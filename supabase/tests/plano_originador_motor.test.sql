-- Teste: MOTOR com o PLANO DO ORIGINADOR (handle_invoice_paid_ledger) sobre a
-- regra de 20261112b (2a revisao do dono, 12/11/2026): Start de PARCEIRO por
-- ENERGIA (kWh compensados ate multiplicador x start_base_kwh, no maximo 1 x
-- start_base_kwh por fatura), Hibrido sequencial e base BRUTA (kWh x tarifa
-- cheia) para todos os percentuais; o fornecedor fica com a base liquida menos
-- o deduzido. Start da B2W continua por ORDINAL de fatura compensada (plano de
-- assinatura). Reescrito em 12/11/2026: a versao anterior cobrava o Start de
-- parceiro por ordinal (20261110b), regra que o dono substituiu.
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md
--
-- Roda DEPOIS de 20261112b, no mesmo BEGIN/ROLLBACK (nada e aplicado):
--   BEGIN; <20261112b>; <este arquivo>; ROLLBACK;
-- Sucesso = erro 'SANDBOX_OK'.
--
-- Cadastro sandbox: tarifa 1,20, Fio B 0,20. Premium: desconto 20 -> base
-- liquida 760 e bruta 1.200 por 1.000 kWh; piso 50% da tarifa bruta = 600 ->
-- teto 160 sem Start, 760 com Start. Ultra: desconto 15 -> liquida 820, teto 220.
-- B2W 10% pelo plano de usina sandbox; Start da B2W do Premium: 36% na 2a
-- compensada (% novo do dono, 12/11/2026, aplicado pela 20261112b).
-- Toda UC com perfil de 1.000 kWh (start_base_kwh 1.000) salvo onde dito.
--
-- (b1) Premium (Plano Padrao, Start 1x: Lider 20, PPE 20): Start de parceiro na
--      1a fatura (energia), Start da B2W na 2a (ordinal), nada na 3a.
-- (b2) Ultra (Plano Recorrente): recorrencia sobre a base bruta.
-- (c)  excecao do originador vence (PPE 2x a 10%); Lider no Padrao (1x).
-- (d)  ordinal so conta fatura COM compensacao (Start da B2W).
-- (e)  transicao: Start pago pela regra antiga encerra o Start da UC.
-- (f)  dois parceiros, cada um pelo seu plano; Lider Hibrido: Start e depois
--      recorrencia, nunca os dois na mesma fatura.
-- (g)  Start por NIVEL: PPE nivel 2 (L2 8%) e PPF nivel 3 (L3 3%).

DO $$
DECLARE
    c_premium constant uuid := 'b0298e43-9f01-4104-b77a-c01d3f30310c';
    c_ultra   constant uuid := '29c46292-363d-46d2-87f5-7cae59c8ee69';
    c_mil     constant jsonb := '[{"mes":"2026-01","kwh":1000},{"mes":"2026-02","kwh":1000},{"mes":"2026-03","kwh":1000}]';
    v_padrao  uuid;
    v_recorr  uuid;
    v_plano_x uuid;   -- excecao: Start 2x, PPE 10%
    v_plano_h uuid;   -- Hibrido do Lider: Start 30% (1x), recorrencia 3%
    v_plano_n uuid;   -- niveis: PPE L1 20 L2 8, PPF L1 6 L2 4 L3 3
    v_pu      uuid;
    v_sup     uuid;
    v_usina   uuid;
    v_lider   uuid;
    v_ppe     uuid;
    v_ppe_sl  uuid;
    v_ppe_x   uuid;
    v_lider_h uuid;
    v_ppe_n   uuid;
    v_ppf_n   uuid;
    v_sub     uuid;
    v_r1      uuid;
    v_r2      uuid;
    v_uc      uuid;
    r         jsonb;
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
        IF r #>> '{rec,versao}' IS DISTINCT FROM '20261112_start_por_energia' THEN
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
      CREATE FUNCTION pg_temp.po(r jsonb, p_papel text) RETURNS jsonb LANGUAGE sql AS $b$
        SELECT r #> ARRAY['rec', 'plano_originador', p_papel]
      $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.fatura(p_uc uuid, p_kwh numeric, p_dias int) RETURNS uuid LANGUAGE sql AS $b$
        INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
        VALUES (p_uc, 'a_vencer', GREATEST(p_kwh, 50), 0, CURRENT_DATE + p_dias, p_kwh) RETURNING id
      $b$
    $f$;
    EXECUTE $f$
      CREATE FUNCTION pg_temp.uc(p_orig uuid, p_plano uuid, p_url text, p_ind uuid, p_perfil jsonb) RETURNS uuid LANGUAGE plpgsql AS $b$
      DECLARE v_s uuid; v_u uuid;
      BEGIN
        INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
        VALUES (p_orig, 'ativo', p_url, p_ind) RETURNING id INTO v_s;
        INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
        SELECT v_s, u.id, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', p_plano
          FROM public.usinas u WHERE u.name = 'SANDBOX PO usina' RETURNING id INTO v_u;
        IF p_perfil IS NOT NULL THEN
          PERFORM public.fn_gravar_historico_consumo(v_u, p_perfil);
        END IF;
        RETURN v_u;
      END $b$
    $f$;

    -- ------------------------------------------------------------ fixture
    -- Padrao e Recorrente com numeros FIXOS (o dono edita os de producao; tudo
    -- desfeito no rollback)
    SELECT id INTO v_padrao FROM public.planos_originador WHERE padrao;
    SELECT plano_originador_id INTO v_recorr FROM public.planos_assinatura_energia WHERE id = c_ultra;
    IF v_recorr IS NULL OR v_recorr = v_padrao THEN
        SELECT id INTO v_recorr FROM public.planos_originador WHERE nome = 'Plano Recorrente' AND NOT padrao;
    END IF;
    UPDATE public.planos_assinatura_energia SET plano_originador_id = v_padrao WHERE id = c_premium;
    UPDATE public.planos_assinatura_energia SET plano_originador_id = v_recorr WHERE id = c_ultra;
    UPDATE public.planos_originador SET
        tipo_recompensa = 'start',
        start_config = '{"multiplicador": 1, "regras_multinivel": {
            "lider": {"niveis": {"L1": "20", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
            "ppe":   {"niveis": {"L1": "20", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
            "ppp":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1},
            "ppf":   {"niveis": {"L1": "0",  "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
        recorrente_config = '{"regras_multinivel": {
            "lider": {"niveis": {"L1": "1", "L2": "1", "L3": "1", "L4": "0"}, "max_niveis": 3},
            "ppe":   {"niveis": {"L1": "5", "L2": "2", "L3": "0", "L4": "0"}, "max_niveis": 2}}}'
     WHERE id = v_padrao;
    UPDATE public.planos_originador SET
        tipo_recompensa = 'recorrente',
        start_config = '{"multiplicador": 1, "regras_multinivel": {}}',
        recorrente_config = '{"regras_multinivel": {
            "lider": {"niveis": {"L1": "1", "L2": "0", "L3": "2", "L4": "0"}, "max_niveis": 3},
            "ppe":   {"niveis": {"L1": "5", "L2": "2", "L3": "0", "L4": "0"}, "max_niveis": 2}}}'
     WHERE id = v_recorr;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX PO excecao', 'start',
            '{"multiplicador": 2, "regras_multinivel": {"ppe": {"niveis": {"L1": "10", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {}}') RETURNING id INTO v_plano_x;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX PO hibrido', 'ambos',
            '{"multiplicador": 1, "regras_multinivel": {"lider": {"niveis": {"L1": "30", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {"lider": {"niveis": {"L1": "3", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}') RETURNING id INTO v_plano_h;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX PO niveis', 'start',
            '{"multiplicador": 1, "regras_multinivel": {
                "ppe": {"niveis": {"L1": "20", "L2": "8", "L3": "0", "L4": "0"}, "max_niveis": 2},
                "ppf": {"niveis": {"L1": "6",  "L2": "4", "L3": "3", "L4": "0"}, "max_niveis": 3}}}',
            '{"regras_multinivel": {}}') RETURNING id INTO v_plano_n;

    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX-PO-1', 'Sandbox PO', 'SANDBOX PO conc', 'RN', 1.20, 0.20);
    INSERT INTO public.planos_usina (nome, percentual_recorrente) VALUES ('SANDBOX PO pu', 10) RETURNING id INTO v_pu;
    INSERT INTO public.suppliers (name) VALUES ('SANDBOX PO fornecedor') RETURNING id INTO v_sup;
    INSERT INTO public.usinas (name, plano_usina_id, supplier_id) VALUES ('SANDBOX PO usina', v_pu, v_sup) RETURNING id INTO v_usina;

    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PO Lider', 'lider', true) RETURNING id INTO v_lider;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PO PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;
    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PO PPE sem lider', 'ppe', true) RETURNING id INTO v_ppe_sl;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id, plano_originador_id)
    VALUES ('SANDBOX PO PPE excecao', 'ppe', true, v_lider, v_plano_x) RETURNING id INTO v_ppe_x;
    INSERT INTO public.originators_v2 (name, cargo, ativo, plano_originador_id)
    VALUES ('SANDBOX PO Lider hibrido', 'lider', true, v_plano_h) RETURNING id INTO v_lider_h;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PO PPE do hibrido', 'ppe', true, v_lider_h) RETURNING id INTO v_r1;
    INSERT INTO public.originators_v2 (name, cargo, ativo, plano_originador_id)
    VALUES ('SANDBOX PO PPE niveis', 'ppe', true, v_plano_n) RETURNING id INTO v_ppe_n;
    INSERT INTO public.originators_v2 (name, cargo, ativo, plano_originador_id)
    VALUES ('SANDBOX PO PPF niveis', 'ppf', true, v_plano_n) RETURNING id INTO v_ppf_n;

    -- ================================================================ (b1)
    -- F1: B2W 10% x 1.200 = 120; PPE e Lider Start 20% x 1.200 = 240 cada
    -- (isento do piso: teto 760); fornecedor 760 - 600 = 160.
    v_uc := pg_temp.uc(v_ppe, c_premium, 'sandbox://po/b1', NULL, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('b1 Premium F1 (Start dos parceiros)', r, -120, -480, 0, -160);
    IF pg_temp.com(r, v_ppe) <> -240 OR pg_temp.com(r, v_lider) <> -240
       OR pg_temp.po(r, 'ppe') ->> 'regra' <> 'start' OR (pg_temp.po(r, 'ppe') ->> 'kwh_start')::numeric <> 1000
       OR (r #>> '{rec,bonus_start,aplicado_b2w}')::boolean IS DISTINCT FROM false
       OR (r #>> '{rec,teto_deducao}')::numeric <> 760 THEN
        RAISE EXCEPTION 'FALHA b1 F1: ppe % lider % / % / teto %', pg_temp.com(r, v_ppe), pg_temp.com(r, v_lider),
            pg_temp.po(r, 'ppe'), r #>> '{rec,teto_deducao}';
    END IF;
    -- F2 (ordinal 2): Start da B2W 36% x 1.200 = 432 (% novo do dono); Start dos
    -- parceiros ja esgotado (1x); fornecedor 760 - 432 = 328.
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('b1 Premium F2 (Start da B2W)', r, -432, 0, 0, -328);
    IF r #>> '{rec,motivo}' IS DISTINCT FROM 'bonus_start'
       OR (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 2
       OR pg_temp.po(r, 'ppe') ->> 'motivo_start' <> 'start_esgotado' THEN
        RAISE EXCEPTION 'FALHA b1 F2: %', r #> '{rec,bonus_start}';
    END IF;
    -- F3: so a gestao; piso de volta (teto 160); fornecedor 640.
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 65));
    PERFORM pg_temp.confere('b1 Premium F3', r, -120, 0, 0, -640);

    -- ================================================================ (b2)
    -- Ultra (Plano Recorrente): PPE 5% + Lider 1% de 1.200 = 72; B2W 120;
    -- fornecedor 820 - 192 = 628 (teto 220, sem corte). Igual na F2.
    v_uc := pg_temp.uc(v_ppe, c_ultra, 'sandbox://po/b2', NULL, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('b2 Ultra F1', r, -120, -72, 0, -628);
    IF pg_temp.po(r, 'ppe') ->> 'regra' <> 'recorrencia' OR (pg_temp.po(r, 'ppe') ->> 'base')::numeric <> 1200 THEN
        RAISE EXCEPTION 'FALHA b2: %', pg_temp.po(r, 'ppe');
    END IF;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('b2 Ultra F2', r, -120, -72, 0, -628);

    -- ================================================================ (c)
    -- PPE pela excecao (2x, 10%); Lider pelo Padrao (1x, 20%).
    v_uc := pg_temp.uc(v_ppe_x, c_premium, 'sandbox://po/c', NULL, c_mil);
    -- F1: B2W 120 + PPE 120 + Lider 240; fornecedor 760 - 480 = 280
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('c excecao F1', r, -120, -360, 0, -280);
    IF pg_temp.po(r, 'ppe') ->> 'plano_origem' IS DISTINCT FROM 'originador'
       OR (pg_temp.po(r, 'ppe') ->> 'plano_originador_id')::uuid IS DISTINCT FROM v_plano_x
       OR pg_temp.po(r, 'lider') ->> 'plano_origem' IS DISTINCT FROM 'plano_assinatura'
       OR (pg_temp.po(r, 'ppe') ->> 'teto_start_kwh')::numeric <> 2000 THEN
        RAISE EXCEPTION 'FALHA c: ppe % lider %', pg_temp.po(r, 'ppe'), pg_temp.po(r, 'lider');
    END IF;
    -- F2: Start da B2W 432 + PPE ainda no Start (120); Lider esgotado; fornecedor
    -- 760 - 552 = 208.
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('c excecao F2', r, -432, -120, 0, -208);
    IF (pg_temp.po(r, 'ppe') ->> 'kwh_start')::numeric <> 1000 OR (r #>> '{rec,resultado,corte_aplicado}')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA c F2: %', r #> '{rec,resultado}';
    END IF;
    -- F3: PPE esgotou os 2.000 kWh; so a gestao.
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 65));
    PERFORM pg_temp.confere('c excecao F3', r, -120, 0, 0, -640);

    -- ================================================================ (d)
    -- fatura sem compensacao nao consome o ordinal: o Start da B2W cai na 2a
    -- COMPENSADA. PPE sem lider (Padrao, 20%).
    v_uc := pg_temp.uc(v_ppe_sl, c_premium, 'sandbox://po/d', NULL, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 0, 5));
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('d 1a compensada', r, -120, -240, 0, -400);
    IF (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 1 THEN
        RAISE EXCEPTION 'FALHA d: ordinal da 1a compensada = %', r #>> '{rec,bonus_start,fatura_ordinal}';
    END IF;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 65));
    PERFORM pg_temp.confere('d 2a compensada (Start da B2W)', r, -432, 0, 0, -328);

    -- ================================================================ (e)
    -- Start pago pela regra antiga (sem ordinal_regra) encerra o Start da UC:
    -- nem B2W nem parceiro recebem Start; plano start -> so a gestao.
    v_uc := pg_temp.uc(v_ppe, c_premium, 'sandbox://po/e', NULL, c_mil);
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, recompensas_aplicadas)
    VALUES (v_uc, 'pago', 760, 0, CURRENT_DATE - 30, 400,
            '{"versao": "20261105_faturas_retidas", "lancado": true, "motivo": "bonus_start", "bonus_start": {"aplicado": true, "fatura_ordinal": 2}}');
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('e transicao', r, -120, 0, 0, -640);
    IF r #>> '{rec,bonus_start,bloqueio}' NOT LIKE 'Start da UC encerrado%'
       OR pg_temp.po(r, 'ppe') ->> 'motivo_start' <> 'start_encerrado_regra_antiga'
       OR (r #>> '{rec,kwh_start_legado}')::numeric <> 400 THEN
        RAISE EXCEPTION 'FALHA e: % / %', r #> '{rec,bonus_start}', pg_temp.po(r, 'ppe');
    END IF;

    -- ================================================================ (f)
    -- PPE pelo Padrao (20%, 1x); Lider pelo Hibrido (Start 30% 1x, depois 3%).
    v_uc := pg_temp.uc(v_r1, c_premium, 'sandbox://po/f', NULL, c_mil);
    -- F1: 120 + PPE 240 + Lider 360 = 720 <= 760; fornecedor 40
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('f F1', r, -120, -600, 0, -40);
    IF pg_temp.com(r, v_lider_h) <> -360 OR pg_temp.po(r, 'lider') ->> 'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA f F1: lider %', pg_temp.po(r, 'lider');
    END IF;
    -- F2: Start da B2W 432 + Lider na recorrencia 3% (36), nunca Start e
    -- recorrencia na mesma fatura; fornecedor 760 - 468 = 292.
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('f F2', r, -432, -36, 0, -292);
    IF pg_temp.po(r, 'lider') ->> 'regra' <> 'recorrencia' OR pg_temp.po(r, 'ppe') ->> 'regra' <> 'nenhuma' THEN
        RAISE EXCEPTION 'FALHA f F2: lider % ppe %', pg_temp.po(r, 'lider'), pg_temp.po(r, 'ppe');
    END IF;
    -- F3: 120 + 36 = 156 <= teto 160; fornecedor 604
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 65));
    PERFORM pg_temp.confere('f F3', r, -120, -36, 0, -604);

    -- ================================================================ (g)
    -- PPE no NIVEL 2 (assinante indicado por outro): Start L2 8% x 1.200 = 96.
    -- Premium e plano start: fora do Start da B2W o Conect nao recebe.
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://po/g-ref') RETURNING id INTO v_sub;
    v_uc := pg_temp.uc(v_ppe_n, c_premium, 'sandbox://po/g', v_sub, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('g PPE nivel 2', r, -120, -96, 0, -544);
    IF (pg_temp.po(r, 'ppe') ->> 'nivel')::int IS DISTINCT FROM 2 OR pg_temp.po(r, 'ppe') ->> 'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA g: %', pg_temp.po(r, 'ppe');
    END IF;
    -- PPF no NIVEL 3 (cadeia de 2 indicacoes): Start L3 3% x 1.200 = 36.
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://po/g3-r2') RETURNING id INTO v_r2;
    INSERT INTO public.subscribers (status, short_url, indicador_assinante_id) VALUES ('ativo', 'sandbox://po/g3-r1', v_r2) RETURNING id INTO v_sub;
    v_uc := pg_temp.uc(v_ppf_n, c_premium, 'sandbox://po/g3', v_sub, c_mil);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('g PPF nivel 3', r, -120, -36, 0, -604);
    IF (pg_temp.po(r, 'ppf') ->> 'nivel')::int IS DISTINCT FROM 3 OR pg_temp.com(r, v_ppf_n) <> -36 THEN
        RAISE EXCEPTION 'FALHA g3: %', pg_temp.po(r, 'ppf');
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
