DO $$
DECLARE v numeric;
BEGIN
    -- caso de producao: TUSD consumo 0,64164, compensado 0,42884 -> 0,2128
    v := public.fn_fio_b_apurado(0.64164, 0.42884);
    IF round(v, 5) <> 0.21280 THEN
        RAISE EXCEPTION 'FALHOU fio_b: esperado 0.21280, veio %', round(v, 5);
    END IF;

    -- compensado nulo: sem compensacao nao ha Fio B
    IF public.fn_fio_b_apurado(0.64164, NULL) <> 0 THEN
        RAISE EXCEPTION 'FALHOU fio_b: compensado nulo deveria dar 0';
    END IF;

    -- nunca negativo
    IF public.fn_fio_b_apurado(0.30000, 0.50000) <> 0 THEN
        RAISE EXCEPTION 'FALHOU fio_b: resultado negativo deveria ser travado em 0';
    END IF;

    RAISE NOTICE 'OK: fn_fio_b_apurado';
END $$;
