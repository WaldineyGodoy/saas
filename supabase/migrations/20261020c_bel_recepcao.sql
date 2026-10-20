-- Bel, a recepcao do WhatsApp (spec docs/superpowers/specs/2026-10-20-bel-recepcao-design.md).
--
-- 1) Normalizacao: ponte_deskcomm.fn_sem_acento, ponte_deskcomm.fn_uf.
-- 2) RPCs do servidor MCP b2w-mcp (so service_role): b2w_mcp_concessionaria, b2w_mcp_identificar.
-- 3) Nao-lead: fn_card_para_lead ignora contato com tag nao_lead; marcar a tag
--    arquiva o lead "Sem Interacao" intocado e desfaz o vinculo.
-- 4) Campos do card -> lead B2W: antes de gravar o card, preenche a
--    concessionaria pela cidade/UF e herda o rastreio do contato; depois,
--    copia cidade, UF, concessionaria, consumo, origem, indicado por e lista
--    de espera para o lead (so onde estiver vazio). Nome do contato -> lead.
-- 5) Codigo de rastreio do site "(cód. IND-xxxxxxxx | IG | GG | FB)" na
--    mensagem recebida -> contacts.custom_fields.ponte_rastreio.
-- 6) Termometro (Jev) so em funil de produto, com >= 3 mensagens do cliente
--    desde que o card chegou ao funil.

-- ---------------------------------------------------------------------------
-- 1. Normalizacao (mesma regra de supabase/functions/b2w-mcp/logica.ts)
-- ---------------------------------------------------------------------------
create or replace function ponte_deskcomm.fn_sem_acento(p text)
returns text language sql immutable
as $$
    select btrim(regexp_replace(lower(translate(coalesce(p, ''),
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'))
$$;

create or replace function ponte_deskcomm.fn_uf(p text)
returns text language sql immutable
as $$
    select case
        when upper(btrim(replace(coalesce(p, ''), '.', ''))) in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
            'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
            then upper(btrim(replace(p, '.', '')))
        else (array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
                    'RJ','RN','RS','RO','RR','SC','SP','SE','TO'])[
              array_position(array['acre','alagoas','amapa','amazonas','bahia','ceara','distrito federal',
                    'espirito santo','goias','maranhao','mato grosso','mato grosso do sul','minas gerais','para',
                    'paraiba','parana','pernambuco','piaui','rio de janeiro','rio grande do norte',
                    'rio grande do sul','rondonia','roraima','santa catarina','sao paulo','sergipe','tocantins'],
                    ponte_deskcomm.fn_sem_acento(p))]
    end
$$;

-- ---------------------------------------------------------------------------
-- 2. RPCs do b2w-mcp
-- ---------------------------------------------------------------------------
create or replace function public.b2w_mcp_concessionaria(p_cidade text, p_uf text)
returns jsonb language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select coalesce(
        -- btrim: a tabela tem siglas com espaco sobrando ("RS ", "SP ", "GO ").
        (select jsonb_build_object(
                    'encontrada', true, 'cidade', btrim(c."Município"), 'uf', btrim(c."UF"),
                    'concessionaria', btrim(c."Concessionaria"),
                    'atende_assinatura', exists (select 1 from planos_distribuidoras pd
                                                  where pd.concessionaria = btrim(c."Concessionaria")))
           from "Concessionaria" c
          where ponte_deskcomm.fn_sem_acento(c."Município") = ponte_deskcomm.fn_sem_acento(p_cidade)
            and upper(btrim(c."UF")) = ponte_deskcomm.fn_uf(p_uf)
          limit 1),
        jsonb_build_object('encontrada', false, 'cidade', p_cidade, 'uf', ponte_deskcomm.fn_uf(p_uf),
                           'concessionaria', null, 'atende_assinatura', false))
$$;

-- Cliente ativo: assinante (contrato assinado/ativo/inadimplente), investidor
-- (fornecedor ativo/contrato assinado) ou originador ativo. Lead que voltou:
-- lead B2W criado ANTES da conversa atual (mais de 2 h), porque a ponte cria o
-- lead no primeiro "oi". So devolve tipo e primeiro nome.
create or replace function public.b2w_mcp_identificar(p_telefone text)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_tel  text := ponte_deskcomm.fn_telefone(p_telefone);
    v_nome text;
begin
    if v_tel is null then
        return jsonb_build_object('tipo', 'novo', 'primeiro_nome', null);
    end if;

    select n into v_nome from (
        select s.name as n from subscribers s
         where s.status in ('contrato_assinado', 'ativo', 'ativo_inadimplente')
           and ponte_deskcomm.fn_telefone(s.phone) = v_tel
        union all
        select f.name from suppliers f
         where f.status in ('ativo', 'contrato_assinado') and ponte_deskcomm.fn_telefone(f.phone) = v_tel
        union all
        select o.name from originators_v2 o
         where o.ativo and ponte_deskcomm.fn_telefone(o.phone) = v_tel
    ) t limit 1;
    if found then
        return jsonb_build_object('tipo', 'cliente_ativo',
                                  'primeiro_nome', nullif(split_part(btrim(coalesce(v_nome, '')), ' ', 1), ''));
    end if;

    select l.name into v_nome from leads l
     where ponte_deskcomm.fn_telefone(l.phone) = v_tel
       and l.arquivado_em is null
       and l.created_at < now() - interval '2 hours'
     order by l.updated_at desc nulls last
     limit 1;
    if found then
        return jsonb_build_object('tipo', 'lead_retorno',
                                  'primeiro_nome', nullif(split_part(btrim(coalesce(v_nome, '')), ' ', 1), ''));
    end if;

    return jsonb_build_object('tipo', 'novo', 'primeiro_nome', null);
end
$$;

revoke all on function public.b2w_mcp_concessionaria(text, text) from public, anon, authenticated;
revoke all on function public.b2w_mcp_identificar(text) from public, anon, authenticated;
grant execute on function public.b2w_mcp_concessionaria(text, text) to service_role;
grant execute on function public.b2w_mcp_identificar(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Nao-lead
-- ---------------------------------------------------------------------------
-- Mesma funcao da migration 20261020a, com um unico acrescimo: contato com a
-- tag nao_lead (marcada pela Bel em spam, fornecedor, candidato, engano) nao
-- gera nem atualiza lead.
create or replace function ponte_deskcomm.fn_card_para_lead()
returns trigger
language plpgsql security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $function$
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
    if not found then
      return new;
    end if;

    if new.status = 'lost' and new.lost_reason = 'moved_to_another_pipeline' then
      return new;
    end if;

    select c.name, c.display_name, c.email, c.phone_number, c.is_personal, c.is_anonymized, c.tags
      into v_contato
      from contacts c where c.id = new.contact_id;
    if not found or v_contato.is_personal or v_contato.is_anonymized
       or 'nao_lead' = any(coalesce(v_contato.tags, '{}')) then
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
$function$;

-- ---------------------------------------------------------------------------
-- 4. Campos do card -> lead B2W
-- ---------------------------------------------------------------------------

-- ANTES de gravar o card (so funis da ponte): herda origem/indicado_por do
-- rastreio do contato e preenche a concessionaria pela cidade + UF.
create or replace function ponte_deskcomm.fn_card_campos_preencher()
returns trigger
language plpgsql security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
    v_cf   jsonb := coalesce(new.custom_fields, '{}'::jsonb);
    v_rast jsonb;
    v_conc jsonb;
begin
    if not exists (select 1 from ponte_deskcomm.categorias where pipeline_id = new.pipeline_id and ativa) then
        return new;
    end if;
    begin
        select c.custom_fields->'ponte_rastreio' into v_rast from contacts c where c.id = new.contact_id;
        if v_rast is not null then
            if coalesce(v_cf->>'origem', '') = '' and coalesce(v_rast->>'origem', '') <> '' then
                v_cf := v_cf || jsonb_build_object('origem', v_rast->>'origem');
            end if;
            if coalesce(v_cf->>'indicado_por', '') = '' and coalesce(v_rast->>'indicado_por', '') <> '' then
                v_cf := v_cf || jsonb_build_object('indicado_por', v_rast->>'indicado_por');
            end if;
        end if;

        if coalesce(v_cf->>'cidade', '') <> '' and coalesce(v_cf->>'uf', '') <> ''
           and coalesce(v_cf->>'concessionaria', '') = '' then
            v_conc := public.b2w_mcp_concessionaria(v_cf->>'cidade', v_cf->>'uf');
            if (v_conc->>'encontrada')::boolean then
                v_cf := v_cf || jsonb_build_object('concessionaria', v_conc->>'concessionaria');
            end if;
        end if;

        if v_cf is distinct from coalesce(new.custom_fields, '{}'::jsonb) then
            new.custom_fields := v_cf;
        end if;
    exception when others then
        insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
        values ('fn_card_campos_preencher', new.id, sqlstate, sqlerrm);
    end;
    return new;
end
$$;

drop trigger if exists trg_ponte_card_campos_preencher on public.crm_leads;
create trigger trg_ponte_card_campos_preencher
    before insert or update of custom_fields on public.crm_leads
    for each row execute function ponte_deskcomm.fn_card_campos_preencher();

-- DEPOIS de gravar o card: copia para o lead B2W vinculado, so onde estiver
-- vazio. O nome do gatilho ordena depois de trg_ponte_card_para_lead, que cria
-- o vinculo no INSERT.
create or replace function ponte_deskcomm.fn_card_campos_para_lead()
returns trigger
language plpgsql security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
    v_lead uuid;
    v_cf   jsonb := coalesce(new.custom_fields, '{}'::jsonb);
    v_rast jsonb;
    v_qual jsonb;
    v_kwh  numeric;
begin
    if coalesce(current_setting('ponte.origem', true), '') = 'b2w' then
        return new;
    end if;
    if tg_op = 'UPDATE' and new.custom_fields is not distinct from old.custom_fields then
        return new;
    end if;
    begin
        select b2w_lead_id into v_lead from ponte_deskcomm.vinculos where deskcomm_lead_id = new.id;
        if v_lead is null then
            return new;
        end if;
        select c.custom_fields->'ponte_rastreio' into v_rast from contacts c where c.id = new.contact_id;

        v_kwh := case when (v_cf->>'consumo_kwh') ~ '^\s*\d+([.,]\d+)?\s*$'
                      then replace(btrim(v_cf->>'consumo_kwh'), ',', '.')::numeric end;
        v_qual := jsonb_strip_nulls(jsonb_build_object(
            'origem',       nullif(v_cf->>'origem', ''),
            'indicado_por', nullif(v_cf->>'indicado_por', ''),
            'lista_espera', case when v_cf ? 'lista_espera' then v_cf->'lista_espera' end));

        perform set_config('ponte.origem', 'deskcomm', true);
        update leads l set
            cidade         = coalesce(nullif(l.cidade, ''), nullif(btrim(v_cf->>'cidade'), '')),
            uf             = coalesce(nullif(l.uf, ''), ponte_deskcomm.fn_uf(v_cf->>'uf')),
            concessionaria = coalesce(nullif(l.concessionaria, ''), nullif(v_cf->>'concessionaria', '')),
            consumo_kwh    = coalesce(l.consumo_kwh, v_kwh),
            qualificacao   = case when v_qual = '{}'::jsonb then l.qualificacao
                                  else coalesce(l.qualificacao, '{}'::jsonb)
                                       || jsonb_build_object('deskcomm',
                                              coalesce(l.qualificacao->'deskcomm', '{}'::jsonb) || v_qual) end,
            -- Indicacao vinda do codigo do site: mesmas travas de fn_registrar_lead_publico.
            indicador_assinante_id = case
                when l.indicador_assinante_id is null
                 and l.status not in ('ativacao', 'ativo', 'pago')
                 and v_rast->>'indicador_tipo' = 'assinante'
                then (v_rast->>'indicador_id')::uuid else l.indicador_assinante_id end,
            originator_id = case
                when l.originator_id is null and v_rast->>'indicador_tipo' = 'originador'
                then (v_rast->>'indicador_id')::uuid else l.originator_id end,
            updated_at = now()
        where l.id = v_lead;
        perform set_config('ponte.origem', '', true);
    exception when others then
        perform set_config('ponte.origem', '', true);
        insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
        values ('fn_card_campos_para_lead', new.id, sqlstate, sqlerrm);
    end;
    return new;
end
$$;

drop trigger if exists trg_ponte_card_para_lead_campos on public.crm_leads;
create trigger trg_ponte_card_para_lead_campos
    after insert or update of custom_fields on public.crm_leads
    for each row execute function ponte_deskcomm.fn_card_campos_para_lead();

-- Contato: nome real (o agente pergunta) substitui o nome do WhatsApp no lead;
-- tag nao_lead arquiva o lead "Sem Interacao" intocado.
create or replace function ponte_deskcomm.fn_contato_para_lead()
returns trigger
language plpgsql security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
begin
    if coalesce(current_setting('ponte.origem', true), '') = 'b2w' then
        return new;
    end if;
    begin
        perform set_config('ponte.origem', 'deskcomm', true);

        if nullif(btrim(new.name), '') is not null and new.name is distinct from old.name then
            update leads l set name = btrim(new.name), updated_at = now()
              from ponte_deskcomm.vinculos v
             where v.contact_id = new.id and l.id = v.b2w_lead_id
               and (nullif(btrim(l.name), '') is null
                    or btrim(l.name) = btrim(coalesce(old.name, ''))
                    or btrim(l.name) = btrim(coalesce(new.display_name, '')));
        end if;

        if 'nao_lead' = any(coalesce(new.tags, '{}'))
           and not ('nao_lead' = any(coalesce(old.tags, '{}'))) then
            update leads l set arquivado_em = now()
              from ponte_deskcomm.vinculos v
             where v.contact_id = new.id and l.id = v.b2w_lead_id
               and l.arquivado_em is null
               and l.status = 'sem_interacao'
               and coalesce(array_length(l.tags, 1), 0) = 0
               and coalesce(l.updated_at, l.created_at) <= l.created_at + interval '1 minute';
            delete from ponte_deskcomm.vinculos v
             using leads l
             where v.contact_id = new.id and l.id = v.b2w_lead_id and l.arquivado_em is not null;
        end if;

        perform set_config('ponte.origem', '', true);
    exception when others then
        perform set_config('ponte.origem', '', true);
        insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
        values ('fn_contato_para_lead', new.id, sqlstate, sqlerrm);
    end;
    return new;
end
$$;

drop trigger if exists trg_ponte_contato_para_lead on public.contacts;
create trigger trg_ponte_contato_para_lead
    after update of name, tags on public.contacts
    for each row execute function ponte_deskcomm.fn_contato_para_lead();

-- ---------------------------------------------------------------------------
-- 5. Codigo de rastreio do site
-- ---------------------------------------------------------------------------
-- "(cód. IND-7f3a9c21)" = indicacao (8 primeiros hex do id do assinante ou do
-- originador); "(cód. IG|GG|FB)" = utm_source instagram/google/facebook.
-- Grava em contacts.custom_fields.ponte_rastreio (a primeira vez vale) e no
-- card aberto do contato, se ja existir (o card costuma nascer segundos depois
-- da mensagem; quando nascer, fn_card_campos_preencher herda do contato).
create or replace function ponte_deskcomm.fn_mensagem_rastreio()
returns trigger
language plpgsql security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $$
declare
    v_cod   text;
    v_rast  jsonb;
    v_id    uuid;
    v_nome  text;
    v_tipo  text;
    v_n     int;
begin
    begin
        v_cod := upper(substring(new.body from '\(c[oóÓ]d\.\s*([A-Za-z]{2,3}(?:-[0-9A-Fa-f]{8})?)\)'));
        if v_cod is null or new.contact_id is null then
            return new;
        end if;
        if exists (select 1 from contacts c where c.id = new.contact_id and c.custom_fields ? 'ponte_rastreio') then
            return new;
        end if;

        if v_cod like 'IND-%' then
            select count(*), min(s.id::text)::uuid, min(s.name) into v_n, v_id, v_nome
              from subscribers s
             where s.id::text like lower(substring(v_cod from 5)) || '%'
               and s.status in ('contrato_assinado', 'ativo', 'ativo_inadimplente');
            if v_n = 1 then
                v_tipo := 'assinante';
            else
                select count(*), min(o.id::text)::uuid, min(o.name) into v_n, v_id, v_nome
                  from originators_v2 o
                 where o.id::text like lower(substring(v_cod from 5)) || '%' and o.ativo;
                if v_n = 1 then v_tipo := 'originador'; end if;
            end if;
            if v_tipo is null then
                return new; -- prefixo inexistente ou ambiguo: o agente pergunta a origem
            end if;
            v_rast := jsonb_build_object('codigo', v_cod, 'origem', 'indicacao',
                'indicado_por', split_part(btrim(coalesce(v_nome, '')), ' ', 1),
                'indicador_tipo', v_tipo, 'indicador_id', v_id);
        elsif v_cod in ('IG', 'GG', 'FB') then
            v_rast := jsonb_build_object('codigo', v_cod,
                'origem', case v_cod when 'IG' then 'instagram' when 'GG' then 'google' else 'facebook' end);
        else
            return new;
        end if;

        update contacts set custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('ponte_rastreio', v_rast)
         where id = new.contact_id;

        -- Card ja existente: o gatilho de antes (fn_card_campos_preencher) herda.
        update crm_leads cl set custom_fields = coalesce(cl.custom_fields, '{}'::jsonb)
         where cl.contact_id = new.contact_id and cl.status = 'open'
           and exists (select 1 from ponte_deskcomm.categorias k where k.pipeline_id = cl.pipeline_id and k.ativa);
    exception when others then
        insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
        values ('fn_mensagem_rastreio', new.id, sqlstate, sqlerrm);
    end;
    return new;
end
$$;

drop trigger if exists trg_ponte_mensagem_rastreio on public.messages;
create trigger trg_ponte_mensagem_rastreio
    after insert on public.messages
    for each row
    when (new.direction = 'inbound' and new.body ilike '%(c%d.%)%')
    execute function ponte_deskcomm.fn_mensagem_rastreio();

-- ---------------------------------------------------------------------------
-- 6. Termometro so no especialista
-- ---------------------------------------------------------------------------
create or replace function public.ponte_deskcomm_para_avaliar(p_limite integer default 25)
returns table(deskcomm_lead_id uuid, b2w_lead_id uuid, contact_id uuid, organization_id uuid,
              categoria text, categoria_nome text, etapa text, ultima_entrada timestamptz)
language sql stable security definer
set search_path to 'public', 'ponte_deskcomm', 'pg_temp'
as $function$
  select v.deskcomm_lead_id, v.b2w_lead_id, v.contact_id, v.organization_id,
         v.categoria, cat.nome, st.name, conv.ultima
    from ponte_deskcomm.vinculos v
    join crm_leads cl on cl.id = v.deskcomm_lead_id and cl.status = 'open'
    join leads l on l.id = v.b2w_lead_id
    join ponte_deskcomm.categorias cat on cat.slug = v.categoria and cat.tag_b2w is not null
    left join crm_stages st on st.id = cl.stage_id
    join lateral (
      select max(c.last_inbound_at) as ultima from conversations c
       where c.contact_id = v.contact_id and c.organization_id = v.organization_id
    ) conv on conv.ultima is not null
   where conv.ultima > coalesce((l.qualificacao->'jev'->>'avaliado_em')::timestamptz, '-infinity')
     and (select count(*) from messages m
           where m.contact_id = v.contact_id and m.organization_id = v.organization_id
             and m.direction = 'inbound' and m.created_at >= cl.created_at) >= 3
   order by conv.ultima desc
   limit greatest(1, least(p_limite, 100))
$function$;
