-- Teste da Task 3: fn_ratear_arrendamento.
-- Sandbox: tudo o que este bloco escreve e' desfeito pelo SANDBOX_OK no fim.

DO $$
DECLARE
    v_area   uuid;
    v_b1     uuid;
    v_b2     uuid;
    v_b3     uuid;
    v_soma   numeric;
    v_val    numeric;
    v_vals   numeric[];
    v_pegou  boolean;
BEGIN
    ---------------------------------------------------------------- caso 1
    -- Um beneficiario a 100% leva o aluguel inteiro.
    INSERT INTO public.leased_areas (nome, valor_aluguel) VALUES ('SANDBOX rateio', 600) RETURNING id INTO v_area;
    INSERT INTO public.leased_area_beneficiaries (leased_area_id, nome, tipo, assina_contrato, rateio_tipo, rateio_valor)
    VALUES (v_area, 'Dono', 'terceiro', true, 'percentual', 100) RETURNING id INTO v_b1;

    SELECT r.valor INTO v_val FROM public.fn_ratear_arrendamento(v_area, 600) r;
    IF v_val IS DISTINCT FROM 600.00 THEN
        RAISE EXCEPTION 'FALHOU caso 1: beneficiario unico a 100%% recebeu % em vez de 600', v_val;
    END IF;

    ---------------------------------------------------------------- caso 2
    -- Dois a 50/50.
    UPDATE public.leased_area_beneficiaries SET rateio_valor = 50 WHERE id = v_b1;
    INSERT INTO public.leased_area_beneficiaries (leased_area_id, nome, tipo, rateio_tipo, rateio_valor)
    VALUES (v_area, 'Dona', 'terceiro', 'percentual', 50) RETURNING id INTO v_b2;

    SELECT sum(r.valor), array_agg(r.valor ORDER BY r.valor) INTO v_soma, v_vals
      FROM public.fn_ratear_arrendamento(v_area, 600) r;
    IF v_soma IS DISTINCT FROM 600.00 OR v_vals IS DISTINCT FROM ARRAY[300.00, 300.00] THEN
        RAISE EXCEPTION 'FALHOU caso 2: 50/50 de 600 deu % (soma %)', v_vals, v_soma;
    END IF;

    ---------------------------------------------------------------- caso 3
    -- Fixo primeiro, percentual sobre o que sobra. O fixo de 100 sai do
    -- aluguel de 600 e o percentual de 100% leva os 500 restantes -- nao 600.
    UPDATE public.leased_area_beneficiaries SET rateio_tipo = 'fixo', rateio_valor = 100 WHERE id = v_b2;
    UPDATE public.leased_area_beneficiaries SET rateio_valor = 100 WHERE id = v_b1;

    SELECT sum(r.valor) INTO v_soma FROM public.fn_ratear_arrendamento(v_area, 600) r;
    SELECT r.valor INTO v_val FROM public.fn_ratear_arrendamento(v_area, 600) r WHERE r.beneficiary_id = v_b1;
    IF v_soma IS DISTINCT FROM 600.00 OR v_val IS DISTINCT FROM 500.00 THEN
        RAISE EXCEPTION 'FALHOU caso 3: fixo 100 + percentual 100%% de 600 deu percentual=% e soma=%', v_val, v_soma;
    END IF;

    ---------------------------------------------------------------- caso 4
    -- Residuo de centavo. 10,00 em tres partes arredondadas soma 9,99:
    -- o centavo que falta precisa ir para alguem, nao evaporar.
    UPDATE public.leased_area_beneficiaries SET rateio_tipo = 'percentual', rateio_valor = 33.33 WHERE id = v_b1;
    UPDATE public.leased_area_beneficiaries SET rateio_tipo = 'percentual', rateio_valor = 33.33 WHERE id = v_b2;
    INSERT INTO public.leased_area_beneficiaries (leased_area_id, nome, tipo, rateio_tipo, rateio_valor)
    VALUES (v_area, 'Terceiro', 'terceiro', 'percentual', 33.34) RETURNING id INTO v_b3;

    SELECT sum(r.valor), array_agg(r.valor ORDER BY r.valor) INTO v_soma, v_vals
      FROM public.fn_ratear_arrendamento(v_area, 10) r;
    IF v_soma IS DISTINCT FROM 10.00 THEN
        RAISE EXCEPTION 'FALHOU caso 4: tres partes de 10,00 somaram % (parcelas %)', v_soma, v_vals;
    END IF;
    IF v_vals IS DISTINCT FROM ARRAY[3.33, 3.33, 3.34] THEN
        RAISE EXCEPTION 'FALHOU caso 4: parcelas saíram % em vez de {3.33, 3.33, 3.34}', v_vals;
    END IF;

    ---------------------------------------------------------------- caso 5
    -- Percentuais somando 90: 10%% do aluguel nao teria destino.
    UPDATE public.leased_area_beneficiaries SET rateio_valor = 30 WHERE id IN (v_b1, v_b2, v_b3);
    v_pegou := false;
    BEGIN
        PERFORM * FROM public.fn_ratear_arrendamento(v_area, 600);
    EXCEPTION WHEN OTHERS THEN
        v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHOU caso 5: percentuais somando 90 foram aceitos';
    END IF;

    ---------------------------------------------------------------- caso 6
    -- Fixos acima do aluguel.
    UPDATE public.leased_area_beneficiaries SET ativo = false WHERE id IN (v_b2, v_b3);
    UPDATE public.leased_area_beneficiaries SET rateio_tipo = 'fixo', rateio_valor = 900 WHERE id = v_b1;
    v_pegou := false;
    BEGIN
        PERFORM * FROM public.fn_ratear_arrendamento(v_area, 600);
    EXCEPTION WHEN OTHERS THEN
        v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHOU caso 6: parcela fixa de 900 num aluguel de 600 foi aceita';
    END IF;

    ---------------------------------------------------------------- caso 7
    -- Nenhum beneficiario ativo.
    UPDATE public.leased_area_beneficiaries SET ativo = false WHERE leased_area_id = v_area;
    v_pegou := false;
    BEGIN
        PERFORM * FROM public.fn_ratear_arrendamento(v_area, 600);
    EXCEPTION WHEN OTHERS THEN
        v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHOU caso 7: area sem beneficiario ativo rateou';
    END IF;

    ---------------------------------------------------------------- caso 8
    -- So' intermediario: a imobiliaria recebe, mas nao ha dono da terra para
    -- absorver o residuo nem para assinar. Rateio nao acontece.
    INSERT INTO public.leased_area_beneficiaries (leased_area_id, nome, tipo, rateio_tipo, rateio_valor)
    VALUES (v_area, 'Imobiliaria', 'intermediario', 'percentual', 100);
    v_pegou := false;
    BEGIN
        PERFORM * FROM public.fn_ratear_arrendamento(v_area, 600);
    EXCEPTION WHEN OTHERS THEN
        v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHOU caso 8: area sem beneficiario terceiro rateou';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SANDBOX_OK' THEN RAISE; END IF;
    RAISE NOTICE 'OK: fn_ratear_arrendamento passou nos 8 casos — tudo desfeito';
END $$;
