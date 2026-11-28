-- Teste: CONTA EM RAMPA (20261127a).
-- Spec: docs/superpowers/specs/2026-11-26-conta-em-rampa-design.md
--
-- Roda DEPOIS de 20261127a, no mesmo BEGIN/ROLLBACK (nada e aplicado):
--   BEGIN; <20261127a>; <este arquivo>; ROLLBACK;
-- Sucesso = erro 'SANDBOX_OK'.
--
-- (a) primeira carga em rampa (caso Bem Potiguar): franquia, base e sugestao 3467,
--     mediana 599, dias gravados, preenchimento 'rampa'.
-- (b) conta mensal (gatilho em invoices) com dias pela data de leitura: sai da
--     rampa, franquia e base NAO mudam, sugestao 4334; preenchimento volta a 'mediana'.
-- (c) conta seguinte no mesmo regime: sugestao pendente fica, regime_desde nao muda.
-- (d) aplicar: anon e barrado; equipe aplica e a sugestao some.
-- (e) em_queda pela conta mensal: sugere a janela, franquia nao muda.
-- (f) volta ao estavel depois da queda: a sugestao de queda some.
-- (g) recarga de UC com historico entrando em rampa: so sugere.
-- (h) termo aditivo em rampa: franquia assinada NAO muda, so a sugestao.
-- (i) primeira carga fora da rampa: franquia do cadastro fica, sem sugestao.

DO $t$
DECLARE
    c_rampa constant jsonb := '[
      {"mes":"2026-08","kwh":4334,"dias":30},{"mes":"2026-07","kwh":869,"dias":33},
      {"mes":"2026-06","kwh":329,"dias":29},{"mes":"2026-05","kwh":100,"dias":20}]';
    v_sub   uuid;
    v_uc    uuid;
    v_uc2   uuid;
    v_lead  uuid;
    v_plano uuid;
    v_r     jsonb;
    v_ok    boolean;
    cu      record;
BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SELECT id INTO v_plano FROM public.planos_assinatura_energia LIMIT 1;

    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://rampa/a') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, concessionaria, address, franquia, plano_assinatura_id)
    VALUES (v_sub, 'consumidora', 'ativo', 'SANDBOX RAMPA conc', '{"uf": "RN"}', 599, v_plano) RETURNING id INTO v_uc;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, concessionaria, address, franquia, plano_assinatura_id)
    VALUES (v_sub, 'consumidora', 'ativo', 'SANDBOX RAMPA conc', '{"uf": "RN"}', 1010, v_plano) RETURNING id INTO v_uc2;

    -- ================================================================== (a)
    v_r := public.fn_historico_consumo_gravar_uc(v_uc, c_rampa, 'cadastro');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc;
    IF cu.regime_consumo IS DISTINCT FROM 'em_rampa' OR cu.franquia IS DISTINCT FROM 3467
       OR cu.start_base_kwh IS DISTINCT FROM 3467 OR cu.franquia_sugerida IS DISTINCT FROM 3467
       OR cu.consumo_mediano_kwh IS DISTINCT FROM 599 OR cu.regime_desde IS NULL THEN
        RAISE EXCEPTION 'FALHA (a): % % % % % %', cu.regime_consumo, cu.franquia, cu.start_base_kwh,
            cu.franquia_sugerida, cu.consumo_mediano_kwh, cu.regime_desde;
    END IF;
    IF (cu.historico_consumo #>> '{08,dias}')::numeric IS DISTINCT FROM 30
       OR cu.historico_consumo #>> '{11,origem}' IS DISTINCT FROM 'rampa'
       OR (cu.historico_consumo #>> '{11,kwh}')::numeric IS DISTINCT FROM 3467 THEN
        RAISE EXCEPTION 'FALHA (a): perfil %', cu.historico_consumo;
    END IF;
    IF v_r ->> 'regime' IS DISTINCT FROM 'em_rampa' OR (v_r ->> 'franquia_sugerida')::numeric IS DISTINCT FROM 3467 THEN
        RAISE EXCEPTION 'FALHA (a): retorno %', v_r;
    END IF;

    -- ================================================================== (b)
    UPDATE public.consumer_units SET regime_desde = '2020-01-01' WHERE id = v_uc;
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado,
                                 consumo_kwh, mes_referencia, data_leitura, data_leitura_anterior)
    VALUES (v_uc, 'a_vencer', 0, 0, CURRENT_DATE + 5, 0, 4400, DATE '2026-09-01', DATE '2026-09-30', DATE '2026-08-31');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc;
    IF cu.regime_consumo IS DISTINCT FROM 'estavel' OR cu.franquia IS DISTINCT FROM 3467
       OR cu.start_base_kwh IS DISTINCT FROM 3467 OR cu.franquia_sugerida IS DISTINCT FROM 4334
       OR cu.regime_desde = '2020-01-01'::timestamptz THEN
        RAISE EXCEPTION 'FALHA (b): % % % % %', cu.regime_consumo, cu.franquia, cu.start_base_kwh, cu.franquia_sugerida, cu.regime_desde;
    END IF;
    IF cu.historico_consumo -> '09' IS DISTINCT FROM '{"kwh": 4400, "ref": "2026-09", "origem": "conta", "dias": 30}'::jsonb
       OR cu.historico_consumo #>> '{11,origem}' IS DISTINCT FROM 'mediana' THEN
        RAISE EXCEPTION 'FALHA (b): perfil %', cu.historico_consumo;
    END IF;

    -- ================================================================== (c)
    UPDATE public.consumer_units SET regime_desde = '2020-01-01' WHERE id = v_uc;
    -- sem datas de leitura: o mes entra sem dias
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, consumo_kwh, mes_referencia)
    VALUES (v_uc, 'a_vencer', 0, 0, CURRENT_DATE + 5, 0, 4380, DATE '2026-10-01');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc;
    IF cu.regime_consumo IS DISTINCT FROM 'estavel' OR cu.franquia_sugerida IS DISTINCT FROM 4334
       OR cu.franquia IS DISTINCT FROM 3467 OR cu.regime_desde IS DISTINCT FROM '2020-01-01'::timestamptz
       OR cu.historico_consumo -> '10' IS DISTINCT FROM '{"kwh": 4380, "ref": "2026-10", "origem": "conta"}'::jsonb THEN
        RAISE EXCEPTION 'FALHA (c): % % % % %', cu.regime_consumo, cu.franquia_sugerida, cu.franquia, cu.regime_desde, cu.historico_consumo -> '10';
    END IF;

    -- ================================================================== (d)
    v_ok := false;
    BEGIN
        SET LOCAL ROLE anon;
        PERFORM public.fn_aplicar_franquia_sugerida(v_uc);
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA (d): anon aplicou a franquia sugerida'; END IF;
    IF has_function_privilege('anon', 'public.fn_aplicar_franquia_sugerida(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_historico_consumo_recalcular(uuid,jsonb,boolean,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_historico_consumo_gravar_uc(uuid,jsonb,text,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA (d): permissao indevida nas funcoes novas';
    END IF;
    IF public.fn_aplicar_franquia_sugerida(v_uc) IS DISTINCT FROM 4334 THEN RAISE EXCEPTION 'FALHA (d): aplicar'; END IF;
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc;
    IF cu.franquia IS DISTINCT FROM 4334 OR cu.franquia_sugerida IS NOT NULL OR cu.start_base_kwh IS DISTINCT FROM 3467 THEN
        RAISE EXCEPTION 'FALHA (d): depois de aplicar % % %', cu.franquia, cu.franquia_sugerida, cu.start_base_kwh;
    END IF;

    -- ================================================================== (e)
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, consumo_kwh, mes_referencia)
    VALUES (v_uc, 'a_vencer', 0, 0, CURRENT_DATE + 5, 0, 1000, DATE '2026-11-01');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc;
    IF cu.regime_consumo IS DISTINCT FROM 'em_queda' OR cu.franquia_sugerida IS DISTINCT FROM 4380
       OR cu.franquia IS DISTINCT FROM 4334 THEN
        RAISE EXCEPTION 'FALHA (e): % % %', cu.regime_consumo, cu.franquia_sugerida, cu.franquia;
    END IF;

    -- ================================================================== (f)
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado, consumo_kwh, mes_referencia)
    VALUES (v_uc, 'a_vencer', 0, 0, CURRENT_DATE + 5, 0, 4300, DATE '2026-12-01');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc;
    IF cu.regime_consumo IS DISTINCT FROM 'estavel' OR cu.franquia_sugerida IS NOT NULL OR cu.franquia IS DISTINCT FROM 4334 THEN
        RAISE EXCEPTION 'FALHA (f): % % %', cu.regime_consumo, cu.franquia_sugerida, cu.franquia;
    END IF;

    -- ================================================================== (i) e (g)
    v_r := public.fn_historico_consumo_gravar_uc(v_uc2,
        '[{"mes":"2026-06","kwh":1000,"dias":30},{"mes":"2026-07","kwh":1050,"dias":30},{"mes":"2026-08","kwh":980,"dias":30}]', 'cadastro');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc2;
    IF cu.regime_consumo IS DISTINCT FROM 'estavel' OR cu.franquia IS DISTINCT FROM 1010
       OR cu.start_base_kwh IS DISTINCT FROM 1000 OR cu.franquia_sugerida IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA (i): % % % %', cu.regime_consumo, cu.franquia, cu.start_base_kwh, cu.franquia_sugerida;
    END IF;
    v_r := public.fn_historico_consumo_gravar_uc(v_uc2, '[{"mes":"2026-09","kwh":2600,"dias":30}]', 'cadastro');
    SELECT * INTO cu FROM public.consumer_units WHERE id = v_uc2;
    IF cu.regime_consumo IS DISTINCT FROM 'em_rampa' OR cu.franquia IS DISTINCT FROM 1010
       OR cu.start_base_kwh IS DISTINCT FROM 1000 OR cu.franquia_sugerida IS DISTINCT FROM 2080
       OR cu.historico_consumo #>> '{11,origem}' IS DISTINCT FROM 'rampa' THEN
        RAISE EXCEPTION 'FALHA (g): % % % % %', cu.regime_consumo, cu.franquia, cu.start_base_kwh, cu.franquia_sugerida, cu.historico_consumo;
    END IF;

    -- ================================================================== (h)
    INSERT INTO public.subscribers (status, short_url, name) VALUES ('ativo', 'sandbox://rampa/h', 'SANDBOX RAMPA titular') RETURNING id INTO v_sub;
    INSERT INTO public.leads (solicitante_assinante_id, conta_lida, plano_id)
    VALUES (v_sub, jsonb_build_object('numeroUc', 'SBX-RAMPA-ADT-0001', 'titular', 'SANDBOX RAMPA titular',
                'ligacao', 'monofasico', 'concessionaria', 'SANDBOX RAMPA conc', 'mediaKwh', '1000',
                'historico', c_rampa,
                'endereco', jsonb_build_object('cep', '59000000', 'logradouro', 'Rua A, 10', 'bairro', 'B', 'cidade', 'C', 'uf', 'rn')),
            v_plano)
    RETURNING id INTO v_lead;
    v_r := public.fn_criar_uc_do_aditivo(v_lead);
    IF (v_r ->> 'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALHA (h): aditivo %', v_r; END IF;
    SELECT * INTO cu FROM public.consumer_units WHERE id = (v_r ->> 'uc_id')::uuid;
    IF cu.regime_consumo IS DISTINCT FROM 'em_rampa' OR cu.franquia IS DISTINCT FROM 1000
       OR cu.franquia_sugerida IS DISTINCT FROM 3467 OR cu.start_base_kwh IS DISTINCT FROM 3467 THEN
        RAISE EXCEPTION 'FALHA (h): % % % %', cu.regime_consumo, cu.franquia, cu.franquia_sugerida, cu.start_base_kwh;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $t$;
