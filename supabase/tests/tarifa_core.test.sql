DO $$
DECLARE v numeric;
BEGIN
    -- caso de producao: TUSD consumo 0,64164, compensado 0,42884 -> 0,2128
    v := public.fn_fio_b_apurado(0.64164, 0.42884);
    IF round(v, 5) <> 0.21280 THEN
        RAISE EXCEPTION 'FALHOU fio_b: esperado 0.21280, veio %', round(v, 5);
    END IF;

    -- insumo ausente: propaga NULL, nao inventa zero
    IF public.fn_fio_b_apurado(0.64164, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU fio_b: insumo nulo deveria propagar NULL';
    END IF;

    -- nunca negativo
    IF public.fn_fio_b_apurado(0.30000, 0.50000) <> 0 THEN
        RAISE EXCEPTION 'FALHOU fio_b: resultado negativo deveria ser travado em 0';
    END IF;

    RAISE NOTICE 'OK: fn_fio_b_apurado';
END $$;

DO $$
DECLARE v numeric;
BEGIN
    -- caso validado contra producao: UFV Bom Jesus 05/2026
    -- TE 0,39033 + TUSD 0,64164 = 1,03197 ; desconto 20% ; Fio B 0,2128
    v := public.fn_tarifa_fornecedor(0.39033, 0.64164, 20, 0.21280);
    IF round(v, 5) <> 0.61278 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: esperado 0.61278, veio %', round(v, 5);
    END IF;

    -- exemplo redondo da memoria de calculo: 1,02 - 20% - 0,21 = 0,606
    v := public.fn_tarifa_fornecedor(0.38000, 0.64000, 20, 0.21000);
    IF round(v, 3) <> 0.606 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor exemplo: esperado 0.606, veio %', round(v, 3);
    END IF;

    -- desconto zero: tarifa menos fio b
    IF round(public.fn_tarifa_fornecedor(0.40000, 0.60000, 0, 0.20000), 5) <> 0.80000 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: desconto zero';
    END IF;

    -- nunca negativa
    IF public.fn_tarifa_fornecedor(0.10000, 0.10000, 20, 0.90000) <> 0 THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: resultado negativo deveria travar em 0';
    END IF;

    -- insumo ausente: propaga NULL em qualquer um dos quatro parametros
    IF public.fn_tarifa_fornecedor(NULL, 0.64164, 20, 0.21280) IS NOT NULL
       OR public.fn_tarifa_fornecedor(0.39033, NULL, 20, 0.21280) IS NOT NULL
       OR public.fn_tarifa_fornecedor(0.39033, 0.64164, NULL, 0.21280) IS NOT NULL
       OR public.fn_tarifa_fornecedor(0.39033, 0.64164, 20, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU tarifa_fornecedor: insumo nulo deveria propagar NULL';
    END IF;

    RAISE NOTICE 'OK: fn_tarifa_fornecedor';
END $$;
