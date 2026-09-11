-- Teste da Task 5: fn_reconhecer_arrendamento.
-- Sandbox: tudo o que este bloco escreve e' desfeito pelo SANDBOX_OK no fim,
-- inclusive o leased_area_id da usina real usada como fixture.

DO $$
DECLARE
    v_usina uuid; v_area uuid; v_b_dono uuid; v_b_casa uuid;
    v_r jsonb; v_soma numeric; v_n int; v_2_1_1 numeric;
    v_pegou boolean; v_tx uuid;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus';

    INSERT INTO public.leased_areas (nome, valor_aluguel, dia_pagamento)
    VALUES ('SANDBOX rec', 600, 5) RETURNING id INTO v_area;
    INSERT INTO public.leased_area_beneficiaries
        (leased_area_id, nome, tipo, assina_contrato, rateio_tipo, rateio_valor, forma_pagamento, pix_key, pix_key_type)
    VALUES (v_area, 'Dono', 'terceiro', true, 'percentual', 100, 'pix', '111', 'CPF')
    RETURNING id INTO v_b_dono;
    UPDATE public.usinas SET leased_area_id = v_area WHERE id = v_usina;

    ------------------------------------------------ caso 1: fornecedor, sem margem
    -- Todo o aluguel vira obrigacao com o dono da terra. Nada de receita.
    v_tx := gen_random_uuid();
    v_r := public.fn_reconhecer_arrendamento(v_usina, DATE '2099-01-01', 600, 'fornecedor', v_tx);
    IF (v_r->>'passivo')::numeric IS DISTINCT FROM 600
       OR (v_r->>'receita_casa')::numeric IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'FALHOU caso 1: %', v_r;
    END IF;
    SELECT count(*) INTO v_n FROM public.arrendamento_pagamentos WHERE competencia = DATE '2099-01-01';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU caso 1: criou % pagamentos', v_n; END IF;

    -- Vencimento no mes seguinte, no dia_pagamento da area.
    SELECT extract(day from vencimento) INTO v_soma
      FROM public.arrendamento_pagamentos WHERE competencia = DATE '2099-01-01';
    IF v_soma <> 5 THEN RAISE EXCEPTION 'FALHOU caso 1: vencimento no dia % em vez de 5', v_soma; END IF;

    ------------------------------------------------ caso 2: idempotencia
    -- Reconhecer duas vezes a mesma competencia nao duplica nada.
    v_r := public.fn_reconhecer_arrendamento(v_usina, DATE '2099-01-01', 600, 'fornecedor', v_tx);
    IF (v_r->>'pagamentos_criados')::int <> 0 THEN
        RAISE EXCEPTION 'FALHOU caso 2: rodou de novo e criou pagamento';
    END IF;
    SELECT count(*) INTO v_n FROM public.ledger_entries WHERE external_id LIKE 'arrendamento:%2099-01%';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU caso 2: % lancamentos apos dois reconhecimentos', v_n; END IF;

    ------------------------------------------------ caso 3: margem da casa
    -- 80/20: o dono vira passivo, a B2W vira receita, e a casa NAO gera
    -- linha de pagamento -- o dinheiro dela ja' esta' na conta.
    UPDATE public.leased_area_beneficiaries SET rateio_valor = 80 WHERE id = v_b_dono;
    INSERT INTO public.leased_area_beneficiaries (leased_area_id, nome, tipo, rateio_tipo, rateio_valor)
    VALUES (v_area, 'B2W', 'casa', 'percentual', 20) RETURNING id INTO v_b_casa;

    v_r := public.fn_reconhecer_arrendamento(v_usina, DATE '2099-02-01', 600, 'fornecedor');
    IF (v_r->>'passivo')::numeric IS DISTINCT FROM 480
       OR (v_r->>'receita_casa')::numeric IS DISTINCT FROM 120 THEN
        RAISE EXCEPTION 'FALHOU caso 3: passivo/receita saiu %', v_r;
    END IF;
    SELECT count(*) INTO v_n FROM public.arrendamento_pagamentos WHERE competencia = DATE '2099-02-01';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU caso 3: a casa gerou pagamento (% linhas)', v_n; END IF;

    ------------------------------------------------ caso 4: pre-operacao
    -- Em obra ninguem foi cobrado: a casa nao ganha margem, o repasse do
    -- investidor nao e' tocado, e a transacao fecha sozinha.
    v_r := public.fn_reconhecer_arrendamento(v_usina, DATE '2099-03-01', 600, 'b2w_pre_operacao');
    IF (v_r->>'passivo')::numeric IS DISTINCT FROM 480
       OR (v_r->>'receita_casa')::numeric IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'FALHOU caso 4: a casa ganhou margem em obra: %', v_r;
    END IF;

    SELECT sum(e.amount) INTO v_2_1_1
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.1' AND e.external_id LIKE 'arrendamento:%2099-03%';
    IF v_2_1_1 IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU caso 4: pre-operacao tocou o repasse do investidor (2.1.1 = %)', v_2_1_1;
    END IF;

    SELECT sum(e.amount) INTO v_soma FROM public.ledger_entries e
     WHERE e.external_id LIKE 'arrendamento:%2099-03%';
    IF v_soma IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'FALHOU caso 4: transacao de pre-operacao soma % em vez de 0', v_soma;
    END IF;

    ------------------------------------------------ caso 5: usina sem area
    -- Cobrar arrendamento de dono desconhecido e' o defeito que originou a
    -- spec. A funcao recusa em vez de lancar contra ninguem.
    UPDATE public.usinas SET leased_area_id = NULL WHERE id = v_usina;
    v_pegou := false;
    BEGIN
        PERFORM public.fn_reconhecer_arrendamento(v_usina, DATE '2099-04-01', 600, 'fornecedor');
    EXCEPTION WHEN OTHERS THEN
        v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHOU caso 5: usina sem area vinculada reconheceu'; END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fn_reconhecer_arrendamento passou nos 5 casos — tudo desfeito';
END $$;
