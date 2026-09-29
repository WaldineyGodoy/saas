-- planos_assinatura_energia: so admin/super_admin logado grava.
--
-- Ate 29/09/2026 a tabela tinha "Permitir controle total anon" (ALL, true):
-- qualquer um com a chave publica do site alterava, criava ou apagava planos.
-- Desde o split de pagamentos, gestao, desconto, piso e a matriz de
-- recompensas saem daqui, entao isso era dinheiro. Decisao do dono:
-- "somente admins logados podem fazer essas alteracoes".
--
-- Leitura: so usuario logado. Nenhuma pagina publica le a tabela; quem le
-- fora do CRM sao fn_plano_da_uc, fn_regras_recompensa_uc e
-- fn_eletroposto_plano_valido, todas SECURITY DEFINER (nao passam pela RLS).

create or replace function public.fn_eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.profiles p
         where p.id = auth.uid()
           and p.role in ('admin', 'super_admin')
    );
$$;

comment on function public.fn_eh_admin() is
    'Usuario logado com papel admin ou super_admin. Mais estreito que fn_papel_interno (que inclui manager e coordinator).';

revoke all on function public.fn_eh_admin() from public, anon;
grant execute on function public.fn_eh_admin() to authenticated;

drop policy if exists "Permitir controle total anon" on public.planos_assinatura_energia;
drop policy if exists "Permitir controle total para autenticados" on public.planos_assinatura_energia;
drop policy if exists "Permitir leitura anon" on public.planos_assinatura_energia;
drop policy if exists "Permitir leitura para autenticados" on public.planos_assinatura_energia;

revoke all on public.planos_assinatura_energia from anon;
revoke truncate, references, trigger on public.planos_assinatura_energia from authenticated;

create policy planos_leitura_logado on public.planos_assinatura_energia
    for select to authenticated
    using (true);

create policy planos_insere_admin on public.planos_assinatura_energia
    for insert to authenticated
    with check (public.fn_eh_admin());

create policy planos_altera_admin on public.planos_assinatura_energia
    for update to authenticated
    using (public.fn_eh_admin())
    with check (public.fn_eh_admin());

create policy planos_apaga_admin on public.planos_assinatura_energia
    for delete to authenticated
    using (public.fn_eh_admin());
