-- Teste: START POR ENERGIA e BASE BRUTA (20261112b, 2a revisao do dono 12/11/2026).
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md, secoes
--       "Revisao de 12/11/2026 (2a, dono)" e "Contrato comum (nomes fixos)".
--
-- Roda DEPOIS de 20261112b, no mesmo BEGIN/ROLLBACK (nada e aplicado):
--   BEGIN; <20261112b>; <este arquivo>; ROLLBACK;
-- Sucesso = erro 'SANDBOX_OK'.
--
-- (a) mediana: so a leitura mais recente de cada mes do calendario (a Cosern
--     traz 13 meses), so kwh > 0; meses zerados preenchidos com a mediana;
--     start_base_kwh congelado na 1a gravacao e NUNCA reescrito por UPDATE
--     comum (so fn_redefinir_start_base_kwh).
-- (b) autoatualizacao: a conta lida (invoices.consumo_kwh) sobrescreve o mes
--     do perfil (origem conta), recalcula a mediana e NAO muda o teto; conta
--     de referencia mais antiga nao sobrescreve.
-- (c) fn_geracao_estimada_mensal: soma dos 12 meses = 12 x estimada; sem
--     cidade casada, plano.
-- (d) exemplo do dono: mediana 1.000, Start 2x (teto 2.000), tarifa 1,02,
--     PPE 50% L1: F1 600 -> 306,00 | F2 1.200 -> 510,00 (1.000 kWh) |
--     F3 800 -> 204,00 (400 kWh, encerrado) | F4: plano start nada.
--     B2W 10% tambem sobre a tarifa cheia; fornecedor = base liquida - deduzido.
-- (e) Hibrido: F3 (a que completa) so Start; F4 recorrencia 5% (51,00).
-- (f) 1x: 600 -> 600 kWh (306,00); 1.000 -> 400 kWh (204,00).
-- (g) UC sem start_base_kwh: Start nao paga (uc_sem_consumo_base).
-- (h) transicao: fatura paga ANTES da regra (sem a marca) consome o saldo.
-- (i) validador e conversao dos planos.
--
-- Cadastro sandbox: tarifa 1,02, Fio B 0,20, desconto 0 -> base liquida
-- 0,82/kWh e base bruta 1,02/kWh; piso 50% da tarifa bruta; B2W 10% pelo
-- plano de usina.

DO $$
DECLARE
    v_ok       boolean;
    v_txt      text;
    v_id       uuid;
    v_r        jsonb;

    v_po_2x    uuid;
    v_po_hib   uuid;
    v_po_1x    uuid;
    v_pa_2x    uuid;
    v_pa_hib   uuid;
    v_pa_1x    uuid;

    v_pu       uuid;
    v_sup      uuid;
    v_usina    uuid;
    v_usina_g  uuid;
    v_ppe      uuid;
    v_sub      uuid;
    v_uc       uuid;
    v_inv      uuid;
    r          jsonb;
    v_b        jsonb;
    v_soma     numeric;

    c_mil constant jsonb := '[{"mes":"2026-01","kwh":1000},{"mes":"2026-02","kwh":1000},{"mes":"2026-03","kwh":1000}]';
    c_matriz_pa constant jsonb := '{"regras_multinivel": {
        "b2w": {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
        "assinante_conect": {"niveis": {"L1": "0", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}';
BEGIN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);

    -- ------------------------------------------------------------ helpers
    EXECUTE $f$
      CREATE FUNCTION pg_temp.pagar(p_inv uuid) RETURNS jsonb LANGUAGE plpgsql AS $b$
      DECLARE v_txn uuid; r jsonb;
      BEGIN
        UPDATE public.invoices SET status = 'pago' WHERE id = p_inv;
        SELECT le.transaction_id INTO v_txn FROM public.ledger_entries le
         WHERE le.reference_id = p_inv AND le.description = 'Recebimento Fatura ' || p_inv;
        IF v_txn IS NULL THEN
          RAISE EXCEPTION 'FALHA: a fatura % nao gerou lancamento (%)', p_inv,
            (SELECT i.recompensas_aplicadas ->> 'motivo' FROM public.invoices i WHERE i.id = p_inv);
        END IF;
        SELECT jsonb_build_object(
                 'gestao',  COALESCE(SUM(le.amount) FILTER (WHERE la.code = '3.1.1'), 0),
                 'com',     COALESCE(SUM(le.amount) FILTER (WHERE la.code = '2.1.2'), 0),
                 'forn',    COALESCE(SUM(le.amount) FILTER (WHERE la.code = '2.1.1'), 0),
                 'total',   COALESCE(SUM(le.amount), 0))
          INTO r
          FROM public.ledger_entries le JOIN public.ledger_accounts la ON la.id = le.account_id
         WHERE le.transaction_id = v_txn;
        RETURN r || jsonb_build_object('rec', (SELECT i.recompensas_aplicadas FROM public.invoices i WHERE i.id = p_inv));
      END $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.confere(p_rot text, r jsonb, g numeric, c numeric, f numeric)
      RETURNS void LANGUAGE plpgsql AS $b$
      BEGIN
        IF ((r->>'gestao')::numeric, (r->>'com')::numeric, (r->>'forn')::numeric) IS DISTINCT FROM (g, c, f) THEN
          RAISE EXCEPTION 'FALHA %: 3.1.1=% 2.1.2=% 2.1.1=% (esperado % / % / %)',
            p_rot, r->>'gestao', r->>'com', r->>'forn', g, c, f;
        END IF;
        IF (r->>'total')::numeric <> 0 THEN
          RAISE EXCEPTION 'FALHA %: a transacao nao fecha em zero (%)', p_rot, r->>'total';
        END IF;
        IF r #>> '{rec,versao}' IS DISTINCT FROM '20261112_start_por_energia'
           OR (r #>> '{rec,start_por_energia}')::boolean IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'FALHA %: versao/marca gravada % / %', p_rot, r #>> '{rec,versao}', r #>> '{rec,start_por_energia}';
        END IF;
      END $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.po(r jsonb) RETURNS jsonb LANGUAGE sql AS $b$
        SELECT r #> '{rec,plano_originador,ppe}'
      $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.fatura(p_uc uuid, p_dias int, p_kwh numeric) RETURNS uuid LANGUAGE sql AS $b$
        INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
        VALUES (p_uc, 'a_vencer', round(p_kwh * 0.82, 2), 0, CURRENT_DATE + p_dias, p_kwh) RETURNING id
      $b$
    $f$;

    -- ================================================================== (i)
    IF EXISTS (SELECT 1 FROM public.planos_originador
                WHERE start_config ? 'faturas_elegiveis' OR start_config ? 'regras'
                   OR jsonb_typeof(start_config -> 'regras_multinivel') <> 'object'
                   OR (tipo_recompensa IN ('start', 'ambos')
                       AND COALESCE((start_config ->> 'multiplicador')::numeric, 0) <= 0)) THEN
        RAISE EXCEPTION 'FALHA (i): sobrou plano no formato antigo ou sem multiplicador';
    END IF;
    FOREACH v_txt IN ARRAY ARRAY[
        '{"faturas_elegiveis": [1], "multiplicador": 1, "regras_multinivel": {}}',
        '{"multiplicador": 1, "regras_multinivel": {}, "regras": {}}',
        '{"multiplicador": 0, "regras_multinivel": {}}',
        '{"multiplicador": "x", "regras_multinivel": {}}',
        '{"regras_multinivel": {}}',
        '{"multiplicador": 1, "regras_multinivel": {}, "janela": 2}',
        '{"multiplicador": 1, "regras_multinivel": {"ppe": {"niveis": {"L1": "10"}, "max_niveis": 4}}}',
        '{"multiplicador": 1, "regras_multinivel": {"b2w": {"niveis": {"L1": "10"}, "max_niveis": 1}}}'] LOOP
        v_ok := false;
        BEGIN
            INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
            VALUES ('SANDBOX energia invalido', 'start', v_txt::jsonb, '{"regras_multinivel": {}}');
        EXCEPTION WHEN check_violation THEN v_ok := true; END;
        IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (i): start_config invalido aceito: %', v_txt; END IF;
    END LOOP;
    -- aceitos: decimal; recorrente com ou sem multiplicador; default da coluna
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX energia 1.5', 'ambos', '{"multiplicador": 1.5, "regras_multinivel": {}}', '{"regras_multinivel": {}}') RETURNING id INTO v_id;
    DELETE FROM public.planos_originador WHERE id = v_id;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX energia rec', 'recorrente', '{"multiplicador": 1, "regras_multinivel": {}}', '{"regras_multinivel": {}}') RETURNING id INTO v_id;
    DELETE FROM public.planos_originador WHERE id = v_id;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX energia rec sem mult', 'recorrente', '{"regras_multinivel": {}}', '{"regras_multinivel": {}}') RETURNING id INTO v_id;
    DELETE FROM public.planos_originador WHERE id = v_id;
    INSERT INTO public.planos_originador (nome) VALUES ('SANDBOX energia default') RETURNING id INTO v_id;
    DELETE FROM public.planos_originador WHERE id = v_id;

    -- ================================================================== (a)
    -- 13 meses: o 2025-10 (antigo) sai, fica o 2026-10
    IF public.fn_mediana_kwh('[{"mes":"2025-10","kwh":5000},{"mes":"2026-10","kwh":100},{"mes":"2026-09","kwh":200}]') <> 150 THEN
        RAISE EXCEPTION 'FALHA (a): mediana do leitor = % (esperado 150: so o mais recente de cada mes)',
            public.fn_mediana_kwh('[{"mes":"2025-10","kwh":5000},{"mes":"2026-10","kwh":100},{"mes":"2026-09","kwh":200}]');
    END IF;
    IF public.fn_mediana_kwh('[{"mes":"2026-01","kwh":0},{"mes":"2026-02","kwh":300},{"mes":"2026-03","kwh":100}]') <> 200
       OR public.fn_mediana_kwh('[]') IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA (a): mediana ignora zero / vazio = null';
    END IF;
    IF public.fn_mediana_kwh('{"01":{"kwh":100,"origem":"cadastro"},"02":{"kwh":900,"origem":"mediana"},"03":{"kwh":300,"origem":"conta"}}') <> 200 THEN
        RAISE EXCEPTION 'FALHA (a): mediana do perfil conta mes preenchido';
    END IF;

    -- ------------------------------------------------------------ fixture
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX energia 2x', 'start',
            '{"multiplicador": 2, "regras_multinivel": {
                "ppe": {"niveis": {"L1": "50", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {"ppe": {"niveis": {"L1": "5", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}')
    RETURNING id INTO v_po_2x;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX energia hibrido', 'ambos',
            '{"multiplicador": 2, "regras_multinivel": {
                "ppe": {"niveis": {"L1": "50", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {"ppe": {"niveis": {"L1": "5", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}')
    RETURNING id INTO v_po_hib;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX energia 1x', 'start',
            '{"multiplicador": 1, "regras_multinivel": {
                "ppe": {"niveis": {"L1": "50", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {}}')
    RETURNING id INTO v_po_1x;

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config, plano_originador_id)
    VALUES ('SANDBOX energia pa 2x', 'recorrente', 10, 50, 0, c_matriz_pa, v_po_2x) RETURNING id INTO v_pa_2x;
    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config, plano_originador_id)
    VALUES ('SANDBOX energia pa hib', 'recorrente', 10, 50, 0, c_matriz_pa, v_po_hib) RETURNING id INTO v_pa_hib;
    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config, plano_originador_id)
    VALUES ('SANDBOX energia pa 1x', 'recorrente', 10, 50, 0, c_matriz_pa, v_po_1x) RETURNING id INTO v_pa_1x;

    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX-ENE-1', 'Sandbox ENE', 'SANDBOX ENE conc', 'RN', 1.02, 0.20);
    INSERT INTO public.planos_usina (nome, percentual_recorrente) VALUES ('SANDBOX ENE pu', 10) RETURNING id INTO v_pu;
    INSERT INTO public.suppliers (name) VALUES ('SANDBOX ENE fornecedor') RETURNING id INTO v_sup;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu, v_sup) RETURNING id INTO v_usina;
    -- PPE sem lider: o unico parceiro da fatura
    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX ENE PPE', 'ppe', true) RETURNING id INTO v_ppe;

    -- (a) perfil pela RPC: 13 meses, zeros preenchidos, teto congelado
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/a') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_2x) RETURNING id INTO v_uc;
    v_r := public.fn_gravar_historico_consumo(v_uc,
        '[{"mes":"2025-10","kwh":5000,"dias":30},{"mes":"2025-11","kwh":0,"dias":30},{"mes":"2025-12","kwh":900,"dias":30},
          {"mes":"2026-01","kwh":1000,"dias":30},{"mes":"2026-02","kwh":1100,"dias":30},{"mes":"2026-03","kwh":0,"dias":30},
          {"mes":"2026-04","kwh":1000,"dias":30},{"mes":"2026-05","kwh":950,"dias":30},{"mes":"2026-06","kwh":1050,"dias":30},
          {"mes":"2026-07","kwh":1000,"dias":30},{"mes":"2026-08","kwh":1000,"dias":30},{"mes":"2026-09","kwh":1200,"dias":30},
          {"mes":"2026-10","kwh":1000,"dias":30}]', 'cadastro');
    IF (v_r ->> 'mediana')::numeric <> 1000 OR (v_r ->> 'start_base_kwh')::numeric <> 1000 THEN
        RAISE EXCEPTION 'FALHA (a): RPC devolveu %', v_r;
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_r -> 'historico')) <> 12
       OR v_r #> '{historico,11}' <> '{"kwh": 1000, "ref": "2025-11", "origem": "mediana"}'::jsonb
       OR v_r #> '{historico,03}' <> '{"kwh": 1000, "ref": "2026-03", "origem": "mediana"}'::jsonb
       OR v_r #> '{historico,10}' <> '{"kwh": 1000, "ref": "2026-10", "origem": "cadastro"}'::jsonb
       OR v_r #> '{historico,12}' <> '{"kwh": 900, "ref": "2025-12", "origem": "cadastro"}'::jsonb THEN
        RAISE EXCEPTION 'FALHA (a): perfil gravado %', v_r -> 'historico';
    END IF;
    IF (SELECT (consumo_mediano_kwh, start_base_kwh) FROM public.consumer_units WHERE id = v_uc)
       IS DISTINCT FROM (1000::numeric, 1000::numeric)
       OR (SELECT start_base_em FROM public.consumer_units WHERE id = v_uc) IS NULL THEN
        RAISE EXCEPTION 'FALHA (a): colunas da UC nao gravadas';
    END IF;
    -- regravar com outro historico nao muda o teto
    v_r := public.fn_gravar_historico_consumo(v_uc, '[{"mes":"2026-11","kwh":4000}]', 'cadastro');
    IF (v_r ->> 'start_base_kwh')::numeric <> 1000
       OR (SELECT start_base_kwh FROM public.consumer_units WHERE id = v_uc) <> 1000 THEN
        RAISE EXCEPTION 'FALHA (a): regravacao mexeu no teto: %', v_r ->> 'start_base_kwh';
    END IF;
    -- UPDATE comum do teto e recusado; so a RPC de admin muda
    v_ok := false;
    BEGIN
        UPDATE public.consumer_units SET start_base_kwh = 999 WHERE id = v_uc;
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (a): start_base_kwh reescrito por UPDATE comum'; END IF;
    v_r := public.fn_redefinir_start_base_kwh(v_uc, 1000);
    IF (v_r ->> 'start_base_kwh')::numeric <> 1000 THEN
        RAISE EXCEPTION 'FALHA (a): fn_redefinir_start_base_kwh %', v_r;
    END IF;

    -- ================================================================== (b)
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://ene/b') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_2x) RETURNING id INTO v_uc;
    v_r := public.fn_gravar_historico_consumo(v_uc,
        '[{"mes":"2026-01","kwh":100},{"mes":"2026-02","kwh":200},{"mes":"2026-03","kwh":300}]');
    IF (v_r ->> 'start_base_kwh')::numeric <> 200 OR v_r #>> '{historico,07,origem}' <> 'mediana' THEN
        RAISE EXCEPTION 'FALHA (b): perfil inicial %', v_r;
    END IF;
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, consumo_kwh, mes_referencia)
    VALUES (v_uc, 'a_vencer', 0, 0, CURRENT_DATE + 5, 0, 1000, DATE '2026-04-01');
    -- conta mais ANTIGA que o perfil nao sobrescreve
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, consumo_kwh, mes_referencia)
    VALUES (v_uc, 'a_vencer', 0, 0, CURRENT_DATE + 5, 0, 999, DATE '2025-01-01');
    SELECT jsonb_build_object('h', historico_consumo, 'med', consumo_mediano_kwh, 'base', start_base_kwh)
      INTO v_r FROM public.consumer_units WHERE id = v_uc;
    IF v_r #> '{h,04}' <> '{"kwh": 1000, "ref": "2026-04", "origem": "conta"}'::jsonb
       OR v_r #> '{h,01}' <> '{"kwh": 100, "ref": "2026-01", "origem": "cadastro"}'::jsonb
       OR (v_r ->> 'med')::numeric <> 250
       OR (v_r #>> '{h,07,kwh}')::numeric <> 250
       OR (v_r ->> 'base')::numeric <> 200 THEN
        RAISE EXCEPTION 'FALHA (b): autoatualizacao %', v_r;
    END IF;

    -- ================================================================== (c)
    INSERT INTO public.usinas (plano_usina_id, supplier_id, ibge_code, geracao_estimada_kwh)
    VALUES (v_pu, v_sup, (SELECT r."cod.ibge"::text FROM public.irradiancia r
                           WHERE r."jan.khw" ~ '^[0-9]+$' AND r."jun.kwh" ~ '^[0-9]+$' AND r."dez.khw" ~ '^[0-9]+$'
                           ORDER BY r."cod.ibge" LIMIT 1), 1000)
    RETURNING id INTO v_usina_g;
    v_r := public.fn_geracao_estimada_mensal(v_usina_g);
    SELECT sum(value::numeric) INTO v_soma FROM jsonb_each_text(v_r);
    IF (SELECT count(*) FROM jsonb_object_keys(v_r)) <> 12 OR abs(v_soma - 12000) > 0.1
       OR (SELECT count(DISTINCT value) FROM jsonb_each_text(v_r)) < 2 THEN
        RAISE EXCEPTION 'FALHA (c): geracao mensal % (soma %)', v_r, v_soma;
    END IF;
    UPDATE public.usinas SET ibge_code = NULL WHERE id = v_usina_g;
    v_r := public.fn_geracao_estimada_mensal(v_usina_g);
    IF (SELECT count(*) FROM jsonb_each_text(v_r) WHERE value::numeric = 1000) <> 12 THEN
        RAISE EXCEPTION 'FALHA (c): sem cidade a geracao nao e o plano: %', v_r;
    END IF;

    -- ================================================================== (d)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/d') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_2x) RETURNING id INTO v_uc;
    PERFORM public.fn_gravar_historico_consumo(v_uc, c_mil);

    -- F1 600: Start 600 kWh x 1,02 x 50% = 306,00; B2W 10% x 612 = 61,20;
    -- fornecedor = 600 x 0,82 - 367,20 = 124,80 (Start isenta o piso)
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5, 600));
    PERFORM pg_temp.confere('d F1 600', r, -61.20, -306.00, -124.80);
    v_b := pg_temp.po(r);
    IF v_b ->> 'regra' <> 'start' OR (v_b ->> 'kwh_start')::numeric <> 600
       OR (v_b ->> 'kwh_start_pago_antes')::numeric <> 0 OR (v_b ->> 'teto_start_kwh')::numeric <> 2000
       OR (v_b ->> 'base')::numeric <> 612 OR (v_b ->> 'tarifa')::numeric <> 1.02 THEN
        RAISE EXCEPTION 'FALHA d F1: congelado %', v_b;
    END IF;
    IF (r #>> '{rec,base_bruta}')::numeric <> 612 OR (r #>> '{rec,base}')::numeric <> 492
       OR (r #>> '{rec,teto_deducao}')::numeric <> 492 THEN
        RAISE EXCEPTION 'FALHA d F1: base bruta % / liquida % / teto %', r #>> '{rec,base_bruta}', r #>> '{rec,base}', r #>> '{rec,teto_deducao}';
    END IF;
    -- F2 1.200: Start sobre 1.000 kWh (teto POR FATURA = 1 x mediana, como no
    -- exemplo do dono; acumulado 1.600) = 510,00; B2W 122,40;
    -- fornecedor 984,00 - 632,40 = 351,60
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 35, 1200));
    PERFORM pg_temp.confere('d F2 1200', r, -122.40, -510.00, -351.60);
    v_b := pg_temp.po(r);
    IF (v_b ->> 'kwh_start')::numeric <> 1000 OR (v_b ->> 'kwh_start_pago_antes')::numeric <> 600 THEN
        RAISE EXCEPTION 'FALHA d F2: congelado %', v_b;
    END IF;
    -- F3 800: so 400 kWh cabem (acumulado 2.000, encerrado) = 204,00
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 65, 800));
    PERFORM pg_temp.confere('d F3 800', r, -81.60, -204.00, -370.40);
    v_b := pg_temp.po(r);
    IF (v_b ->> 'kwh_start')::numeric <> 400 OR (v_b ->> 'kwh_start_pago_antes')::numeric <> 1600
       OR v_b ->> 'motivo_start' <> 'start_completo_nesta_fatura' THEN
        RAISE EXCEPTION 'FALHA d F3: congelado %', v_b;
    END IF;
    -- F4 1.000: plano start com saldo zerado -> nada; volta o piso
    -- (50% x 1.000 x 1,02 = 510 -> teto 820 - 510 = 310); B2W 102,00
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 95, 1000));
    PERFORM pg_temp.confere('d F4 1000', r, -102.00, 0, -718.00);
    v_b := pg_temp.po(r);
    IF v_b ->> 'regra' <> 'nenhuma' OR (v_b ->> 'kwh_start')::numeric <> 0
       OR v_b ->> 'motivo_start' <> 'start_esgotado' OR (r #>> '{rec,teto_deducao}')::numeric <> 310 THEN
        RAISE EXCEPTION 'FALHA d F4: congelado % teto %', v_b, r #>> '{rec,teto_deducao}';
    END IF;

    -- ================================================================== (e)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/e') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_hib) RETURNING id INTO v_uc;
    PERFORM public.fn_gravar_historico_consumo(v_uc, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5, 600));
    PERFORM pg_temp.confere('e F1', r, -61.20, -306.00, -124.80);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 35, 1200));
    PERFORM pg_temp.confere('e F2', r, -122.40, -510.00, -351.60);
    -- F3 completa o Start: so Start, nunca recorrencia junto
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 65, 800));
    PERFORM pg_temp.confere('e F3 (so Start)', r, -81.60, -204.00, -370.40);
    IF pg_temp.po(r) ->> 'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA e F3: regra %', pg_temp.po(r);
    END IF;
    -- F4: recorrencia 5% x 1.020 = 51,00, com piso (teto 310)
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 95, 1000));
    PERFORM pg_temp.confere('e F4 (recorrencia)', r, -102.00, -51.00, -667.00);
    v_b := pg_temp.po(r);
    IF v_b ->> 'regra' <> 'recorrencia' OR (v_b ->> 'kwh_start')::numeric <> 0 OR (v_b ->> 'base')::numeric <> 1020 THEN
        RAISE EXCEPTION 'FALHA e F4: congelado %', v_b;
    END IF;

    -- ================================================================== (f)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/f') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_1x) RETURNING id INTO v_uc;
    PERFORM public.fn_gravar_historico_consumo(v_uc, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5, 600));
    PERFORM pg_temp.confere('f 1x F1', r, -61.20, -306.00, -124.80);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 35, 1000));
    PERFORM pg_temp.confere('f 1x F2', r, -102.00, -204.00, -514.00);
    IF (pg_temp.po(r) ->> 'kwh_start')::numeric <> 400 OR (pg_temp.po(r) ->> 'teto_start_kwh')::numeric <> 1000 THEN
        RAISE EXCEPTION 'FALHA f: congelado %', pg_temp.po(r);
    END IF;

    -- ================================================================== (g)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/g') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_2x) RETURNING id INTO v_uc;
    -- sem historico: Start nao paga; plano start fora do Start: piso (teto 492 - 306 = 186)
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5, 600));
    PERFORM pg_temp.confere('g sem base', r, -61.20, 0, -430.80);
    IF pg_temp.po(r) ->> 'motivo_start' <> 'uc_sem_consumo_base' OR pg_temp.po(r) ->> 'regra' <> 'nenhuma' THEN
        RAISE EXCEPTION 'FALHA g: %', pg_temp.po(r);
    END IF;
    -- Hibrido sem base: recorrencia segue (5% x 612 = 30,60)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/g2') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_hib) RETURNING id INTO v_uc;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5, 600));
    PERFORM pg_temp.confere('g2 hibrido sem base', r, -61.20, -30.60, -400.20);

    -- ================================================================== (h)
    -- fatura paga ANTES da regra (sem a marca start_por_energia): 1.500 kWh
    -- consomem o saldo; a seguinte paga so 500 kWh (= 255,00)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://ene/h') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX ENE conc', '{"uf": "RN"}', v_pa_2x) RETURNING id INTO v_uc;
    PERFORM public.fn_gravar_historico_consumo(v_uc, c_mil);
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'pago', 0, 0, CURRENT_DATE - 30, 1500);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5, 800));
    PERFORM pg_temp.confere('h transicao', r, -81.60, -255.00, -319.40);
    IF (pg_temp.po(r) ->> 'kwh_start')::numeric <> 500 OR (pg_temp.po(r) ->> 'kwh_start_pago_antes')::numeric <> 1500
       OR (r #>> '{rec,kwh_start_legado}')::numeric <> 1500 THEN
        RAISE EXCEPTION 'FALHA h: %', pg_temp.po(r);
    END IF;

    -- funcao pura: Hibrido com saldo zerado ANTES -> recorrencia; com saldo -> Start
    IF public.fn_plano_originador_start_energia(
           '{"tipo_recompensa": "ambos", "start_config": {"multiplicador": 1, "regras_multinivel": {}},
             "recorrente_config": {"regras_multinivel": {"ppe": {"niveis": {"L1": "5"}, "max_niveis": 1}}}}',
           'ppe', 500, 1000, 1000, false) ->> 'matriz' IS DISTINCT FROM 'recorrencia'
       OR (public.fn_plano_originador_start_energia(
           '{"tipo_recompensa": "ambos", "start_config": {"multiplicador": 1.5, "regras_multinivel": {}}}',
           'ppe', 900, 1000, 1000, false) ->> 'kwh_start')::numeric IS DISTINCT FROM 500
       OR public.fn_plano_originador_start_energia(
           '{"tipo_recompensa": "start", "start_config": {"multiplicador": 2, "regras_multinivel": {}}}',
           'ppe', 900, 1000, 0, true) ->> 'motivo' IS DISTINCT FROM 'start_encerrado_regra_antiga' THEN
        RAISE EXCEPTION 'FALHA: fn_plano_originador_start_energia';
    END IF;

    -- adesao publica e termo aditivo gravam o historico pela logica interna
    IF position('fn_historico_consumo_gravar_uc' IN pg_get_functiondef(
           'public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)'::regprocedure)) = 0
       OR position('fn_historico_consumo_gravar_uc' IN pg_get_functiondef('public.fn_criar_uc_do_aditivo(uuid)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'FALHA: cadastro publico/aditivo nao grava o historico';
    END IF;
    IF has_function_privilege('anon', 'public.fn_historico_consumo_gravar_uc(uuid, jsonb, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_gravar_historico_consumo(uuid, jsonb, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA: anon executa a gravacao do historico';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
