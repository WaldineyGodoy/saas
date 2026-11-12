-- Teste: MOTOR com o PLANO DO ORIGINADOR (handle_invoice_paid_ledger, 20261110b).
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md
--
-- Roda DEPOIS de 20261110a, 20261110b e 20261112a, no mesmo BEGIN/ROLLBACK:
--   BEGIN; <20261110a>; <20261110b>; <20261112a>; <este arquivo>; ROLLBACK;
-- 20261112a (revisao do dono 12/11/2026): planos sandbox no formato novo
-- (start_config.regras_multinivel, uma matriz para as N faturas).
-- Sucesso = erro 'SANDBOX_OK'.
--
-- Usa os planos REAIS (Premium e Ultra Connect, ja limpos e ligados ao Padrao
-- e ao Recorrente semeados). Cadastro sandbox da concessionaria: tarifa 1,20 e
-- Fio B 0,20, entao com 1000 kWh compensados:
--   Premium (desconto 20%, piso 50%): base 760,00, piso 600,00, teto 160,00
--   Ultra   (desconto 15%, piso 50%): base 820,00, piso 600,00, teto 220,00
--
-- (b) EQUIVALENCIA -- o que o motor pagava antes com as regras do proprio plano:
--   b1 Premium, nivel 1: ord 1 b2w 76 | ord 2 (Start) b2w 456, ppe 152,
--      lider 152, fornecedor 0 | ord 3 b2w 76.
--   b2 Ultra, nivel 1: b2w 82, ppe 41 (5%), lider 8,20 (1%), forn 688,80, nas
--      duas faturas (plano recorrente nao tem Start).
--   b3 Ultra com Assinante Conect (parceiro no nivel 2): b2w 82, ppe 16,40
--      (L2 2%), lider 0 (L2 do Ultra e 0), Conect 16,40, forn 705,20.
-- (c) excecao do originador vence; originador no Padrao herda do plano de
--     assinatura; o Start do parceiro isenta o piso.
-- (d) ordinal so conta fatura paga COM compensacao -- inclusive para as
--     faturas retidas do fornecedor (2.1.7).
-- (e) transicao: Start pago pela regra antiga encerra o Start da UC; pela
--     regra nova o mesmo ordinal nunca paga Start duas vezes.
-- (f) dois parceiros na mesma fatura, cada um pelo seu plano.

DO $$
DECLARE
    c_premium constant uuid := 'b0298e43-9f01-4104-b77a-c01d3f30310c';
    c_ultra   constant uuid := '29c46292-363d-46d2-87f5-7cae59c8ee69';

    v_padrao   uuid;
    v_recorr   uuid;
    v_plano_x  uuid;   -- excecao: start nas faturas 1 e 2 (ppe L1 10%)
    v_plano_y  uuid;   -- excecao: so recorrencia, ppe 7%
    v_plano_z  uuid;   -- excecao: ambos, lider 30% na 1a

    v_lider    uuid;
    v_ppe      uuid;
    v_ppe_x    uuid;
    v_lider_z  uuid;
    v_ppe_y    uuid;

    v_pu       uuid;
    v_sup      uuid;
    v_sup_ret  uuid;
    v_usina    uuid;
    v_usina_r  uuid;

    v_sub      uuid;
    v_ref      uuid;
    v_uc       uuid;
    v_uc_p     uuid;
    v_uc_u     uuid;
    v_i1       uuid;
    v_i2       uuid;
    v_i3       uuid;
    r          jsonb;
    v_b        jsonb;
    v_txt      text;
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
                 'retido',  COALESCE(SUM(le.amount) FILTER (WHERE la.code = '2.1.7'), 0),
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
      CREATE FUNCTION pg_temp.fatura(p_uc uuid, p_kwh numeric, p_dias int) RETURNS uuid LANGUAGE sql AS $b$
        INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
        VALUES (p_uc, 'a_vencer', GREATEST(p_kwh, 50), 0, CURRENT_DATE + p_dias, p_kwh) RETURNING id
      $b$
    $f$;

    -- ------------------------------------------------------------ fixture
    SELECT id INTO v_padrao FROM public.planos_originador WHERE padrao;
    SELECT plano_originador_id INTO v_recorr FROM public.planos_assinatura_energia WHERE id = c_ultra;

    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX-PO-1', 'Sandbox PO', 'SANDBOX PO conc', 'RN', 1.20, 0.20);

    INSERT INTO public.planos_usina (nome, percentual_recorrente) VALUES ('SANDBOX PO pu', 10) RETURNING id INTO v_pu;
    INSERT INTO public.suppliers (name) VALUES ('SANDBOX PO fornecedor') RETURNING id INTO v_sup;
    INSERT INTO public.suppliers (name, contract_terms) VALUES ('SANDBOX PO fornecedor retido', '{"faturasRetidas": "1"}') RETURNING id INTO v_sup_ret;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu, v_sup) RETURNING id INTO v_usina;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu, v_sup_ret) RETURNING id INTO v_usina_r;

    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX excecao start 1 e 2', 'start',
            '{"faturas_elegiveis": [1, 2], "regras_multinivel": {"ppe": {"niveis": {"L1": "10", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}, "lider": {"niveis": {"L1": "0", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}, "ppp": {"niveis": {"L1": "0", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}, "ppf": {"niveis": {"L1": "0", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {}}')
    RETURNING id INTO v_plano_x;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX excecao recorrente', 'recorrente',
            '{"faturas_elegiveis": [1], "regras_multinivel": {"ppe": {"niveis": {"L1": "99", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {"ppe": {"niveis": {"L1": "7", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 2}}}')
    RETURNING id INTO v_plano_y;
    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX excecao ambos', 'ambos',
            '{"faturas_elegiveis": [1], "regras_multinivel": {"lider": {"niveis": {"L1": "30", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
            '{"regras_multinivel": {"lider": {"niveis": {"L1": "3", "L2": "3", "L3": "0", "L4": "0"}, "max_niveis": 2}}}')
    RETURNING id INTO v_plano_z;

    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PO Lider', 'lider', true) RETURNING id INTO v_lider;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PO PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id, plano_originador_id)
    VALUES ('SANDBOX PO PPE excecao', 'ppe', true, v_lider, v_plano_x) RETURNING id INTO v_ppe_x;
    INSERT INTO public.originators_v2 (name, cargo, ativo, plano_originador_id)
    VALUES ('SANDBOX PO Lider ambos', 'lider', true, v_plano_z) RETURNING id INTO v_lider_z;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id, plano_originador_id)
    VALUES ('SANDBOX PO PPE recorrente', 'ppe', true, v_lider_z, v_plano_y) RETURNING id INTO v_ppe_y;

    -- ================================================================ (b1)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://po/b1') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_premium) RETURNING id INTO v_uc_p;

    r := pg_temp.pagar(pg_temp.fatura(v_uc_p, 1000, 5));
    PERFORM pg_temp.confere('b1 Premium ord 1', r, -76, 0, 0, -684);
    r := pg_temp.pagar(pg_temp.fatura(v_uc_p, 1000, 35));
    PERFORM pg_temp.confere('b1 Premium ord 2 (Start)', r, -456, -304, 0, 0);
    IF pg_temp.com(r, v_ppe) <> -152 OR pg_temp.com(r, v_lider) <> -152 THEN
        RAISE EXCEPTION 'FALHA b1: ppe % lider % (esperado -152 / -152)', pg_temp.com(r, v_ppe), pg_temp.com(r, v_lider);
    END IF;
    IF (r #>> '{rec,bonus_start,aplicado}')::boolean IS DISTINCT FROM true
       OR r #>> '{rec,bonus_start,ordinal_regra}' IS DISTINCT FROM 'compensadas'
       OR (r #>> '{rec,teto_deducao}')::numeric <> 760
       OR r #>> '{rec,motivo}' IS DISTINCT FROM 'bonus_start' THEN
        RAISE EXCEPTION 'FALHA b1: congelamento do Start %', r -> 'rec' -> 'bonus_start';
    END IF;
    v_b := pg_temp.ben(r, 'ppe');
    IF (v_b->>'plano_originador_id')::uuid IS DISTINCT FROM v_padrao OR v_b->>'plano_origem' <> 'plano_assinatura' OR v_b->>'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA b1: beneficiario ppe congelado %', v_b;
    END IF;
    SELECT description INTO v_txt FROM public.ledger_entries WHERE transaction_id = (r->>'txn')::uuid AND reference_id = v_ppe;
    IF v_txt IS DISTINCT FROM 'Bônus Start Parceiro Power Embaixador (nível 1)' THEN
        RAISE EXCEPTION 'FALHA b1: descricao do Start do parceiro = %', v_txt;
    END IF;
    r := pg_temp.pagar(pg_temp.fatura(v_uc_p, 1000, 65));
    PERFORM pg_temp.confere('b1 Premium ord 3', r, -76, 0, 0, -684);

    -- ================================================================ (b2)
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://po/b2') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_ultra) RETURNING id INTO v_uc_u;

    r := pg_temp.pagar(pg_temp.fatura(v_uc_u, 1000, 5));
    PERFORM pg_temp.confere('b2 Ultra ord 1', r, -82, -49.20, 0, -688.80);
    r := pg_temp.pagar(pg_temp.fatura(v_uc_u, 1000, 35));
    PERFORM pg_temp.confere('b2 Ultra ord 2', r, -82, -49.20, 0, -688.80);
    IF pg_temp.com(r, v_ppe) <> -41 OR pg_temp.com(r, v_lider) <> -8.20 THEN
        RAISE EXCEPTION 'FALHA b2: ppe % lider % (esperado -41 / -8.20)', pg_temp.com(r, v_ppe), pg_temp.com(r, v_lider);
    END IF;
    IF (r #>> '{rec,bonus_start,aplicado}')::boolean IS DISTINCT FROM false
       OR (r #>> '{rec,teto_deducao}')::numeric <> 220 THEN
        RAISE EXCEPTION 'FALHA b2: plano recorrente nao pode ter Start nem perder o piso: %', r -> 'rec' -> 'bonus_start';
    END IF;
    v_b := pg_temp.ben(r, 'ppe');
    IF (v_b->>'plano_originador_id')::uuid IS DISTINCT FROM v_recorr OR v_b->>'plano_origem' <> 'plano_assinatura' OR v_b->>'regra' <> 'recorrencia' THEN
        RAISE EXCEPTION 'FALHA b2: beneficiario ppe congelado %', v_b;
    END IF;

    -- ================================================================ (b3)
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://po/b3-ref') RETURNING id INTO v_ref;
    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe, 'ativo', 'sandbox://po/b3', v_ref) RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_ultra) RETURNING id INTO v_uc;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('b3 Ultra nivel 2 + Conect', r, -82, -16.40, -16.40, -705.20);

    -- ================================================================ (c)
    IF public.fn_plano_originador_efetivo(v_ppe_x, v_uc_p) ->> 'origem' <> 'originador'
       OR (public.fn_plano_originador_efetivo(v_ppe_x, v_uc_p) ->> 'id')::uuid <> v_plano_x THEN
        RAISE EXCEPTION 'FALHA c: a excecao do originador nao venceu: %', public.fn_plano_originador_efetivo(v_ppe_x, v_uc_p);
    END IF;
    IF public.fn_plano_originador_efetivo(v_ppe, v_uc_u) ->> 'origem' <> 'plano_assinatura'
       OR (public.fn_plano_originador_efetivo(v_ppe, v_uc_u) ->> 'id')::uuid <> v_recorr THEN
        RAISE EXCEPTION 'FALHA c: originador no Padrao nao herdou do plano de assinatura (Ultra -> Recorrente)';
    END IF;
    IF (public.fn_plano_originador_efetivo(v_ppe, v_uc_p) ->> 'id')::uuid <> v_padrao THEN
        RAISE EXCEPTION 'FALHA c: originador no Padrao numa UC Premium nao ficou no Padrao';
    END IF;

    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe_x, 'ativo', 'sandbox://po/c') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_premium) RETURNING id INTO v_uc;

    -- ord 1: Premium fora da janela (B2W 10%), mas o parceiro tem Start de 10%
    -- na 1a pela excecao: 76. O lider fica no Padrao (Start so na 2a): 0.
    -- O Start do parceiro isenta o piso (teto = base 760).
    -- 20261112a (revisao do dono 12/11/2026): o Start e UMA matriz para as N
    -- faturas, entao a excecao paga 10% nas duas (antes: 50% na 1a = 380 e
    -- 10% na 2a); a 2a nao muda.
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('c excecao ord 1', r, -76, -76, 0, -608);
    IF pg_temp.com(r, v_lider) <> 0 THEN
        RAISE EXCEPTION 'FALHA c: lider recebeu % na 1a (o plano dele e o Padrao)', pg_temp.com(r, v_lider);
    END IF;
    IF (r #>> '{rec,bonus_start,aplicado}')::boolean IS DISTINCT FROM true
       OR (r #>> '{rec,bonus_start,aplicado_b2w}')::boolean IS DISTINCT FROM false
       OR (r #>> '{rec,bonus_start,aplicado_parceiros}')::boolean IS DISTINCT FROM true
       OR (r #>> '{rec,bonus_start,piso_ignorado}')::boolean IS DISTINCT FROM true
       OR (r #>> '{rec,teto_deducao}')::numeric <> 760 THEN
        RAISE EXCEPTION 'FALHA c: congelamento do Start de parceiro % teto %', r -> 'rec' -> 'bonus_start', r #>> '{rec,teto_deducao}';
    END IF;
    v_b := pg_temp.ben(r, 'ppe');
    IF (v_b->>'plano_originador_id')::uuid IS DISTINCT FROM v_plano_x OR v_b->>'plano_origem' <> 'originador' OR v_b->>'regra' <> 'start' THEN
        RAISE EXCEPTION 'FALHA c: beneficiario ppe congelado %', v_b;
    END IF;
    v_b := pg_temp.ben(r, 'lider');
    IF (v_b->>'plano_originador_id')::uuid IS DISTINCT FROM v_padrao OR v_b->>'plano_origem' <> 'plano_assinatura' OR v_b->>'regra' <> 'nenhuma' THEN
        RAISE EXCEPTION 'FALHA c: beneficiario lider congelado %', v_b;
    END IF;

    -- ord 2: B2W Start 60% (456), parceiro 10% pela excecao (76), lider 20% pelo Padrao (152)
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('c excecao ord 2', r, -456, -228, 0, -76);
    IF pg_temp.com(r, v_ppe_x) <> -76 OR pg_temp.com(r, v_lider) <> -152 THEN
        RAISE EXCEPTION 'FALHA c ord 2: ppe % lider % (esperado -76 / -152)', pg_temp.com(r, v_ppe_x), pg_temp.com(r, v_lider);
    END IF;

    -- ================================================================ (f)
    -- ppe pela excecao recorrente (7%) e o lider dele pela excecao 'ambos'
    -- (Start de 30% na 1a): 53,20 + 228,00; B2W 76; isento do piso.
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe_y, 'ativo', 'sandbox://po/f') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_premium) RETURNING id INTO v_uc;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('f dois planos ord 1', r, -76, -281.20, 0, -402.80);
    IF pg_temp.com(r, v_ppe_y) <> -53.20 OR pg_temp.com(r, v_lider_z) <> -228 THEN
        RAISE EXCEPTION 'FALHA f: ppe % lider % (esperado -53.20 / -228)', pg_temp.com(r, v_ppe_y), pg_temp.com(r, v_lider_z);
    END IF;
    IF pg_temp.ben(r, 'ppe') ->> 'regra' <> 'recorrencia' OR pg_temp.ben(r, 'lider') ->> 'regra' <> 'start'
       OR (pg_temp.ben(r, 'ppe') ->> 'plano_originador_id')::uuid <> v_plano_y
       OR (pg_temp.ben(r, 'lider') ->> 'plano_originador_id')::uuid <> v_plano_z THEN
        RAISE EXCEPTION 'FALHA f: congelamento % / %', pg_temp.ben(r, 'ppe'), pg_temp.ben(r, 'lider');
    END IF;
    SELECT description INTO v_txt FROM public.ledger_entries WHERE transaction_id = (r->>'txn')::uuid AND reference_id = v_ppe_y;
    IF v_txt IS DISTINCT FROM 'Recompensa Parceiro Power Embaixador (nível 1)' THEN
        RAISE EXCEPTION 'FALHA f: descricao da recorrencia do parceiro = %', v_txt;
    END IF;
    SELECT description INTO v_txt FROM public.ledger_entries WHERE transaction_id = (r->>'txn')::uuid AND reference_id = v_lider_z;
    IF v_txt IS DISTINCT FROM 'Bônus Start Líder (nível 1)' THEN
        RAISE EXCEPTION 'FALHA f: descricao do Start do lider = %', v_txt;
    END IF;
    -- ord 2: ppe 7% (53,20), lider 'ambos' fora da janela -> recorrencia L1 3% (22,80);
    -- Premium Start da B2W 60% (456). Total 532 <= base (Start isenta).
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('f dois planos ord 2', r, -456, -76, 0, -228);

    -- ================================================================ (d)
    -- 1a fatura sem compensacao: nao consome o ordinal (nem a retencao).
    -- 2a (1a compensada) = ordinal 1: fora da janela do Premium, retida.
    -- 3a (2a compensada) = ordinal 2: Start, nao retida.
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://po/d') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina_r, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_premium) RETURNING id INTO v_uc;

    r := pg_temp.pagar(pg_temp.fatura(v_uc, 0, 5));
    IF r #>> '{rec,motivo}' <> 'sem_compensacao' OR (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 1
       OR (r->>'retido')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA d: fatura sem compensacao: motivo % ordinal % retido %',
            r #>> '{rec,motivo}', r #>> '{rec,bonus_start,fatura_ordinal}', r->>'retido';
    END IF;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('d 1a compensada', r, -76, 0, 0, 0);
    IF (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 1 OR (r #>> '{rec,bonus_start,aplicado}')::boolean
       OR (r->>'retido')::numeric <> -684
       OR (r #>> '{rec,retencao_associacao,fatura_ordinal}')::int <> 1
       OR r #>> '{rec,retencao_associacao,ordinal_regra}' IS DISTINCT FROM 'compensadas' THEN
        RAISE EXCEPTION 'FALHA d: 1a compensada tem de ser o ordinal 1 (sem Start, retida): ordinal % aplicado % retido %',
            r #>> '{rec,bonus_start,fatura_ordinal}', r #>> '{rec,bonus_start,aplicado}', r->>'retido';
    END IF;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 65));
    PERFORM pg_temp.confere('d 2a compensada (Start)', r, -456, -304, 0, 0);
    IF (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 2 OR (r->>'retido')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA d: 2a compensada: ordinal % retido %', r #>> '{rec,bonus_start,fatura_ordinal}', r->>'retido';
    END IF;

    -- ================================================================ (e)
    -- e1: regra antiga. A (sem compensacao) e B (Start pago como ordinal 2
    -- pela contagem antiga) ja estao pagas. C e o ordinal 2 na contagem nova
    -- -- dentro da janela -- mas o Start da UC ja foi pago: nada de Start.
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://po/e1') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_premium) RETURNING id INTO v_uc;
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, recompensas_aplicadas)
    VALUES (v_uc, 'pago', 50, 0, CURRENT_DATE - 60, 0,
            '{"versao": "20261105_faturas_retidas", "lancado": true, "motivo": "sem_compensacao", "bonus_start": {"aplicado": false, "fatura_ordinal": 1}}');
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, recompensas_aplicadas)
    VALUES (v_uc, 'pago', 760, 0, CURRENT_DATE - 30, 1000,
            '{"versao": "20261105_faturas_retidas", "lancado": true, "motivo": "bonus_start", "bonus_start": {"aplicado": true, "fatura_ordinal": 2}}');
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 5));
    PERFORM pg_temp.confere('e1 transicao', r, -76, 0, 0, -684);
    IF (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 2
       OR (r #>> '{rec,bonus_start,aplicado}')::boolean IS DISTINCT FROM false
       OR (r #>> '{rec,bonus_start,elegivel_calendario}')::boolean IS DISTINCT FROM true
       OR r #>> '{rec,bonus_start,bloqueio}' NOT LIKE 'Start da UC encerrado%'
       OR r #>> '{rec,bonus_start,motivo}' NOT LIKE 'Start da UC encerrado%' THEN
        RAISE EXCEPTION 'FALHA e1: o Start foi pago de novo ou nao registrou o motivo: %', r -> 'rec' -> 'bonus_start';
    END IF;
    -- e as proximas tambem nao (o Start da UC esta encerrado)
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('e1 transicao, fatura seguinte', r, -76, 0, 0, -684);

    -- e2: regra nova. ord 1, ord 2 (Start). A 1a e corrigida para sem
    -- compensacao depois de paga, entao a proxima cai de novo no ordinal 2:
    -- o ordinal 2 ja pagou Start nesta UC e nao paga outra vez.
    INSERT INTO public.subscribers (originator_id, status, short_url) VALUES (v_ppe, 'ativo', 'sandbox://po/e2') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX PO conc', '{"uf": "RN"}', c_premium) RETURNING id INTO v_uc;
    v_i1 := pg_temp.fatura(v_uc, 1000, 5);
    r := pg_temp.pagar(v_i1);
    PERFORM pg_temp.confere('e2 ord 1', r, -76, 0, 0, -684);
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 35));
    PERFORM pg_temp.confere('e2 ord 2 (Start)', r, -456, -304, 0, 0);
    UPDATE public.invoices SET consumo_compensado = 0 WHERE id = v_i1;
    r := pg_temp.pagar(pg_temp.fatura(v_uc, 1000, 65));
    PERFORM pg_temp.confere('e2 ordinal repetido', r, -76, 0, 0, -684);
    IF (r #>> '{rec,bonus_start,fatura_ordinal}')::int <> 2
       OR (r #>> '{rec,bonus_start,aplicado}')::boolean IS DISTINCT FROM false
       OR r #>> '{rec,bonus_start,bloqueio}' NOT LIKE 'o ordinal 2 ja pagou Start%' THEN
        RAISE EXCEPTION 'FALHA e2: Start em dobro no mesmo ordinal: %', r -> 'rec' -> 'bonus_start';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
