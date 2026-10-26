-- =====================================================================
-- Adesão à Energia por Assinatura pelo WhatsApp
-- (spec docs/superpowers/specs/2026-10-26-adesao-whatsapp-design.md §4-5)
--   1. ponte_deskcomm.adesoes: estado da adesão por card.
--   2. RPCs da Edge Function adesao-whatsapp e da ferramenta b2w_status_adesao.
--   3. Gatilhos: mídia recebida, card mudou, originador no card.
-- =====================================================================

create table if not exists ponte_deskcomm.adesoes (
    card_id              uuid primary key,
    b2w_lead_id          uuid,
    contact_id           uuid,
    conta_message_id     uuid,
    documento_message_id uuid,
    conta_lida           jsonb,
    erros                jsonb not null default '{}'::jsonb,
    status               text not null default 'coletando'
                         check (status in ('coletando', 'pendencia', 'criando', 'contrato_pronto', 'assinado', 'erro')),
    subscriber_id        uuid,
    onboarding_token     text,
    signature_link       text,
    documentos_copiados  boolean not null default false,
    criado_em            timestamptz not null default now(),
    atualizado_em        timestamptz not null default now()
);

-- Card da Assinatura de um contato (o mais recente).
create or replace function ponte_deskcomm.fn_card_assinatura(p_contato uuid)
returns uuid language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select cl.id from crm_leads cl
      join ponte_deskcomm.categorias c on c.pipeline_id = cl.pipeline_id and c.slug = 'energia_assinatura'
     where cl.contact_id = p_contato
     order by cl.updated_at desc nulls last limit 1
$$;

create or replace function public.ponte_deskcomm_adesao_dados(p_card uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select jsonb_build_object(
        'card_id', cl.id,
        'b2w_lead_id', v.b2w_lead_id,
        'contact_id', cl.contact_id,
        'telefone', ponte_deskcomm.fn_telefone(ct.phone_number),
        'campos', coalesce(cl.custom_fields, '{}'::jsonb),
        'originator_id', l.originator_id,
        'indicador_id', l.indicador_assinante_id,
        'adesao', to_jsonb(a),
        'conta_midia', (select jsonb_build_object('path', m.media_storage_path, 'mime', m.media_mime, 'tamanho', m.media_size_bytes)
                          from messages m where m.id = a.conta_message_id),
        'documento_midia', (select jsonb_build_object('path', m.media_storage_path, 'mime', m.media_mime, 'tamanho', m.media_size_bytes)
                              from messages m where m.id = a.documento_message_id))
      from crm_leads cl
      join contacts ct on ct.id = cl.contact_id
      left join ponte_deskcomm.vinculos v on v.deskcomm_lead_id = cl.id
      left join leads l on l.id = v.b2w_lead_id
      left join ponte_deskcomm.adesoes a on a.card_id = cl.id
     where cl.id = p_card
$$;

create or replace function public.ponte_deskcomm_adesao_salvar(p_card uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    k text;
begin
    insert into ponte_deskcomm.adesoes (card_id) values (p_card) on conflict do nothing;
    update ponte_deskcomm.adesoes a set
        conta_lida          = case when p_patch ? 'conta_lida' then p_patch->'conta_lida' else a.conta_lida end,
        status              = coalesce(p_patch->>'status', a.status),
        subscriber_id       = coalesce((p_patch->>'subscriber_id')::uuid, a.subscriber_id),
        onboarding_token    = coalesce(p_patch->>'onboarding_token', a.onboarding_token),
        signature_link      = coalesce(p_patch->>'signature_link', a.signature_link),
        documentos_copiados = coalesce((p_patch->>'documentos_copiados')::boolean, a.documentos_copiados),
        atualizado_em       = now()
     where a.card_id = p_card;
    foreach k in array array['conta', 'documento', 'validacao', 'criacao'] loop
        if p_patch ? ('erros_' || k) then
            update ponte_deskcomm.adesoes set erros = erros || jsonb_build_object(k, p_patch->('erros_' || k))
             where card_id = p_card;
        end if;
    end loop;
end
$$;

create or replace function public.ponte_deskcomm_ibge(p_cidade text, p_uf text)
returns text language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select btrim(c."Cod. Ibge") from "Concessionaria" c
     where ponte_deskcomm.fn_sem_acento(c."Município") = ponte_deskcomm.fn_sem_acento(p_cidade)
       and upper(btrim(c."UF")) = ponte_deskcomm.fn_uf(p_uf)
     limit 1
$$;

create or replace function public.ponte_deskcomm_cpf_existe(p_cpf text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    select exists (select 1 from subscribers s
                    where public.fn_so_digitos(s.cpf_cnpj) = public.fn_so_digitos(p_cpf)
                      and s.status::text <> 'cancelado')
$$;

-- Ferramenta da Bia: só o card do telefone do cabeçalho; CPF mascarado.
create or replace function public.b2w_mcp_status_adesao(p_telefone text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
    with ct as (
        select c.id from contacts c
         where ponte_deskcomm.fn_telefone(c.phone_number) = ponte_deskcomm.fn_telefone(p_telefone)
         order by c.updated_at desc nulls last limit 1),
    card as (
        select cl.* from crm_leads cl where cl.id = ponte_deskcomm.fn_card_assinatura((select id from ct)))
    select coalesce((
        select jsonb_build_object(
            'etapa', card.custom_fields->>'adesao_etapa',
            'status', coalesce(a.status, 'coletando'),
            'conta', case when a.conta_lida is null then null else jsonb_build_object(
                'titular', a.conta_lida->>'titular',
                'endereco', a.conta_lida->'endereco'->>'completo',
                'numero_cliente', a.conta_lida->>'numeroUc',
                'consumo_kwh', (a.conta_lida->>'mediaKwh')::numeric) end,
            'cpf_mascarado', case when length(public.fn_so_digitos(card.custom_fields->>'adesao_cpf')) = 11
                then '***.' || substr(public.fn_so_digitos(card.custom_fields->>'adesao_cpf'), 4, 3) || '.'
                     || substr(public.fn_so_digitos(card.custom_fields->>'adesao_cpf'), 7, 3) || '-**' end,
            'erros', coalesce((select jsonb_agg(distinct e) from jsonb_each(coalesce(a.erros, '{}'::jsonb)) x,
                                      jsonb_array_elements_text(x.value) e), '[]'::jsonb),
            'link_assinatura', a.signature_link,
            'assinado', exists (select 1 from signatures s where s.signer_id = a.subscriber_id and s.status = 'signed'))
          from card left join ponte_deskcomm.adesoes a on a.card_id = card.id),
        jsonb_build_object('etapa', null))
$$;

do $$
declare f text;
begin
    foreach f in array array['ponte_deskcomm_adesao_dados(uuid)', 'ponte_deskcomm_adesao_salvar(uuid, jsonb)',
        'ponte_deskcomm_ibge(text, text)', 'ponte_deskcomm_cpf_existe(text)', 'b2w_mcp_status_adesao(text)']
    loop
        execute format('revoke all on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

-- Mídia recebida numa etapa que espera arquivo. O Deskcomm pode gravar o
-- caminho depois do INSERT (download assíncrono), por isso também no UPDATE.
create or replace function ponte_deskcomm.fn_adesao_midia()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    v_card  uuid;
    v_etapa text;
begin
    if new.direction <> 'inbound' or new.media_storage_path is null then return null; end if;
    if tg_op = 'UPDATE' and old.media_storage_path is not null then return null; end if;
    select ponte_deskcomm.fn_card_assinatura(cv.contact_id) into v_card from conversations cv where cv.id = new.conversation_id;
    if v_card is null then return null; end if;
    select custom_fields->>'adesao_etapa' into v_etapa from crm_leads where id = v_card;
    if v_etapa not in ('aguardando_conta', 'aguardando_documento') then return null; end if;

    insert into ponte_deskcomm.adesoes (card_id) values (v_card) on conflict do nothing;
    if v_etapa = 'aguardando_conta' then
        update ponte_deskcomm.adesoes set conta_message_id = new.id, atualizado_em = now() where card_id = v_card;
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'conta', 'card_id', v_card));
    else
        update ponte_deskcomm.adesoes set documento_message_id = new.id, atualizado_em = now() where card_id = v_card;
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'documento', 'card_id', v_card));
    end if;
    return null;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_adesao_midia', new.id, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_adesao_midia on public.messages;
create trigger trg_ponte_adesao_midia
    after insert or update of media_storage_path on public.messages
    for each row execute function ponte_deskcomm.fn_adesao_midia();

-- Card mudou: valida dados ou cria a adesão.
create or replace function ponte_deskcomm.fn_adesao_card()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
    n jsonb := coalesce(new.custom_fields, '{}'::jsonb);
    o jsonb := coalesce(old.custom_fields, '{}'::jsonb);
begin
    if not exists (select 1 from ponte_deskcomm.categorias c where c.pipeline_id = new.pipeline_id and c.slug = 'energia_assinatura') then
        return null;
    end if;
    if n->>'adesao_etapa' = 'confirmado' and coalesce(o->>'adesao_etapa', '') <> 'confirmado' then
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'criar', 'card_id', new.id));
    elsif (n->>'adesao_cpf') is distinct from (o->>'adesao_cpf')
       or (n->>'adesao_email') is distinct from (o->>'adesao_email')
       or (n->>'adesao_telefone') is distinct from (o->>'adesao_telefone')
       or (n->>'adesao_titular_ok') is distinct from (o->>'adesao_titular_ok') then
        perform ponte_deskcomm.fn_chamar_funcao('adesao-whatsapp', jsonb_build_object('acao', 'validar', 'card_id', new.id));
    end if;
    return null;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_adesao_card', new.id, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_adesao_card on public.crm_leads;
create trigger trg_ponte_adesao_card
    after update of custom_fields on public.crm_leads
    for each row execute function ponte_deskcomm.fn_adesao_card();

-- Originador do lead da B2W visível no card (só se vazio).
create or replace function ponte_deskcomm.fn_card_originador()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_nome text;
begin
    if coalesce(new.custom_fields->>'originador', '') <> '' then return new; end if;
    select o.name into v_nome
      from ponte_deskcomm.vinculos v join leads l on l.id = v.b2w_lead_id join originators_v2 o on o.id = l.originator_id
     where v.deskcomm_lead_id = new.id;
    if v_nome is not null then
        new.custom_fields := coalesce(new.custom_fields, '{}'::jsonb) || jsonb_build_object('originador', v_nome);
    end if;
    return new;
exception when others then
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem) values ('fn_card_originador', new.id, sqlstate, sqlerrm);
    return new;
end
$$;

drop trigger if exists trg_ponte_card_originador on public.crm_leads;
create trigger trg_ponte_card_originador
    before insert or update on public.crm_leads
    for each row execute function ponte_deskcomm.fn_card_originador();
