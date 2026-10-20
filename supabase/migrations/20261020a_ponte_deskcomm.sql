-- Ponte DeskcommCRM <-> CRM B2W (leads)
--
-- Os dois sistemas moram no MESMO projeto Supabase (abbysvxnnhwvvzhftoms):
--   * Deskcomm: contacts, crm_pipelines, crm_stages, crm_leads (cards), conversations, messages
--   * B2W:      leads (status enum lead_status, tags text[], qualificacao jsonb)
--
-- Tudo da ponte fica no schema `ponte_deskcomm`, para nao colidir com as tabelas
-- que o baseline.sql do Deskcomm cria e recria a cada atualizacao.
--
-- Sentidos:
--   1. Deskcomm -> B2W (este arquivo, por gatilho): card criado/movido/etiquetado
--      no Deskcomm cria ou atualiza o lead da B2W, com a tag da categoria e o
--      status correspondente a etapa.
--   2. B2W -> Deskcomm (fila + Edge Function `deskcomm-ponte`): mudar o status do
--      lead no CRM da B2W move o card no Deskcomm PELA API dele (MCP), porque um
--      UPDATE direto em crm_leads.stage_id nao emite `lead.stage_changed` e o
--      follow-up / automacoes do Deskcomm nao veriam a mudanca.
--
-- Antiloop: quem escreve marca a transacao com `set_config('ponte.origem', ...)`.
--
-- FALHA ABERTA: o gatilho do sentido 1 roda dentro da transacao do Deskcomm. Um
-- erro aqui derrubaria o atendimento, entao todo o corpo esta em
-- `exception when others` e o erro vai para ponte_deskcomm.erros.

create schema if not exists ponte_deskcomm;
revoke all on schema ponte_deskcomm from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Categorias (linhas de negocio) — uma por funil de produto no Deskcomm
-- ---------------------------------------------------------------------------
create table if not exists ponte_deskcomm.categorias (
  slug          text primary key,
  nome          text not null,
  tag_b2w       text,                   -- tag usada em leads.tags (src/lib/tagHelpers.js); nula na entrada
  pipeline_id   uuid unique references public.crm_pipelines(id) on delete set null,
  -- Funil de ENTRADA (Recepcao): o contato ainda nao disse o produto. Cria o
  -- lead em `sem_interacao` (1a coluna do kanban da B2W) e NUNCA mexe em lead
  -- que ja existe — um cliente antigo que manda "oi" nao volta para o comeco.
  entrada       boolean not null default false,
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now(),
  constraint categorias_tag_ou_entrada check (entrada or tag_b2w is not null)
);

insert into ponte_deskcomm.categorias (slug, nome, tag_b2w, entrada) values
  ('triagem', 'Recepção (sem produto definido)', null, true)
on conflict (slug) do nothing;

insert into ponte_deskcomm.categorias (slug, nome, tag_b2w) values
  ('energia_assinatura', 'Energia por Assinatura',        '#Energia por Assinatura'),
  ('usina_investimento', 'Usinas de Investimento',        '#Investidor'),
  ('eletropostos',       'Eletropostos',                  '#Eletropostos'),
  ('cotas',              'Cotas',                         '#Cotas'),
  ('arrendamento',       'Áreas de Arrendamento',         '#Arrendamento de area'),
  ('comercializadora',   'Gestora ou Comercializadora',   '#Comercializadora'),
  ('vagas',              'Locação de Vagas',              '#Locação de Vagas')
on conflict (slug) do nothing;

-- A entrada comeca no funil padrao do Deskcomm (hoje "Clientes"), onde nasce
-- todo contato novo do WhatsApp. Os funis de produto sao ligados depois de
-- criados (update ponte_deskcomm.categorias set pipeline_id = ...).
update ponte_deskcomm.categorias
   set pipeline_id = (select id from public.crm_pipelines
                       where is_default and not is_archived
                       order by created_at limit 1)
 where slug = 'triagem' and pipeline_id is null;

-- ---------------------------------------------------------------------------
-- 2. Etapa do Deskcomm -> status da B2W, pelo NOME da etapa (independe de uuid)
--    Etapas is_won / is_lost tem regra propria (ver fn_status_da_etapa).
-- ---------------------------------------------------------------------------
create table if not exists ponte_deskcomm.etapa_status (
  padrao      text primary key,              -- comparado com lower(nome da etapa) via LIKE
  status_b2w  public.lead_status not null,
  prioridade  int not null default 100       -- menor vence quando dois padroes casam
);

insert into ponte_deskcomm.etapa_status (padrao, status_b2w, prioridade) values
  ('%contrato%',  'contrato_enviado', 10),
  ('%reuni%',     'reuniao_agendada', 20),
  ('%apresenta%', 'reuniao_agendada', 21),
  ('%negocia%',   'negociacao',       30),
  ('%proposta%',  'negociacao',       31),
  ('%simula%',    'simulacao',        40),
  ('%sem resposta%', 'sem_interacao', 50),
  ('%novo%',      'simulacao',        90),
  ('%qualifica%', 'simulacao',        91),
  ('%entendendo%','simulacao',        92),
  ('%respondi%',  'simulacao',        93)
on conflict (padrao) do nothing;

-- status da B2W -> nome da etapa de destino no Deskcomm (sentido 2)
create table if not exists ponte_deskcomm.status_etapa (
  status_b2w   public.lead_status primary key,
  etapa_padrao text not null                 -- LIKE contra lower(crm_stages.name) do funil do card
);

insert into ponte_deskcomm.status_etapa (status_b2w, etapa_padrao) values
  ('simulacao',        '%simula%'),
  ('negociacao',       '%negocia%'),
  ('reuniao_agendada', '%reuni%'),
  ('contrato_enviado', '%contrato%'),
  ('sem_interacao',    '%sem resposta%'),
  ('ativacao',         '%fechou%'),
  ('ativo',            '%fechou%'),
  ('pago',             '%fechou%'),
  ('negocio_perdido',  '%não fechou%')
on conflict (status_b2w) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Vinculo card <-> lead. Um contato pode ter 2 cards (dois produtos); os dois
--    apontam para o MESMO lead da B2W (a pessoa), que acumula as tags.
-- ---------------------------------------------------------------------------
create table if not exists ponte_deskcomm.vinculos (
  deskcomm_lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  b2w_lead_id      uuid not null references public.leads(id) on delete cascade,
  contact_id       uuid,
  organization_id  uuid not null,
  categoria        text references ponte_deskcomm.categorias(slug),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists vinculos_b2w_idx on ponte_deskcomm.vinculos (b2w_lead_id);

create table if not exists ponte_deskcomm.erros (
  id         bigserial primary key,
  onde       text not null,
  ref_id     uuid,
  sqlstate   text,
  mensagem   text,
  criado_em  timestamptz not null default now()
);

-- Fila do sentido 2 (B2W -> Deskcomm), drenada pela Edge Function deskcomm-ponte
create table if not exists ponte_deskcomm.fila (
  id               bigserial primary key,
  deskcomm_lead_id uuid not null,
  b2w_lead_id      uuid not null,
  status_b2w       public.lead_status not null,
  tentativas       int not null default 0,
  ultimo_erro      text,
  processado_em    timestamptz,
  criado_em        timestamptz not null default now()
);
create index if not exists fila_pendente_idx on ponte_deskcomm.fila (criado_em) where processado_em is null;

-- ---------------------------------------------------------------------------
-- Funcoes auxiliares
-- ---------------------------------------------------------------------------

-- So digitos, com DDI 55 (mesma regra do playbook: todo WhatsApp leva 55)
create or replace function ponte_deskcomm.fn_telefone(p text) returns text
language sql immutable as $$
  select case
    when d is null or d = '' then null
    when length(d) in (10, 11) then '55' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Chama uma Edge Function da ponte com o token do Vault (padrao do emissor:
-- `cron:ponte_token` + `cron:anon_key`). Sem o segredo, nao chama — a fila
-- espera o cron das 10 em 10 minutos.
create or replace function ponte_deskcomm.fn_chamar_funcao(p_funcao text, p_corpo jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_anon  text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'cron:ponte_token';
  select decrypted_secret into v_anon  from vault.decrypted_secrets where name = 'cron:anon_key';
  if v_token is null or v_anon is null then
    return null;
  end if;
  return net.http_post(
    url     := 'https://abbysvxnnhwvvzhftoms.supabase.co/functions/v1/' || p_funcao,
    body    := p_corpo,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-ponte-token', v_token
    ),
    timeout_milliseconds := 60000
  );
end
$$;

create or replace function ponte_deskcomm.fn_status_da_etapa(p_stage_id uuid)
returns public.lead_status
language sql stable as $$
  select case
    when s.is_won  then 'ativacao'::public.lead_status
    when s.is_lost then 'negocio_perdido'::public.lead_status
    else (select es.status_b2w from ponte_deskcomm.etapa_status es
           where lower(s.name) like es.padrao
           order by es.prioridade limit 1)
  end
  from public.crm_stages s where s.id = p_stage_id
$$;

-- ---------------------------------------------------------------------------
-- Sentido 1: card do Deskcomm -> lead da B2W
-- ---------------------------------------------------------------------------
create or replace function ponte_deskcomm.fn_card_para_lead() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
declare
  v_cat      ponte_deskcomm.categorias%rowtype;
  v_contato  record;
  v_fone     text;
  v_status   public.lead_status;
  v_lead_id  uuid;
begin
  if coalesce(current_setting('ponte.origem', true), '') = 'b2w' then
    return new;
  end if;

  begin
    select * into v_cat from ponte_deskcomm.categorias
     where pipeline_id = new.pipeline_id and ativa;
    -- Funil sem categoria: fora da ponte.
    if not found then
      return new;
    end if;

    -- O roteador TRANSFERE o card da Recepcao: cria o clone no funil do produto
    -- e encerra a origem como perda com este motivo canonico (Deskcomm,
    -- lib/leads/motivo-da-perda.ts). Nao e perda comercial — sem isto o lead da
    -- B2W iria para `negocio_perdido` logo depois de entrar no produto.
    if new.status = 'lost' and new.lost_reason = 'moved_to_another_pipeline' then
      return new;
    end if;

    select c.name, c.display_name, c.email, c.phone_number, c.is_personal, c.is_anonymized
      into v_contato
      from contacts c where c.id = new.contact_id;
    if not found or v_contato.is_personal or v_contato.is_anonymized then
      return new;
    end if;

    v_fone   := ponte_deskcomm.fn_telefone(v_contato.phone_number);
    v_status := case when v_cat.entrada then 'sem_interacao'::public.lead_status
                     else ponte_deskcomm.fn_status_da_etapa(new.stage_id) end;

    select b2w_lead_id into v_lead_id from ponte_deskcomm.vinculos
     where deskcomm_lead_id = new.id;

    if v_lead_id is null and v_fone is not null then
      select l.id into v_lead_id from leads l
       where ponte_deskcomm.fn_telefone(l.phone) = v_fone
         and l.arquivado_em is null
       order by l.updated_at desc nulls last
       limit 1;
    end if;

    perform set_config('ponte.origem', 'deskcomm', true);

    if v_lead_id is null then
      insert into leads (name, phone, email, status, tags)
      values (
        -- no Deskcomm o nome do WhatsApp costuma vir so em display_name
        coalesce(nullif(trim(v_contato.name), ''), nullif(trim(v_contato.display_name), ''), new.title),
        v_fone,
        v_contato.email,
        coalesce(v_status, 'simulacao'),
        case when v_cat.tag_b2w is null then '{}'::text[] else array[v_cat.tag_b2w] end
      )
      returning id into v_lead_id;
    elsif not v_cat.entrada then
      update leads l set
        tags   = case when v_cat.tag_b2w = any(coalesce(l.tags, '{}')) then l.tags
                      else array_append(coalesce(l.tags, '{}'), v_cat.tag_b2w) end,
        -- Quem ja fechou (ativacao/ativo/pago) nao e rebaixado por um card de
        -- outro produto: so ganha a tag nova. O funil do produto conta a
        -- historia dele no Deskcomm.
        status = case when l.status in ('ativacao', 'ativo', 'pago') then l.status
                      else coalesce(v_status, l.status) end,
        email  = coalesce(l.email, v_contato.email),
        updated_at = now()
      where l.id = v_lead_id
        and (tg_op = 'INSERT'
             or new.stage_id is distinct from old.stage_id
             or new.pipeline_id is distinct from old.pipeline_id
             or not (v_cat.tag_b2w = any(coalesce(l.tags, '{}'))));
    end if;

    insert into ponte_deskcomm.vinculos (deskcomm_lead_id, b2w_lead_id, contact_id, organization_id, categoria)
    values (new.id, v_lead_id, new.contact_id, new.organization_id, v_cat.slug)
    on conflict (deskcomm_lead_id) do update
      set b2w_lead_id = excluded.b2w_lead_id,
          categoria   = excluded.categoria,
          atualizado_em = now();

    perform set_config('ponte.origem', '', true);
  exception when others then
    perform set_config('ponte.origem', '', true);
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_card_para_lead', new.id, sqlstate, sqlerrm);
  end;

  return new;
end
$$;

drop trigger if exists trg_ponte_card_para_lead on public.crm_leads;
create trigger trg_ponte_card_para_lead
  after insert or update of stage_id, pipeline_id, status on public.crm_leads
  for each row execute function ponte_deskcomm.fn_card_para_lead();

-- ---------------------------------------------------------------------------
-- Sentido 2: status do lead da B2W -> fila -> Edge Function deskcomm-ponte
-- ---------------------------------------------------------------------------
create or replace function ponte_deskcomm.fn_lead_para_fila() returns trigger
language plpgsql security definer
set search_path = public, ponte_deskcomm, pg_temp
as $$
begin
  if coalesce(current_setting('ponte.origem', true), '') = 'deskcomm' then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    insert into ponte_deskcomm.fila (deskcomm_lead_id, b2w_lead_id, status_b2w)
    select v.deskcomm_lead_id, new.id, new.status
      from ponte_deskcomm.vinculos v
      join crm_leads cl on cl.id = v.deskcomm_lead_id and cl.status = 'open'
     where v.b2w_lead_id = new.id;

    if found then
      -- Mesmo padrao do fn_originador_gerar_short_url: o POST so sai apos o COMMIT.
      perform ponte_deskcomm.fn_chamar_funcao('deskcomm-ponte');
    end if;
  exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_lead_para_fila', new.id, sqlstate, sqlerrm);
  end;
  return new;
end
$$;

drop trigger if exists trg_ponte_lead_para_fila on public.leads;
create trigger trg_ponte_lead_para_fila
  after update of status on public.leads
  for each row execute function ponte_deskcomm.fn_lead_para_fila();

-- ---------------------------------------------------------------------------
-- Acesso: so a service role (Edge Functions). Usuario logado do CRM/app NAO le
-- este schema — o app tambem atende embaixadores e assinantes. A tela do lead
-- recebe os dados do Deskcomm por RPC propria, numa fase seguinte.
-- ---------------------------------------------------------------------------
grant usage on schema ponte_deskcomm to service_role;
grant all on all tables in schema ponte_deskcomm to service_role;
grant all on all sequences in schema ponte_deskcomm to service_role;
grant execute on all functions in schema ponte_deskcomm to service_role;

-- O PostgREST nao expoe o schema ponte_deskcomm (nem deve). As Edge Functions
-- falam com ele por estas RPCs em public, todas fechadas para anon/authenticated.

-- Confere o token do cron no BANCO (o valor nunca sai do Vault).
create or replace function public.ponte_deskcomm_token_confere(p_token text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_token <> '' and p_token = (
    select decrypted_secret from vault.decrypted_secrets where name = 'cron:ponte_token'), false)
$$;

create or replace function public.ponte_deskcomm_fila_pendente(p_limite int default 20)
returns table (id bigint, deskcomm_lead_id uuid, b2w_lead_id uuid, status_b2w text, tentativas int, etapa_padrao text)
language sql stable security definer set search_path = public, ponte_deskcomm, pg_temp as $$
  select f.id, f.deskcomm_lead_id, f.b2w_lead_id, f.status_b2w::text, f.tentativas, se.etapa_padrao
    from ponte_deskcomm.fila f
    left join ponte_deskcomm.status_etapa se on se.status_b2w = f.status_b2w
   where f.processado_em is null and f.tentativas < 5
   order by f.criado_em
   limit greatest(1, least(p_limite, 100))
$$;

create or replace function public.ponte_deskcomm_fila_marcar(p_id bigint, p_ok boolean, p_erro text default null)
returns void
language sql security definer set search_path = public, ponte_deskcomm, pg_temp as $$
  update ponte_deskcomm.fila set
    processado_em = case when p_ok then now() else processado_em end,
    tentativas    = case when p_ok then tentativas else tentativas + 1 end,
    ultimo_erro   = left(p_erro, 300)
  where id = p_id
$$;

-- Cards abertos e vinculados cuja conversa teve mensagem do cliente depois da
-- ultima avaliacao do Jev (leads.qualificacao->'jev'->>'avaliado_em').
create or replace function public.ponte_deskcomm_para_avaliar(p_limite int default 25)
returns table (deskcomm_lead_id uuid, b2w_lead_id uuid, contact_id uuid, organization_id uuid,
               categoria text, categoria_nome text, etapa text, ultima_entrada timestamptz)
language sql stable security definer set search_path = public, ponte_deskcomm, pg_temp as $$
  select v.deskcomm_lead_id, v.b2w_lead_id, v.contact_id, v.organization_id,
         v.categoria, cat.nome, st.name, conv.ultima
    from ponte_deskcomm.vinculos v
    join crm_leads cl on cl.id = v.deskcomm_lead_id and cl.status = 'open'
    join leads l on l.id = v.b2w_lead_id
    left join ponte_deskcomm.categorias cat on cat.slug = v.categoria
    left join crm_stages st on st.id = cl.stage_id
    join lateral (
      select max(c.last_inbound_at) as ultima from conversations c
       where c.contact_id = v.contact_id and c.organization_id = v.organization_id
    ) conv on conv.ultima is not null
   where conv.ultima > coalesce((l.qualificacao->'jev'->>'avaliado_em')::timestamptz, '-infinity')
   order by conv.ultima desc
   limit greatest(1, least(p_limite, 100))
$$;

create or replace function public.ponte_deskcomm_categorias()
returns table (slug text, nome text, tag_b2w text)
language sql stable security definer set search_path = public, ponte_deskcomm, pg_temp as $$
  select slug, nome, tag_b2w from ponte_deskcomm.categorias where ativa order by nome
$$;

revoke execute on function public.ponte_deskcomm_token_confere(text)        from public, anon, authenticated;
revoke execute on function public.ponte_deskcomm_fila_pendente(int)         from public, anon, authenticated;
revoke execute on function public.ponte_deskcomm_fila_marcar(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public.ponte_deskcomm_para_avaliar(int)          from public, anon, authenticated;
revoke execute on function public.ponte_deskcomm_categorias()               from public, anon, authenticated;
grant  execute on function public.ponte_deskcomm_token_confere(text)        to service_role;
grant  execute on function public.ponte_deskcomm_fila_pendente(int)         to service_role;
grant  execute on function public.ponte_deskcomm_fila_marcar(bigint, boolean, text) to service_role;
grant  execute on function public.ponte_deskcomm_para_avaliar(int)          to service_role;
grant  execute on function public.ponte_deskcomm_categorias()               to service_role;

-- ---------------------------------------------------------------------------
-- Cron: a cada 10 min drena a fila (rede de seguranca do gatilho) e avalia a
-- temperatura dos leads com mensagem nova. Minutos fora do topo da hora.
-- Pre-requisito: segredos `cron:ponte_token` e `cron:anon_key` no Vault.
-- ---------------------------------------------------------------------------
select cron.unschedule('ponte-deskcomm-fila')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-fila');
select cron.schedule('ponte-deskcomm-fila', '3-59/10 * * * *',
  $cron$ select ponte_deskcomm.fn_chamar_funcao('deskcomm-ponte') $cron$);

select cron.unschedule('ponte-deskcomm-jev')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-jev');
select cron.schedule('ponte-deskcomm-jev', '7-59/10 * * * *',
  $cron$ select ponte_deskcomm.fn_chamar_funcao('jev-temperatura', '{"limite": 25}'::jsonb) $cron$);
