-- Teste do circuito do PIX com autorizacao por token no Asaas.
--
-- O que ele prova: transferencia PENDING nao move o razao, e e' a confirmacao
-- do token que paga. Marcar 'pago' ao criar a transferencia faria o Banco
-- Asaas mostrar um saldo menor do que o real ate' alguem autorizar -- ou para
-- sempre, se ninguem autorizasse.
--
-- Sandbox: tudo desfeito pelo SANDBOX_OK no fim.

DO $$
DECLARE
    v_pag uuid; v_tr uuid; v_st text; v_ben uuid;
    v_antes numeric; v_depois numeric;
BEGIN
    SELECT round(sum(e.amount), 2) INTO v_antes
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '1.1.1.01';

    SELECT ap.id, ap.beneficiary_id INTO v_pag, v_ben
      FROM public.arrendamento_pagamentos ap
     WHERE ap.forma_pagamento = 'pix' AND ap.status = 'a_pagar' LIMIT 1;
    IF v_pag IS NULL THEN
        RAISE EXCEPTION 'fixture: nenhum repasse PIX a pagar para exercitar o teste';
    END IF;

    -- Caminho real: a transferencia nasce PENDING e o repasse fica preso a ela.
    INSERT INTO public.financial_transfers (amount, destination_type, destination_id, status, asaas_transfer_id)
    VALUES (600, 'arrendante', v_ben, 'pending', 'sandbox_tok_1') RETURNING id INTO v_tr;

    UPDATE public.arrendamento_pagamentos
       SET status = 'enfileirado', financial_transfer_id = v_tr
     WHERE id = v_pag;

    SELECT round(sum(e.amount), 2) INTO v_depois
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '1.1.1.01';
    IF v_depois IS DISTINCT FROM v_antes THEN
        RAISE EXCEPTION 'FALHOU: transferencia pendente ja mexeu no banco (de % para %)', v_antes, v_depois;
    END IF;

    -- O operador autoriza o token; o Asaas dispara TRANSFER_DONE e o webhook
    -- marca completed. E' aqui que o dinheiro sai.
    UPDATE public.financial_transfers SET status = 'completed' WHERE id = v_tr;

    SELECT status INTO v_st FROM public.arrendamento_pagamentos WHERE id = v_pag;
    IF v_st <> 'pago' THEN
        RAISE EXCEPTION 'FALHOU: depois da confirmacao o repasse ficou em %, nao em pago', v_st;
    END IF;

    SELECT round(sum(e.amount), 2) INTO v_depois
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '1.1.1.01';
    IF v_depois IS DISTINCT FROM round(v_antes - 600, 2) THEN
        RAISE EXCEPTION 'FALHOU: o banco deveria cair 600 e foi de % para %', v_antes, v_depois;
    END IF;

    -- Transferencia que falha devolve a obrigacao.
    UPDATE public.financial_transfers SET status = 'failed' WHERE id = v_tr;
    SELECT status INTO v_st FROM public.arrendamento_pagamentos WHERE id = v_pag;
    IF v_st <> 'falhou' THEN
        RAISE EXCEPTION 'FALHOU: transferencia falhada deixou o repasse em %', v_st;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: PENDING nao move o razao; o token e que paga — tudo desfeito';
END $$;
