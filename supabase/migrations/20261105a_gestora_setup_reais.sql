-- Setup em reais e prazo do primeiro repasse no plano de usina
-- (spec docs/superpowers/specs/2026-11-05-helena-v8-condicoes-design.md §3).
--
-- O dono definiu o setup como valor fixo OPCIONAL em reais (a usina que paga tem prioridade
-- na captacao de assinantes) e o prazo ate o primeiro repasse como a propria carencia.
-- Por isso saem as colunas setup_pct, setup_base e carencia_dias (criadas em 25/10/2026 pela
-- 20261025a_gestora_helena, nunca preenchidas) e entra setup_reais.
-- Troca a RPC primeiro: ela e a unica que le as colunas antigas.

do $$
begin
  if exists (select 1 from public.planos_usina
              where setup_pct is not null or setup_base is not null or carencia_dias is not null) then
    raise exception 'colunas antigas do plano de usina tem dado; nada foi alterado';
  end if;
end $$;

drop function if exists public.ponte_deskcomm_gestora_planos();

alter table public.planos_usina
  add column if not exists setup_reais numeric check (setup_reais is null or setup_reais >= 0),
  drop column if exists setup_pct,
  drop column if exists setup_base,
  drop column if exists carencia_dias;

comment on column public.planos_usina.setup_reais is 'Custo de setup OPCIONAL, em reais. Quem paga tem prioridade na captacao de assinantes (campanhas e trafego pago exclusivos para a usina); quem nao paga fica em segunda prioridade. Vazio = ainda nao definido.';
comment on column public.planos_usina.prazo_primeiro_repasse_dias is 'Prazo, em dias, ate o primeiro repasse ao dono da usina. E tambem a carencia dos pagamentos ao dono.';

-- Valores do plano de oferta atual, informados pelo dono em 05/11/2026.
update public.planos_usina
   set setup_reais = 3000, prazo_primeiro_repasse_dias = 120
 where nome = 'Plano Usina - Ultra Connect'
   and setup_reais is null and prazo_primeiro_repasse_dias is null;

create or replace function public.ponte_deskcomm_gestora_planos()
returns table (nome text, taxa_gestao_pct numeric, desconto_assinante_pct numeric,
               dia_corte integer, dia_repasse integer, setup_reais numeric,
               prazo_primeiro_repasse_dias integer)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.nome, p.percentual_recorrente, p.desconto_pct, p.dia_corte, p.dia_repasse,
         p.setup_reais, p.prazo_primeiro_repasse_dias
    from planos_usina p
   where p.status = 'ativo'
   order by p.created_at, p.nome
$$;
revoke execute on function public.ponte_deskcomm_gestora_planos() from public, anon, authenticated;
grant  execute on function public.ponte_deskcomm_gestora_planos() to service_role;
