-- Teste: PLANO DO ORIGINADOR -- seed, vinculos, limpeza, trava e guardas.
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md
--
-- Roda DEPOIS de 20261110a_plano_originador.sql, 20261110b e 20261112a, no
-- mesmo BEGIN/ROLLBACK (nada e aplicado):
--   BEGIN; <20261110a>; <20261110b>; <20261112a>; <este arquivo>; ROLLBACK;
-- 20261112a (revisao do dono 12/11/2026): start_config no formato novo
-- (regras_multinivel; faturas_elegiveis [1..N]); `regras` e recusado.
-- Sucesso = erro 'SANDBOX_OK'.
--
-- (a) Padrao = regras de parceiro do Plano Premium, Recorrente = as do Ultra
--     Connect, com os valores de producao de 10/11/2026; Premium -> Padrao,
--     Ultra -> Recorrente, todo originador -> Padrao; as chaves de parceiro
--     sairam do plano de assinatura e b2w/assinante_conect ficaram intactos.
-- (g) guardas do Padrao (nao exclui, nao inativa, nao perde padrao, nao ha
--     segundo), FK RESTRICT, formato (so os 4 cargos), gatilho de default nos
--     INSERTs, trava do plano de assinatura (ignora parceiro e
--     plano_originador_id, continua travando o resto) e o plano do originador
--     como campo sensivel (o proprio parceiro nao troca).

DO $$
DECLARE
    c_premium constant uuid := 'b0298e43-9f01-4104-b77a-c01d3f30310c';
    c_ultra   constant uuid := '29c46292-363d-46d2-87f5-7cae59c8ee69';
    c_parceiro constant text[] := ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante'];

    v_padrao     public.planos_originador;
    v_recorrente public.planos_originador;
    v_premium    public.planos_assinatura_energia;
    v_ultra      public.planos_assinatura_energia;
    v_id         uuid;
    v_plano      uuid;
    v_orig       uuid;
    v_n          int;
    v_ok         boolean;
    v_txt        text;
    v_dono       text := current_user;
    v_user       uuid := gen_random_uuid();
BEGIN
    -- =================================================================== (a)
    -- Revisao de 12/11/2026: o dono passou a EDITAR os planos em producao (criou
    -- o "Plano Hibrido", mudou o Padrao para Start na 1a fatura). Este caso
    -- deixou de conferir os numeros do seed de 10/11 -- que ele tem direito de
    -- mudar -- e passou a conferir INVARIANTES que valem para qualquer edicao.
    SELECT * INTO v_padrao FROM public.planos_originador WHERE padrao;
    SELECT * INTO v_recorrente FROM public.planos_originador WHERE nome = 'Plano Recorrente';
    SELECT * INTO v_premium FROM public.planos_assinatura_energia WHERE id = c_premium;
    SELECT * INTO v_ultra   FROM public.planos_assinatura_energia WHERE id = c_ultra;

    SELECT count(*) INTO v_n FROM public.planos_originador WHERE padrao;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA (a): % Plano(s) Padrao, esperado exatamente 1', v_n;
    END IF;
    IF v_padrao.status <> 'ativo' THEN
        RAISE EXCEPTION 'FALHA (a): Plano Padrao nao esta ativo: %', to_jsonb(v_padrao);
    END IF;
    IF v_recorrente.id IS NULL OR v_recorrente.padrao THEN
        RAISE EXCEPTION 'FALHA (a): Plano Recorrente (seed) ausente ou marcado como Padrao: %', to_jsonb(v_recorrente);
    END IF;

    -- formato novo em TODOS os planos (20261112a): Start por nivel, sem `regras`
    SELECT count(*) INTO v_n FROM public.planos_originador po
     WHERE jsonb_typeof(po.start_config -> 'regras_multinivel') IS DISTINCT FROM 'object'
        OR jsonb_typeof(po.start_config -> 'faturas_elegiveis') IS DISTINCT FROM 'array'
        OR po.start_config ? 'regras'
        OR jsonb_typeof(po.recorrente_config -> 'regras_multinivel') IS DISTINCT FROM 'object';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA (a): % Plano(s) do Originador fora do formato novo', v_n;
    END IF;

    -- vinculos: todo plano de assinatura e todo originador apontam para um plano que existe
    SELECT count(*) INTO v_n FROM public.planos_assinatura_energia pa
     WHERE pa.plano_originador_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.planos_originador po WHERE po.id = pa.plano_originador_id);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA (a): % plano(s) de assinatura sem Plano do Originador valido', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM public.originators_v2 o
     WHERE o.plano_originador_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.planos_originador po WHERE po.id = o.plano_originador_id);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA (a): % originador(es) sem Plano do Originador valido', v_n;
    END IF;

    -- limpeza: nenhuma chave de parceiro sobrou nos planos de assinatura
    SELECT count(*) INTO v_n
      FROM public.planos_assinatura_energia p
     WHERE p.tarifa_motorista_kwh IS NULL
       AND (EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p.start_config -> 'regras', '{}'::jsonb)) e
                     WHERE jsonb_typeof(e.value) = 'object' AND e.value ?| c_parceiro)
            OR COALESCE(p.recorrente_config -> 'regras_multinivel', '{}'::jsonb) ?| c_parceiro
            OR COALESCE(p.recorrente_config -> 'regras', '{}'::jsonb) ?| c_parceiro);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA (a): % plano(s) de assinatura ainda com chave de parceiro', v_n;
    END IF;

    -- ... e b2w / assinante_conect / o resto ficaram como estavam
    IF v_premium.start_config <> '{"faturas_elegiveis": [2], "regras": {
          "1": {"b2w": 0,  "assinante_conect": 0},
          "2": {"b2w": 60, "assinante_conect": 0},
          "3": {"b2w": 0,  "assinante_conect": 0}}}'::jsonb THEN
        RAISE EXCEPTION 'FALHA (a): start_config do Premium depois da limpeza = %', v_premium.start_config;
    END IF;
    IF v_premium.recorrente_config -> 'regras_multinivel' <> '{
          "b2w": {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
          "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}'::jsonb
       OR v_premium.recorrente_config -> 'regras' <> '{"b2w": 10, "assinante_conect": 2}'::jsonb
       OR v_premium.recorrente_config ->> 'vigencia_tipo' IS DISTINCT FROM 'status_ativo_entidade'
       OR NOT (v_premium.recorrente_config ? 'lastro_tarifario') THEN
        RAISE EXCEPTION 'FALHA (a): recorrente_config do Premium depois da limpeza = %', v_premium.recorrente_config - 'lastro_tarifario';
    END IF;
    IF v_ultra.start_config #> '{regras,2}' <> '{"b2w": 0, "assinante_conect": 0}'::jsonb
       OR v_ultra.recorrente_config -> 'regras' <> '{"b2w": 10, "assinante_conect": 0}'::jsonb
       OR v_ultra.recorrente_config #> '{regras_multinivel,assinante_conect,niveis,L1}' <> '"2"'::jsonb THEN
        RAISE EXCEPTION 'FALHA (a): Ultra depois da limpeza: start %, rc %', v_ultra.start_config, v_ultra.recorrente_config - 'lastro_tarifario';
    END IF;
    IF (v_premium.desconto_assinante, v_premium.gestao_percentual, v_premium.piso_fornecedor_pct, v_premium.tipo_recompensa)
       IS DISTINCT FROM (20.00::numeric, 10::numeric, 50::numeric, 'start'::text) THEN
        RAISE EXCEPTION 'FALHA (a): numeros do Premium mudaram: % % % %',
            v_premium.desconto_assinante, v_premium.gestao_percentual, v_premium.piso_fornecedor_pct, v_premium.tipo_recompensa;
    END IF;

    -- fn_plano_originador_efetivo sem originador nem UC -> Padrao
    IF public.fn_plano_originador_efetivo(NULL, NULL) ->> 'origem' IS DISTINCT FROM 'padrao'
       OR (public.fn_plano_originador_efetivo(NULL, NULL) ->> 'id')::uuid IS DISTINCT FROM v_padrao.id THEN
        RAISE EXCEPTION 'FALHA (a): efetivo(NULL, NULL) = %', public.fn_plano_originador_efetivo(NULL, NULL);
    END IF;

    -- =================================================================== (g)
    -- trava: Premium tem UC. Trocar plano_originador_id passa; tirar chave de
    -- parceiro (re-gravar ppe e tirar de novo) passa; mexer no b2w do Start,
    -- no desconto ou na matriz do b2w continua barrado.
    SELECT count(*) INTO v_n FROM public.consumer_units WHERE plano_assinatura_id = c_premium;
    IF v_n = 0 THEN
        RAISE EXCEPTION 'FIXTURE (g): o Premium precisa ter UC para o teste da trava valer';
    END IF;

    UPDATE public.planos_assinatura_energia SET plano_originador_id = v_recorrente.id WHERE id = c_premium;
    UPDATE public.planos_assinatura_energia SET plano_originador_id = v_padrao.id WHERE id = c_premium;
    UPDATE public.planos_assinatura_energia
       SET start_config = jsonb_set(start_config, '{regras,2,ppe}', '20'::jsonb),
           recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,ppe}', '{"niveis": {"L1": "9"}, "max_niveis": 1}'::jsonb)
     WHERE id = c_premium;
    UPDATE public.planos_assinatura_energia
       SET start_config = jsonb_set(start_config, '{regras,2}', (start_config #> '{regras,2}') - 'ppe'),
           recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel}', (recorrente_config -> 'regras_multinivel') - 'ppe')
     WHERE id = c_premium;

    v_ok := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET start_config = jsonb_set(start_config, '{regras,2,b2w}', '50'::jsonb) WHERE id = c_premium;
    EXCEPTION WHEN check_violation THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): a trava deixou mudar o b2w do Start de um plano com UC'; END IF;

    v_ok := false;
    BEGIN
        UPDATE public.planos_assinatura_energia SET desconto_assinante = 21 WHERE id = c_premium;
    EXCEPTION WHEN check_violation THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): a trava deixou mudar o desconto de um plano com UC'; END IF;

    v_ok := false;
    BEGIN
        UPDATE public.planos_assinatura_energia
           SET recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,b2w,niveis,L1}', '"11"'::jsonb)
         WHERE id = c_premium;
    EXCEPTION WHEN check_violation THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): a trava deixou mudar a matriz do b2w de um plano com UC'; END IF;

    v_ok := false;
    BEGIN
        UPDATE public.planos_assinatura_energia
           SET recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,assinante_conect,niveis,L1}', '"3"'::jsonb)
         WHERE id = c_premium;
    EXCEPTION WHEN check_violation THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): a trava deixou mudar o Assinante Conect de um plano com UC'; END IF;

    -- Padrao: nao exclui, nao inativa, nao perde padrao
    v_ok := false;
    BEGIN DELETE FROM public.planos_originador WHERE id = v_padrao.id;
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): o Padrao foi excluido'; END IF;

    v_ok := false;
    BEGIN UPDATE public.planos_originador SET status = 'inativo' WHERE id = v_padrao.id;
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): o Padrao foi inativado'; END IF;

    v_ok := false;
    BEGIN UPDATE public.planos_originador SET padrao = false WHERE id = v_padrao.id;
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): o Padrao deixou de ser Padrao'; END IF;

    v_ok := false;
    BEGIN
        INSERT INTO public.planos_originador (nome, padrao, start_config, recorrente_config)
        VALUES ('SANDBOX outro padrao', true, '{"faturas_elegiveis": [], "regras_multinivel": {}}', '{"regras_multinivel": {}}');
    EXCEPTION WHEN unique_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): um segundo Padrao foi aceito'; END IF;

    v_ok := false;
    BEGIN UPDATE public.planos_originador SET padrao = true WHERE id = v_recorrente.id;
    EXCEPTION WHEN check_violation OR unique_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): outro plano virou Padrao'; END IF;

    -- o Padrao continua editavel nos numeros
    UPDATE public.planos_originador SET descricao = 'SANDBOX editado' WHERE id = v_padrao.id;

    -- plano referenciado nao sai (FK RESTRICT); plano sem vinculo sai
    v_ok := false;
    BEGIN DELETE FROM public.planos_originador WHERE id = v_recorrente.id;
    EXCEPTION WHEN foreign_key_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): plano referenciado pelo Ultra foi excluido'; END IF;

    INSERT INTO public.planos_originador (nome, tipo_recompensa, start_config, recorrente_config)
    VALUES ('SANDBOX livre', 'ambos', '{"faturas_elegiveis": [1, 2], "regras_multinivel": {"ppf": {"niveis": {"L1": 50, "L2": "10", "L3": "5", "L4": "0"}, "max_niveis": 3}}}',
            '{"regras_multinivel": {"ppf": {"niveis": {"L1": "2", "L2": "2", "L3": "0", "L4": "0"}, "max_niveis": 2}}}')
    RETURNING id INTO v_id;
    DELETE FROM public.planos_originador WHERE id = v_id;

    -- formato: b2w, assinante_conect e chave legada nao entram; percentual > 100 nao entra
    FOREACH v_txt IN ARRAY ARRAY[
        '{"faturas_elegiveis": [1], "regras_multinivel": {"b2w": {"niveis": {"L1": "10", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {"embaixador": {"niveis": {"L1": "10", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
        '{"faturas_elegiveis": [0], "regras_multinivel": {}}',
        '{"faturas_elegiveis": [1], "regras_multinivel": {"ppe": {"niveis": {"L1": "101", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}}}',
        '{"faturas_elegiveis": [1], "regras": {"1": {"ppe": 10}}}'] LOOP
        v_ok := false;
        BEGIN
            INSERT INTO public.planos_originador (nome, start_config, recorrente_config)
            VALUES ('SANDBOX invalido', v_txt::jsonb, '{"regras_multinivel": {}}');
        EXCEPTION WHEN check_violation THEN v_ok := true; END;
        IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): start_config invalido aceito: %', v_txt; END IF;
    END LOOP;
    FOREACH v_txt IN ARRAY ARRAY[
        '{"regras_multinivel": {"assinante_conect": {"niveis": {"L1": "2"}, "max_niveis": 1}}}',
        '{"regras_multinivel": {"b2w": {"niveis": {"L1": "10"}, "max_niveis": 4}}}',
        '{"regras_multinivel": {}, "regras": {"ppe": 5}}',
        '{"regras_multinivel": {"ppe": {"niveis": {"L1": "2"}}}}'] LOOP
        v_ok := false;
        BEGIN
            INSERT INTO public.planos_originador (nome, start_config, recorrente_config)
            VALUES ('SANDBOX invalido', '{"faturas_elegiveis": [], "regras_multinivel": {}}', v_txt::jsonb);
        EXCEPTION WHEN check_violation THEN v_ok := true; END;
        IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): recorrente_config invalido aceito: %', v_txt; END IF;
    END LOOP;

    -- default nos INSERTs: sem a coluna e com NULL explicito -> Padrao
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante)
    VALUES ('SANDBOX sem plano do originador', 'start', 10, 50, 10) RETURNING id INTO v_plano;
    IF (SELECT plano_originador_id FROM public.planos_assinatura_energia WHERE id = v_plano) IS DISTINCT FROM v_padrao.id THEN
        RAISE EXCEPTION 'FALHA (g): plano de assinatura novo nao nasceu no Padrao';
    END IF;
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, plano_originador_id)
    VALUES ('SANDBOX plano null', 'start', 10, 50, 10, NULL) RETURNING id INTO v_plano;
    IF (SELECT plano_originador_id FROM public.planos_assinatura_energia WHERE id = v_plano) IS DISTINCT FROM v_padrao.id THEN
        RAISE EXCEPTION 'FALHA (g): plano de assinatura com plano_originador_id NULL nao caiu no Padrao';
    END IF;
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, plano_originador_id)
    VALUES ('SANDBOX plano rec', 'recorrente', 10, 50, 10, v_recorrente.id) RETURNING id INTO v_plano;
    IF (SELECT plano_originador_id FROM public.planos_assinatura_energia WHERE id = v_plano) IS DISTINCT FROM v_recorrente.id THEN
        RAISE EXCEPTION 'FALHA (g): plano de assinatura perdeu o plano_originador_id informado';
    END IF;

    INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX orig sem plano', 'ppe', true) RETURNING id INTO v_orig;
    IF (SELECT plano_originador_id FROM public.originators_v2 WHERE id = v_orig) IS DISTINCT FROM v_padrao.id THEN
        RAISE EXCEPTION 'FALHA (g): originador novo nao nasceu no Padrao';
    END IF;
    INSERT INTO public.originators_v2 (name, cargo, ativo, plano_originador_id) VALUES ('SANDBOX orig null', 'ppe', true, NULL) RETURNING id INTO v_id;
    IF (SELECT plano_originador_id FROM public.originators_v2 WHERE id = v_id) IS DISTINCT FROM v_padrao.id THEN
        RAISE EXCEPTION 'FALHA (g): originador com plano NULL nao caiu no Padrao';
    END IF;
    -- equipe interna / service role troca o plano
    UPDATE public.originators_v2 SET plano_originador_id = v_recorrente.id WHERE id = v_orig;
    IF (SELECT plano_originador_id FROM public.originators_v2 WHERE id = v_orig) IS DISTINCT FROM v_recorrente.id THEN
        RAISE EXCEPTION 'FALHA (g): service role nao conseguiu trocar o plano do originador';
    END IF;
    -- NULL num UPDATE volta ao Padrao (nao estoura o NOT NULL)
    UPDATE public.originators_v2 SET plano_originador_id = NULL WHERE id = v_orig;
    IF (SELECT plano_originador_id FROM public.originators_v2 WHERE id = v_orig) IS DISTINCT FROM v_padrao.id THEN
        RAISE EXCEPTION 'FALHA (g): UPDATE com plano NULL nao voltou ao Padrao';
    END IF;

    -- o proprio parceiro (sessao dele, papel nao interno) nao troca o plano
    INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
    VALUES (v_user, 'sbx.plano.orig@teste.invalid', '{"name":"SBX"}', 'authenticated', 'authenticated');
    INSERT INTO public.originators_v2 (id, name, email, cargo, ativo) VALUES (v_user, 'SANDBOX dono', 'sbx.plano.orig@teste.invalid', 'ppe', true);
    UPDATE public.profiles SET role = 'originator' WHERE id = v_user;

    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    v_ok := false;
    BEGIN
        UPDATE public.originators_v2 SET plano_originador_id = v_recorrente.id WHERE id = v_user;
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
    -- leitura dos planos liberada para logado; escrita nao
    SELECT count(*) INTO v_n FROM public.planos_originador;
    UPDATE public.planos_originador SET descricao = 'hack' WHERE id = v_padrao.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('role', v_dono, true);
    PERFORM set_config('request.jwt.claims', '', true);

    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (g): o proprio parceiro trocou o Plano do Originador'; END IF;
    IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA (g): usuario nao admin alterou um Plano do Originador (% linha)', v_n; END IF;
    IF (SELECT descricao FROM public.planos_originador WHERE id = v_padrao.id) = 'hack' THEN
        RAISE EXCEPTION 'FALHA (g): RLS deixou o nao admin gravar';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
