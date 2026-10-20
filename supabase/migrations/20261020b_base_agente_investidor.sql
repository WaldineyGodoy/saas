-- Base de conhecimento do Agente Investidor no Deskcomm
-- (spec docs/superpowers/specs/2026-10-19-base-agente-investidor-design.md §5).
--
-- 1) usinas: a_venda, previsao_entrega, modelo_venda (aba Contratos do modal).
-- 2) ponte_deskcomm.fontes_base: liga cada conteudo a fonte do Deskcomm e
--    guarda o hash do ultimo envio.
-- 3) RPCs publicas so para service_role (o PostgREST nao expoe ponte_deskcomm),
--    usadas pela Edge Function deskcomm-base.
-- 4) Gatilho em usinas + cron de hora em hora chamando deskcomm-base.

-- ---------------------------------------------------------------------------
-- 1. Campos da usina
-- ---------------------------------------------------------------------------
alter table public.usinas
    add column if not exists a_venda boolean not null default false,
    add column if not exists previsao_entrega date,
    add column if not exists modelo_venda text not null default 'integral';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'usinas_modelo_venda_check') then
        alter table public.usinas
            add constraint usinas_modelo_venda_check check (modelo_venda in ('integral', 'cotas'));
    end if;
end $$;

comment on column public.usinas.a_venda is
    'true = a usina aparece em "Usinas à venda" na base do Agente Investidor (Deskcomm).';
comment on column public.usinas.previsao_entrega is
    'Previsão de entrega mostrada ao investidor. Só vai para a base do agente.';
comment on column public.usinas.modelo_venda is
    'integral = usina inteira; cotas = vendida em cotas (1/10). Cotas disponíveis entram com a lista de cotistas.';

-- ---------------------------------------------------------------------------
-- 2. Controle das fontes
-- ---------------------------------------------------------------------------
create table if not exists ponte_deskcomm.fontes_base (
    chave               text primary key,
    knowledge_source_id uuid,
    ultimo_hash         text,
    sincronizado_em     timestamptz
);

insert into ponte_deskcomm.fontes_base (chave) values ('investidor_faq'), ('usinas_a_venda')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RPCs da Edge Function
-- ---------------------------------------------------------------------------

-- Usinas à venda, so com os campos que podem ir para a base (nada de CPF/CNPJ,
-- dono, credenciais, UCs ou endereco completo).
create or replace function public.ponte_deskcomm_usinas_a_venda()
returns table (
    nome text, cidade text, uf text, status text, previsao_entrega date,
    potencia_kwp numeric, potencia_inversor_w numeric, modalidade_gd text, modalidade text,
    valor_investido numeric, modelo_venda text, short_url text
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select u.name, u.address->>'cidade', u.address->>'uf', u.status::text, u.previsao_entrega,
           u.potencia_kwp, u.potencia_inversor_w, u.modalidade_gd, u.modalidade::text,
           u.valor_investido, u.modelo_venda, u.short_url
      from usinas u
     where u.a_venda
       and u.status::text not in ('cancelada', 'inativa')
$$;

-- Organizacao e agente da categoria (categoria -> funil -> agente publicado no funil).
create or replace function public.ponte_deskcomm_agente_da_categoria(p_slug text)
returns table (organization_id uuid, agent_id uuid)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select p.organization_id, a.id
      from ponte_deskcomm.categorias c
      join crm_pipelines p on p.id = c.pipeline_id
      join ai_agents a on a.organization_id = p.organization_id and a.archived_at is null
      join ai_agent_versions v on v.id = a.published_version_id
     where c.slug = p_slug
       and p.id = any(v.pipeline_ids)
     order by a.created_at
     limit 1
$$;

create or replace function public.ponte_deskcomm_fontes_base()
returns setof ponte_deskcomm.fontes_base
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$ select * from ponte_deskcomm.fontes_base $$;

create or replace function public.ponte_deskcomm_fonte_base_marcar(p_chave text, p_source_id uuid, p_hash text)
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
    update ponte_deskcomm.fontes_base
       set knowledge_source_id = p_source_id, ultimo_hash = p_hash, sincronizado_em = now()
     where chave = p_chave
$$;

-- O que a funcao precisa do Deskcomm. Vazio = pode gravar. Qualquer item = nao
-- grava nada (uma atualizacao do Deskcomm mudou o contrato).
create or replace function public.ponte_deskcomm_contrato_base()
returns text[]
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_falta text[] := '{}';
    v_col   text;
begin
    foreach v_col in array array['source_type', 'source_metadata', 'status', 'is_active', 'name',
                                 'organization_id', 'agent_id', 'last_indexed_at', 'last_index_status']
    loop
        if not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = 'ai_knowledge_sources'
                          and column_name = v_col) then
            v_falta := v_falta || ('ai_knowledge_sources.' || v_col);
        end if;
    end loop;
    foreach v_col in array array['organization_id', 'knowledge_source_id', 'question', 'answer',
                                 'tags', 'locale', 'position']
    loop
        if not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = 'ai_faq_items'
                          and column_name = v_col) then
            v_falta := v_falta || ('ai_faq_items.' || v_col);
        end if;
    end loop;
    if not exists (select 1 from storage.buckets where id = 'ai-policy') then
        v_falta := v_falta || 'bucket ai-policy'::text;
    end if;
    if to_regprocedure('public.emit_event(text, text, uuid, jsonb, jsonb, uuid)') is null then
        v_falta := v_falta || 'emit_event'::text;
    end if;
    return v_falta;
end
$$;

-- Troca os itens do FAQ numa transacao so (a fonte nunca fica vazia pela metade).
create or replace function public.ponte_deskcomm_faq_trocar(p_org uuid, p_source_id uuid, p_itens jsonb)
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
    v_n integer;
begin
    delete from ai_faq_items where organization_id = p_org and knowledge_source_id = p_source_id;
    insert into ai_faq_items (organization_id, knowledge_source_id, question, answer, tags, locale, position)
    select p_org, p_source_id, i->>'question', i->>'answer', '{}'::text[], 'pt-BR', (ord - 1)::int
      from jsonb_array_elements(p_itens) with ordinality as t(i, ord);
    get diagnostics v_n = row_count;
    return v_n;
end
$$;

-- Mesmo evento que a tela do Deskcomm emite ao salvar/reindexar um material.
create or replace function public.ponte_deskcomm_emitir_fonte(p_org uuid, p_source_id uuid, p_agent_id uuid, p_tipo text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    perform emit_event(
        'knowledge_source.updated', 'ai_knowledge_source', p_source_id,
        jsonb_build_object('knowledge_source_id', p_source_id, 'agent_id', p_agent_id, 'source_type', p_tipo),
        jsonb_build_object('origem', 'ponte_deskcomm.deskcomm-base'),
        p_org);
end
$$;

create or replace function public.ponte_deskcomm_erro_base(p_onde text, p_mensagem text)
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
    insert into ponte_deskcomm.erros (onde, mensagem) values (p_onde, left(p_mensagem, 2000))
$$;

do $$
declare
    f text;
begin
    foreach f in array array[
        'ponte_deskcomm_usinas_a_venda()',
        'ponte_deskcomm_agente_da_categoria(text)',
        'ponte_deskcomm_fontes_base()',
        'ponte_deskcomm_fonte_base_marcar(text, uuid, text)',
        'ponte_deskcomm_contrato_base()',
        'ponte_deskcomm_faq_trocar(uuid, uuid, jsonb)',
        'ponte_deskcomm_emitir_fonte(uuid, uuid, uuid, text)',
        'ponte_deskcomm_erro_base(text, text)']
    loop
        execute format('revoke all on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Gatilho e cron
-- ---------------------------------------------------------------------------
create or replace function ponte_deskcomm.fn_usina_para_base()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    -- So interessa usina que esta ou estava a venda.
    if coalesce((case when tg_op = 'DELETE' then null else new.a_venda end), false)
       or coalesce((case when tg_op = 'INSERT' then null else old.a_venda end), false) then
        perform ponte_deskcomm.fn_chamar_funcao('deskcomm-base', '{}'::jsonb);
    end if;
    return null;
exception when others then
    -- Falha aqui nunca bloqueia a gravacao da usina; o cron corrige.
    insert into ponte_deskcomm.erros (onde, ref_id, sqlstate, mensagem)
    values ('fn_usina_para_base', case when tg_op = 'DELETE' then old.id else new.id end, sqlstate, sqlerrm);
    return null;
end
$$;

drop trigger if exists trg_ponte_usinas_base on public.usinas;
create trigger trg_ponte_usinas_base
    after insert or delete or update of a_venda, previsao_entrega, modelo_venda, status, name, address,
        potencia_kwp, potencia_inversor_w, modalidade_gd, modalidade, valor_investido, short_url
    on public.usinas
    for each row execute function ponte_deskcomm.fn_usina_para_base();

select cron.unschedule('ponte-deskcomm-base') where exists (select 1 from cron.job where jobname = 'ponte-deskcomm-base');
select cron.schedule('ponte-deskcomm-base', '17 * * * *',
    $$ select ponte_deskcomm.fn_chamar_funcao('deskcomm-base') $$);
