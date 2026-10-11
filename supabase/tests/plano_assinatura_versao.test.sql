-- Teste: trava de versao do plano de assinatura (spec 2026-10-06, secao 6, decisao 17).
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).
DO $$
DECLARE
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2}
    }'::jsonb;
    v_livre   uuid;
    v_plano   uuid;
    v_novo    uuid;
    v_sub     uuid;
    v_uc      uuid;
    v_uc2     uuid;
    v_row     public.planos_assinatura_energia;
    v_n       integer;
    v_msg     text;
    v_pegou   boolean;
BEGIN
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX PV livre', 'recorrente', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_livre;
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX PV', 'recorrente', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz, 'lastro_tarifario', '{"tarifa_bruta": 1.0}'::jsonb))
    RETURNING id INTO v_plano;
    INSERT INTO public.planos_distribuidoras (plano_id, concessionaria) VALUES (v_plano, 'SANDBOX PV conc');

    -- V0 -- colunas novas com default
    SELECT * INTO v_row FROM public.planos_assinatura_energia WHERE id = v_plano;
    IF v_row.status <> 'ativo' OR v_row.substitui_plano_id IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA V0: plano novo devia nascer ativo e sem substitui_plano_id: %', row_to_json(v_row);
    END IF;

    -- V1 -- sem UC, numero muda livre
    UPDATE public.planos_assinatura_energia SET desconto_assinante = 18 WHERE id = v_livre;

    -- fixture: uma UC no plano
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pv/1') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_plano) RETURNING id INTO v_uc;

    -- V2 -- com UC: desconto, piso, matriz e Start recusados pedindo nova versao
    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET desconto_assinante = 15 WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%nova versao%' THEN
        RAISE EXCEPTION 'FALHA V2: desconto de plano com UC devia ser recusado pedindo nova versao (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET piso_fornecedor_pct = 45 WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V2: piso de plano com UC devia ser recusado'; END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia
           SET recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,ppe,niveis,L1}', '"6"')
         WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V2: matriz de plano com UC devia ser recusada'; END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET start_config = '{"faturas_elegiveis": [2]}'::jsonb WHERE id = v_plano;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V2: start_config de plano com UC devia ser recusado'; END IF;

    -- V3 -- nome, ativo e metadados (lastro_tarifario) passam
    UPDATE public.planos_assinatura_energia
       SET nome = 'SANDBOX PV renomeado', ativo = true,
           recorrente_config = jsonb_set(recorrente_config, '{lastro_tarifario}', '{"tarifa_bruta": 1.1}'::jsonb)
     WHERE id = v_plano;

    -- V4 -- nova versao: nasce ativa com substitui_plano_id, herda o que nao veio,
    --       copia as distribuidoras; a antiga vira somente_contratos e mantem a UC.
    v_novo := public.fn_planos_assinatura_nova_versao(v_plano, jsonb_build_object('desconto_assinante', 15));
    SELECT * INTO v_row FROM public.planos_assinatura_energia WHERE id = v_novo;
    IF v_row.status <> 'ativo' OR v_row.substitui_plano_id IS DISTINCT FROM v_plano
       OR v_row.desconto_assinante <> 15 OR v_row.piso_fornecedor_pct <> 50
       OR v_row.recorrente_config -> 'regras_multinivel' IS DISTINCT FROM c_matriz
       OR v_row.nome <> 'SANDBOX PV renomeado (nova versão)' THEN
        RAISE EXCEPTION 'FALHA V4: nova versao errada: %', row_to_json(v_row);
    END IF;
    SELECT count(*) INTO v_n FROM public.planos_distribuidoras WHERE plano_id = v_novo AND concessionaria = 'SANDBOX PV conc';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA V4: distribuidoras nao foram copiadas (%)', v_n; END IF;
    IF (SELECT status FROM public.planos_assinatura_energia WHERE id = v_plano) <> 'somente_contratos' THEN
        RAISE EXCEPTION 'FALHA V4: o plano antigo devia virar somente_contratos';
    END IF;
    IF (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc) IS DISTINCT FROM v_plano THEN
        RAISE EXCEPTION 'FALHA V4: a UC do plano antigo nao pode mudar sozinha';
    END IF;

    -- V5 -- UC nova so aponta para plano ativo; a UC antiga continua salvando
    v_pegou := false;
    BEGIN
        INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
        VALUES (v_sub, 'beneficiaria', 'ativo', v_plano);
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%somente para contratos%' THEN
        RAISE EXCEPTION 'FALHA V5: UC nova entrou em plano somente_contratos (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;
    UPDATE public.consumer_units SET numero_uc = 'SANDBOX-PV-1' WHERE id = v_uc;   -- passa

    -- V6 -- mover UCs para a versao nova (admin em lote)
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativacao', v_livre) RETURNING id INTO v_uc2;
    v_n := public.fn_planos_assinatura_mover_ucs(v_plano, v_novo);
    IF v_n <> 1 OR (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc) IS DISTINCT FROM v_novo THEN
        RAISE EXCEPTION 'FALHA V6: mover UCs moveu % e a UC esta em %', v_n,
            (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc);
    END IF;
    IF (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc2) IS DISTINCT FROM v_livre THEN
        RAISE EXCEPTION 'FALHA V6: mover UCs tocou UC de outro plano';
    END IF;
    v_pegou := false;
    BEGIN
        PERFORM public.fn_planos_assinatura_mover_ucs(v_novo, v_plano);   -- destino somente_contratos
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V6: mover UCs para plano somente_contratos devia ser recusado'; END IF;

    -- V7 -- seguranca
    IF has_function_privilege('anon', 'public.fn_planos_assinatura_nova_versao(uuid, jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_planos_assinatura_mover_ucs(uuid, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA V7: anon executa RPC de versao de plano';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
