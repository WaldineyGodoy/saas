-- Encerrar uma dispensa de ciclo sem apaga-la.
--
-- A dispensa (20260903b) tira a UC do ciclo enquanto a conta esta
-- indisponivel e deixa a cobranca pendente: quando a conta aparece, a fatura
-- sai retroativa. Mas ha um terceiro desfecho, que a revogacao nao cobre --
-- descobrir que nao ha nada a cobrar. Caso de origem: UC 197941103286, 08/2026
-- (Mirantes Green Park). Na troca de titularidade de 24/08/2026 o periodo foi
-- todo faturado pelo numero antigo (7030839085, 10/07 a 11/08) e pela conta de
-- encerramento (11/08 a 21/08); nao existe conta de 08/2026 a esperar.
--
-- Revogar apagaria a linha e o ciclo voltaria a esperar a UC: se uma fatura
-- tardia do mesmo ciclo reabrisse a fila, ela contaria como ausente e
-- travaria a emissao. Encerrar mantem a linha -- a fila continua tratando a
-- UC como resolvida no ciclo -- e registra por que e por quem. Pendente de
-- retroativo e a dispensa com encerrada_em nulo.

alter table public.dispensas_ciclo
    add column if not exists encerrada_em timestamptz,
    add column if not exists encerrada_por uuid,
    add column if not exists encerramento_motivo text;

comment on column public.dispensas_ciclo.encerrada_em is
    'Quando a dispensa foi encerrada sem cobranca retroativa (nada a cobrar). Nulo = ainda aguarda a conta (20261103c).';

create or replace function public.fn_encerrar_dispensa_ciclo(p_uc_id uuid, p_ciclo date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.fn_chamador_interno() then
        raise exception 'Sem permissao.' using errcode = '42501';
    end if;

    if coalesce(trim(p_motivo), '') = '' then
        raise exception 'Encerrar dispensa exige o motivo por escrito.';
    end if;

    update public.dispensas_ciclo
       set encerrada_em        = now(),
           encerrada_por       = auth.uid(),
           encerramento_motivo = trim(p_motivo)
     where uc_id = p_uc_id
       and ciclo = date_trunc('month', p_ciclo)::date
       and encerrada_em is null;

    if not found then
        raise exception 'Nao ha dispensa aberta da UC % no ciclo %.', p_uc_id, to_char(p_ciclo, 'MM/YYYY');
    end if;
end;
$$;

revoke all on function public.fn_encerrar_dispensa_ciclo(uuid, date, text) from public, anon;
grant execute on function public.fn_encerrar_dispensa_ciclo(uuid, date, text) to authenticated, service_role;
