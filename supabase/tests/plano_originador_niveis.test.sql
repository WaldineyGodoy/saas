-- Teste: PLANO DO ORIGINADOR POR NIVEL (20261112a, revisao do dono 12/11/2026).
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md
--       secao "Revisao de 12/11/2026".
--
-- Roda DEPOIS de 20261112a, no mesmo BEGIN/ROLLBACK (nada e aplicado):
--   BEGIN; <20261112a>; <este arquivo>; ROLLBACK;
-- Sucesso = erro 'SANDBOX_OK'.
--
-- (a) conversao: o Plano Padrao do dono (Start na 1a fatura, Lider 50%,
--     PPP 40%) virou regras_multinivel L1 com os mesmos numeros; nenhum plano
--     guarda mais start_config.regras.
-- (b) validador: recusa `regras` antigo, max_niveis 4, cargo fora dos 4 e
--     percentual > 100; aceita o formato novo.
-- (c) plano start: participante de nivel 2 recebe o L2 do Start; fora da
--     janela nada.
-- (d) Hibrido (ambos) sequencial: dentro da janela [1,2] Start e NAO
--     recorrencia (inclusive nivel 2: L2 do Start, nao a recorrencia);
--     fatura seguinte a janela: recorrencia e NAO Start.
-- (e) PPF com L3 no Start recebe em nivel 3.
--
-- Cadastro sandbox: tarifa 1,20, Fio B 0,20, desconto 0 -> base 1000 com
-- 1000 kWh; piso 50% da tarifa bruta = 600 -> teto 400 sem Start, 1000 com
-- Start de parceiro. B2W: 10% pelo plano de usina (100). Conect: 0%.

DO $$
DECLARE
    v_padrao   public.planos_originador;
    v_ok       boolean;
    v_txt      text;
    v_id       uuid;

    v_po_start uuid;
    v_po_hib   uuid;
    v_pa_start uuid;
    v_pa_hib   uuid;

    v_pu       uuid;
    v_sup      uuid;
    v_usina    uuid;

    v_lider    uuid;
    v_ppe      uuid;
    v_ppe_sl   uuid;
    v_ppf      uuid;

    v_sub      uuid;
    v_r1       uuid;
    v_r2       uuid;
    v_uc       uuid;
    r          jsonb;
    v_b        jsonb;

    c_matriz_pa constant jsonb := '{"regras_multinivel": {
        "b2w": {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
        "assinante_conect": {"niveis": {"L1": "0", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}';
BEGIN
    -- ------------------------------------------------------------ helpers
    EXECUTE $f$
      CREATE FUNCTION pg_temp.pagar(p_inv uuid) RETURNS jsonb LANGUAGE plpgsql AS $b$
      DECLARE v_txn uuid; r jsonb;
      BEGIN
        UPDATE public.invoices SET status = 'pago' WHERE id = p_inv;
        SELECT le.transaction_id INTO v_txn FROM public.ledger_entries le
         WHERE le.reference_id = p_inv AND le.description = 'Recebimento Fatura ' || p_inv;
        IF v_txn IS NULL THEN
          RAISE EXCEPTION 'FALHA: a fatura % nao gerou lancamento', p_inv;
        END IF;
        SELECT jsonb_build_object(
                 'gestao',  COALESCE(SUM(le.amount) FILTER (WHERE la.code = '3.1.1'), 0),
                 'com',     COALESCE(SUM(le.amount) FILTER (WHERE la.code = '2.1.2'), 0),
                 'conect',  COALESCE(SUM(le.amount) FILTER (WHERE la.code = '2.1.6'), 0),
                 'forn',    COALESCE(SUM(le.amount) FILTER (WHERE la.code = '2.1.1'), 0),
                 'total',   COALESCE(SUM(le.amount), 0),
                 'txn',     v_txn)
          INTO r
          FROM public.ledger_entries le JOIN public.ledger_accounts la ON la.id = le.account_id
         WHERE le.transaction_id = v_txn;
        RETURN r || jsonb_build_object('rec', (SELECT i.recompensas_aplicadas FROM public.invoices i WHERE i.id = p_inv));
      END $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.confere(p_rot text, r jsonb, g numeric, c numeric, k numeric, f numeric)
      RETURNS void LANGUAGE plpgsql AS $b$
      BEGIN
        IF ((r->>'gestao')::numeric, (r->>'com')::numeric, (r->>'conect')::numeric, (r->>'forn')::numeric)
           IS DISTINCT FROM (g, c, k, f) THEN
          RAISE EXCEPTION 'FALHA %: 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado % / % / % / %)',
            p_rot, r->>'gestao', r->>'com', r->>'conect', r->>'forn', g, c, k, f;
        END IF;
        IF (r->>'total')::numeric <> 0 THEN
          RAISE EXCEPTION 'FALHA %: a transacao nao fecha em zero (%)', p_rot, r->>'total';
        END IF;
        IF r #>> '{rec,versao}' IS DISTINCT FROM '20261112_plano_originador_niveis' THEN
          RAISE EXCEPTION 'FALHA %: versao gravada %', p_rot, r #>> '{rec,versao}';
        END IF;
      END $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.com(r jsonb, p_orig uuid) RETURNS numeric LANGUAGE sql AS $b$
        SELECT COALESCE(SUM(le.amount), 0) FROM public.ledger_entries le
          JOIN public.ledger_accounts la ON la.id = le.account_id
         WHERE le.transaction_id = (r->>'txn')::uuid AND la.code = '2.1.2' AND le.reference_id = p_orig
      $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.ben(r jsonb, p_papel text) RETURNS jsonb LANGUAGE sql AS $b$
        SELECT b FROM jsonb_array_elements(r #> '{rec,resultado,beneficiarios}') b WHERE b->>'papel' = p_papel LIMIT 1
      $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.fatura(p_uc uuid, p_dias int) RETURNS uuid LANGUAGE sql AS $b$
        INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
        VALUES (p_uc, 'a_vencer', 1000, 0, CURRENT_DATE + p_dias, 1000) RETURNING id
      $b$
    $f$;

    -- ================================================================== (a)
    SELECT * INTO v_padrao FROM public.planos_originador WHERE padrao;
    IF v_padrao.start_config <> '{"faturas_elegiveis": [1], "regras_multinivel": {
          "lider": {"niveis": {"L1": "50", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
          "ppe":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
          "ppp":   {"niveis": {"L1": "40", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
          "ppf":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}'::jsonb THEN
        RAISE EXCEPTION 'FALHA (a): Padrao convertido = % (esperado Start na 1a, Lider 50, PPP 40 em L1)', v_padrao.start_config;
    END IF;
    IF v_padrao.tipo_recompensa <> 'start' THEN
        RAISE EXCEPTION 'FALHA (a): Padrao mudou de tipo: %', v_padrao.tipo_recompensa;
    END IF;
    IF EXISTS (SELECT 1 FROM public.planos_originador
                WHERE start_config ? 'regras'
                   OR jsonb_typeof(start_config -> 'regras_multinivel') <> 'object'
                   OR NOT (start_config -> 'regras_multinivel' ?& ARRAY['lider', 'ppe', 'ppp', 'ppf'])) THEN
        RAISE EXCEPTION 'FALHA (a): sobrou plano no formato antigo';
    END IF;
    -- faturas_elegiveis sempre [1..N]
    IF EXISTS (SELECT 1 FROM public.planos_originador p
                WHERE p.start_config -> 'faturas_elegiveis'
                      IS DISTINCT FROM COALESCE((SELECT jsonb_agg(g ORDER BY g)
                                                   FROM generate_series(1, jsonb_array_length(p.start_config -> 'faturas_elegiveis')) g), '[]'::jsonb)) THEN
        RAISE EXCEPTION 'FALHA (a): faturas_elegiveis fora do formato [1..N]';
    END IF;

    -- ================================================================== (b)
    FOREACH v_txt IN ARRAY ARRAY[
        '{"faturas_elegiveis": [1], "regras": {"1": {"ppe": 10}}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {}, "regras": {}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {"ppe": {"niveis": {"L1": "10"}, "max_niveis": 4}}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {"b2w": {"niveis": {"L1": "10"}, "max_niveis": 1}}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {"ppf": {"niveis": {"L3": "101"}, "max_niveis": 3}}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {"ppf": {"niveis": {"L3": "1"}}}}',
        '{"faturas_elegiveis": [0], "regras_multinivel": {}}'] LOOP
        v_ok := false;
        BEGIN
            INSERT INTO public.planos_originador (nome, start_config, recorrente_config)
            VALUES ('SANDBOX niveis invalido', v_txt::jsonb, '{"regras_multinivel": {}}');
        EXCEPTION WHEN check_violation THEN v_ok := true; END;
        IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (b): start_config invalido aceito: %', v_txt; END IF;
    END LOOP;
    v_ok := false;
    BEGIN
        INSERT INTO public.planos_originador (nome, start_config, recorrente_config)
        VALUES ('SANDBOX niveis invalido', '{"faturas_elegiveis": [], "regras_multinivel": {}}',
                '{"regras_multinivel": {"lider": {"niveis": {"L1": "1"}, "max_niveis": 4}}}');
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (b): recorrencia com max_niveis 4 aceita'; END IF;

    -- default da coluna e o formato novo
    INSERT INTO public.planos_originador (nome) VALUES ('SANDBOX niveis default') RETURNING id INTO v_id;
    DELETE FROM public.planos_originador WHERE id = v_id;

    -- ------------------------------------------------------------ fixture
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX niveis start', 'start',
            '{"faturas_elegiveis": [1], "regras_multinivel": {
                "lider": {"niveis": {"L1": "10", "L2": "5", "L3": "0", "L4": "0"}, "max_niveis": 2},
                "ppe":   {"niveis": {"L1": "20", "L2": "8", "L3": "0", "L4": "0"}, "max_niveis": 2},
                "ppp":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 0},
                "ppf":   {"niveis": {"L1": "6",  "L2": "4", "L3": "3", "L4": "0"}, "max_niveis": 3}}}',
            '{"regras_multinivel": {
                "ppe":   {"niveis": {"L1": "5", "L2": "2", "L3": "0", "L4": "0"}, "max_niveis": 2},
                "ppf":   {"niveis": {"L1": "2", "L2": "2", "L3": "2", "L4": "0"}, "max_niveis": 3}}}')
    RETURNING id INTO v_po_start;

    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX niveis hibrido', 'ambos',
            '{"faturas_elegiveis": [1, 2], "regras_multinivel": {
                "lider": {"niveis": {"L1": "10", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
                "ppe":   {"niveis": {"L1": "20", "L2": "8", "L3": "0", "L4": "0"}, "max_niveis": 2},
                "ppp":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 0},
                "ppf":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 0}}}',
            '{"regras_multinivel": {
                "lider": {"niveis": {"L1": "1", "L2": "1", "L3": "0", "L4": "0"}, "max_niveis": 2},
                "ppe":   {"niveis": {"L1": "5", "L2": "2", "L3": "0", "L4": "0"}, "max_niveis": 2}}}')
    RETURNING id INTO v_po_hib;

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config, plano_originador_id)
    VALUES ('SANDBOX niveis pa start', 'recorrente', 10, 50, 0, c_matriz_pa, v_po_start)
    RETURNING id INTO v_pa_start;
    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config, plano_originador_id)
    VALUES ('SANDBOX niveis pa hibrido', 'recorrente', 10, 50, 0, c_matriz_pa, v_po_hib)
    RETURNING id INTO v_pa_hib;
    IF (SELECT plano_originador_id FROM public.planos_assinatura_energia WHERE id = v_pa_start) IS DISTINCT FROM v_po_start THEN
        RAISE EXCEPTION 'FALHA fixture: o plano de assinatura nao ficou no plano do originador sandbox';
    END IF;

    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX-PON-1', 'Sandbox PON', 'SANDBOX PON conc', 'RN', 1.20, 0.20);
    INSERT INTO public.planos_usina (nome, percentual_recorrente) VALUES ('SANDBOX PON pu', 10) RETURNING id INTO v_pu;
    INSERT INTO public.suppliers (name) VALUES ('SANDBOX PON fornecedor') RETURNING id INTO v_sup;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu, v_sup) RETURNING id INTO v_usina;

    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PON Lider', 'lider', true) RETURNING id INTO v_lider;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PON PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;
    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PON PPE sem lider', 'ppe', true) RETURNING id INTO v_ppe_sl;
    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PON PPF', 'ppf', true) RETURNING id INTO v_ppf;

    -- ================================================================== (c)
    -- plano start, PPE no NIVEL 2 (assinante indicado por outro): Start L2 8% = 80
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pon/c-ref') RETURNING id INTO v_r1;
    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe_sl, 'ativo', 'sandbox://pon/c', v_r1) RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PON conc', '{"uf": "RN"}', v_pa_start) RETURNING id INTO v_uc;

    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5));
    PERFORM pg_temp.confere('c start nivel 2 ord 1', r, -100, -80, 0, -820);
    v_b := pg_temp.ben(r, 'ppe');
    IF (v_b->>'nivel')::int IS DISTINCT FROM 2 OR v_b->>'regra' IS DISTINCT FROM 'start'
       OR (v_b->>'plano_originador_id')::uuid IS DISTINCT FROM v_po_start THEN
        RAISE EXCEPTION 'FALHA c: beneficiario ppe %', v_b;
    END IF;
    IF (r #>> '{rec,bonus_start,aplicado_parceiros}')::boolean IS DISTINCT FROM true
       OR (r #>> '{rec,teto_deducao}')::numeric <> 1000 THEN
        RAISE EXCEPTION 'FALHA c: Start de parceiro em nivel 2 nao isentou o piso: % teto %', r -> 'rec' -> 'bonus_start', r #>> '{rec,teto_deducao}';
    END IF;
    -- fora da janela: plano start nao paga nada (nem a recorrencia de 2% que o plano tem)
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 35));
    PERFORM pg_temp.confere('c start ord 2 (fora)', r, -100, 0, 0, -900);
    IF pg_temp.ben(r, 'ppe') ->> 'regra' IS DISTINCT FROM 'nenhuma' THEN
        RAISE EXCEPTION 'FALHA c: fora da janela a regra do ppe = %', pg_temp.ben(r, 'ppe') ->> 'regra';
    END IF;

    -- ================================================================== (e)
    -- PPF no NIVEL 3 (cadeia de 2 indicacoes): Start L3 3% = 30
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pon/e-r2') RETURNING id INTO v_r2;
    INSERT INTO public.subscribers (status, short_url, indicador_assinante_id) VALUES ('ativo', 'sandbox://pon/e-r1', v_r2) RETURNING id INTO v_r1;
    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppf, 'ativo', 'sandbox://pon/e', v_r1) RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PON conc', '{"uf": "RN"}', v_pa_start) RETURNING id INTO v_uc;

    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5));
    PERFORM pg_temp.confere('e ppf nivel 3', r, -100, -30, 0, -870);
    v_b := pg_temp.ben(r, 'ppf');
    IF (v_b->>'nivel')::int IS DISTINCT FROM 3 OR v_b->>'regra' IS DISTINCT FROM 'start'
       OR pg_temp.com(r, v_ppf) <> -30 THEN
        RAISE EXCEPTION 'FALHA e: ppf % recebeu %', v_b, pg_temp.com(r, v_ppf);
    END IF;

    -- ================================================================== (d)
    -- Hibrido, PPE nivel 1 com Lider. Janela [1, 2]:
    --   ord 1 e 2: Start ppe 20% (200) + lider 10% (100), sem recorrencia;
    --   ord 3:     recorrencia ppe 5% (50) + lider 1% (10), sem Start.
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://pon/d') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PON conc', '{"uf": "RN"}', v_pa_hib) RETURNING id INTO v_uc;

    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5));
    PERFORM pg_temp.confere('d hibrido ord 1', r, -100, -300, 0, -600);
    IF pg_temp.com(r, v_ppe) <> -200 OR pg_temp.com(r, v_lider) <> -100
       OR pg_temp.ben(r, 'ppe') ->> 'regra' <> 'start' OR pg_temp.ben(r, 'lider') ->> 'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA d ord 1: ppe % lider % / % / %', pg_temp.com(r, v_ppe), pg_temp.com(r, v_lider),
            pg_temp.ben(r, 'ppe'), pg_temp.ben(r, 'lider');
    END IF;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 35));
    PERFORM pg_temp.confere('d hibrido ord 2 (ainda na janela)', r, -100, -300, 0, -600);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 65));
    PERFORM pg_temp.confere('d hibrido ord 3 (depois da janela)', r, -100, -60, 0, -840);
    IF pg_temp.com(r, v_ppe) <> -50 OR pg_temp.com(r, v_lider) <> -10
       OR pg_temp.ben(r, 'ppe') ->> 'regra' <> 'recorrencia' OR pg_temp.ben(r, 'lider') ->> 'regra' <> 'recorrencia'
       OR (r #>> '{rec,bonus_start,aplicado}')::boolean IS DISTINCT FROM false
       OR (r #>> '{rec,teto_deducao}')::numeric <> 400 THEN
        RAISE EXCEPTION 'FALHA d ord 3: ppe % lider % bonus_start % teto %', pg_temp.com(r, v_ppe), pg_temp.com(r, v_lider),
            r -> 'rec' -> 'bonus_start', r #>> '{rec,teto_deducao}';
    END IF;

    -- d2: Hibrido com PPE no NIVEL 2 dentro da janela -> L2 do Start (8% = 80),
    -- nao a recorrencia L2 (2%) e nunca as duas.
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pon/d2-ref') RETURNING id INTO v_r1;
    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe_sl, 'ativo', 'sandbox://pon/d2', v_r1) RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PON conc', '{"uf": "RN"}', v_pa_hib) RETURNING id INTO v_uc;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 5));
    PERFORM pg_temp.confere('d2 hibrido nivel 2 na janela', r, -100, -80, 0, -820);
    IF pg_temp.ben(r, 'ppe') ->> 'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA d2: regra do ppe nivel 2 = %', pg_temp.ben(r, 'ppe') ->> 'regra';
    END IF;

    -- funcao pura: ambos fora da janela mas ANTES do fim dela -> nada;
    -- Start encerrado pela guarda -> recorrencia; fallback L1-only do formato antigo
    IF public.fn_plano_originador_entrada(
           '{"tipo_recompensa": "ambos", "start_config": {"faturas_elegiveis": [2], "regras_multinivel": {}},
             "recorrente_config": {"regras_multinivel": {"ppe": {"niveis": {"L1": "5"}, "max_niveis": 1}}}}',
           'ppe', 1, NULL, false) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'FALHA d: ambos antes da janela pagou algo';
    END IF;
    IF public.fn_plano_originador_entrada(
           '{"tipo_recompensa": "ambos", "start_config": {"faturas_elegiveis": [1, 2], "regras_multinivel": {}},
             "recorrente_config": {"regras_multinivel": {"ppe": {"niveis": {"L1": "5"}, "max_niveis": 1}}}}',
           'ppe', 1, 'Start da UC encerrado', true) ->> 'matriz' IS DISTINCT FROM 'recorrencia' THEN
        RAISE EXCEPTION 'FALHA d: ambos com Start encerrado pela guarda nao foi para a recorrencia';
    END IF;
    IF public.fn_plano_originador_entrada(
           '{"tipo_recompensa": "start", "start_config": {"faturas_elegiveis": [1], "regras": {"1": {"lider": 50}}}}',
           'lider', 1, NULL, false) -> 'entrada'
       <> '{"niveis": {"L1": "50", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}'::jsonb THEN
        RAISE EXCEPTION 'FALHA: fallback L1-only do formato antigo';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
