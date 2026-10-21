-- =====================================================================
-- Base do Agente Cotas (spec docs/superpowers/specs/2026-10-20-base-agente-cotas-design.md §5.1)
--   1. usinas.cotas_vendidas: contador manual (0 a 10) ate existir o
--      cadastro de cotistas.
--   2. ponte_deskcomm_usinas_cotas: dados do documento "Usinas com cotas".
--   3. Chaves cotas_faq e usinas_cotas em ponte_deskcomm.fontes_base.
--   4. trg_ponte_usinas_base passa a reagir a cotas_vendidas.
-- =====================================================================

alter table public.usinas
    add column if not exists cotas_vendidas smallint not null default 0
        constraint usinas_cotas_vendidas_check check (cotas_vendidas between 0 and 10);
comment on column public.usinas.cotas_vendidas is
    'Cotas vendidas de 10 (modelo_venda = cotas). Contador manual ate existir o cadastro de cotistas; alimenta "Usinas com cotas" no Deskcomm.';

create or replace function public.ponte_deskcomm_usinas_cotas()
returns table(nome text, cidade text, uf text, status text, previsao_entrega date,
              valor_investido numeric, cotas_vendidas smallint, short_url text)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    select u.name, u.address->>'cidade', u.address->>'uf', u.status::text, u.previsao_entrega,
           u.valor_investido, u.cotas_vendidas, u.short_url
      from usinas u
     where u.a_venda
       and u.modelo_venda = 'cotas'
       and u.cotas_vendidas < 10
       and u.status::text not in ('cancelada', 'inativa')
$$;
revoke all on function public.ponte_deskcomm_usinas_cotas() from public, anon, authenticated;
grant execute on function public.ponte_deskcomm_usinas_cotas() to service_role;

insert into ponte_deskcomm.fontes_base (chave) values ('cotas_faq'), ('usinas_cotas')
on conflict (chave) do nothing;

drop trigger if exists trg_ponte_usinas_base on public.usinas;
create trigger trg_ponte_usinas_base
    after insert or delete or update of a_venda, previsao_entrega, modelo_venda, status, name, address,
        potencia_kwp, potencia_inversor_w, modalidade_gd, modalidade, valor_investido, short_url, cotas_vendidas
    on public.usinas
    for each row execute function ponte_deskcomm.fn_usina_para_base();
