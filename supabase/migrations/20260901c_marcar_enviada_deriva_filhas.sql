-- ============================================================================
-- A tela também marca a fatura como entregue
--
-- O envio pela tela (`sendCombinedNotification`) e o enviador autônomo são dois
-- caminhos para a mesma coisa, e só o segundo anotava que a entrega aconteceu.
-- Resultado: fatura enviada pela tela ficava com `fatura_enviada_em` nulo, de
-- pé na fila, e o robô mandava um SEGUNDO PDF ao cliente no dia seguinte.
--
-- Aconteceu em 01/09/2026 com as duas faturas 07/2026 da Brigitte Caturano:
-- reemitidas com vencimento 04/09 pela tela, entregues na hora por WhatsApp e
-- e-mail, e ainda assim continuavam na fila do enviador.
--
-- Duas mudanças fecham isso:
--   1. o front passa `invoiceId` e chama esta função depois de enviar
--   2. no consolidado, a função deriva as faturas-filha sozinha — obrigar cada
--      chamador a montar o array só criaria a chance de esquecer, e um array
--      esquecido devolve as filhas para a fila
-- ============================================================================

create or replace function public.fn_marcar_fatura_enviada(
    p_tipo text, p_id uuid, p_invoice_ids uuid[] default null, p_erro text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ids uuid[];
begin
    if p_erro is not null then
        if p_tipo = 'consolidada' then
            update consolidated_invoices set envio_erro = left(p_erro, 500) where id = p_id;
        else
            update invoices set envio_erro = left(p_erro, 500) where id = p_id;
        end if;
        return;
    end if;

    if p_tipo = 'consolidada' then
        update consolidated_invoices
        set fatura_enviada_em = now(), envio_erro = null, envio_retido_motivo = null
        where id = p_id;

        v_ids := coalesce(
            p_invoice_ids,
            (select array_agg(id) from invoices where consolidated_invoice_id = p_id)
        );
    else
        v_ids := coalesce(p_invoice_ids, array[p_id]);
    end if;

    update invoices
    set fatura_enviada_em = now(), envio_erro = null, envio_retido_motivo = null
    where id = any(v_ids);
end;
$$;

revoke execute on function public.fn_marcar_fatura_enviada(text, uuid, uuid[], text) from anon;
