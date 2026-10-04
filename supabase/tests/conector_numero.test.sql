-- OCPP (Tarefa 9): numero publico do conector (unico por eletroposto) e colunas
-- carregador_id / ocpp_connector_id da recarga.
-- Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §4.2, §5.4
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
-- Depende de 20261004a_recarga_seguranca.sql e 20261004b_ocpp_estrutura.sql.
DO $$
DECLARE
  v_e1    uuid;
  v_e2    uuid;
  v_c1a   uuid;   -- carregador A do eletroposto 1
  v_c1b   uuid;   -- carregador B do eletroposto 1
  v_c2    uuid;   -- carregador do eletroposto 2
  v_cx    uuid;   -- carregador descartavel (teste de FK)
  v_r     uuid;
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

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
