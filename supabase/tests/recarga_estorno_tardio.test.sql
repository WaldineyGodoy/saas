-- B2W Charge: pagamento que chega depois da falha e recarga paga sem destino viram estorno total.
-- Revisao final (C1, I1). Migracao: supabase/migrations/20261004e_recarga_estorno_tardio.sql
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §5.4, §8.3 (RC-09)
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar no SQL Editor (ou `node scripts/ocpp-local/db.mjs testes-sql`). Qualquer outra mensagem = falha.
-- Depende de 20261004a..e.
DO $$
DECLARE
  v_e      uuid;
  v_c      uuid;
  v_r      uuid;
  v_r2     uuid;
  v_ret    uuid;
  v_t      bigint;
  v_txt    text;
  v_pi     text := 'pi_teste_tardio_' || replace(gen_random_uuid()::text, '-', '');
  v_pi2    text := 'pi_teste_tardio2_' || replace(gen_random_uuid()::text, '-', '');
  v_pi3    text := 'pi_teste_tardio3_' || replace(gen_random_uuid()::text, '-', '');
  v_pi4    text := 'pi_teste_tardio4_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO public.eletropostos (nome) VALUES ('Posto estorno tardio teste') RETURNING id INTO v_e;
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e, 'TARDIO_1') RETURNING id INTO v_c;

  -- =====================================================================
  -- 1) Privilegios: so service_role
  -- =====================================================================
  IF has_function_privilege('anon', 'public.fn_marcar_estorno_pagamento_tardio(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_marcar_estorno_pagamento_tardio(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_marcar_estorno_pagamento_tardio(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: fn_marcar_estorno_pagamento_tardio deve ser executavel so por service_role';
  END IF;
  IF has_function_privilege('anon', 'public.fn_confirmar_inicio(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_confirmar_inicio(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: fn_confirmar_inicio deve continuar so de service_role';
  END IF;

  -- =====================================================================
  -- 2) C1: recarga failed (cartao recusado no codigo antigo) e o motorista paga depois
  -- =====================================================================
  INSERT INTO public.recargas_eletroposto (eletroposto_id, tipo_usuario, valor, status, stripe_payment_intent_id, metadata)
  VALUES (v_e, 'avulso', 30, 'pending_payment', v_pi, '{"nome_posto":"X"}') RETURNING id INTO v_r;
  UPDATE public.recargas_eletroposto SET status = 'failed' WHERE id = v_r;
  IF public.fn_marcar_recarga_paga(v_pi) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: failed nao vira paid'; END IF;

  v_ret := public.fn_marcar_estorno_pagamento_tardio(v_pi);
  IF v_ret IS DISTINCT FROM v_r THEN RAISE EXCEPTION 'FALHOU: pagamento tardio de failed deveria ser marcado (%)', v_ret; END IF;
  SELECT status || '|' || coalesce(valor_final::text, 'nulo') || '|' || coalesce(motivo_fim, 'nulo') || '|'
         || (metadata->>'estorno_total_pendente') || '|' || (metadata->>'nome_posto') || '|' || (finalizada_em IS NOT NULL)::text
    INTO v_txt FROM public.recargas_eletroposto WHERE id = v_r;
  IF v_txt <> 'failed|0.00|pago_apos_falha|true|X|true' THEN
    RAISE EXCEPTION 'FALHOU: marca de estorno total do pagamento tardio errada (%)', v_txt;
  END IF;
  -- reentrega: ja marcada, nada muda
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: reentrega deveria devolver nulo'; END IF;

  -- canceled (checkout liberou a reserva) com motivo proprio: motivo preservado
  INSERT INTO public.recargas_eletroposto (eletroposto_id, tipo_usuario, valor, status, stripe_payment_intent_id)
  VALUES (v_e, 'avulso', 20, 'pending_payment', v_pi2) RETURNING id INTO v_r2;
  UPDATE public.recargas_eletroposto SET status = 'canceled', motivo_fim = 'ConnectionTimeout' WHERE id = v_r2;
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi2) IS DISTINCT FROM v_r2 THEN RAISE EXCEPTION 'FALHOU: canceled pago deveria ser marcado'; END IF;
  IF (SELECT motivo_fim FROM public.recargas_eletroposto WHERE id = v_r2) <> 'ConnectionTimeout' THEN
    RAISE EXCEPTION 'FALHOU: motivo_fim existente nao pode ser sobrescrito';
  END IF;

  -- ja estornada (stripe_refund_id): nao marca de novo
  UPDATE public.recargas_eletroposto
     SET stripe_refund_id = 're_teste', valor_estornado = 20,
         metadata = metadata || '{"estorno_total_pendente": false}'::jsonb
   WHERE id = v_r2;
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi2) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: recarga ja estornada nao pode ser marcada'; END IF;
  IF (SELECT metadata->>'estorno_total_pendente' FROM public.recargas_eletroposto WHERE id = v_r2) <> 'false' THEN
    RAISE EXCEPTION 'FALHOU: marca de recarga estornada nao pode voltar a true';
  END IF;

  -- failed com transacao OCPP (houve energia): fora do estorno total automatico
  INSERT INTO public.recargas_eletroposto (eletroposto_id, tipo_usuario, valor, status, stripe_payment_intent_id)
  VALUES (v_e, 'avulso', 20, 'pending_payment', v_pi3) RETURNING id INTO v_r2;
  INSERT INTO public.ocpp_transacoes (carregador_id, connector_id, id_tag, meter_start_wh, inicio_em, chave_idempotencia, recarga_id)
  VALUES (v_c, 1, 'TAGTARDIO', 0, now(), 'tardio|' || v_r2::text, v_r2) RETURNING id INTO v_t;
  UPDATE public.recargas_eletroposto SET status = 'failed', ocpp_transacao_id = v_t WHERE id = v_r2;
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi3) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: recarga com transacao nao pode ser marcada'; END IF;

  -- outros status (pending_payment, paid, completed) e PI desconhecido: nulo, nada muda
  INSERT INTO public.recargas_eletroposto (eletroposto_id, tipo_usuario, valor, status, stripe_payment_intent_id)
  VALUES (v_e, 'avulso', 20, 'pending_payment', v_pi4) RETURNING id INTO v_r2;
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi4) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: pending_payment nao e pagamento tardio'; END IF;
  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_r2;
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi4) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: paid nao e pagamento tardio'; END IF;
  IF public.fn_marcar_estorno_pagamento_tardio('pi_inexistente_tardio') IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: PI desconhecido'; END IF;
  IF (SELECT metadata ? 'estorno_total_pendente' FROM public.recargas_eletroposto WHERE id = v_r2) THEN
    RAISE EXCEPTION 'FALHOU: recarga paid nao pode ganhar marca';
  END IF;

  -- =====================================================================
  -- 3) I1: recarga paid sem destino (checkout antigo) -> failed + estorno total, 'sem_destino'
  -- =====================================================================
  -- v_r2 esta paid e sem carregador_id/ocpp_connector_id
  v_txt := public.fn_confirmar_inicio(v_r2, 10);
  IF v_txt <> 'sem_destino' THEN RAISE EXCEPTION 'FALHOU: paid sem destino deveria dar sem_destino (%)', v_txt; END IF;
  SELECT status || '|' || coalesce(valor_final::text, 'nulo') || '|' || coalesce(motivo_fim, 'nulo') || '|'
         || (metadata->>'estorno_total_pendente') || '|' || (finalizada_em IS NOT NULL)::text
    INTO v_txt FROM public.recargas_eletroposto WHERE id = v_r2;
  IF v_txt <> 'failed|0.00|sem_destino|true|true' THEN RAISE EXCEPTION 'FALHOU: sem destino deveria virar failed com estorno total (%)', v_txt; END IF;
  -- reentrega: ja nao esta paid
  IF public.fn_confirmar_inicio(v_r2, 10) <> 'ignorada' THEN RAISE EXCEPTION 'FALHOU: reentrega sem destino deveria ser ignorada'; END IF;
  -- e o pagamento tardio nao marca de novo (ja marcada)
  IF public.fn_marcar_estorno_pagamento_tardio(v_pi4) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: ja marcada nao repete'; END IF;

  -- sem destino e fora de paid: ignorada, nada muda
  IF public.fn_confirmar_inicio(v_r, 10) <> 'ignorada' THEN RAISE EXCEPTION 'FALHOU: failed sem destino deveria ser ignorada'; END IF;
  IF public.fn_confirmar_inicio(gen_random_uuid(), 10) <> 'ignorada' THEN RAISE EXCEPTION 'FALHOU: recarga inexistente'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
