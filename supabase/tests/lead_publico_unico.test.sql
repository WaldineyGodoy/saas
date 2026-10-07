-- =====================================================================
-- Lead publico unico (20261006b)
-- Data: 06/10/2026
--
-- Padrao da casa: tudo roda dentro de um DO que termina em
-- RAISE EXCEPTION 'SANDBOX_OK'. Sucesso = receber esse erro; o erro
-- desfaz a transacao inteira, entao nenhuma linha de teste sobra em
-- producao. Qualquer outra mensagem e falha de verdade.
-- =====================================================================

DO $$
DECLARE
  v_a uuid; v_b uuid; v_orig uuid; v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid; v_v5 uuid;
  v_lead uuid; v_lead2 uuid; v_n int; v_txt text; v_json jsonb; v_ret jsonb; v_ret2 jsonb; v_sub record; i int; v_aviso text := '';
BEGIN
  SELECT id INTO v_orig FROM public.originators_v2 ORDER BY created_at LIMIT 1;

  -- dois assinantes que podem indicar
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Teste Lead Indicador A', '11144477735', 'lead.a@example.test', '84999990101', 'ativo') RETURNING id INTO v_a;
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Teste Lead Indicador B', '52998224725', 'lead.b@example.test', '84999990102', 'ativo') RETURNING id INTO v_b;

  -- ---------------- 1. primeira simulacao, pelo link do parceiro ----------------
  v_v1 := public.fn_registrar_lead_publico(jsonb_build_object(
    'name', 'Maria Teste', 'email', 'maria.teste@example.test', 'phone', '(84) 99888-7766',
    'cep', '59000000', 'cidade', 'Natal', 'uf', 'RN', 'consumo_kwh', '300', 'originator_id', v_orig::text), 'link');
  SELECT lead_id INTO v_lead FROM public.lead_visitas WHERE id = v_v1;
  IF v_lead IS NULL OR v_lead = v_v1 THEN RAISE EXCEPTION 'FALHA 1: devolveu o id do lead, nao o da visita'; END IF;
  IF (SELECT originator_id FROM public.leads WHERE id = v_lead) IS DISTINCT FROM v_orig THEN
    RAISE EXCEPTION 'FALHA 1b: originador do link nao gravado';
  END IF;

  -- ---------------- 2. mesma pessoa (celular com 55 e mascara), link do assinante A ----------------
  v_v2 := public.fn_registrar_lead_publico(jsonb_build_object(
    'name', 'Maria Teste', 'email', 'maria.teste@example.test', 'phone', '+55 84 99888-7766',
    'indicador_assinante_id', v_a::text), 'qr');
  IF (SELECT lead_id FROM public.lead_visitas WHERE id = v_v2) <> v_lead THEN
    RAISE EXCEPTION 'FALHA 2: o mesmo celular criou outro lead';
  END IF;
  SELECT count(*) INTO v_n FROM public.leads WHERE public.fn_telefone_br(phone) = '84998887766';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 2b: % leads com o mesmo celular', v_n; END IF;
  -- ultimo link vale para os dois: indicador A e originador do link (nenhum)
  IF (SELECT indicador_assinante_id FROM public.leads WHERE id = v_lead) IS DISTINCT FROM v_a
     OR (SELECT originator_id FROM public.leads WHERE id = v_lead) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 2c: ultimo link deveria trocar indicador e originador juntos';
  END IF;
  IF (SELECT retornos FROM public.leads WHERE id = v_lead) <> 1 THEN RAISE EXCEPTION 'FALHA 2d: retornos'; END IF;

  -- ---------------- 3. estranho com o celular dela, pelo link do B ----------------
  v_v3 := public.fn_registrar_lead_publico(jsonb_build_object(
    'name', 'Fulano Estranho', 'email', 'estranho@example.test', 'phone', '84998887766',
    'indicador_assinante_id', v_b::text), 'link');
  SELECT name || '|' || email INTO v_txt FROM public.leads WHERE id = v_lead;
  IF v_txt <> 'Maria Teste|maria.teste@example.test' THEN
    RAISE EXCEPTION 'FALHA 3: envio alheio sobrescreveu o cadastro: %', v_txt;
  END IF;
  -- a visita do estranho so devolve o que ele mesmo digitou
  v_json := public.fn_lead_adesao(v_v3);
  IF v_json ->> 'email' <> 'estranho@example.test' OR v_json ? 'uc' THEN
    RAISE EXCEPTION 'FALHA 3b: preenchimento pela visita vazou dados do lead: %', v_json;
  END IF;

  -- ---------------- 4. e-mail igual, celular diferente: mesmo lead ----------------
  v_v4 := public.fn_registrar_lead_publico(jsonb_build_object(
    'name', 'Maria Teste', 'email', ' MARIA.TESTE@example.test ', 'phone', '84911112222'), 'link');
  IF (SELECT lead_id FROM public.lead_visitas WHERE id = v_v4) <> v_lead THEN
    RAISE EXCEPTION 'FALHA 4: e-mail igual deveria achar o mesmo lead';
  END IF;
  -- visita sem link (organica) nao mexe na indicacao: continua o B do passo 3
  IF (SELECT indicador_assinante_id FROM public.leads WHERE id = v_lead) IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION 'FALHA 4b: visita sem link mudou a indicacao';
  END IF;
  IF (SELECT meio FROM public.lead_visitas WHERE id = v_v4) <> 'organico' THEN
    RAISE EXCEPTION 'FALHA 4c: visita sem link deveria ficar como organico';
  END IF;
  SELECT count(*) INTO v_n FROM public.lead_visitas WHERE lead_id = v_lead;
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHA 4d: historico deveria ter 4 visitas, tem %', v_n; END IF;

  -- ---------------- 5. campo armadilha: nada gravado ----------------
  SELECT count(*) INTO v_n FROM public.leads;
  PERFORM public.fn_registrar_lead_publico(jsonb_build_object('name', 'Robo', 'phone', '84933334444'), 'link', 'http://spam');
  IF (SELECT count(*) FROM public.leads) <> v_n THEN RAISE EXCEPTION 'FALHA 5: armadilha gravou lead'; END IF;

  -- ---------------- 5b. celular de fachada e recusado ----------------
  BEGIN
    PERFORM public.fn_registrar_lead_publico(jsonb_build_object('name', 'Fachada', 'phone', '99999999999'), 'link');
    RAISE EXCEPTION 'FALHA 5b: aceitou 99999999999';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- ---------------- 6. limite de 5 envios por hora ----------------
  FOR i IN 1..5 LOOP
    PERFORM public.fn_registrar_lead_publico(jsonb_build_object('name', 'Insistente', 'phone', '84955556666'), 'link');
  END LOOP;
  BEGIN
    PERFORM public.fn_registrar_lead_publico(jsonb_build_object('name', 'Insistente', 'phone', '84955556666'), 'link');
    RAISE EXCEPTION 'FALHA 6: sexto envio na hora passou';
  EXCEPTION WHEN SQLSTATE '54000' THEN NULL;
  END;

  -- ---------------- 7. adesao pela visita do link A: vale a sessao que concluiu ----------------
  -- O lead esta com B (ultimo link), mas a pessoa conclui pela sessao do passo 2 (A).
  v_ret := public.fn_criar_assinante_publico(
    'Maria Teste', '39053344705', 'maria.teste@example.test', '84998887766',
    '59000000', 'Rua Teste', '1', NULL, 'Centro', 'Natal', 'RN', '2408102',
    NULL, v_v2,
    jsonb_build_array(jsonb_build_object('numero_uc', 'TST-LEAD-0001', 'cpf_cnpj_fatura', '39053344705',
      'tipo_ligacao', 'monofasico', 'ibge', '2408102', 'uf', 'RN')),
    10, NULL, NULL, 'teste', NULL);
  SELECT s.indicador_assinante_id, s.lead_id, s.originator_id INTO v_sub
    FROM public.subscribers s WHERE s.id = (v_ret ->> 'subscriber_id')::uuid;
  IF v_sub.indicador_assinante_id IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'FALHA 7: a sessao que concluiu (A) deveria valer, veio %', v_sub.indicador_assinante_id;
  END IF;
  IF v_sub.lead_id IS DISTINCT FROM v_lead THEN
    RAISE EXCEPTION 'FALHA 7b: subscribers.lead_id deveria ser o lead, nao a visita';
  END IF;
  IF (SELECT indicador_assinante_id FROM public.leads WHERE id = v_lead) IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'FALHA 7c: o lead deveria ficar com a atribuicao que valeu';
  END IF;

  -- ---------------- 7d. adesao refeita substitui o cadastro nao assinado ----------------
  v_ret2 := public.fn_criar_assinante_publico(
    'Maria Teste', '39053344705', 'maria.teste@example.test', '84998887766',
    '59000000', 'Rua Teste', '1', NULL, 'Centro', 'Natal', 'RN', '2408102',
    NULL, v_v3,
    jsonb_build_array(jsonb_build_object('numero_uc', 'TST-LEAD-0001', 'cpf_cnpj_fatura', '39053344705',
      'tipo_ligacao', 'monofasico', 'ibge', '2408102', 'uf', 'RN')),
    10, NULL, NULL, 'teste', NULL);
  IF (SELECT status::text FROM public.subscribers WHERE id = (v_ret ->> 'subscriber_id')::uuid) <> 'cancelado' THEN
    RAISE EXCEPTION 'FALHA 7d: o cadastro antigo nao assinado deveria ficar cancelado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_history WHERE entity_id = (v_ret ->> 'subscriber_id')::uuid
                  AND metadata ->> 'acao' = 'substituido_por_nova_adesao') THEN
    RAISE EXCEPTION 'FALHA 7e: substituicao sem registro no historico';
  END IF;
  -- a segunda adesao concluiu pela visita do estranho (link B): vale B
  IF (SELECT indicador_assinante_id FROM public.subscribers WHERE id = (v_ret2 ->> 'subscriber_id')::uuid) IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION 'FALHA 7f: a adesao nova deveria valer pelo link da sessao que concluiu';
  END IF;
  -- outra pessoa com o mesmo CPF (celular e e-mail diferentes) NAO derruba o cadastro
  BEGIN
    PERFORM public.fn_criar_assinante_publico(
      'Golpista', '39053344705', 'golpe@example.test', '84912345678',
      '59000000', 'Rua X', '1', NULL, 'Centro', 'Natal', 'RN', '2408102', NULL, NULL,
      jsonb_build_array(jsonb_build_object('numero_uc', 'TST-LEAD-0002', 'cpf_cnpj_fatura', '39053344705',
        'tipo_ligacao', 'monofasico', 'ibge', '2408102', 'uf', 'RN')),
      10, NULL, NULL, 'teste', NULL);
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;  -- chamador interno: CPF em uso e recusado
  END;
  IF (SELECT status::text FROM public.subscribers WHERE id = (v_ret2 ->> 'subscriber_id')::uuid) <> 'ativacao' THEN
    RAISE EXCEPTION 'FALHA 7g: CPF igual com outro celular e e-mail derrubou o cadastro';
  END IF;
  v_ret := v_ret2;

  -- ---------------- 8. contrato assinado trava a indicacao ----------------
  UPDATE public.subscribers SET status = 'contrato_assinado' WHERE id = (v_ret ->> 'subscriber_id')::uuid;
  v_v5 := public.fn_registrar_lead_publico(jsonb_build_object(
    'name', 'Maria Teste', 'phone', '84998887766', 'indicador_assinante_id', v_b::text), 'link');
  IF (SELECT aplicada FROM public.lead_visitas WHERE id = v_v5) THEN
    RAISE EXCEPTION 'FALHA 8: indicacao depois do contrato deveria ficar registrada como nao aplicada';
  END IF;
  SELECT lead_id INTO v_lead2 FROM public.lead_visitas WHERE id = v_v5;
  IF (SELECT indicador_assinante_id FROM public.leads WHERE id = v_lead2) IS DISTINCT FROM
     (CASE WHEN v_lead2 = v_lead THEN v_b ELSE NULL END) THEN
    RAISE EXCEPTION 'FALHA 8b: a indicacao travada foi trocada';
  END IF;

  -- ---------------- 9. arquivo de 90 dias ----------------
  INSERT INTO public.leads (name, phone, status, created_at, updated_at)
  VALUES ('Parado Teste', '84977778888', 'simulacao', now() - interval '120 days', now() - interval '120 days')
  RETURNING id INTO v_lead2;
  -- updated_at pode ter gatilho; forca a data para o teste
  UPDATE public.leads SET updated_at = now() - interval '120 days' WHERE id = v_lead2;
  PERFORM public.fn_arquivar_leads_parados();
  IF (SELECT arquivado_em FROM public.leads WHERE id = v_lead2) IS NULL THEN
    -- updated_at mantido por gatilho de "agora": o arquivo usa a ultima atividade real
    IF (SELECT updated_at FROM public.leads WHERE id = v_lead2) > now() - interval '1 minute' THEN
      v_aviso := ' AVISO: updated_at mantido por gatilho, teste 9 nao exercitado';
    ELSE
      RAISE EXCEPTION 'FALHA 9: lead parado ha 120 dias nao foi arquivado';
    END IF;
  ELSE
    UPDATE public.leads SET status = 'negociacao' WHERE id = v_lead2;
    IF (SELECT arquivado_em FROM public.leads WHERE id = v_lead2) IS NOT NULL THEN
      RAISE EXCEPTION 'FALHA 9b: mudar o status deveria desarquivar';
    END IF;
  END IF;
  IF (SELECT arquivado_em FROM public.leads WHERE id = v_lead) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 9c: lead ativo foi arquivado';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK%', v_aviso;
END
$$;
