-- Fecha o circuito do PIX com autorizacao por token.
--
-- O Asaas devolve PENDING quando a transferencia espera o token do operador, e
-- so' depois dispara TRANSFER_DONE. O webhook ja' escutava esse evento e
-- marcava financial_transfers como completed -- mas desde a Task 7 o gatilho
-- handle_transfer_ledger ignora 'arrendante' de proposito, entao a confirmacao
-- morria ali e o repasse ficava 'enfileirado' para sempre.
--
-- Este gatilho leva a confirmacao ate' o repasse, que e' quem lanca no razao.
-- O dinheiro so' aparece como saido do Banco Asaas quando o Asaas disse que
-- saiu.

create or replace function public.fn_transfer_confirma_arrendamento()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    if new.destination_type is distinct from 'arrendante' then
        return new;
    end if;

    if new.status = 'completed' and (old.status is null or old.status <> 'completed') then
        update arrendamento_pagamentos
           set status = 'pago'
         where financial_transfer_id = new.id
           and status <> 'pago';

    elsif new.status in ('failed', 'reversed') and (old.status is null or old.status <> new.status) then
        update arrendamento_pagamentos
           set status = 'falhou',
               observacoes = coalesce(observacoes, '') || ' | Asaas: transferencia ' || new.status
         where financial_transfer_id = new.id
           and status <> 'falhou';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_transfer_confirma_arrendamento on public.financial_transfers;
create trigger trg_transfer_confirma_arrendamento
    after insert or update on public.financial_transfers
    for each row execute function public.fn_transfer_confirma_arrendamento();
