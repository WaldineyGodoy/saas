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

DO $$
DECLARE r jsonb;
BEGIN
    -- exemplo da memoria de calculo, 1 kWh, tarifa 0,60
    r := public.fn_split_tarifa(0.60, 1, 3, 10, 5);

    IF round((r->>'crm')::numeric, 3) <> 0.018 THEN
        RAISE EXCEPTION 'FALHOU split crm: esperado 0.018, veio %', r->>'crm';
    END IF;
    IF round((r->>'gestora')::numeric, 3) <> 0.060 THEN
        RAISE EXCEPTION 'FALHOU split gestora: esperado 0.060, veio %', r->>'gestora';
    END IF;
    IF round((r->>'originador')::numeric, 3) <> 0.030 THEN
        RAISE EXCEPTION 'FALHOU split originador: esperado 0.030, veio %', r->>'originador';
    END IF;
    IF round((r->>'fornecedor')::numeric, 3) <> 0.492 THEN
        RAISE EXCEPTION 'FALHOU split fornecedor: esperado 0.492 (82%%), veio %', r->>'fornecedor';
    END IF;

    -- a soma das partes fecha com o total, sem centavo perdido
    IF round((r->>'crm')::numeric + (r->>'gestora')::numeric
           + (r->>'originador')::numeric + (r->>'fornecedor')::numeric, 6)
       <> round((r->>'total')::numeric, 6) THEN
        RAISE EXCEPTION 'FALHOU split: partes nao fecham com o total';
    END IF;

    -- escala com a energia compensada
    r := public.fn_split_tarifa(0.60, 1000, 3, 10, 5);
    IF round((r->>'total')::numeric, 2) <> 600.00 THEN
        RAISE EXCEPTION 'FALHOU split: total para 1000 kWh deveria ser 600.00, veio %', r->>'total';
    END IF;

    -- insumo ausente propaga NULL em qualquer um dos cinco parametros (Global Constraint)
    IF public.fn_split_tarifa(NULL, 1000, 3, 10, 5) IS NOT NULL
       OR public.fn_split_tarifa(0.60, NULL, 3, 10, 5) IS NOT NULL
       OR public.fn_split_tarifa(0.60, 1000, NULL, 10, 5) IS NOT NULL
       OR public.fn_split_tarifa(0.60, 1000, 3, NULL, 5) IS NOT NULL
       OR public.fn_split_tarifa(0.60, 1000, 3, 10, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU split: insumo nulo deveria propagar NULL';
    END IF;

    -- soma exatamente 100 e' valida: o fornecedor fica com zero, e' o limite
    r := public.fn_split_tarifa(0.60, 1, 50, 30, 20);
    IF r IS NULL OR round((r->>'fornecedor')::numeric, 6) <> 0 THEN
        RAISE EXCEPTION 'FALHOU split: soma 100 deveria valer com fornecedor zero, veio %', r;
    END IF;

    -- soma acima de 100 deixaria o fornecedor negativo: recusa
    IF public.fn_split_tarifa(0.60, 1, 3, 100, 5) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU split: soma 108 deveria recusar';
    END IF;

    -- percentual negativo: mesmo tratamento
    IF public.fn_split_tarifa(0.60, 1, -3, 10, 5) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU split: percentual negativo deveria recusar';
    END IF;

    RAISE NOTICE 'OK: fn_split_tarifa';
END $$;

DO $$
DECLARE
    v_ibge text;
    v_te   numeric;
    v_tusd numeric;
    r      jsonb;
BEGIN
    -- pega um municipio real da tabela de referencia
    SELECT "Cod. Ibge", "TE", "TUSD"
      INTO v_ibge, v_te, v_tusd
      FROM public."Concessionaria"
     WHERE "TE" IS NOT NULL AND "TE" > 0 AND "TUSD" IS NOT NULL AND "TUSD" > 0
     LIMIT 1;

    IF v_ibge IS NULL THEN
        RAISE EXCEPTION 'FALHOU: tabela Concessionaria sem linha utilizavel para o teste';
    END IF;

    -- valor identico a referencia: nao diverge
    r := public.fn_auditar_tarifa(v_ibge, v_te, v_tusd, NULL, 5);
    IF (r->>'divergente')::boolean THEN
        RAISE EXCEPTION 'FALHOU auditoria: valor igual a referencia acusou divergencia: %', r;
    END IF;

    -- 50%% acima da referencia: diverge e aponta o campo
    r := public.fn_auditar_tarifa(v_ibge, v_te * 1.5, v_tusd, NULL, 5);
    IF NOT (r->>'divergente')::boolean THEN
        RAISE EXCEPTION 'FALHOU auditoria: 50%% de desvio nao acusou divergencia: %', r;
    END IF;
    IF NOT (r->'campos' ? 'te') THEN
        RAISE EXCEPTION 'FALHOU auditoria: campo te deveria constar em campos: %', r;
    END IF;

    -- municipio inexistente: nao diverge, mas sinaliza ausencia de referencia
    r := public.fn_auditar_tarifa('0000000', 1.0, 1.0, NULL, 5);
    IF (r->>'divergente')::boolean THEN
        RAISE EXCEPTION 'FALHOU auditoria: sem referencia nao deve acusar divergencia';
    END IF;
    IF r->'referencia' <> 'null'::jsonb THEN
        RAISE EXCEPTION 'FALHOU auditoria: sem referencia, a chave referencia deve ser null';
    END IF;

    RAISE NOTICE 'OK: fn_auditar_tarifa';
END $$;
