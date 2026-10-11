-- OCPP (Tarefa 9): numero publico do conector (unico por eletroposto) e colunas
-- carregador_id / ocpp_connector_id da recarga.
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §4.2, §5.4
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
-- Depende de 20261007a_recarga_seguranca.sql e 20261007b_ocpp_estrutura.sql.
DO $$
DECLARE
  v_e1    uuid;
  v_e2    uuid;
  v_c1a   uuid;   -- carregador A do eletroposto 1
  v_c1b   uuid;   -- carregador B do eletroposto 1
  v_c2    uuid;   -- carregador do eletroposto 2
  v_cx    uuid;   -- carregador descartavel (teste de FK)
  v_r     uuid;
  v_r1    uuid;
  v_r2    uuid;
  v_r3    uuid;
  v_plano uuid;
  v_n     integer;
  v_tab   text;
  v_dono  text := current_user;
  v_ra    uuid;
  v_rb    uuid;
  v_txt   text;
  v_erro  text;
  v_state text;
BEGIN
  INSERT INTO public.eletropostos (nome) VALUES ('Eletroposto numero teste 1') RETURNING id INTO v_e1;
  INSERT INTO public.eletropostos (nome) VALUES ('Eletroposto numero teste 2') RETURNING id INTO v_e2;
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e1, 'NUM_1A') RETURNING id INTO v_c1a;
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e1, 'NUM_1B') RETURNING id INTO v_c1b;
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e2, 'NUM_2A') RETURNING id INTO v_c2;
  INSERT INTO public.eletroposto_carregadores (eletroposto_id, ocpp_id) VALUES (v_e2, 'NUM_2X') RETURNING id INTO v_cx;

  -- =====================================================================
  -- 1) Estacao (connector_id 0) nao tem numero; eletroposto_id vem do carregador
  -- =====================================================================
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c1a, 0);
  SELECT coalesce(numero::text, 'nulo') || '|' || (eletroposto_id = v_e1)::text INTO v_txt
    FROM public.eletroposto_conectores WHERE carregador_id = v_c1a AND connector_id = 0;
  IF v_txt <> 'nulo|true' THEN RAISE EXCEPTION 'FALHOU: conector 0 deveria ter numero nulo e eletroposto do carregador (%)', v_txt; END IF;

  -- =====================================================================
  -- 2) Conector real recebe o proximo numero livre do ELETROPOSTO
  --    (atravessa carregadores; outro eletroposto recomeca em 1)
  -- =====================================================================
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c1a, 1);
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c1b, 1);
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c2, 1);

  SELECT string_agg(numero::text, ',' ORDER BY numero) INTO v_txt
    FROM public.eletroposto_conectores WHERE eletroposto_id = v_e1 AND numero IS NOT NULL;
  IF v_txt <> '1,2' THEN RAISE EXCEPTION 'FALHOU: numeros do eletroposto 1 = % (esperado 1,2)', v_txt; END IF;

  SELECT numero::text INTO v_txt FROM public.eletroposto_conectores WHERE carregador_id = v_c1b AND connector_id = 1;
  IF v_txt <> '2' THEN RAISE EXCEPTION 'FALHOU: carregador B conector 1 deveria ser o numero 2, e %', v_txt; END IF;

  SELECT numero::text INTO v_txt FROM public.eletroposto_conectores WHERE carregador_id = v_c2 AND connector_id = 1;
  IF v_txt <> '1' THEN RAISE EXCEPTION 'FALHOU: outro eletroposto recomeca em 1, e %', v_txt; END IF;

  -- numero explicito e respeitado; o automatico segue o maior + 1
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id, numero) VALUES (v_c1a, 2, 5);
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id) VALUES (v_c1a, 3);
  SELECT numero::text INTO v_txt FROM public.eletroposto_conectores WHERE carregador_id = v_c1a AND connector_id = 3;
  IF v_txt <> '6' THEN RAISE EXCEPTION 'FALHOU: depois do 5 o automatico deveria ser 6, e %', v_txt; END IF;

  -- =====================================================================
  -- 3) Unicidade por eletroposto, valor positivo, nada de numero na estacao
  -- =====================================================================
  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_conectores (carregador_id, connector_id, numero) VALUES (v_c1b, 2, 1);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: numero repetido no eletroposto deu % (esperado 23505): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_conectores (carregador_id, connector_id, numero) VALUES (v_c1b, 3, 0);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: numero 0 deu % (esperado 23514): %', v_state, v_erro; END IF;

  v_state := NULL;
  BEGIN
    INSERT INTO public.eletroposto_conectores (carregador_id, connector_id, numero) VALUES (v_c1b, 0, 9);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: numero na estacao (connector_id 0) deu % (esperado 23514): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 4) eletroposto_id nao e confiavel vindo de fora: o gatilho corrige
  -- =====================================================================
  INSERT INTO public.eletroposto_conectores (carregador_id, connector_id, eletroposto_id) VALUES (v_c1b, 7, v_e2);
  SELECT (eletroposto_id = v_e1)::text INTO v_txt FROM public.eletroposto_conectores WHERE carregador_id = v_c1b AND connector_id = 7;
  IF v_txt <> 'true' THEN RAISE EXCEPTION 'FALHOU: eletroposto_id mentido nao foi corrigido pelo gatilho'; END IF;

  -- =====================================================================
  -- 5) Carregador muda de eletroposto: os conectores acompanham; colisao de numero recusa
  -- =====================================================================
  -- B tem numeros 2 e 7 (nenhum colide no eletroposto 2, que so tem o 1)
  UPDATE public.eletroposto_carregadores SET eletroposto_id = v_e2 WHERE id = v_c1b;
  SELECT count(*)::text INTO v_txt FROM public.eletroposto_conectores WHERE carregador_id = v_c1b AND eletroposto_id = v_e2;
  IF v_txt <> '2' THEN RAISE EXCEPTION 'FALHOU: conectores deveriam acompanhar o carregador (% de 2)', v_txt; END IF;

  -- A tem o numero 1, que o eletroposto 2 ja usa (carregador 2A)
  v_state := NULL;
  BEGIN
    UPDATE public.eletroposto_carregadores SET eletroposto_id = v_e2 WHERE id = v_c1a;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: mover carregador com numero em colisao deu % (esperado 23505): %', v_state, v_erro; END IF;

  -- =====================================================================
  -- 6) Busca do checkout: (eletroposto_id, numero) acha um unico conector
  -- =====================================================================
  SELECT count(*)::text INTO v_txt FROM public.eletroposto_conectores WHERE eletroposto_id = v_e1 AND numero = 1;
  IF v_txt <> '1' THEN RAISE EXCEPTION 'FALHOU: busca por (eletroposto, numero) devolveu % linhas', v_txt; END IF;

  -- =====================================================================
  -- 7) Recarga guarda carregador e conector OCPP resolvidos no checkout
  -- =====================================================================
  INSERT INTO public.recargas_eletroposto
    (eletroposto_id, conector_numero, tipo_usuario, valor, status, carregador_id, ocpp_connector_id)
  VALUES (v_e2, 1, 'avulso', 50, 'pending_payment', v_cx, 1) RETURNING id INTO v_r;

  v_state := NULL;
  BEGIN
    UPDATE public.recargas_eletroposto SET ocpp_connector_id = 0 WHERE id = v_r;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN RAISE EXCEPTION 'FALHOU: ocpp_connector_id 0 deu % (esperado 23514): %', v_state, v_erro; END IF;

  DELETE FROM public.eletroposto_carregadores WHERE id = v_cx;
  SELECT coalesce(carregador_id::text, 'nulo') INTO v_txt FROM public.recargas_eletroposto WHERE id = v_r;
  IF v_txt <> 'nulo' THEN RAISE EXCEPTION 'FALHOU: apagar o carregador deveria zerar recargas.carregador_id (%)', v_txt; END IF;

  -- =====================================================================
  -- 8) Gatilho tambem dispara em UPDATE OF eletroposto_id (staff nao burla a copia)
  -- =====================================================================
  UPDATE public.eletroposto_conectores SET eletroposto_id = v_e1 WHERE carregador_id = v_c2 AND connector_id = 1;
  SELECT (eletroposto_id = v_e2)::text INTO v_txt FROM public.eletroposto_conectores WHERE carregador_id = v_c2 AND connector_id = 1;
  IF v_txt <> 'true' THEN RAISE EXCEPTION 'FALHOU: UPDATE de eletroposto_id no conector nao foi corrigido pelo gatilho'; END IF;

  -- =====================================================================
  -- 9) Reserva atomica do conector (fn_reservar_recarga), janela de 10 min
  -- =====================================================================
  -- so service_role chama
  IF has_function_privilege('anon', 'public.fn_reservar_recarga(uuid,integer,integer,uuid,integer,uuid,text,text,text,numeric,numeric,numeric,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_reservar_recarga(uuid,integer,integer,uuid,integer,uuid,text,text,text,numeric,numeric,numeric,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_reservar_recarga(uuid,integer,integer,uuid,integer,uuid,text,text,text,numeric,numeric,numeric,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: fn_reservar_recarga deve ser executavel so por service_role';
  END IF;

  v_r1 := public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'Motorista A', 'a@teste.invalid', NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  IF v_r1 IS NULL THEN RAISE EXCEPTION 'FALHOU: primeira reserva deveria passar'; END IF;
  SELECT tipo_usuario || '|' || status || '|' || carregador_id::text || '|' || ocpp_connector_id::text || '|' || conector_numero::text INTO v_txt
    FROM public.recargas_eletroposto WHERE id = v_r1;
  IF v_txt <> 'avulso|pending_payment|' || v_c1a::text || '|1|1' THEN RAISE EXCEPTION 'FALHOU: recarga reservada gravada errada (%)', v_txt; END IF;

  -- segunda reserva dentro de 10 min: recusada
  v_r2 := public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'Motorista B', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  IF v_r2 IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: segunda reserva dentro de 10 min deveria ser recusada'; END IF;

  -- outro conector nao e afetado
  v_r3 := public.fn_reservar_recarga(v_c2, 1, 10, v_e2, 1, NULL, 'Motorista C', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  IF v_r3 IS NULL THEN RAISE EXCEPTION 'FALHOU: reserva em outro conector deveria passar'; END IF;

  -- depois de 10 min a reserva vence
  UPDATE public.recargas_eletroposto SET created_at = now() - interval '11 minutes' WHERE id = v_r1;
  v_r2 := public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'Motorista B', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  IF v_r2 IS NULL THEN RAISE EXCEPTION 'FALHOU: reserva vencida (11 min) deveria liberar o conector'; END IF;

  -- 9 min ainda segura
  UPDATE public.recargas_eletroposto SET created_at = now() - interval '9 minutes' WHERE id = v_r2;
  IF public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'X', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: reserva de 9 min deveria bloquear';
  END IF;

  -- paid / starting / charging bloqueiam mesmo com a recarga antiga (> 10 min)
  UPDATE public.recargas_eletroposto SET created_at = now() - interval '2 hours' WHERE id = v_r2;
  FOREACH v_txt IN ARRAY ARRAY['paid', 'starting', 'charging'] LOOP
    UPDATE public.recargas_eletroposto SET status = v_txt WHERE id = v_r2;
    IF public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'X', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb) IS NOT NULL THEN
      RAISE EXCEPTION 'FALHOU: recarga % deveria bloquear o conector', v_txt;
    END IF;
  END LOOP;

  -- concluida libera
  UPDATE public.recargas_eletroposto SET status = 'completed' WHERE id = v_r2;
  IF public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'X', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: recarga concluida deveria liberar o conector';
  END IF;

  -- pending_payment cancelada/falha libera (pending -> canceled)
  UPDATE public.recargas_eletroposto SET status = 'canceled'
   WHERE carregador_id = v_c1a AND ocpp_connector_id = 1 AND status = 'pending_payment';
  IF public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'Y', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: reserva cancelada deveria liberar o conector';
  END IF;

  -- =====================================================================
  -- 10) idTag: no maximo um por recarga (webhooks simultaneos)
  -- =====================================================================
  INSERT INTO public.ocpp_id_tags (id_tag, recarga_id, expira_em) VALUES ('RCAAAAAAAAAAAAAAAAAA', v_r1, now() + interval '5 minutes');
  v_state := NULL;
  BEGIN
    INSERT INTO public.ocpp_id_tags (id_tag, recarga_id) VALUES ('RCBBBBBBBBBBBBBBBBBB', v_r1);
  EXCEPTION WHEN others THEN v_state := SQLSTATE; v_erro := SQLERRM;
  END;
  IF v_state IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'FALHOU: 2o idTag da mesma recarga deu % (esperado 23505): %', v_state, v_erro; END IF;
  -- idTag sem recarga (totem, RC-06) pode repetir a ausencia
  INSERT INTO public.ocpp_id_tags (id_tag) VALUES ('TAG_TOTEM_1');
  INSERT INTO public.ocpp_id_tags (id_tag) VALUES ('TAG_TOTEM_2');

  -- =====================================================================
  -- 11) Dados publicos do posto (tarifa do plano) para anon, sem abrir as tabelas
  -- =====================================================================
  INSERT INTO public.planos_assinatura_energia (nome, recorrente_config, tarifa_motorista_kwh)
  VALUES ('Plano publico teste', '{"categoria_plano":"eletroposto"}'::jsonb, 1.9900) RETURNING id INTO v_plano;
  UPDATE public.eletropostos SET plano_id = v_plano, status = 'operando', potencia_kw = 60, tipo_recarga = 'DC', qtd_carregadores = 2 WHERE id = v_e1;
  UPDATE public.eletropostos SET status = 'operando' WHERE id = v_e2;   -- sem plano

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT tarifa_motorista_kwh::text || '|' || nome || '|' || qtd_carregadores::text INTO v_txt FROM public.fn_eletroposto_publico(v_e1);
  IF v_txt IS DISTINCT FROM '1.9900|Eletroposto numero teste 1|2' THEN RAISE EXCEPTION 'FALHOU: anon deveria ler a tarifa pela RPC (%)', v_txt; END IF;

  SELECT coalesce(tarifa_motorista_kwh::text, 'nula') INTO v_txt FROM public.fn_eletroposto_publico(v_e2);
  IF v_txt <> 'nula' THEN RAISE EXCEPTION 'FALHOU: posto sem plano deveria vir sem tarifa (%)', v_txt; END IF;

  SELECT count(*) INTO v_n FROM public.fn_eletropostos_publicos() WHERE id IN (v_e1, v_e2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: lista publica deveria trazer os 2 postos em operacao (%)', v_n; END IF;

  -- so colunas nao pessoais
  v_txt := pg_get_function_result('public.fn_eletroposto_publico(uuid)'::regprocedure);
  IF v_txt <> 'TABLE(id uuid, nome text, endereco text, potencia_kw numeric, tipo_recarga text, qtd_carregadores integer, tarifa_motorista_kwh numeric)' THEN
    RAISE EXCEPTION 'FALHOU: colunas da RPC publica mudaram (%)', v_txt;
  END IF;

  -- tabelas continuam fechadas para anon
  FOREACH v_tab IN ARRAY ARRAY['eletropostos', 'planos_assinatura_energia', 'eletroposto_conectores', 'recargas_eletroposto'] LOOP
    v_state := NULL; v_n := 0;
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tab) INTO v_n;
    EXCEPTION WHEN others THEN v_state := SQLSTATE;
    END;
    IF v_n <> 0 OR (v_state IS NOT NULL AND v_state <> '42501') THEN
      RAISE EXCEPTION 'FALHOU: anon le % (% linhas, SQLSTATE %)', v_tab, v_n, v_state;
    END IF;
  END LOOP;
  v_state := NULL;
  BEGIN
    PERFORM public.fn_reservar_recarga(v_c1a, 1, 10, v_e1, 1, NULL, 'Z', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  EXCEPTION WHEN others THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon executou fn_reservar_recarga (SQLSTATE %)', v_state; END IF;

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- posto fora de operacao some da RPC publica
  UPDATE public.eletropostos SET status = 'manutencao' WHERE id = v_e2;
  SELECT count(*) INTO v_n FROM public.fn_eletroposto_publico(v_e2);
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: posto em manutencao nao deveria aparecer na RPC publica'; END IF;

  -- =====================================================================
  -- 12) Pagamento tardio de reserva vencida (fn_confirmar_inicio)
  -- =====================================================================
  IF has_function_privilege('anon', 'public.fn_confirmar_inicio(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_confirmar_inicio(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fn_confirmar_inicio(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU: fn_confirmar_inicio deve ser executavel so por service_role';
  END IF;

  -- A reserva e vence; B reserva o mesmo conector; A paga depois
  v_ra := public.fn_reservar_recarga(v_c1b, 7, 10, v_e2, 2, NULL, 'A', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  UPDATE public.recargas_eletroposto SET created_at = now() - interval '11 minutes' WHERE id = v_ra;
  v_rb := public.fn_reservar_recarga(v_c1b, 7, 10, v_e2, 2, NULL, 'B', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  IF v_ra IS NULL OR v_rb IS NULL THEN RAISE EXCEPTION 'FALHOU: preparo do cenario de pagamento tardio'; END IF;
  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_ra;   -- o que fn_marcar_recarga_paga faz

  IF public.fn_confirmar_inicio(v_ra, 10) <> 'conflito' THEN RAISE EXCEPTION 'FALHOU: A (pago tarde, B reservando) deveria dar conflito'; END IF;
  SELECT status || '|' || coalesce(valor_final::text, 'nulo') || '|' || coalesce(motivo_fim, 'nulo') || '|' || (metadata->>'estorno_total_pendente') INTO v_txt
    FROM public.recargas_eletroposto WHERE id = v_ra;
  IF v_txt <> 'failed|0.00|conector_reservado_por_outro|true' THEN RAISE EXCEPTION 'FALHOU: A deveria estar failed com estorno total pendente (%)', v_txt; END IF;
  IF (SELECT status FROM public.recargas_eletroposto WHERE id = v_rb) <> 'pending_payment' THEN RAISE EXCEPTION 'FALHOU: B nao deveria ser tocada'; END IF;

  -- idempotente: A ja nao esta paid
  IF public.fn_confirmar_inicio(v_ra, 10) <> 'ignorada' THEN RAISE EXCEPTION 'FALHOU: segunda chamada deveria ser ignorada'; END IF;

  -- B paga: A (failed) nao segura o conector
  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_rb;
  IF public.fn_confirmar_inicio(v_rb, 10) <> 'ok' THEN RAISE EXCEPTION 'FALHOU: B deveria poder iniciar'; END IF;
  IF (SELECT status FROM public.recargas_eletroposto WHERE id = v_rb) <> 'paid' THEN RAISE EXCEPTION 'FALHOU: B deveria seguir paid'; END IF;

  -- sem concorrente: ok (v_r3 e a unica recarga do conector 1 do carregador 2)
  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_r3;
  IF public.fn_confirmar_inicio(v_r3, 10) <> 'ok' THEN RAISE EXCEPTION 'FALHOU: recarga sem concorrente deveria dar ok'; END IF;

  -- concorrente ja paid (E2 pagou dentro da janela; E1 vencida paga depois)
  v_ra := public.fn_reservar_recarga(v_c1a, 2, 10, v_e1, 3, NULL, 'E1', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  UPDATE public.recargas_eletroposto SET created_at = now() - interval '11 minutes' WHERE id = v_ra;
  v_rb := public.fn_reservar_recarga(v_c1a, 2, 10, v_e1, 3, NULL, 'E2', NULL, NULL, 50, 23.1, 2.1500, '{}'::jsonb);
  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_rb;
  IF public.fn_confirmar_inicio(v_rb, 10) <> 'ok' THEN RAISE EXCEPTION 'FALHOU: E2 deveria iniciar (E1 vencida)'; END IF;
  UPDATE public.recargas_eletroposto SET status = 'paid' WHERE id = v_ra;
  IF public.fn_confirmar_inicio(v_ra, 10) <> 'conflito' THEN RAISE EXCEPTION 'FALHOU: E1 tardia deveria dar conflito com E2 paid'; END IF;
  -- com E2 em andamento (starting / charging) o conector continua ocupado
  UPDATE public.recargas_eletroposto SET status = 'starting' WHERE id = v_rb;
  UPDATE public.recargas_eletroposto SET status = 'charging' WHERE id = v_rb;
  IF public.fn_confirmar_inicio(v_rb, 10) <> 'ignorada' THEN RAISE EXCEPTION 'FALHOU: recarga em andamento nao e paid, deveria ser ignorada'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
