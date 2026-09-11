-- Teste da Task 7: trilho de pagamento ao arrendante.
-- Exercita o caso que o dono relatou: uma area com dois beneficiarios, um
-- recebendo por PIX e outro por boleto de imobiliaria.
-- Sandbox: tudo desfeito pelo SANDBOX_OK no fim.

DO $$
DECLARE
    v_usina uuid; v_area uuid; v_pix uuid; v_bol uuid;
    v_p_pix uuid; v_p_bol uuid; v_n int; v_saldo numeric; v_banco numeric;
    v_2_1_0 numeric; v_tr uuid;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';
    INSERT INTO public.leased_areas (nome, valor_aluguel, dia_pagamento)
    VALUES ('SANDBOX trilho', 1000, 5) RETURNING id INTO v_area;
    UPDATE public.usinas SET leased_area_id = v_area WHERE id = v_usina;

    INSERT INTO public.leased_area_beneficiaries
        (leased_area_id, nome, tipo, assina_contrato, rateio_tipo, rateio_valor, forma_pagamento, pix_key, pix_key_type)
    VALUES (v_area, 'Dono PIX', 'terceiro', true, 'percentual', 60, 'pix', '123', 'CPF')
    RETURNING id INTO v_pix;
    INSERT INTO public.leased_area_beneficiaries
        (leased_area_id, nome, tipo, rateio_tipo, rateio_valor, forma_pagamento)
    VALUES (v_area, 'Imobiliaria', 'intermediario', 'percentual', 40, 'boleto')
    RETURNING id INTO v_bol;

    PERFORM public.fn_reconhecer_arrendamento(v_usina, DATE '2099-05-01', 1000, 'b2w_pre_operacao');

    SELECT id INTO v_p_pix FROM public.arrendamento_pagamentos WHERE beneficiary_id = v_pix;
    SELECT id INTO v_p_bol FROM public.arrendamento_pagamentos WHERE beneficiary_id = v_bol;

    -- O status inicial vem do trilho: boleto espera a linha digitavel chegar.
    SELECT count(*) INTO v_n FROM public.arrendamento_pagamentos WHERE id = v_p_bol AND status = 'aguardando_boleto';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: boleto nao nasceu aguardando_boleto'; END IF;
    SELECT count(*) INTO v_n FROM public.arrendamento_pagamentos WHERE id = v_p_pix AND status = 'a_pagar';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: pix nao nasceu a_pagar'; END IF;

    SELECT sum(e.amount) INTO v_saldo
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.5' AND e.reference_id IN (v_pix, v_bol);
    IF v_saldo IS DISTINCT FROM -1000 THEN
        RAISE EXCEPTION 'FALHOU: passivo reconhecido = % (esperado -1000)', v_saldo;
    END IF;

    -- Paga so' o do PIX. Pagamento parcial e' estado legitimo.
    UPDATE public.arrendamento_pagamentos SET status = 'pago' WHERE id = v_p_pix;

    SELECT sum(e.amount) INTO v_saldo
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.5' AND (e.reference_id IN (v_pix, v_bol) OR e.reference_id IN (v_p_pix, v_p_bol));
    IF v_saldo IS DISTINCT FROM -400 THEN
        RAISE EXCEPTION 'FALHOU: apos pagar o PIX, passivo = % (esperado -400)', v_saldo;
    END IF;

    SELECT count(*) INTO v_n FROM public.arrendamento_pagamentos WHERE id = v_p_bol AND status = 'aguardando_boleto';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: pagar um beneficiario mexeu no outro'; END IF;

    -- Paga o boleto. O par de lancamentos e' o mesmo dos dois trilhos.
    UPDATE public.arrendamento_pagamentos SET status = 'pago', linha_digitavel = '00190...' WHERE id = v_p_bol;
    SELECT sum(e.amount) INTO v_saldo
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.5' AND (e.reference_id IN (v_pix, v_bol) OR e.reference_id IN (v_p_pix, v_p_bol));
    IF v_saldo IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FALHOU: passivo nao zerou (%)', v_saldo; END IF;

    SELECT sum(e.amount) INTO v_banco
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '1.1.1.01' AND e.reference_id IN (v_p_pix, v_p_bol);
    IF v_banco IS DISTINCT FROM -1000 THEN
        RAISE EXCEPTION 'FALHOU: banco saiu % (esperado -1000)', v_banco;
    END IF;

    -- Estorno devolve a obrigacao.
    UPDATE public.arrendamento_pagamentos SET status = 'falhou' WHERE id = v_p_bol;
    SELECT sum(e.amount) INTO v_saldo
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.5' AND (e.reference_id IN (v_pix, v_bol) OR e.reference_id IN (v_p_pix, v_p_bol));
    IF v_saldo IS DISTINCT FROM -400 THEN
        RAISE EXCEPTION 'FALHOU: estorno nao devolveu a obrigacao (%)', v_saldo;
    END IF;

    -- Um PIX de arrendante NAO pode lancar por handle_transfer_ledger (seria
    -- a segunda perna) nem cair na conta-titulo 2.1.0, que era o defeito.
    INSERT INTO public.financial_transfers (amount, destination_type, destination_id, status, asaas_transfer_id)
    VALUES (600, 'arrendante', v_pix, 'completed', 'sandbox_tr_1') RETURNING id INTO v_tr;

    SELECT count(*) INTO v_n FROM public.ledger_entries WHERE reference_type = 'payout_arrendante';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHOU: handle_transfer_ledger lancou em dobro para arrendante (% linhas)', v_n;
    END IF;

    SELECT sum(e.amount) INTO v_2_1_0
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.0';
    IF v_2_1_0 IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU: lancamento caiu na conta-titulo 2.1.0 (%)', v_2_1_0;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: trilho de pagamento passou — tudo desfeito';
END $$;
