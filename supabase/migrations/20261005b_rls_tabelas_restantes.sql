-- Fechamento do RLS das tabelas que 20261004d nao cobriu.
--
-- Antes: ~20 tabelas com policy "true" para authenticated (algumas para todos
-- os comandos): qualquer login -- lead, assinante, fornecedor, originador --
-- lia o razao contabil, os repasses, o historico do CRM de todos os clientes,
-- os logs de mensagens com telefone, e podia ALTERAR plano de contas,
-- protocolos, listas de rateio, tabela de tarifas etc. Com o app mobile aberto
-- aos clientes, isso vira acesso de qualquer cliente pela API REST.
--
-- Mesma regra do dono de 20261004d (04/10/2026):
--   - equipe interna (fn_papel_interno) ve e edita tudo;
--   - fora dela, cada um ve so o que e seu, e ninguem cria/edita/apaga;
--   - excecoes mapeadas no codigo do CRM (o que cada papel abre hoje):
--       originador: le e registra historico dos proprios leads/assinantes
--                   (LeadModal) e le o proprio extrato de comissao
--                   (OriginatorDashboard: ledger_entries reference_type='originator');
--       fornecedor: le protocolos, listas de rateio e areas arrendadas das
--                   proprias usinas (menu Usinas/Rateio/Protocolos);
--       assinante e fornecedor NAO leem historico do CRM (anotacao interna);
--       standalone (/analisedeconta): cada dono ve so as proprias usinas.
--   - tabelas de referencia (tarifas, subestacoes, inversores...) seguem com
--     leitura aberta; escrita so equipe.
-- Robos e Edge Functions usam service_role e nao passam pelo RLS.

-- ---------------------------------------------------------------------------
-- Apoio: a entidade referenciada (tipo + id) e visivel para quem chama?
-- ---------------------------------------------------------------------------
create or replace function public.fn_rls_ve_entidade(p_tipo text, p_id uuid)
returns boolean
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    if p_id is null or auth.uid() is null then
        return false;
    end if;
    case lower(coalesce(p_tipo, ''))
        when 'lead' then
            return exists (select 1 from leads l where l.id = p_id and l.originator_id = auth.uid());
        when 'subscriber', 'assinante' then
            return fn_rls_ve_assinante(p_id);
        when 'consumer_unit', 'uc', 'unidade_consumidora' then
            return fn_rls_ve_uc(p_id);
        when 'invoice', 'conta_energia' then
            return exists (select 1 from invoices i where i.id = p_id and fn_rls_ve_uc(i.uc_id));
        when 'supplier' then
            return fn_rls_ve_fornecedor(p_id);
        when 'usina' then
            return fn_rls_ve_usina(p_id);
        when 'rateio_list', 'rateio' then
            return exists (select 1 from rateio_lists r where r.id = p_id and fn_rls_ve_usina(r.usina_id));
        when 'originator' then
            return p_id = auth.uid();
        else
            -- financial_transfer, consolidated_invoice, protocol...: so equipe.
            return false;
    end case;
end;
$$;

revoke all on function public.fn_rls_ve_entidade(text, uuid) from public, anon;
grant execute on function public.fn_rls_ve_entidade(text, uuid) to authenticated;

-- Historico do CRM tem anotacao interna da equipe sobre o cliente: assinante e
-- fornecedor NAO leem o proprio historico. So o originador, da propria
-- carteira (leads dele e assinantes que ele trouxe, com UCs e faturas).
create or replace function public.fn_rls_ve_historico(p_tipo text, p_id uuid)
returns boolean
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
begin
    if p_id is null or auth.uid() is null then
        return false;
    end if;
    case lower(coalesce(p_tipo, ''))
        when 'lead' then
            return exists (select 1 from leads l where l.id = p_id and l.originator_id = auth.uid());
        when 'subscriber', 'assinante' then
            return exists (select 1 from subscribers s where s.id = p_id and s.originator_id = auth.uid());
        when 'consumer_unit', 'uc', 'unidade_consumidora' then
            return exists (select 1 from consumer_units c join subscribers s on s.id = c.subscriber_id
                            where c.id = p_id and s.originator_id = auth.uid());
        when 'invoice' then
            return exists (select 1 from invoices i join consumer_units c on c.id = i.uc_id
                             join subscribers s on s.id = c.subscriber_id
                            where i.id = p_id and s.originator_id = auth.uid());
        when 'originator' then
            return p_id = auth.uid();
        else
            return false;
    end case;
end;
$$;

revoke all on function public.fn_rls_ve_historico(text, uuid) from public, anon;
grant execute on function public.fn_rls_ve_historico(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper local: troca todas as policies de uma tabela
-- ---------------------------------------------------------------------------
create or replace function pg_temp.limpar_policies(p_tabela text)
returns void language plpgsql as $$
declare r record;
begin
    for r in select polname from pg_policy where polrelid = format('public.%I', p_tabela)::regclass loop
        execute format('drop policy %I on public.%I', r.polname, p_tabela);
    end loop;
    execute format('alter table public.%I enable row level security', p_tabela);
end $$;

-- Equipe interna: tudo
create or replace function pg_temp.policy_interno(p_tabela text)
returns void language plpgsql as $$
begin
    execute format('create policy %I on public.%I for all to authenticated using (public.fn_papel_interno()) with check (public.fn_papel_interno())',
                   p_tabela || '_interno', p_tabela);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Somente equipe interna
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array[
        'financial_transfers', 'arrendamento_boletos', 'arrendamento_pagamentos',
        'compras', 'itens_compra', 'leased_area_beneficiaries', 'entity_history',
        'notification_logs', 'notification_triggers', 'originators',
        'dispensas_ciclo', 'robo_execucoes'
    ] loop
        perform pg_temp.limpar_policies(t);
        perform pg_temp.policy_interno(t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Referencia: leitura aberta, escrita so equipe
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
    -- leitura publica (ja era publica antes)
    foreach t in array array['Concessionaria', 'distribuicao_subestacoes', 'geracao_usinas', 'inverter_brands', 'parametros_bifacialidade'] loop
        perform pg_temp.limpar_policies(t);
        perform pg_temp.policy_interno(t);
        execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_leitura', t);
    end loop;
    -- leitura para logado
    foreach t in array array['service_defaults', 'aeroportos_referencia', 'ledger_accounts'] loop
        perform pg_temp.limpar_policies(t);
        perform pg_temp.policy_interno(t);
        execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leitura', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Escopo por dono
-- ---------------------------------------------------------------------------

-- Razao: originador le o proprio extrato de comissao.
select pg_temp.limpar_policies('ledger_entries');
select pg_temp.policy_interno('ledger_entries');
create policy ledger_entries_originador on public.ledger_entries
    for select to authenticated
    using (reference_type = 'originator' and reference_id = auth.uid());

-- Historico do CRM: originador ve e registra o da propria carteira.
select pg_temp.limpar_policies('crm_history');
select pg_temp.policy_interno('crm_history');
create policy crm_history_leitura on public.crm_history
    for select to authenticated
    using (created_by = auth.uid() or public.fn_rls_ve_historico(entity_type, entity_id));
create policy crm_history_registro on public.crm_history
    for insert to authenticated
    with check (public.fn_rls_ve_historico(entity_type, entity_id));

-- Protocolos: leitura do que e seu; escrita so equipe.
select pg_temp.limpar_policies('protocols');
select pg_temp.policy_interno('protocols');
create policy protocols_leitura on public.protocols
    for select to authenticated
    using (created_by = auth.uid() or public.fn_rls_ve_entidade(linked_entity_type, linked_entity_id));

-- Listas de rateio: fornecedor le as das proprias usinas.
select pg_temp.limpar_policies('rateio_lists');
select pg_temp.policy_interno('rateio_lists');
create policy rateio_lists_leitura on public.rateio_lists
    for select to authenticated
    using (public.fn_rls_ve_usina(usina_id));

-- Areas arrendadas: fornecedor le as proprias.
select pg_temp.limpar_policies('leased_areas');
select pg_temp.policy_interno('leased_areas');
create policy leased_areas_leitura on public.leased_areas
    for select to authenticated
    using (public.fn_rls_ve_fornecedor(supplier_id));

-- Analise independente (/analisedeconta): cada dono so as proprias usinas.
select pg_temp.limpar_policies('standalone_usinas');
select pg_temp.policy_interno('standalone_usinas');
create policy standalone_usinas_dono on public.standalone_usinas
    for all to authenticated
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());

select pg_temp.limpar_policies('standalone_ucs');
select pg_temp.policy_interno('standalone_ucs');
create policy standalone_ucs_dono on public.standalone_ucs
    for all to authenticated
    using (exists (select 1 from public.standalone_usinas u where u.id = usina_id and u.owner_id = auth.uid()))
    with check (exists (select 1 from public.standalone_usinas u where u.id = usina_id and u.owner_id = auth.uid()));

select pg_temp.limpar_policies('standalone_contas');
select pg_temp.policy_interno('standalone_contas');
create policy standalone_contas_dono on public.standalone_contas
    for all to authenticated
    using (exists (select 1 from public.standalone_ucs c join public.standalone_usinas u on u.id = c.usina_id
                    where c.id = uc_id and u.owner_id = auth.uid()))
    with check (exists (select 1 from public.standalone_ucs c join public.standalone_usinas u on u.id = c.usina_id
                         where c.id = uc_id and u.owner_id = auth.uid()));
