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
    v_p8      uuid;
    v_uc8     uuid;
    v_v3      uuid;
    v_orfa    uuid;
    v_user    uuid := gen_random_uuid();
    v_ids     uuid[];
    v_lead    uuid;
    v_r       jsonb;
    v_p13a    uuid;
    v_p13b    uuid;
    v_uc13a   uuid;
    v_uc13b   uuid;
    v_sub13   uuid;
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

    -- V8 -- fix round 1 (A): a tela grava o Start em 10 chaves por fatura (aliases
    --       legados, texto no lugar de numero); o motor le 6. Salvar/renomear
    --       um plano travado com os MESMOS 6 valores passa; mudar um deles, nao.
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config, start_config)
    VALUES ('SANDBOX PV8', 'start', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [2], "regras": {"1": {"b2w": 0, "ppe": 50, "ppf": 20, "ppp": 40, "lider": 50, "assinante_conect": 0},
                                                   "2": {"b2w": 60, "ppe": 20, "ppf": 0, "ppp": 0, "lider": 20, "assinante_conect": 0},
                                                   "3": {"b2w": 0, "ppe": 0, "ppf": 0, "ppp": 0, "lider": 0, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_p8;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_p8) RETURNING id INTO v_uc8;

    UPDATE public.planos_assinatura_energia
       SET nome = 'SANDBOX PV8 renomeado',
           start_config = '{"faturas_elegiveis": [2], "regras": {
              "1": {"b2w": 0, "lider": 50, "ppe": 50, "ppp": 40, "ppf": 20, "assinante_conect": 0,
                    "associacao": 0, "coordenador": 50, "embaixador": 50, "assinante": 0},
              "2": {"b2w": "60", "lider": 20.0, "ppe": 20, "ppp": 0, "ppf": 0, "assinante_conect": 0,
                    "associacao": 60, "coordenador": 20, "embaixador": 20, "assinante": 0},
              "3": {"b2w": 0, "lider": 0, "ppe": 0, "ppp": 0, "ppf": 0, "assinante_conect": 0,
                    "associacao": 0, "coordenador": 0, "embaixador": 0, "assinante": 0}}}'::jsonb
     WHERE id = v_p8;   -- passa

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia
           SET start_config = '{"faturas_elegiveis": [2], "regras": {
              "1": {"b2w": 0, "lider": 50, "ppe": 50, "ppp": 40, "ppf": 20, "assinante_conect": 0, "embaixador": 50},
              "2": {"b2w": 60, "lider": 20, "ppe": 21, "ppp": 0, "ppf": 0, "assinante_conect": 0, "embaixador": 21},
              "3": {"b2w": 0, "lider": 0, "ppe": 0, "ppp": 0, "ppf": 0, "assinante_conect": 0}}}'::jsonb
         WHERE id = v_p8;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V8: mudar um dos 6 valores do Start (ppe 20 -> 21) devia ser recusado'; END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_assinatura_energia
           SET start_config = jsonb_set(start_config, '{faturas_elegiveis}', '[1,2]'::jsonb)
         WHERE id = v_p8;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V8: mudar faturas_elegiveis devia ser recusado'; END IF;

    -- V9 -- nova versao so a partir da versao ativa (v_plano ja foi substituido em V4)
    v_pegou := false;
    BEGIN
        PERFORM public.fn_planos_assinatura_nova_versao(v_plano, '{}'::jsonb);
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%ja foi substituido%' THEN
        RAISE EXCEPTION 'FALHA V9: nova versao de plano somente_contratos devia ser recusada (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- V10 -- segunda versao: o sufixo nao empilha
    v_v3 := public.fn_planos_assinatura_nova_versao(v_novo, '{}'::jsonb);
    SELECT * INTO v_row FROM public.planos_assinatura_energia WHERE id = v_v3;
    IF v_row.nome <> 'SANDBOX PV renomeado (nova versão)' OR v_row.substitui_plano_id IS DISTINCT FROM v_novo THEN
        RAISE EXCEPTION 'FALHA V10: nome/substitui da 2a versao errados: %', row_to_json(v_row);
    END IF;

    -- V11 -- versao vigente: v_plano -> v_novo -> v_v3
    IF public.fn_plano_assinatura_vigente(v_plano) IS DISTINCT FROM v_v3
       OR public.fn_plano_assinatura_vigente(v_novo) IS DISTINCT FROM v_v3
       OR public.fn_plano_assinatura_vigente(v_v3) IS DISTINCT FROM v_v3 THEN
        RAISE EXCEPTION 'FALHA V11: vigente da cadeia v1->v2->v3 devia ser v3 a partir de qualquer ponto';
    END IF;
    IF public.fn_plano_assinatura_vigente(gen_random_uuid()) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA V11: plano inexistente devia dar NULL';
    END IF;
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX PV orfa', 'recorrente', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_orfa;
    UPDATE public.planos_assinatura_energia SET status = 'somente_contratos' WHERE id = v_orfa;
    IF public.fn_plano_assinatura_vigente(v_orfa) IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA V11: plano somente_contratos sem sucessor devia dar NULL';
    END IF;
    IF has_function_privilege('anon', 'public.fn_plano_assinatura_vigente(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA V11: anon executa fn_plano_assinatura_vigente';
    END IF;

    -- V12 -- listas da adesao: so plano ativo (v_plano e v_novo ja foram substituidos)
    INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
    VALUES (v_user, 'pv12@teste.invalid', '{"name":"PV12"}', 'authenticated', 'authenticated');
    UPDATE public.subscribers SET user_id = v_user WHERE id = v_sub;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SELECT array_agg(id) INTO v_ids FROM public.app_planos_adesao('SANDBOX PV conc');
    IF v_ids IS DISTINCT FROM ARRAY[v_v3] THEN
        RAISE EXCEPTION 'FALHA V12: app_planos_adesao devia listar so a versao ativa %, listou %', v_v3, v_ids;
    END IF;
    SELECT array_agg(id) INTO v_ids FROM public.app_planos_para_uc('SANDBOX PV conc');
    IF v_ids IS DISTINCT FROM ARRAY[v_v3] THEN
        RAISE EXCEPTION 'FALHA V12: app_planos_para_uc devia listar so a versao ativa %, listou %', v_v3, v_ids;
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);

    -- V13 -- mover UCs aplica os termos novos, inclusive o desconto cobrado
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX PV13', 'recorrente', 10, 50, 20, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_p13a;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id, desconto_assinante)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_p13a, 20) RETURNING id INTO v_uc13a;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id, desconto_assinante)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_livre, 17) RETURNING id INTO v_uc13b;
    v_p13b := public.fn_planos_assinatura_nova_versao(v_p13a, jsonb_build_object('desconto_assinante', 18));
    v_n := public.fn_planos_assinatura_mover_ucs(v_p13a, v_p13b);
    IF v_n <> 1
       OR (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc13a) IS DISTINCT FROM v_p13b
       OR (SELECT desconto_assinante FROM public.consumer_units WHERE id = v_uc13a) IS DISTINCT FROM 18::numeric THEN
        RAISE EXCEPTION 'FALHA V13: UC movida devia ir para a v2 com desconto 18 (n=%, plano=%, desconto=%)', v_n,
            (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc13a),
            (SELECT desconto_assinante FROM public.consumer_units WHERE id = v_uc13a);
    END IF;
    IF (SELECT desconto_assinante FROM public.consumer_units WHERE id = v_uc13b) IS DISTINCT FROM 17::numeric
       OR (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = v_uc13b) IS DISTINCT FROM v_livre THEN
        RAISE EXCEPTION 'FALHA V13: UC de outro plano foi tocada';
    END IF;

    -- V14 -- aditivo: lead que ainda aponta para versao antiga cai na vigente
    INSERT INTO public.subscribers (status, short_url, name) VALUES ('ativo', 'sandbox://pv/14', 'SANDBOX PV14 nome') RETURNING id INTO v_sub13;
    INSERT INTO public.leads (solicitante_assinante_id, conta_lida, plano_id)
    VALUES (v_sub13, '{"numeroUc":"SBX-PV-ADT-7771","titular":"SANDBOX PV14 nome","ligacao":"monofasico","concessionaria":"SANDBOX PV conc","mediaKwh":"300","endereco":{"cep":"59000000","logradouro":"Rua A, 10","bairro":"B","cidade":"C","uf":"rn"}}'::jsonb, v_plano)
    RETURNING id INTO v_lead;
    v_r := public.fn_criar_uc_do_aditivo(v_lead);
    IF (v_r ->> 'ok')::boolean IS DISTINCT FROM true
       OR (SELECT plano_assinatura_id FROM public.consumer_units WHERE id = (v_r ->> 'uc_id')::uuid) IS DISTINCT FROM v_v3 THEN
        RAISE EXCEPTION 'FALHA V14: aditivo com plano antigo devia criar a UC na versao vigente %: %', v_v3, v_r;
    END IF;

    -- V15 -- adesao publica: plano escolhido numa tela velha cai na vigente
    v_r := public.fn_criar_assinante_publico('SANDBOX PV15 Fulano', '52998224725', 'sbx.pv15@teste.invalid', '84999990000',
        '59000000', 'Rua A', '10', NULL, 'Bairro', 'Natal', 'RN', '2408102', NULL, NULL,
        jsonb_build_array(jsonb_build_object('numero_uc', 'SBX-PV-PUB-7772', 'cpf_cnpj_fatura', '52998224725',
            'tipo_ligacao', 'monofasico', 'concessionaria', 'SANDBOX PV conc', 'plano_assinatura_id', v_plano::text, 'uf', 'RN')),
        10, NULL, NULL, 'v1', NULL);
    IF (v_r ->> 'ucs_criadas')::int IS DISTINCT FROM 1
       OR (SELECT plano_assinatura_id FROM public.consumer_units WHERE numero_uc = 'SBX-PV-PUB-7772') IS DISTINCT FROM v_v3 THEN
        RAISE EXCEPTION 'FALHA V15: adesao publica com plano antigo devia cair na versao vigente %: %', v_v3, v_r;
    END IF;

    -- V16 -- so admin cria versao (usuario logado que nao e admin)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    v_pegou := false;
    BEGIN
        PERFORM public.fn_planos_assinatura_nova_versao(v_v3, '{}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN v_pegou := true;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_pegou THEN RAISE EXCEPTION 'FALHA V16: usuario nao admin criou versao de plano'; END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
