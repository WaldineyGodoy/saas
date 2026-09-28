-- Task 2 (Split de Pagamentos): cargos do embaixador, licenca do PPP e
-- arvore de indicacao entre UCs.
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
--
-- Papeis simulados por set_config('role','authenticated') + request.jwt.claims,
-- exatamente como o PostgREST executa a consulta do navegador (ver
-- originators_v2_rls.test.sql, Task 15).
DO $$
DECLARE
  v_emb      uuid := gen_random_uuid();   -- embaixador comum (papel nao interno)
  v_dono     text := current_user;

  v_s1       uuid;                        -- subscribers
  v_s2       uuid;
  v_s3       uuid;

  v_uc1      uuid;                        -- consumer_units
  v_uc2      uuid;
  v_uc3      uuid;
  v_uc4      uuid;                        -- mesmo assinante de v_uc1

  v_orig     uuid;                        -- originator novo (cargo default)
  v_n        integer;
  v_txt      text;
  v_dt       date;
  v_erro     text;
  v_state    text;
BEGIN
  -- ======================================================================
  -- 1) cargo default 'ppf'
  -- ======================================================================
  INSERT INTO public.originators_v2 (name)
  VALUES ('SANDBOX Originador Cargo Default')
  RETURNING id INTO v_orig;

  SELECT cargo INTO v_txt FROM public.originators_v2 WHERE id = v_orig;
  IF v_txt <> 'ppf' THEN
    RAISE EXCEPTION 'FALHOU: cargo default veio "%", esperado ppf', v_txt;
  END IF;

  -- ======================================================================
  -- 2) cargo invalido recusado (CHECK constraint)
  -- ======================================================================
  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.originators_v2 SET cargo = 'gerente' WHERE id = v_orig;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: cargo invalido "gerente" foi aceito'; END IF;
  IF v_state <> '23514' THEN
    RAISE EXCEPTION 'FALHOU: cargo invalido deu SQLSTATE % (esperado 23514 check_violation): %', v_state, v_erro;
  END IF;

  -- ======================================================================
  -- 3) licenca_status derivado do vencimento
  -- ======================================================================
  -- 3a) sem vencimento => isenta
  SELECT licenca_status INTO v_txt FROM public.originators_v2 WHERE id = v_orig;
  IF v_txt <> 'isenta' THEN
    RAISE EXCEPTION 'FALHOU: licenca_status sem vencimento veio "%", esperado isenta', v_txt;
  END IF;

  -- 3b) vencimento futuro => ativa
  UPDATE public.originators_v2
     SET licenca_valor = 199.90, licenca_vencimento = current_date + 30
   WHERE id = v_orig;
  SELECT licenca_status INTO v_txt FROM public.originators_v2 WHERE id = v_orig;
  IF v_txt <> 'ativa' THEN
    RAISE EXCEPTION 'FALHOU: licenca_status com vencimento futuro veio "%", esperado ativa', v_txt;
  END IF;

  -- 3c) vencimento passado => vencida
  UPDATE public.originators_v2
     SET licenca_vencimento = current_date - 1
   WHERE id = v_orig;
  SELECT licenca_status INTO v_txt FROM public.originators_v2 WHERE id = v_orig;
  IF v_txt <> 'vencida' THEN
    RAISE EXCEPTION 'FALHOU: licenca_status com vencimento passado veio "%", esperado vencida', v_txt;
  END IF;

  -- ======================================================================
  -- 4) originador nao interno nao altera o proprio cargo (nem lider_id /
  --    campos de licenca — a mesma guarda de split_commission/short_url)
  -- ======================================================================
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_emb, 'emb.cargo@teste.invalid', '{"name":"Embaixador Cargo"}', 'authenticated', 'authenticated');

  INSERT INTO public.originators_v2 (id, name, email)
  VALUES (v_emb, 'Embaixador Cargo', 'emb.cargo@teste.invalid');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emb, 'role', 'authenticated')::text, true);

  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.originators_v2 SET cargo = 'lider' WHERE id = v_emb;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador alterou o proprio cargo'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: cargo barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.originators_v2 SET lider_id = v_orig WHERE id = v_emb;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador atribuiu o proprio lider_id'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: lider_id barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.originators_v2 SET licenca_vencimento = current_date + 365 WHERE id = v_emb;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador alterou o proprio vencimento de licenca'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: licenca_vencimento barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- volta ao dono (service role / superuser) para o resto do teste
  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- ======================================================================
  -- 5) arvore de indicacao entre UCs: fn_uc_sem_ciclo()
  -- ======================================================================
  INSERT INTO public.subscribers DEFAULT VALUES RETURNING id INTO v_s1;
  INSERT INTO public.subscribers DEFAULT VALUES RETURNING id INTO v_s2;
  INSERT INTO public.subscribers DEFAULT VALUES RETURNING id INTO v_s3;

  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_s1, 'consumidora', 'ativacao') RETURNING id INTO v_uc1;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_s2, 'consumidora', 'ativacao') RETURNING id INTO v_uc2;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_s3, 'consumidora', 'ativacao') RETURNING id INTO v_uc3;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_s1, 'consumidora', 'ativacao') RETURNING id INTO v_uc4; -- mesmo assinante de v_uc1

  -- 5a) propria UC
  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.consumer_units SET indicado_por_uc_id = v_uc1 WHERE id = v_uc1;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: UC foi indicada por ela mesma sem erro'; END IF;
  IF v_state <> '22023' THEN
    RAISE EXCEPTION 'FALHOU: propria-UC deu SQLSTATE % (esperado 22023 invalid_parameter_value): %', v_state, v_erro;
  END IF;

  -- 5b) UC do mesmo assinante
  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.consumer_units SET indicado_por_uc_id = v_uc1 WHERE id = v_uc4;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: UC foi indicada por outra UC do mesmo assinante sem erro'; END IF;
  IF v_state <> '22023' THEN
    RAISE EXCEPTION 'FALHOU: mesmo-assinante deu SQLSTATE % (esperado 22023): %', v_state, v_erro;
  END IF;

  -- Cadeia legitima entre assinantes diferentes: uc2 -> uc1, uc3 -> uc2
  UPDATE public.consumer_units SET indicado_por_uc_id = v_uc1 WHERE id = v_uc2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: cadeia legitima uc2->uc1 foi recusada'; END IF;

  UPDATE public.consumer_units SET indicado_por_uc_id = v_uc2 WHERE id = v_uc3;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: cadeia legitima uc3->uc2 foi recusada'; END IF;

  -- 5c) fechar o ciclo subindo a cadeia: uc1 -> uc3 (uc3->uc2->uc1->uc3)
  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.consumer_units SET indicado_por_uc_id = v_uc3 WHERE id = v_uc1;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: ciclo na cadeia (uc1->uc3->uc2->uc1) nao foi recusado'; END IF;
  IF v_state <> '22023' THEN
    RAISE EXCEPTION 'FALHOU: ciclo na cadeia deu SQLSTATE % (esperado 22023): %', v_state, v_erro;
  END IF;

  -- ======================================================================
  -- 6) backfill: os 8 originadores existentes ficaram em ppf, sem lider_id
  -- ======================================================================
  SELECT count(*) INTO v_n
    FROM public.originators_v2
   WHERE id NOT IN (v_orig, v_emb)
     AND (cargo IS DISTINCT FROM 'ppf' OR lider_id IS NOT NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHOU: % originador(es) pre-existente(s) fora do backfill (cargo <> ppf ou com lider_id)', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.originators_v2
   WHERE id NOT IN (v_orig, v_emb);
  IF v_n <> 8 THEN
    RAISE EXCEPTION 'FALHOU: esperava 8 originadores pre-existentes, achou %', v_n;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
