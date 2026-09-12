-- Teste da Task 8: fn_validar_linha_digitavel.
-- Nao escreve nada: a funcao e' IMMUTABLE e so' le a propria linha.
-- Trava de graca contra colar o boleto do mes errado ou de outro credor.

DO $$
DECLARE
    -- Boleto bancario sintetico de R$ 600,00. Os 10 ultimos digitos sao o
    -- valor em centavos; os 4 anteriores, o fator de vencimento.
    v_ok_600 text := '23793.38128 60007.827723 95000.063305 4 11510000060000';
    v_r jsonb;
BEGIN
    ------------------------------------------------------------------ valor bate
    v_r := public.fn_validar_linha_digitavel(v_ok_600, 600.00);
    IF (v_r->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FALHOU: boleto de 600 contra pagamento de 600 foi recusado: %', v_r;
    END IF;
    IF (v_r->>'valor_boleto')::numeric IS DISTINCT FROM 600.00 THEN
        RAISE EXCEPTION 'FALHOU: leu o valor como % em vez de 600', v_r->>'valor_boleto';
    END IF;
    IF v_r->>'formato' <> 'bancario' THEN
        RAISE EXCEPTION 'FALHOU: 47 digitos deveriam ser bancario, veio %', v_r->>'formato';
    END IF;

    --------------------------------------------------------------- valor diverge
    -- O caso que a trava existe para pegar: boleto certo, mes errado.
    v_r := public.fn_validar_linha_digitavel(v_ok_600, 500.00);
    IF (v_r->>'ok')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'FALHOU: boleto de 600 passou para um pagamento de 500';
    END IF;

    ------------------------------------------------------------------- ilegivel
    -- Formato desconhecido e' recusa explicita, nao aceite por omissao.
    v_r := public.fn_validar_linha_digitavel('1234', 600.00);
    IF (v_r->>'ok')::boolean IS NOT FALSE OR v_r->>'formato' <> 'desconhecido' THEN
        RAISE EXCEPTION 'FALHOU: linha de 4 digitos nao foi recusada: %', v_r;
    END IF;

    --------------------------------------------------------------------- nulos
    v_r := public.fn_validar_linha_digitavel(NULL, 600.00);
    IF (v_r->>'ok')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'FALHOU: linha nula passou';
    END IF;

    -- Sem valor esperado nao ha o que conferir, entao tambem nao passa.
    v_r := public.fn_validar_linha_digitavel(v_ok_600, NULL);
    IF (v_r->>'ok')::boolean IS NOT FALSE THEN
        RAISE EXCEPTION 'FALHOU: sem valor esperado, a conferencia passou assim mesmo';
    END IF;

    RAISE NOTICE 'OK: fn_validar_linha_digitavel passou nos 5 casos';
END $$;
