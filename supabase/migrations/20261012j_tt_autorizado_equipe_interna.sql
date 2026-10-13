-- A TT e o inicio do fluxo da UC: quem cadastra a UC e a equipe interna, nao so
-- o admin. fn_tt_autorizado passa a ter a mesma regra de fn_rateio_autorizado
-- (service_role do robo ou papel interno, a mesma do RLS das tabelas de cadastro).
create or replace function public.fn_tt_autorizado()
returns boolean
language sql stable
set search_path = public
as $$
    select coalesce(auth.role(), '') = 'service_role'
        or coalesce(public.fn_papel_interno(), false)
        or coalesce(public.check_user_is_admin(auth.uid()), false);
$$;
