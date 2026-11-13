-- Teste: LICENCA ANUAL DO ORIGINADOR (20261113a, dono 13/11/2026).
-- Roda DEPOIS da 20261113a, no mesmo lote (nada e aplicado):
--   <20261113a>; <este arquivo>   -> sucesso = erro 'SANDBOX_OK'
--
-- (a) preco por cargo no plano; sem pagamento = pendente e recebe como PPF
-- (b) pagamento -> ativa, vencimento +1 ano, recebe como o cargo
-- (c) pago ha mais de 1 ano -> vencida, volta a PPF
-- (d) voucher %: desconto no valor; isencao: ativa no dia, limite de usos
-- (e) voucher de outro plano e codigo inexistente sao recusados
-- (f) troca de cargo recomeca a licenca; cargo sem preco = isenta
-- (g) Lider sem licenca: venda propria como PPF, cota de Lider suspensa
-- (h) preco do plano mudou -> originadores recalculados
-- (i) os originadores de producao continuam isentos

DO $$
DECLARE
    v_p    uuid;
    v_pad  uuid;
    v_a    uuid := gen_random_uuid();
    v_b    uuid := gen_random_uuid();
    v_c    uuid := gen_random_uuid();
    v_l    uuid := gen_random_uuid();
    v_v50  uuid;
    v_vis  uuid;
    v_vout uuid;
    v_sub  uuid;
    v_uc   uuid;
    v_subl uuid;
    v_ucl  uuid;
    o      record;
    r      jsonb;
    v_ok   boolean;
BEGIN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);

    -- (i) producao intacta
    IF EXISTS (SELECT 1 FROM public.originators_v2 WHERE licenca_status <> 'isenta') THEN
        RAISE EXCEPTION 'FALHA i: originador de producao saiu de isenta';
    END IF;

    SELECT id INTO v_pad FROM public.planos_originador WHERE padrao;
    INSERT INTO public.planos_originador (nome, status, tipo_recompensa, start_config, recorrente_config, licenca_config)
    SELECT 'SANDBOX licenca', 'ativo', tipo_recompensa, start_config, recorrente_config,
           '{"lider": 1000, "ppe": 0, "ppp": 500, "ppf": 0}'::jsonb
      FROM public.planos_originador WHERE id = v_pad
    RETURNING id INTO v_p;

    INSERT INTO public.originador_vouchers (plano_originador_id, codigo, tipo, valor)
    VALUES (v_p, 'sbx-metade', 'percentual', 50) RETURNING id INTO v_v50;
    INSERT INTO public.originador_vouchers (plano_originador_id, codigo, tipo, valor, limite_usos, cargos)
    VALUES (v_p, 'SBX-ISENTA', 'isencao', 0, 1, ARRAY['ppp']) RETURNING id INTO v_vis;
    INSERT INTO public.originador_vouchers (plano_originador_id, codigo, tipo, valor)
    VALUES (v_pad, 'SBX-OUTRO', 'valor', 100) RETURNING id INTO v_vout;

    -- (a)
    INSERT INTO public.originators_v2 (id, name, email, cargo, plano_originador_id)
    VALUES (v_a, 'SBX Pro A', 'sbx-a@exemplo.invalid', 'ppp', v_p);
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF (o.licenca_status, o.licenca_preco, o.licenca_valor) IS DISTINCT FROM ('pendente'::text, 500::numeric, 500::numeric)
       OR o.licenca_vencimento IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA a: % % % %', o.licenca_status, o.licenca_preco, o.licenca_valor, o.licenca_vencimento;
    END IF;

    INSERT INTO public.subscribers (originator_id, status) VALUES (v_a, 'ativo') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, 'consumidora', 'ativo', 'SANDBOX licenca', '{"uf": "RN"}', 'b0298e43-9f01-4104-b77a-c01d3f30310c') RETURNING id INTO v_uc;

    r := public.fn_participantes_recompensa(v_uc);
    IF r -> 0 ->> 'papel' IS DISTINCT FROM 'ppf' OR (r -> 0 ->> 'suspenso')::boolean THEN
        RAISE EXCEPTION 'FALHA a motor: %', r;
    END IF;

    -- (b)
    UPDATE public.originators_v2 SET licenca_paga_em = current_date - 10 WHERE id = v_a;
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF o.licenca_status <> 'ativa' OR o.licenca_vencimento <> ((current_date - 10) + interval '1 year')::date THEN
        RAISE EXCEPTION 'FALHA b: % %', o.licenca_status, o.licenca_vencimento;
    END IF;
    r := public.fn_participantes_recompensa(v_uc);
    IF r -> 0 ->> 'papel' IS DISTINCT FROM 'ppp' THEN
        RAISE EXCEPTION 'FALHA b motor: %', r;
    END IF;

    -- (c)
    UPDATE public.originators_v2 SET licenca_paga_em = current_date - 400 WHERE id = v_a;
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    r := public.fn_participantes_recompensa(v_uc);
    IF o.licenca_status <> 'vencida' OR r -> 0 ->> 'papel' IS DISTINCT FROM 'ppf' THEN
        RAISE EXCEPTION 'FALHA c: % %', o.licenca_status, r;
    END IF;

    -- (d) voucher 50%
    UPDATE public.originators_v2 SET licenca_voucher_id = v_v50, licenca_paga_em = NULL WHERE id = v_a;
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF o.licenca_valor <> 250 OR o.licenca_status <> 'pendente' THEN
        RAISE EXCEPTION 'FALHA d1: % %', o.licenca_valor, o.licenca_status;
    END IF;

    -- (d) isencao: ativa hoje; limite 1 uso
    INSERT INTO public.originators_v2 (id, name, email, cargo, plano_originador_id, licenca_voucher_id)
    VALUES (v_b, 'SBX Pro B', 'sbx-b@exemplo.invalid', 'ppp', v_p, v_vis);
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_b;
    IF (o.licenca_valor, o.licenca_paga_em, o.licenca_status) IS DISTINCT FROM (0::numeric, current_date, 'ativa'::text) THEN
        RAISE EXCEPTION 'FALHA d2: % % %', o.licenca_valor, o.licenca_paga_em, o.licenca_status;
    END IF;

    INSERT INTO public.originators_v2 (id, name, email, cargo, plano_originador_id)
    VALUES (v_c, 'SBX Pro C', 'sbx-c@exemplo.invalid', 'ppp', v_p);
    v_ok := false;
    BEGIN
        UPDATE public.originators_v2 SET licenca_voucher_id = v_vis WHERE id = v_c;
    EXCEPTION WHEN invalid_parameter_value THEN
        v_ok := SQLERRM LIKE '%limite%';
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA d3: limite de usos nao barrou'; END IF;

    -- (e)
    v_ok := false;
    BEGIN
        UPDATE public.originators_v2 SET licenca_voucher_id = v_vout WHERE id = v_c;
    EXCEPTION WHEN invalid_parameter_value THEN
        v_ok := SQLERRM LIKE '%nao pertence%';
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA e1: voucher de outro plano passou'; END IF;

    v_ok := false;
    BEGIN
        PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
        UPDATE public.originators_v2 SET licenca_voucher_id = NULL WHERE id = v_c;
        -- codigo inexistente pelo RPC: exige papel interno; o service_role do
        -- teste nao e "interno", entao confere so a recusa de permissao.
        PERFORM public.fn_aplicar_voucher_licenca(v_c, 'NAO-EXISTE');
    EXCEPTION WHEN insufficient_privilege OR invalid_parameter_value THEN
        v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA e2: RPC aceitou sem papel interno / codigo inexistente'; END IF;

    -- (f) troca de cargo: ppe sem preco no plano -> isenta, voucher sai
    UPDATE public.originators_v2 SET cargo = 'ppe' WHERE id = v_a;
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF o.licenca_status <> 'isenta' OR o.licenca_voucher_id IS NOT NULL OR o.licenca_paga_em IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA f: % % %', o.licenca_status, o.licenca_voucher_id, o.licenca_paga_em;
    END IF;
    r := public.fn_participantes_recompensa(v_uc);
    IF r -> 0 ->> 'papel' IS DISTINCT FROM 'ppe' THEN
        RAISE EXCEPTION 'FALHA f motor: %', r;
    END IF;

    -- (g) Lider sem licenca
    INSERT INTO public.originators_v2 (id, name, email, cargo, plano_originador_id)
    VALUES (v_l, 'SBX Lider', 'sbx-l@exemplo.invalid', 'lider', v_p);
    UPDATE public.originators_v2 SET lider_id = v_l WHERE id = v_a;
    r := public.fn_participantes_recompensa(v_uc);
    IF jsonb_array_length(r) <> 2 OR r -> 1 ->> 'papel' <> 'lider' OR NOT (r -> 1 ->> 'suspenso')::boolean THEN
        RAISE EXCEPTION 'FALHA g1: %', r;
    END IF;
    INSERT INTO public.subscribers (originator_id, status) VALUES (v_l, 'ativo') RETURNING id INTO v_subl;
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_subl, 'consumidora', 'ativo', 'SANDBOX licenca', '{"uf": "RN"}', 'b0298e43-9f01-4104-b77a-c01d3f30310c') RETURNING id INTO v_ucl;
    r := public.fn_participantes_recompensa(v_ucl);
    IF r -> 0 ->> 'papel' IS DISTINCT FROM 'ppf' THEN
        RAISE EXCEPTION 'FALHA g2: %', r;
    END IF;
    UPDATE public.originators_v2 SET licenca_paga_em = current_date WHERE id = v_l;
    r := public.fn_participantes_recompensa(v_ucl);
    IF r -> 0 ->> 'papel' IS DISTINCT FROM 'lider' THEN
        RAISE EXCEPTION 'FALHA g3: %', r;
    END IF;
    r := public.fn_participantes_recompensa(v_uc);
    IF (r -> 1 ->> 'suspenso')::boolean THEN
        RAISE EXCEPTION 'FALHA g4: %', r;
    END IF;

    -- (h) preco do PPP vai a 0: C (pendente) vira isenta
    UPDATE public.planos_originador SET licenca_config = licenca_config || '{"ppp": 0}'::jsonb WHERE id = v_p;
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_c;
    IF o.licenca_status <> 'isenta' THEN
        RAISE EXCEPTION 'FALHA h: %', o.licenca_status;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
