-- Teste da fila anual de boletos.
--
-- Prova que boleto e pagamento se encontram nas DUAS ordens: o boleto que
-- chega depois do repasse existir, e o repasse que nasce depois do boleto
-- já estar guardado.
--
-- Sandbox: tudo desfeito pelo SANDBOX_OK no fim.

DO $$
DECLARE
    v_ben uuid; v_pag uuid; v_n int; v_st text; v_linha text; v_pegou boolean;
    -- Boleto sintético de R$ 600,00.
    v_bol text := '23793381286000782772395000063305411510000060000';
BEGIN
    SELECT id INTO v_ben FROM public.leased_area_beneficiaries
     WHERE nome = 'Joelson Imoveis'
       AND leased_area_id = (SELECT id FROM public.leased_areas WHERE nome = 'Santa Maria - Anita');

    ------------------------------------------------------------------ caso 1
    -- Boleto cadastrado DEPOIS do repasse existir: o repasse sai de
    -- aguardando_boleto e recebe a linha, sem ninguém digitar nada.
    SELECT id, status INTO v_pag, v_st FROM public.arrendamento_pagamentos
     WHERE beneficiary_id = v_ben AND competencia = DATE '2026-08-01';
    IF v_st <> 'aguardando_boleto' THEN
        RAISE EXCEPTION 'fixture: esperava aguardando_boleto, veio %', v_st;
    END IF;

    INSERT INTO public.arrendamento_boletos (beneficiary_id, competencia, linha_digitavel)
    VALUES (v_ben, DATE '2026-08-01', v_bol);

    SELECT status, linha_digitavel INTO v_st, v_linha FROM public.arrendamento_pagamentos WHERE id = v_pag;
    IF v_st <> 'a_pagar' THEN
        RAISE EXCEPTION 'FALHOU caso 1: repasse continuou em % depois do boleto chegar', v_st;
    END IF;
    IF v_linha IS DISTINCT FROM v_bol THEN
        RAISE EXCEPTION 'FALHOU caso 1: a linha nao foi anexada (%)', v_linha;
    END IF;

    -- Valor e vencimento saem da propria linha, nao sao digitados.
    SELECT count(*) INTO v_n FROM public.arrendamento_boletos
     WHERE beneficiary_id = v_ben AND competencia = DATE '2026-08-01'
       AND valor = 600.00 AND vencimento IS NOT NULL;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHOU caso 1: valor/vencimento nao foram extraidos da linha';
    END IF;

    ------------------------------------------------------------------ caso 2
    -- Linha ilegivel e' recusada na hora de guardar, nao na de pagar.
    v_pegou := false;
    BEGIN
        INSERT INTO public.arrendamento_boletos (beneficiary_id, competencia, linha_digitavel)
        VALUES (v_ben, DATE '2026-09-01', '123');
    EXCEPTION WHEN OTHERS THEN v_pegou := true; END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHOU caso 2: linha de 3 digitos foi aceita'; END IF;

    ------------------------------------------------------------------ caso 3
    -- Dois boletos para a mesma competencia do mesmo beneficiario: e' a
    -- trava contra pagar o mes duas vezes com papeis diferentes.
    v_pegou := false;
    BEGIN
        INSERT INTO public.arrendamento_boletos (beneficiary_id, competencia, linha_digitavel)
        VALUES (v_ben, DATE '2026-08-01', v_bol);
    EXCEPTION WHEN OTHERS THEN v_pegou := true; END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHOU caso 3: aceitou dois boletos na mesma competencia'; END IF;

    ------------------------------------------------------------------ caso 4
    -- Boleto guardado ANTES do reconhecimento. E' o caso real: a imobiliaria
    -- manda os 12 em janeiro. O repasse deve nascer ja' com a linha e pronto
    -- para pagar, em vez de aguardando_boleto.
    INSERT INTO public.arrendamento_boletos (beneficiary_id, competencia, linha_digitavel)
    VALUES (v_ben, DATE '2026-09-01', '23793381286000782772395000063305411510000026138');

    PERFORM public.fn_reconhecer_arrendamento(
        (SELECT id FROM public.usinas WHERE name = 'UFV - Santa Maria'),
        DATE '2026-09-01', 261.38, 'b2w_pre_operacao');

    SELECT status, linha_digitavel INTO v_st, v_linha FROM public.arrendamento_pagamentos
     WHERE beneficiary_id = v_ben AND competencia = DATE '2026-09-01';
    IF v_st <> 'a_pagar' THEN
        RAISE EXCEPTION 'FALHOU caso 4: nasceu em % em vez de a_pagar', v_st;
    END IF;
    IF v_linha IS NULL THEN
        RAISE EXCEPTION 'FALHOU caso 4: nasceu sem a linha que ja estava guardada';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fila de boletos passou nos 4 casos — tudo desfeito';
END $$;
