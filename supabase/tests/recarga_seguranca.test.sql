-- B2W Charge: recarga so vira paga pelo webhook (service role) e anon nao le
-- nem altera recargas. Cenarios SG-01, SG-02 e RC-10 (parte do banco).
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §2.1
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
DO $$
DECLARE
  v_motor  uuid := gen_random_uuid();   -- motorista cadastrado (dono da recarga 2)
  v_outro  uuid := gen_random_uuid();   -- outro usuario autenticado, nao interno
  v_dono   text := current_user;
  v_posto  uuid;
  v_r1     uuid;                         -- recarga avulsa
  v_r2     uuid;                         -- recarga do motorista cadastrado
  v_pi     text := 'pi_teste_seg_' || replace(gen_random_uuid()::text, '-', '');
  v_ret    uuid;
  v_n      integer;
  v_txt    text;
  v_json   jsonb;
  v_chaves text[];
  v_erro   text;
  v_state  text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_motor, 'motor.recarga@teste.invalid', '{"name":"Motorista"}', 'authenticated', 'authenticated'),
    (v_outro, 'outro.recarga@teste.invalid', '{"name":"Outro"}',     'authenticated', 'authenticated');
  UPDATE public.profiles SET role = 'subscriber' WHERE id IN (v_motor, v_outro);

  INSERT INTO public.eletropostos (nome) VALUES ('Posto recarga seguranca teste') RETURNING id INTO v_posto;

  INSERT INTO public.recargas_eletroposto
    (eletroposto_id, conector_numero, tipo_usuario, motorista_nome, motorista_email, motorista_telefone,
     valor, kwh_estimado, tarifa_kwh_aplicada, stripe_payment_intent_id)
  VALUES (v_posto, 2, 'avulso', 'Fulano Avulso', 'fulano@teste.invalid', '11999990000',
          50, 23.26, 2.15, v_pi)
  RETURNING id INTO v_r1;

  INSERT INTO public.recargas_eletroposto (eletroposto_id, tipo_usuario, user_id, valor)
  VALUES (v_posto, 'cadastrado', v_motor, 30) RETURNING id INTO v_r2;

  -- =====================================================================
  -- 1) anon (chave publica do Supabase)
  -- =====================================================================
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- SG-01: nao marca como paga (sem permissao OU 0 linhas)
  v_state := NULL; v_n := 0;
  BEGIN
    UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_r1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU SG-01: anon marcou % recarga(s) como paga', v_n; END IF;
  IF v_state IS NOT NULL AND v_state <> '42501' THEN RAISE EXCEPTION 'FALHOU SG-01: erro inesperado %', v_state; END IF;

  -- anon nao cria recarga direto na tabela (so a Edge Function, com service role)
  v_state := NULL;
  BEGIN
    INSERT INTO public.recargas_eletroposto (tipo_usuario, valor, status) VALUES ('avulso', 1, 'paid');
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon inseriu recarga (SQLSTATE %)', v_state; END IF;

  -- SG-02: nao le a tabela (sem permissao OU 0 linhas)
  v_state := NULL; v_n := 0;
  BEGIN
    SELECT count(*) INTO v_n FROM public.recargas_eletroposto;
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU SG-02: anon le % recarga(s)', v_n; END IF;
  IF v_state IS NOT NULL AND v_state <> '42501' THEN RAISE EXCEPTION 'FALHOU SG-02: erro inesperado %', v_state; END IF;

  -- SG-02: fn_recarga_publica devolve so o que a tela precisa, sem dados pessoais
  SELECT to_jsonb(r) INTO v_json FROM public.fn_recarga_publica(v_r1) r;
  IF v_json IS NULL THEN RAISE EXCEPTION 'FALHOU SG-02: fn_recarga_publica nao achou a recarga'; END IF;
  SELECT array_agg(k ORDER BY k) INTO v_chaves FROM jsonb_object_keys(v_json) k;
  IF v_chaves IS DISTINCT FROM ARRAY['conector_numero','kwh_consumido','kwh_estimado','nome_posto',
                                     'status','valor','valor_estornado','valor_final'] THEN
    RAISE EXCEPTION 'FALHOU SG-02: fn_recarga_publica devolve as colunas %', v_chaves;
  END IF;
  IF v_json->>'status' <> 'pending_payment' OR (v_json->>'valor')::numeric <> 50
     OR (v_json->>'conector_numero')::int <> 2 OR v_json->>'nome_posto' <> 'Posto recarga seguranca teste' THEN
    RAISE EXCEPTION 'FALHOU SG-02: fn_recarga_publica devolveu %', v_json;
  END IF;

  SELECT count(*) INTO v_n FROM public.fn_recarga_publica(gen_random_uuid());
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fn_recarga_publica com uuid inexistente devolveu % linha(s)', v_n; END IF;

  -- anon nao chama a transicao usada pelo webhook
  v_state := NULL;
  BEGIN
    PERFORM public.fn_marcar_recarga_paga(v_pi);
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon executou fn_marcar_recarga_paga (SQLSTATE %)', v_state; END IF;

  -- =====================================================================
  -- 2) authenticated nao interno
  -- =====================================================================
  PERFORM set_config('role', 'authenticated', true);

  -- motorista cadastrado le a propria recarga e nao a avulsa
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_motor, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.recargas_eletroposto WHERE id IN (v_r1, v_r2);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: motorista enxerga % recarga(s) (esperado 1, a propria)', v_n; END IF;

  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_r2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: motorista marcou a propria recarga como paga'; END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.fn_marcar_recarga_paga(v_pi);
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: authenticated executou fn_marcar_recarga_paga (SQLSTATE %)', v_state; END IF;

  -- outro usuario nao enxerga nada
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.recargas_eletroposto WHERE id IN (v_r1, v_r2);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: usuario alheio enxerga % recarga(s)', v_n; END IF;

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT status INTO v_txt FROM public.recargas_eletroposto WHERE id = v_r2;
  IF v_txt <> 'pending_payment' THEN RAISE EXCEPTION 'FALHOU: recarga do motorista mudou para %', v_txt; END IF;
  SELECT status INTO v_txt FROM public.recargas_eletroposto WHERE id = v_r1;
  IF v_txt <> 'pending_payment' THEN RAISE EXCEPTION 'FALHOU SG-01: recarga avulsa mudou para %', v_txt; END IF;

  -- =====================================================================
  -- 3) RC-10: transicao idempotente (o webhook roda como service role)
  -- =====================================================================
  v_ret := public.fn_marcar_recarga_paga(v_pi);
  IF v_ret IS DISTINCT FROM v_r1 THEN RAISE EXCEPTION 'FALHOU RC-10: 1a entrega devolveu % (esperado %)', v_ret, v_r1; END IF;
  SELECT status INTO v_txt FROM public.recargas_eletroposto WHERE id = v_r1;
  IF v_txt <> 'paid' THEN RAISE EXCEPTION 'FALHOU RC-10: 1a entrega deixou status %', v_txt; END IF;

  v_ret := public.fn_marcar_recarga_paga(v_pi);
  IF v_ret IS NOT NULL THEN RAISE EXCEPTION 'FALHOU RC-10: 2a entrega devolveu % (esperado nulo)', v_ret; END IF;

  -- recarga que ja saiu de pending_payment nao volta a ser paga
  UPDATE public.recargas_eletroposto SET status = 'failed' WHERE id = v_r1;
  v_ret := public.fn_marcar_recarga_paga(v_pi);
  IF v_ret IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: recarga failed virou paga de novo'; END IF;

  v_ret := public.fn_marcar_recarga_paga('pi_inexistente_teste');
  IF v_ret IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: PaymentIntent inexistente devolveu %', v_ret; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
