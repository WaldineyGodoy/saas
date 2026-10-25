-- Base de conhecimento da Helena (Gestora / Comercializadora)
-- (spec docs/superpowers/specs/2026-10-25-base-helena-gestora-design.md §4).
--
-- 1) Tres campos novos no plano de usina: custo de setup, carencia e prazo ate o primeiro
--    repasse. Nascem vazios: a Helena so cita o que estiver preenchido.
--    fn_planos_usina_trava lista as colunas que travam com usina vinculada; as novas NAO estao
--    na lista, entao continuam editaveis (e uma decisao do dono, ver spec §4.1).
-- 2) Gatilho: mudou um plano de usina, a deskcomm-base regera o documento da Helena.
-- 3) Leitura para a Edge Function (service role) e as duas linhas de fontes_base.

alter table public.planos_usina
  add column if not exists setup_pct                   numeric check (setup_pct is null or (setup_pct >= 0 and setup_pct <= 100)),
  add column if not exists setup_base                  text,
  add column if not exists carencia_dias               integer check (carencia_dias is null or carencia_dias >= 0),
  add column if not exists prazo_primeiro_repasse_dias integer check (prazo_primeiro_repasse_dias is null or prazo_primeiro_repasse_dias >= 0);

comment on column public.planos_usina.setup_pct is 'Custo de setup, em percentual, cobrado do dono da usina. Vazio = ainda nao definido.';
comment on column public.planos_usina.setup_base is 'Sobre o que o setup_pct incide (texto livre, ex.: "o valor do projeto"). A Helena so cita o setup se este campo estiver preenchido.';
comment on column public.planos_usina.carencia_dias is 'Carencia, em dias, antes de os repasses ao dono da usina comecarem.';
comment on column public.planos_usina.prazo_primeiro_repasse_dias is 'Prazo, em dias, para o dono da usina receber o primeiro repasse.';

drop trigger if exists trg_ponte_planos_usina_base on public.planos_usina;
create trigger trg_ponte_planos_usina_base
  after insert or update or delete on public.planos_usina
  for each statement execute function ponte_deskcomm.fn_assinatura_para_base();

create or replace function public.ponte_deskcomm_gestora_planos()
returns table (nome text, taxa_gestao_pct numeric, desconto_assinante_pct numeric,
               dia_corte integer, dia_repasse integer, setup_pct numeric, setup_base text,
               carencia_dias integer, prazo_primeiro_repasse_dias integer)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.nome, p.percentual_recorrente, p.desconto_pct, p.dia_corte, p.dia_repasse,
         p.setup_pct, nullif(btrim(p.setup_base), ''), p.carencia_dias, p.prazo_primeiro_repasse_dias
    from planos_usina p
   where p.status = 'ativo'
   order by p.created_at, p.nome
$$;
revoke execute on function public.ponte_deskcomm_gestora_planos() from public, anon, authenticated;
grant  execute on function public.ponte_deskcomm_gestora_planos() to service_role;

insert into ponte_deskcomm.fontes_base (chave)
values ('gestora_faq'), ('gestora_planos')
on conflict (chave) do nothing;
