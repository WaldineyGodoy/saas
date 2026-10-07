-- OCPP (Tarefa 2): carregador, conector, idTag, transacao, medicao, comandos,
-- trilha de frames, maquina de status da recarga, tarifa ao motorista e RLS.
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §4
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
-- Depende de 20261007a_recarga_seguranca.sql.
DO $$
DECLARE
  v_adm      uuid := gen_random_uuid();   -- admin (papel interno)
  v_forn_usr uuid := gen_random_uuid();   -- usuario do fornecedor A (eletroposto 1)
  v_outro    uuid := gen_random_uuid();   -- usuario do fornecedor X (eletroposto 2)
  v_dono     text := current_user;
  v_sup_a    uuid;
  v_sup_x    uuid;
  v_plano    uuid;
  v_e1       uuid;
  v_e2       uuid;
  v_c1       uuid;                         -- carregador do eletroposto 1
  v_c2       uuid;                         -- carregador do eletroposto 2
  v_t1       bigint;
  v_t2       bigint;
  v_r        uuid;
  v_cmd      uuid;
  v_n        integer;
  v_txt      text;
  v_ts       timestamptz := '2026-10-04 12:00:00+00';
  v_erro     text;
  v_state    text;
  v_tab      text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_adm,      'adm.ocpp@teste.invalid',   '{"name":"Admin"}',        'authenticated', 'authenticated'),
    (v_forn_usr, 'forn.ocpp@teste.invalid',  '{"name":"Fornecedor A"}', 'authenticated', 'authenticated'),
    (v_outro,    'outro.ocpp@teste.invalid', '{"name":"Fornecedor X"}', 'authenticated', 'authenticated');
  UPDATE public.profiles SET role = 'admin'    WHERE id = v_adm;
  UPDATE public.profiles SET role = 'supplier' WHERE id IN (v_forn_usr, v_outro);

  INSERT INTO public.suppliers (name, profile_id) VALUES ('Forn A ocpp teste', v_forn_usr) RETURNING id INTO v_sup_a;
  INSERT INTO public.suppliers (name, profile_id) VALUES ('Forn X ocpp teste', v_outro)    RETURNING id INTO v_sup_x;

  INSERT INTO public.eletropostos (nome) VALUES ('Eletroposto ocpp teste 1') RETURNING id INTO v_e1;
  INSERT INTO public.eletropostos (nome) VALUES ('Eletroposto ocpp teste 2') RETURNING id INTO v_e2;
  INSERT INTO public.eletroposto_fornecedores (eletroposto_id, supplier_id, percentual) VALUES
    (v_e1, v_sup_a, 100), (v_e2, v_sup_x, 100);

  -- =====================================================================
  -- 1) Tarifa ao motorista no plano de eletroposto (spec §4.9)
  -- =====================================================================
  INSERT INTO public.planos_assinatura_energia (nome, recorrente_config, tarifa_motorista_kwh)
  VALUES ('Plano eletro ocpp teste', '{"categoria_plano":"eletroposto"}'::jsonb, 1.9900) RETURNING id INTO v_plano;

  v_state := NULL;
  BEGIN
    UPDATE public.planos_assinatura_energia SET tarifa_motorista_kwh = 0 WHERE id = v_plano;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: tarifa ao motorista 0 deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 2) Carregador: ocpp_id valido e unico
  -- =====================================================================
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id, senha_hash)
  VALUES (v_e1, 'CP_EMU-01', 'scrypt$teste') RETURNING id INTO v_c1;
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id)
  VALUES (v_e2, 'CP_EMU_02') RETURNING id INTO v_c2;

  SELECT estado_registro || '|' || online::text || '|' || heartbeat_intervalo_s INTO v_txt
    FROM public.eletroposto_carregadores WHERE id = v_c1;
  IF v_txt <> 'pendente|false|60' THEN RAISE EXCEPTION 'FALHOU: padroes do carregador %', v_txt; END IF;

  FOREACH v_txt IN ARRAY ARRAY['CP 01', '', 'CP/01', repeat('A', 49)] LOOP
    v_state := NULL;
    BEGIN
      INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e1, v_txt);
    EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
    END;
    IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: ocpp_id "%" deu % (esperado 23514): %', v_txt, v_state, v_erro; END IF;
  END LOOP;

  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e1, repeat('A', 48));

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e2, 'CP_EMU-01');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: ocpp_id repetido deu % (esperado 23505): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 3) Conector: (carregador, connector_id) unico, enums do 1.6
  -- =====================================================================
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c1, 0), (v_c1, 1), (v_c2, 1);

  SELECT status || '|' || error_code || '|' || bloqueado_ate_reset::text INTO v_txt
    FROM public.eletroposto_conectores WHERE carregador_id = v_c1 AND connector_id = 1;
  IF v_txt <> 'Unavailable|NoError|false' THEN RAISE EXCEPTION 'FALHOU: padroes do conector %', v_txt; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c1, 1);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: conector repetido deu % (esperado 23505): %', v_state, v_erro; END IF;

  UPDATE public.eletroposto_conectores SET status = 'Faulted', error_code = 'GroundFailure'
   WHERE carregador_id = v_c1 AND connector_id = 1;

  v_state := NULL;
  BEGIN
    UPDATE public.eletroposto_conectores SET status = 'Livre' WHERE carregador_id = v_c1 AND connector_id = 1;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: status fora do 1.6 deu % (esperado 23514): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    UPDATE public.eletroposto_conectores SET error_code = 'Quebrado' WHERE carregador_id = v_c1 AND connector_id = 1;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: errorCode fora do 1.6 deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 4) idTag: maximo 20 caracteres (CiString20Type)
  -- =====================================================================
  INSERT INTO public.ocpp_id_tags (id_tag) VALUES ('RCABCDEFGHIJKLMNOPQR');   -- 20

  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_id_tags (id_tag) VALUES ('RCABCDEFGHIJKLMNOPQRS');  -- 21
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: idTag de 21 deu % (esperado 23514): %', v_state, v_erro; END IF;

  SELECT status INTO v_txt FROM public.ocpp_id_tags WHERE id_tag = 'RCABCDEFGHIJKLMNOPQR';
  IF v_txt <> 'Accepted' THEN RAISE EXCEPTION 'FALHOU: idTag nasce %', v_txt; END IF;

  -- =====================================================================
  -- 5) Transacao: id inteiro, chave de idempotencia unica (RS-03)
  -- =====================================================================
  INSERT INTO public.ocpp_transacoes (carregador_id, connector_id, id_tag, meter_start_wh, inicio_em, chave_idempotencia)
  VALUES (v_c1, 1, 'RCABCDEFGHIJKLMNOPQR', 1000, v_ts, 'k1') RETURNING id INTO v_t1;
  INSERT INTO public.ocpp_transacoes (carregador_id, connector_id, id_tag, meter_start_wh, inicio_em, chave_idempotencia)
  VALUES (v_c2, 1, 'RCOUTRA', 0, v_ts, 'k2') RETURNING id INTO v_t2;

  SELECT data_type INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ocpp_transacoes' AND column_name = 'id';
  IF v_txt <> 'bigint' THEN RAISE EXCEPTION 'FALHOU: transactionId e % (esperado inteiro bigint)', v_txt; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_transacoes (carregador_id, connector_id, id_tag, meter_start_wh, inicio_em, chave_idempotencia)
    VALUES (v_c1, 1, 'RCABCDEFGHIJKLMNOPQR', 1000, v_ts, 'k1');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: StartTransaction repetido deu % (esperado 23505): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    UPDATE public.ocpp_transacoes SET motivo_parada = 'Cansou' WHERE id = v_t1;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: Reason fora do 1.6 deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 6) Medicao: reenvio apos queda nao duplica (RS-01)
  -- =====================================================================
  INSERT INTO public.ocpp_medicoes (transacao_id, connector_id, medido_em, measurand, valor, unidade)
  VALUES (v_t1, 1, v_ts, 'Energy.Active.Import.Register', 1500, 'Wh')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.ocpp_medicoes (transacao_id, connector_id, medido_em, measurand, valor, unidade)
  VALUES (v_t1, 1, v_ts, 'Energy.Active.Import.Register', 1500, 'Wh')
  ON CONFLICT (transacao_id, medido_em, measurand, phase) DO NOTHING;
  SELECT count(*) INTO v_n FROM public.ocpp_medicoes WHERE transacao_id = v_t1;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU RS-01: medicao repetida virou % linha(s)', v_n; END IF;

  -- fase diferente e outra medicao
  INSERT INTO public.ocpp_medicoes (transacao_id, connector_id, medido_em, measurand, phase, valor, unidade)
  VALUES (v_t1, 1, v_ts, 'Energy.Active.Import.Register', 'L1', 500, 'Wh') ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_n FROM public.ocpp_medicoes WHERE transacao_id = v_t1;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: medicao da fase L1 nao entrou (% linhas)', v_n; END IF;

  INSERT INTO public.ocpp_medicoes (transacao_id, connector_id, medido_em, valor, unidade)
  VALUES (v_t2, 1, v_ts, 10, 'Wh');

  -- =====================================================================
  -- 7) Comandos: chave de idempotencia unica (RC-10), padroes da fila
  -- =====================================================================
  INSERT INTO public.ocpp_comandos (carregador_id, acao, payload, chave_idempotencia)
  VALUES (v_c1, 'RemoteStartTransaction', '{"connectorId":1,"idTag":"RCABCDEFGHIJKLMNOPQR"}', 'start:teste')
  RETURNING id INTO v_cmd;

  SELECT status || '|' || tentativas INTO v_txt FROM public.ocpp_comandos WHERE id = v_cmd;
  IF v_txt <> 'pendente|0' THEN RAISE EXCEPTION 'FALHOU: comando nasce %', v_txt; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_comandos
   WHERE id = v_cmd AND expira_em BETWEEN now() + interval '119 seconds' AND now() + interval '121 seconds'
     AND proxima_tentativa_em <= now();
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: comando nao expira em 2 min ou nao esta pronto para envio'; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_comandos (carregador_id, acao, chave_idempotencia) VALUES (v_c1, 'RemoteStartTransaction', 'start:teste');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU RC-10: comando repetido deu % (esperado 23505): %', v_state, v_erro; END IF;

  -- comando de operador (sem chave) pode repetir
  INSERT INTO public.ocpp_comandos (carregador_id, acao, payload) VALUES (v_c1, 'Reset', '{"type":"Hard"}'), (v_c1, 'Reset', '{"type":"Hard"}');

  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_comandos (carregador_id, acao) VALUES (v_c1, 'SetChargingProfile');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: acao fora do escopo deu % (esperado 23514): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    UPDATE public.ocpp_comandos SET status = 'perdido' WHERE id = v_cmd;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: status de comando invalido deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 8) Trilha de frames (inclui recusa de handshake sem carregador: CP-02)
  -- =====================================================================
  INSERT INTO public.ocpp_mensagens (carregador_id, ocpp_id, direcao, tipo, unique_id, acao, payload)
  VALUES (v_c1, 'CP_EMU-01', 'entrada', 2, 'u1', 'BootNotification', '{}');
  INSERT INTO public.ocpp_mensagens (ocpp_id, direcao, acao) VALUES ('CP_DESCONHECIDO', 'entrada', 'handshake_recusado');

  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_mensagens (ocpp_id, direcao, tipo) VALUES ('CP_EMU-01', 'entrada', 5);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: tipo de frame 5 deu % (esperado 23514): %', v_state, v_erro; END IF;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'ocpp-mensagens-limpeza' AND command ILIKE '%30 days%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: cron de limpeza da trilha (30 dias) nao agendado'; END IF;

  SELECT count(*) INTO v_n FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ocpp_comandos';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: ocpp_comandos fora da publicacao do Realtime'; END IF;

  -- =====================================================================
  -- 9) Recarga: maquina de status (spec §4.8) e colunas novas
  -- =====================================================================
  INSERT INTO public.recargas_eletroposto (eletroposto_id, tipo_usuario, valor) VALUES (v_e1, 'avulso', 50) RETURNING id INTO v_r;

  v_state := NULL;
  BEGIN
    UPDATE public.recargas_eletroposto SET status = 'charging' WHERE id = v_r;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: pending_payment -> charging deu % (esperado 23514): %', v_state, v_erro; END IF;
  IF v_erro NOT ILIKE '%pending_payment%charging%' THEN RAISE EXCEPTION 'FALHOU: mensagem da transicao pouco clara: %', v_erro; END IF;

  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_r;
  UPDATE public.recargas_eletroposto SET status = 'starting', ocpp_id_tag = 'RCABCDEFGHIJKLMNOPQR' WHERE id = v_r;
  UPDATE public.recargas_eletroposto
     SET status = 'charging', ocpp_transacao_id = v_t1, kwh_limite = 25.12, iniciada_em = v_ts WHERE id = v_r;
  -- mudar outras colunas sem mudar o status nao passa pela maquina
  UPDATE public.recargas_eletroposto SET kwh_consumido = 10.5 WHERE id = v_r;
  UPDATE public.recargas_eletroposto
     SET status = 'completed', valor_final = 21.50, valor_estornado = 28.50, stripe_refund_id = 're_teste',
         finalizada_em = v_ts + interval '1 hour', motivo_fim = 'Remote'
   WHERE id = v_r;

  v_state := NULL;
  BEGIN
    UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_r;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: completed -> paid deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- updated_at automatico
  UPDATE public.recargas_eletroposto SET updated_at = '2000-01-01' WHERE id = v_r;
  UPDATE public.recargas_eletroposto SET motivo_fim = 'Remote.' WHERE id = v_r;
  SELECT count(*) INTO v_n FROM public.recargas_eletroposto WHERE id = v_r AND updated_at > '2001-01-01';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: updated_at da recarga nao foi atualizado'; END IF;

  -- =====================================================================
  -- 10) RLS
  -- =====================================================================
  -- 10a) anon: nada
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  FOREACH v_tab IN ARRAY ARRAY['eletroposto_carregadores', 'eletroposto_conectores', 'ocpp_id_tags',
                               'ocpp_transacoes', 'ocpp_medicoes', 'ocpp_comandos', 'ocpp_mensagens'] LOOP
    v_state := NULL; v_n := 0;
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tab) INTO v_n;
    EXCEPTION WHEN others THEN v_state := SQLSTATE;
    END;
    IF v_n <> 0 OR (v_state IS NOT NULL AND v_state <> '42501') THEN
      RAISE EXCEPTION 'FALHOU: anon le % (% linhas, SQLSTATE %)', v_tab, v_n, v_state;
    END IF;
  END LOOP;

  PERFORM set_config('role', 'authenticated', true);

  -- 10b) fornecedor A: le o que e do eletroposto 1, nada do 2, nada de token/fila/trilha
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_forn_usr, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.eletroposto_carregadores WHERE id IN (v_c1, v_c2);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga % carregador(es) (esperado 1)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.eletroposto_carregadores WHERE id = v_c2;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga carregador de outro eletroposto'; END IF;
  SELECT count(*) INTO v_n FROM public.eletroposto_conectores WHERE carregador_id IN (v_c1, v_c2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga % conector(es) (esperado 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_transacoes WHERE id IN (v_t1, v_t2);
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga % transacao(oes) (esperado 1)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_medicoes WHERE transacao_id IN (v_t1, v_t2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: fornecedor A enxerga % medicao(oes) (esperado 2)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_id_tags;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor enxerga % idTag(s)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_comandos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor enxerga % comando(s)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_mensagens;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor enxerga % frame(s)', v_n; END IF;

  v_state := NULL;
  BEGIN
    SELECT senha_hash INTO v_txt FROM public.eletroposto_carregadores WHERE id = v_c1;
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: fornecedor leu senha_hash (SQLSTATE %)', v_state; END IF;

  UPDATE public.eletroposto_carregadores SET online = true WHERE id = v_c1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: fornecedor alterou o carregador'; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_comandos (carregador_id, acao) VALUES (v_c1, 'Reset');
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: fornecedor enfileirou comando (SQLSTATE %)', v_state; END IF;

  -- 10c) admin: le tudo, cadastra carregador e manda comando; nao le a senha
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.eletroposto_carregadores WHERE id IN (v_c1, v_c2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: admin enxerga % dos 2 carregadores', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_mensagens WHERE ocpp_id IN ('CP_EMU-01', 'CP_DESCONHECIDO');
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: admin enxerga % dos 2 frames', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.ocpp_id_tags WHERE id_tag = 'RCABCDEFGHIJKLMNOPQR';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao enxerga o idTag'; END IF;

  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e2, 'CP_ADMIN_01');
  INSERT INTO public.ocpp_comandos (carregador_id, acao, payload) VALUES (v_c2, 'Reset', '{"type":"Soft"}');

  v_state := NULL;
  BEGIN
    SELECT senha_hash INTO v_txt FROM public.eletroposto_carregadores WHERE id = v_c1;
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: admin leu senha_hash (SQLSTATE %)', v_state; END IF;

  -- admin nao forja medicao nem transacao (so o CSMS grava)
  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_medicoes (transacao_id, connector_id, medido_em, valor, unidade) VALUES (v_t1, 1, now(), 1, 'Wh');
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: admin gravou medicao (SQLSTATE %)', v_state; END IF;

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- =====================================================================
  -- 11) Excluir o eletroposto leva carregadores e conectores junto
  -- =====================================================================
  DELETE FROM public.ocpp_comandos WHERE carregador_id = v_c2;
  DELETE FROM public.ocpp_medicoes WHERE transacao_id = v_t2;
  DELETE FROM public.ocpp_transacoes WHERE id = v_t2;
  DELETE FROM public.eletropostos WHERE id = v_e2;
  SELECT count(*) INTO v_n FROM public.eletroposto_conectores WHERE carregador_id = v_c2;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: conectores sobraram apos excluir o eletroposto'; END IF;

  -- carregador com transacao (historico) nao some
  v_state := NULL;
  BEGIN
    DELETE FROM public.eletroposto_carregadores WHERE id = v_c1;
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '23503' THEN RAISE EXCEPTION 'FALHOU: carregador com transacao foi apagado (SQLSTATE %)', v_state; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
