-- Fechamento do RLS das tabelas de negocio.
--
-- Antes: subscribers, consumer_units, usinas, generation_production, suppliers
-- e consolidated_invoices tinham "Enable all for authenticated users"
-- (qualquer login -- lead, assinante, fornecedor, originador -- lia, alterava e
-- apagava tudo), invoices era lida por qualquer login, quatro tabelas estavam
-- sem RLS (abertas ate para anon) e recargas_eletroposto era lida e alterada
-- por qualquer pessoa sem login.
--
-- Decisoes do dono (04/10/2026):
--   - Equipe interna (fn_papel_interno: super_admin, admin, manager,
--     coordinator) continua vendo e editando tudo.
--   - Assinante: so o proprio cadastro (user_id), as proprias UCs e faturas.
--   - Originador: so os assinantes dele (originator_id) e as UCs e faturas
--     desses assinantes. O lider, alem disso, ve os originadores da equipe.
--   - Fornecedor: so o proprio cadastro, as proprias usinas e a geracao delas.
--   - Fora da equipe interna, ninguem cria, edita ou apaga essas tabelas.
--   - Concessionaria_backup_20260905: apagar.
--
-- Robos e edge functions usam service_role e nao passam pelo RLS.

-- ---------------------------------------------------------------------------
-- Funcoes de apoio (SECURITY DEFINER: evitam recursao entre policies)
-- ---------------------------------------------------------------------------
create or replace function public.fn_rls_ve_assinante(p_sub uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select exists (
        select 1 from subscribers s
         where s.id = p_sub
           and (s.user_id = auth.uid() or s.originator_id = auth.uid())
    );
$$;

create or replace function public.fn_rls_ve_uc(p_uc uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select exists (
        select 1 from consumer_units c
          join subscribers s on s.id = c.subscriber_id
         where c.id = p_uc
           and (s.user_id = auth.uid() or s.originator_id = auth.uid())
    );
$$;

create or replace function public.fn_rls_ve_fornecedor(p_supplier uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select exists (select 1 from suppliers f where f.id = p_supplier and f.user_id = auth.uid());
$$;

create or replace function public.fn_rls_ve_usina(p_usina uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select exists (
        select 1 from usinas u
          join suppliers f on f.id = u.supplier_id
         where u.id = p_usina and f.user_id = auth.uid()
    );
$$;

revoke all on function public.fn_rls_ve_assinante(uuid) from public, anon;
revoke all on function public.fn_rls_ve_uc(uuid) from public, anon;
revoke all on function public.fn_rls_ve_fornecedor(uuid) from public, anon;
revoke all on function public.fn_rls_ve_usina(uuid) from public, anon;
grant execute on function public.fn_rls_ve_assinante(uuid) to authenticated;
grant execute on function public.fn_rls_ve_uc(uuid) to authenticated;
grant execute on function public.fn_rls_ve_fornecedor(uuid) to authenticated;
grant execute on function public.fn_rls_ve_usina(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Escrita so da equipe interna (mesmo molde para todas as tabelas)
-- ---------------------------------------------------------------------------
do $$
declare
    t text;
begin
    foreach t in array array['subscribers', 'consumer_units', 'usinas',
                             'generation_production', 'suppliers', 'consolidated_invoices']
    loop
        execute format('drop policy if exists "Enable all for authenticated users" on public.%I', t);
        execute format('drop policy if exists %I on public.%I', t || '_insert_interno', t);
        execute format('drop policy if exists %I on public.%I', t || '_update_interno', t);
        execute format('drop policy if exists %I on public.%I', t || '_delete_interno', t);
        execute format('create policy %I on public.%I for insert to authenticated with check (fn_papel_interno())', t || '_insert_interno', t);
        execute format('create policy %I on public.%I for update to authenticated using (fn_papel_interno()) with check (fn_papel_interno())', t || '_update_interno', t);
        execute format('create policy %I on public.%I for delete to authenticated using (fn_papel_interno())', t || '_delete_interno', t);
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------------
drop policy if exists subscribers_select on public.subscribers;
create policy subscribers_select on public.subscribers for select to authenticated
    using (fn_papel_interno() or user_id = auth.uid() or originator_id = auth.uid());

drop policy if exists consumer_units_select on public.consumer_units;
create policy consumer_units_select on public.consumer_units for select to authenticated
    using (fn_papel_interno() or fn_rls_ve_assinante(subscriber_id));

drop policy if exists consolidated_invoices_select on public.consolidated_invoices;
create policy consolidated_invoices_select on public.consolidated_invoices for select to authenticated
    using (fn_papel_interno() or fn_rls_ve_assinante(subscriber_id));

drop policy if exists invoices_select_authenticated on public.invoices;
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
    using (fn_papel_interno() or fn_rls_ve_uc(uc_id));

-- invoices_update_interno tinha using (true): qualquer login "alcancava" a
-- linha e so o with check barrava. Fica interno nas duas pontas.
drop policy if exists invoices_update_interno on public.invoices;
create policy invoices_update_interno on public.invoices for update to authenticated
    using (fn_papel_interno()) with check (fn_papel_interno());

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
    using (fn_papel_interno() or user_id = auth.uid());

drop policy if exists usinas_select on public.usinas;
create policy usinas_select on public.usinas for select to authenticated
    using (fn_papel_interno() or fn_rls_ve_fornecedor(supplier_id));

drop policy if exists generation_production_select on public.generation_production;
create policy generation_production_select on public.generation_production for select to authenticated
    using (fn_papel_interno() or fn_rls_ve_usina(usina_id));

-- Lider ve os originadores da equipe (soma-se a "propria ou interno").
drop policy if exists originators_v2_select_equipe_lider on public.originators_v2;
create policy originators_v2_select_equipe_lider on public.originators_v2 for select to authenticated
    using (lider_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Tabelas que estavam sem RLS
-- ---------------------------------------------------------------------------
alter table public.lead_appointments enable row level security;
drop policy if exists lead_appointments_interno_ou_dono_do_lead on public.lead_appointments;
create policy lead_appointments_interno_ou_dono_do_lead on public.lead_appointments for all to authenticated
    using (fn_papel_interno() or exists (select 1 from leads l where l.id = lead_id and l.originator_id = auth.uid()))
    with check (fn_papel_interno() or exists (select 1 from leads l where l.id = lead_id and l.originator_id = auth.uid()));

alter table public.mkt_modelos enable row level security;
drop policy if exists mkt_modelos_interno on public.mkt_modelos;
create policy mkt_modelos_interno on public.mkt_modelos for all to authenticated
    using (fn_papel_interno()) with check (fn_papel_interno());

alter table public.cashbook_legado enable row level security;
drop policy if exists cashbook_legado_interno on public.cashbook_legado;
create policy cashbook_legado_interno on public.cashbook_legado for all to authenticated
    using (fn_papel_interno()) with check (fn_papel_interno());

drop table if exists public."Concessionaria_backup_20260905";

-- ---------------------------------------------------------------------------
-- recargas_eletroposto: criacao e baixa so pelas edge functions (service_role)
-- ---------------------------------------------------------------------------
drop policy if exists "Permitir criacao de solicitacao de recarga" on public.recargas_eletroposto;
drop policy if exists "Permitir leitura da recarga" on public.recargas_eletroposto;
drop policy if exists "Permitir atualizacao da recarga" on public.recargas_eletroposto;

drop policy if exists recargas_eletroposto_select_interno on public.recargas_eletroposto;
create policy recargas_eletroposto_select_interno on public.recargas_eletroposto for select to authenticated
    using (fn_papel_interno());

-- O checkout publico so precisa saber se a recarga dele foi paga. O id e um
-- uuid devolvido pela create-charging-checkout a quem iniciou o pagamento.
create or replace function public.fn_recarga_status(p_id uuid)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select status::text from recargas_eletroposto where id = p_id;
$$;

revoke all on function public.fn_recarga_status(uuid) from public;
grant execute on function public.fn_recarga_status(uuid) to anon, authenticated;
