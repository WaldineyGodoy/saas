-- Resumo curto da passagem IA -> humano, e o contexto humano de volta para a IA (04/11/2026).
--
-- Pedido do dono:
--   1. O cartão "Por que a IA passou para você" vinha poluído (resumo acumulado,
--      tentativas, fala do cliente, texto de quem passou, tudo repetido). Agora a
--      Edge Function `resumo-passagem` pergunta ao Jev as dúvidas e as objeções e
--      reescreve o cartão no formato curto:
--        Nome / Cidade / Interesse / Principais dúvidas / Dúvidas não respondidas / Objeções
--      O texto original fica guardado em ponte_deskcomm.resumo_passagem.original.
--   2. O mesmo resumo vai para o histórico do lead no CRM B2W (crm_history, entity_type 'lead').
--   3. A equipe às vezes continua o atendimento por OUTRO WhatsApp e, ao terminar,
--      devolve o contato ao automático e escreve uma nota interna no chat do
--      Deskcomm. Na retomada, a IA precisa ler o resumo e as notas.
--
-- Por que o item 3 precisa de nós: o Deskcomm já tenta (lib/escalacao/retomada.ts
-- grava um lead_checkpoint com as notas ao devolver), mas grava SEM conversation_id
-- e service_revision. O turno do agente lê o checkpoint filtrando por esse limite
-- de atendimento (latestCheckpoint com currentExecutionBoundary), então aquele
-- checkpoint nunca é lido. Aqui o checkpoint nasce com o limite certo:
--   · na devolução (contacts.force_human true -> false);
--   · em nota interna escrita depois da devolução;
--   · na primeira mensagem do cliente num atendimento NOVO (conversa reaberta muda
--     service_revision, e o agente começaria do zero).

-- ── Tabelas ───────────────────────────────────────────────────────────────────

create table if not exists ponte_deskcomm.resumo_passagem (
  passagem_id     uuid primary key references public.passagens_de_atendimento(id) on delete cascade,
  organization_id uuid not null,
  contact_id      uuid not null,
  conversation_id uuid not null,
  b2w_lead_id     uuid,
  resumo          text,
  dados           jsonb,
  original        jsonb,
  history_id      uuid,
  tentativas      integer not null default 0,
  ultimo_erro     text,
  gerado_em       timestamptz,
  criado_em       timestamptz not null default now()
);
create index if not exists resumo_passagem_contato_idx
  on ponte_deskcomm.resumo_passagem (contact_id, gerado_em desc);

create table if not exists ponte_deskcomm.contexto_humano_injetado (
  id               bigserial primary key,
  contact_id       uuid not null,
  conversation_id  uuid not null,
  service_revision bigint,
  demanda_id       uuid,
  demanda_revision bigint,
  passagem_id      uuid,
  notas_ate        timestamptz,
  checkpoint_id    uuid,
  motivo           text not null,
  criado_em        timestamptz not null default now()
);
create index if not exists contexto_humano_injetado_idx
  on ponte_deskcomm.contexto_humano_injetado (contact_id, conversation_id, service_revision);

-- ── Leitura para a Edge Function ───────────────────────────────────────────────

create or replace function public.ponte_deskcomm_passagens_para_resumir(
  p_limite integer default 10,
  p_passagem uuid default null
)
returns table (
  passagem_id uuid, organization_id uuid, contact_id uuid, conversation_id uuid,
  criado_em timestamptz, motivo_codigo text, title text, content text,
  contato_nome text, b2w_lead_id uuid, lead_nome text, cidade text, uf text,
  temperatura text, categoria_slug text, categoria_nome text, entrada boolean
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.organization_id, p.contact_id, p.conversation_id,
         p.criado_em, p.motivo_codigo, p.title, p.content,
         ct.name, v.b2w_lead_id, l.name, l.cidade, l.uf,
         l.qualificacao->'jev'->>'temperatura',
         v.categoria, cat.nome, coalesce(cat.entrada, true)
    from passagens_de_atendimento p
    join contacts ct on ct.id = p.contact_id
    left join lateral (
      -- O card de PRODUTO vence o da Recepção; entre iguais, o mexido por último.
      select vv.b2w_lead_id, vv.categoria
        from ponte_deskcomm.vinculos vv
        left join ponte_deskcomm.categorias c2 on c2.slug = vv.categoria
       where vv.contact_id = p.contact_id
       order by (c2.entrada is true), vv.atualizado_em desc nulls last
       limit 1
    ) v on true
    left join ponte_deskcomm.categorias cat on cat.slug = v.categoria
    left join leads l on l.id = v.b2w_lead_id
   where p.body not like 'Cliente Anonimizado%'
     and (
       (p_passagem is not null and p.id = p_passagem)
       or (p_passagem is null
           and p.criado_em > now() - interval '3 days'
           and not exists (
             select 1 from ponte_deskcomm.resumo_passagem r
              where r.passagem_id = p.id
                and (r.gerado_em is not null or r.tentativas >= 3)))
     )
   order by p.criado_em
   limit greatest(1, least(coalesce(p_limite, 10), 50));
$$;

-- ── Escrita: cartão curto + histórico do lead ─────────────────────────────────

create or replace function public.ponte_deskcomm_gravar_resumo_passagem(
  p_passagem uuid,
  p_resumo text,
  p_titulo text,
  p_dados jsonb
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  p      passagens_de_atendimento%rowtype;
  v_lead uuid := nullif(p_dados->>'b2w_lead_id', '')::uuid;
  v_hist uuid;
begin
  if coalesce(trim(p_resumo), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'resumo_vazio');
  end if;

  select * into p from passagens_de_atendimento where id = p_passagem for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'passagem_inexistente');
  end if;
  if exists (select 1 from ponte_deskcomm.resumo_passagem
              where passagem_id = p_passagem and gerado_em is not null) then
    return jsonb_build_object('ok', false, 'erro', 'ja_resumida');
  end if;

  insert into ponte_deskcomm.resumo_passagem as r
         (passagem_id, organization_id, contact_id, conversation_id, b2w_lead_id,
          resumo, dados, original, gerado_em)
  values (p.id, p.organization_id, p.contact_id, p.conversation_id, v_lead,
          p_resumo, p_dados,
          jsonb_build_object('title', p.title, 'body', p.body, 'notes', p.notes,
                             'content', p.content, 'tentativas', p.tentativas),
          now())
  on conflict (passagem_id) do update
     set resumo = excluded.resumo, dados = excluded.dados, original = excluded.original,
         b2w_lead_id = excluded.b2w_lead_id, gerado_em = now(), ultimo_erro = null;

  -- O cartão: só o resumo curto. O motivo ("Por que a IA passou") e o aviso ao
  -- cliente continuam vindo das colunas próprias, que não mexemos.
  update passagens_de_atendimento
     set body = p_resumo,
         title = nullif(left(coalesce(p_titulo, ''), 300), ''),
         notes = null,
         content = null,
         tentativas = '[]'::jsonb
   where id = p.id;

  if v_lead is not null then
    insert into crm_history (entity_type, entity_id, content, metadata)
    values ('lead', v_lead,
            'Passagem para atendimento humano ('
              || to_char(p.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ')'
              || E'\n' || p_resumo,
            jsonb_build_object('origem', 'deskcomm_passagem', 'passagem_id', p.id,
                               'motivo', p.motivo_codigo))
    returning id into v_hist;
    update ponte_deskcomm.resumo_passagem set history_id = v_hist where passagem_id = p.id;
  end if;

  return jsonb_build_object('ok', true, 'history_id', v_hist);
end;
$$;

create or replace function public.ponte_deskcomm_falha_resumo_passagem(p_passagem uuid, p_erro text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into ponte_deskcomm.resumo_passagem as r
         (passagem_id, organization_id, contact_id, conversation_id, tentativas, ultimo_erro)
  select p.id, p.organization_id, p.contact_id, p.conversation_id, 1, left(p_erro, 500)
    from passagens_de_atendimento p where p.id = p_passagem
  on conflict (passagem_id) do update
     set tentativas = r.tentativas + 1, ultimo_erro = excluded.ultimo_erro;
$$;

revoke all on function public.ponte_deskcomm_passagens_para_resumir(integer, uuid) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_gravar_resumo_passagem(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.ponte_deskcomm_falha_resumo_passagem(uuid, text) from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_passagens_para_resumir(integer, uuid) to service_role;
grant execute on function public.ponte_deskcomm_gravar_resumo_passagem(uuid, text, text, jsonb) to service_role;
grant execute on function public.ponte_deskcomm_falha_resumo_passagem(uuid, text) to service_role;

-- ── Contexto humano -> memória do agente ──────────────────────────────────────

create or replace function ponte_deskcomm.fn_injetar_contexto_humano(
  p_conversation uuid,
  p_rev bigint,
  p_dem uuid,
  p_demrev bigint,
  p_motivo text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  c        record;
  r        ponte_deskcomm.resumo_passagem%rowtype;
  v_ja     ponte_deskcomm.contexto_humano_injetado%rowtype;
  v_desde  timestamptz;
  v_notas  text;
  v_ate    timestamptz;
  v_texto  text;
  v_ant    record;
  v_cp     uuid;
begin
  select id, organization_id, contact_id into c from conversations where id = p_conversation;
  if c.id is null then return null; end if;

  select * into r
    from ponte_deskcomm.resumo_passagem
   where contact_id = c.contact_id and gerado_em is not null
     and criado_em > now() - interval '30 days'
   order by gerado_em desc limit 1;

  select * into v_ja
    from ponte_deskcomm.contexto_humano_injetado
   where contact_id = c.contact_id and conversation_id = c.id
     and service_revision is not distinct from p_rev
     and demanda_id is not distinct from p_dem
     and demanda_revision is not distinct from p_demrev
   order by id desc limit 1;

  -- Notas internas desde a última passagem (ou 30 dias), de qualquer conversa do contato.
  v_desde := coalesce((select criado_em from passagens_de_atendimento where id = r.passagem_id),
                      now() - interval '30 days');
  if v_ja.id is not null then
    v_desde := greatest(v_desde, coalesce(v_ja.notas_ate, v_desde));
  end if;

  select string_agg('- ' || coalesce(n.created_by_name, 'Equipe') || ' ('
                    || to_char(n.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '): '
                    || left(n.body, 1500), E'\n' order by n.created_at),
         max(n.created_at)
    into v_notas, v_ate
    from conversation_notes n
    join conversations cc on cc.id = n.conversation_id and cc.contact_id = c.contact_id
   where n.created_at > v_desde
     and coalesce(trim(n.body), '') <> '';

  if v_ja.id is not null then
    -- Este atendimento já recebeu o contexto: só entra nota nova.
    if v_notas is null then return null; end if;
    v_texto := 'Nova nota interna da equipe B2W (não mostre ao cliente; trate como combinado):'
               || E'\n' || v_notas;
  else
    if r.passagem_id is null and v_notas is null then return null; end if;
    v_texto := 'CONTEXTO DO ATENDIMENTO HUMANO (registrado pela equipe B2W; use para retomar de forma personalizada):';
    if r.passagem_id is not null then
      v_texto := v_texto || E'\n\nResumo de quando a conversa passou para a equipe ('
                 || to_char(r.gerado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '):'
                 || E'\n' || r.resumo;
    end if;
    if v_notas is not null then
      v_texto := v_texto || E'\n\nNotas internas da equipe (não mostre ao cliente; trate como combinado):'
                 || E'\n' || v_notas;
    end if;
    v_texto := v_texto || E'\n\nAo retomar: cumprimente pelo nome, não repita perguntas já respondidas, '
               || 'trate as dúvidas não respondidas e as objeções acima, e não contradiga o que a equipe combinou.';
  end if;

  -- Continua a memória deste mesmo atendimento, se houver.
  select commitments, objections, next_action, rolling_summary into v_ant
    from lead_checkpoints
   where organization_id = c.organization_id and contact_id = c.contact_id
     and conversation_id = c.id
     and service_revision is not distinct from p_rev
     and demanda_id is not distinct from p_dem
     and demanda_revision is not distinct from p_demrev
   order by seq desc limit 1;

  insert into lead_checkpoints
         (organization_id, contact_id, job_id, commitments, objections, next_action,
          rolling_summary, conversation_id, service_revision, demanda_id, demanda_revision)
  values (c.organization_id, c.contact_id, null,
          coalesce(v_ant.commitments, '[]'::jsonb), coalesce(v_ant.objections, '[]'::jsonb),
          v_ant.next_action,
          case when coalesce(trim(v_ant.rolling_summary), '') = '' then v_texto
               else v_ant.rolling_summary || E'\n\n' || v_texto end,
          c.id, p_rev, p_dem, p_demrev)
  returning id into v_cp;

  insert into ponte_deskcomm.contexto_humano_injetado
         (contact_id, conversation_id, service_revision, demanda_id, demanda_revision,
          passagem_id, notas_ate, checkpoint_id, motivo)
  values (c.contact_id, c.id, p_rev, p_dem, p_demrev,
          r.passagem_id, coalesce(v_ate, v_ja.notas_ate), v_cp, p_motivo);

  return v_cp;
end;
$$;

-- Atalho: limite ATUAL da conversa (devolução e nota).
create or replace function ponte_deskcomm.fn_injetar_contexto_na_conversa(p_conversation uuid, p_motivo text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_rev bigint; v_dem uuid; v_demrev bigint;
begin
  select cv.service_revision, cv.current_demanda_id, d.revision
    into v_rev, v_dem, v_demrev
    from conversations cv left join demandas d on d.id = cv.current_demanda_id
   where cv.id = p_conversation;
  return ponte_deskcomm.fn_injetar_contexto_humano(p_conversation, v_rev, v_dem, v_demrev, p_motivo);
end;
$$;

-- (a) Devolução ao automático: force_human true -> false (só a retomada faz isso).
create or replace function ponte_deskcomm.fn_trg_contexto_na_devolucao()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_conv uuid;
begin
  begin
    select id into v_conv from conversations
     where contact_id = new.id and organization_id = new.organization_id
     order by last_message_at desc nulls last limit 1;
    if v_conv is not null then
      perform ponte_deskcomm.fn_injetar_contexto_na_conversa(v_conv, 'devolucao');
    end if;
  exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('contexto_na_devolucao', new.id, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists trg_ponte_contexto_na_devolucao on public.contacts;
create trigger trg_ponte_contexto_na_devolucao
  after update of force_human on public.contacts
  for each row when (old.force_human is true and new.force_human is false)
  execute function ponte_deskcomm.fn_trg_contexto_na_devolucao();

-- (b) Nota interna escrita com a conversa já de volta à IA.
create or replace function ponte_deskcomm.fn_trg_contexto_na_nota()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean;
begin
  begin
    select ct.force_human is not true
           and cv.assignee_kind is distinct from 'user'
           and cv.contato_trava_humano is not true
      into v_ok
      from conversations cv join contacts ct on ct.id = cv.contact_id
     where cv.id = new.conversation_id;
    if v_ok then
      perform ponte_deskcomm.fn_injetar_contexto_na_conversa(new.conversation_id, 'nota');
    end if;
  exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('contexto_na_nota', new.id, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists trg_ponte_contexto_na_nota on public.conversation_notes;
create trigger trg_ponte_contexto_na_nota
  after insert on public.conversation_notes
  for each row execute function ponte_deskcomm.fn_trg_contexto_na_nota();

-- (c) Primeira mensagem do cliente num atendimento novo (service_revision novo).
create or replace function ponte_deskcomm.fn_trg_contexto_no_atendimento_novo()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean;
begin
  -- Corte barato primeiro: só contato que teve passagem resumida nos últimos 30 dias.
  if not exists (select 1 from ponte_deskcomm.resumo_passagem
                  where contact_id = new.contact_id and gerado_em > now() - interval '30 days') then
    return null;
  end if;
  begin
    if exists (select 1 from ponte_deskcomm.contexto_humano_injetado i
                where i.contact_id = new.contact_id and i.conversation_id = new.conversation_id
                  and i.service_revision is not distinct from new.service_revision
                  and i.demanda_id is not distinct from new.demanda_id
                  and i.demanda_revision is not distinct from new.demanda_revision) then
      return null;
    end if;
    select ct.force_human is not true
           and cv.assignee_kind is distinct from 'user'
           and cv.contato_trava_humano is not true
      into v_ok
      from conversations cv join contacts ct on ct.id = cv.contact_id
     where cv.id = new.conversation_id;
    if v_ok then
      perform ponte_deskcomm.fn_injetar_contexto_humano(
        new.conversation_id, new.service_revision, new.demanda_id, new.demanda_revision, 'atendimento_novo');
    end if;
  exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('contexto_no_atendimento_novo', new.id, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists trg_ponte_contexto_no_atendimento_novo on public.messages;
create trigger trg_ponte_contexto_no_atendimento_novo
  after insert or update of service_revision on public.messages
  for each row when (new.direction = 'inbound' and new.service_revision is not null)
  execute function ponte_deskcomm.fn_trg_contexto_no_atendimento_novo();

-- ── Disparo do resumo ─────────────────────────────────────────────────────────

create or replace function ponte_deskcomm.fn_trg_resumir_passagem()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform ponte_deskcomm.fn_chamar_funcao('resumo-passagem', jsonb_build_object('passagem_id', new.id));
  exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('resumir_passagem', new.id, sqlstate, sqlerrm);
  end;
  return null;
end;
$$;

drop trigger if exists trg_ponte_resumir_passagem on public.passagens_de_atendimento;
create trigger trg_ponte_resumir_passagem
  after insert on public.passagens_de_atendimento
  for each row execute function ponte_deskcomm.fn_trg_resumir_passagem();

-- Rede de segurança: o que o disparo perdeu (Jev fora, função fora) sai no cron.
select cron.unschedule('ponte-deskcomm-resumo-passagem')
 where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-resumo-passagem');
select cron.schedule(
  'ponte-deskcomm-resumo-passagem',
  '*/5 * * * *',
  $cron$
    select ponte_deskcomm.fn_chamar_funcao('resumo-passagem', '{}'::jsonb)
     where exists (
       select 1 from public.passagens_de_atendimento p
        where p.criado_em > now() - interval '3 days'
          and p.criado_em < now() - interval '2 minutes'
          and not exists (select 1 from ponte_deskcomm.resumo_passagem r
                           where r.passagem_id = p.id
                             and (r.gerado_em is not null or r.tentativas >= 3)));
  $cron$
);
