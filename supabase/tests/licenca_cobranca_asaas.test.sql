-- Teste: BOLETO DA LICENCA (20261114a). Roda depois da migracao, no mesmo
-- lote; sucesso = erro 'SANDBOX_OK' (tudo desfeito).
-- (a) pagamento de adesao ativa a licenca na data paga, 1 ano
-- (b) baixa repetida (webhook de novo) e idempotente
-- (c) renovacao paga antes do fim: novo ano comeca no fim do anterior
-- (d) cargo trocado depois do boleto: registra pago, nao ativa
-- (e) um boleto em aberto por originador
-- (f) navegador nao escreve na tabela nem chama a baixa
DO $$
DECLARE
    v_p uuid; v_pad uuid;
    v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
    o record; r jsonb; v_ok boolean;
BEGIN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);

    SELECT id INTO v_pad FROM public.planos_originador WHERE padrao;
    INSERT INTO public.planos_originador (nome, status, tipo_recompensa, start_config, recorrente_config, licenca_config)
    SELECT 'SANDBOX boleto', 'ativo', tipo_recompensa, start_config, recorrente_config, '{"ppp": 500}'::jsonb
      FROM public.planos_originador WHERE id = v_pad RETURNING id INTO v_p;

    INSERT INTO public.originators_v2 (id, name, email, cargo, plano_originador_id)
    VALUES (v_a, 'SBX Boleto A', 'sbx-ba@exemplo.invalid', 'ppp', v_p);

    -- (a)
    INSERT INTO public.originador_licenca_cobrancas (originator_id, tipo, cargo, plano_originador_id, preco, valor, vencimento, asaas_payment_id)
    VALUES (v_a, 'adesao', 'ppp', v_p, 500, 500, current_date + 3, 'pay_sbx_a');
    r := public.fn_licenca_registrar_pagamento('pay_sbx_a', current_date - 2);
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF NOT (r->>'ativou')::boolean OR o.licenca_paga_em <> current_date - 2 OR o.licenca_status <> 'ativa'
       OR o.licenca_vencimento <> ((current_date - 2) + interval '1 year')::date THEN
        RAISE EXCEPTION 'FALHA a: % % % %', r, o.licenca_paga_em, o.licenca_status, o.licenca_vencimento;
    END IF;
    IF (SELECT status FROM public.originador_licenca_cobrancas WHERE asaas_payment_id = 'pay_sbx_a') <> 'pago' THEN
        RAISE EXCEPTION 'FALHA a: cobranca nao ficou paga';
    END IF;

    -- (b)
    r := public.fn_licenca_registrar_pagamento('pay_sbx_a', current_date);
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF NOT (r->>'ja_baixada')::boolean OR o.licenca_paga_em <> current_date - 2 THEN
        RAISE EXCEPTION 'FALHA b: %', r;
    END IF;

    -- (c) licenca vence em 10 dias; renovacao paga hoje comeca no fim
    UPDATE public.originators_v2 SET licenca_paga_em = (current_date + 10 - interval '1 year')::date WHERE id = v_a;
    INSERT INTO public.originador_licenca_cobrancas (originator_id, tipo, cargo, plano_originador_id, preco, valor, vencimento, asaas_payment_id)
    VALUES (v_a, 'renovacao', 'ppp', v_p, 500, 500, current_date + 10, 'pay_sbx_c');
    r := public.fn_licenca_registrar_pagamento('pay_sbx_c', current_date);
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_a;
    IF o.licenca_paga_em <> current_date + 10 OR o.licenca_vencimento <> ((current_date + 10) + interval '1 year')::date
       OR o.licenca_status <> 'ativa' THEN
        RAISE EXCEPTION 'FALHA c: % % %', o.licenca_paga_em, o.licenca_vencimento, o.licenca_status;
    END IF;

    -- (d)
    INSERT INTO public.originators_v2 (id, name, email, cargo, plano_originador_id)
    VALUES (v_b, 'SBX Boleto B', 'sbx-bb@exemplo.invalid', 'ppp', v_p);
    INSERT INTO public.originador_licenca_cobrancas (originator_id, tipo, cargo, plano_originador_id, preco, valor, vencimento, asaas_payment_id)
    VALUES (v_b, 'adesao', 'ppp', v_p, 500, 500, current_date + 3, 'pay_sbx_d');
    UPDATE public.originators_v2 SET cargo = 'ppe' WHERE id = v_b;
    r := public.fn_licenca_registrar_pagamento('pay_sbx_d', current_date);
    SELECT * INTO o FROM public.originators_v2 WHERE id = v_b;
    IF (r->>'ativou')::boolean OR o.licenca_paga_em IS NOT NULL
       OR (SELECT status FROM public.originador_licenca_cobrancas WHERE asaas_payment_id = 'pay_sbx_d') <> 'pago' THEN
        RAISE EXCEPTION 'FALHA d: % %', r, o.licenca_paga_em;
    END IF;

    -- (e)
    INSERT INTO public.originador_licenca_cobrancas (originator_id, tipo, cargo, preco, valor, vencimento)
    VALUES (v_b, 'adesao', 'ppe', 500, 500, current_date + 3);
    v_ok := false;
    BEGIN
        INSERT INTO public.originador_licenca_cobrancas (originator_id, tipo, cargo, preco, valor, vencimento)
        VALUES (v_b, 'adesao', 'ppe', 500, 500, current_date + 3);
    EXCEPTION WHEN unique_violation THEN v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHA e: dois boletos em aberto'; END IF;

    -- (f)
    IF has_table_privilege('authenticated', 'public.originador_licenca_cobrancas', 'INSERT')
       OR has_table_privilege('anon', 'public.originador_licenca_cobrancas', 'SELECT')
       OR has_function_privilege('authenticated', 'public.fn_licenca_registrar_pagamento(text, date)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA f: navegador com acesso de escrita/baixa';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
