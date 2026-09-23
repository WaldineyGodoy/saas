-- C1: so papel interno escreve regra de gatilho de mensagem.
--
-- Antes da 20260922i, `notification_triggers` tinha INSERT/UPDATE/DELETE com
-- `true` para `authenticated`. Como `fn_process_notification_triggers()` e
-- `fn_check_invoice_due_reminders()` sao SECURITY DEFINER e transformam essas
-- linhas em `notification_logs` (com `message_body` livre e `custom_recipients`
-- livre, uma lista de telefones separada por ";"), e `fn_dispatch_notification()`
-- dispara cada log pendente, qualquer pessoa logada mandava o texto que
-- quisesse para o numero que quisesse pelo WhatsApp/e-mail da empresa. O
-- portao da Task 12 (INSERT em notification_logs so para papel interno) nao
-- alcancava esse desvio.
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
--
-- Papeis simulados por set_config('role','authenticated') + request.jwt.claims,
-- que e exatamente como o PostgREST executa a consulta do navegador.
DO $$
DECLARE
  v_ass  uuid := gen_random_uuid();   -- assinante (papel nao interno)
  v_emb  uuid := gen_random_uuid();   -- embaixador/originador (papel nao interno)
  v_adm  uuid := gen_random_uuid();   -- admin (papel interno)

  v_gat  uuid;                        -- regra fixture, criada pelo dono
  v_gat2 uuid := gen_random_uuid();   -- regra que o admin insere

  v_dono text := current_user;
  v_n    integer;
  v_erro text;
  v_state text;
  v_ativo boolean;
  v_corpo text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_ass, 'assin.gat@teste.invalid', '{"name":"Assinante"}',  'authenticated', 'authenticated'),
    (v_emb, 'emb.gat@teste.invalid',   '{"name":"Embaixador"}', 'authenticated', 'authenticated'),
    (v_adm, 'admin.gat@teste.invalid', '{"name":"Admin"}',      'authenticated', 'authenticated');

  UPDATE public.profiles SET role = 'subscriber'  WHERE id = v_ass;
  UPDATE public.profiles SET role = 'originator'  WHERE id = v_emb;
  UPDATE public.profiles SET role = 'admin'       WHERE id = v_adm;

  INSERT INTO public.notification_triggers
    (name, entity_type, trigger_status, channel, message_body, is_active)
  VALUES
    ('SANDBOX regra legitima', 'lead', 'novo', 'whatsapp', 'Ola, {{nome}}.', true)
  RETURNING id INTO v_gat;

  -- =====================================================================
  -- 1) ASSINANTE: continua lendo, mas nao escreve regra nenhuma
  -- =====================================================================
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ass, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.notification_triggers WHERE id = v_gat;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: assinante perdeu a leitura da regra (SELECT devia continuar como hoje)'; END IF;

  -- 1a) INSERT: a rota do abuso — texto livre + destino livre
  v_erro := NULL; v_state := NULL;
  BEGIN
    INSERT INTO public.notification_triggers
      (name, entity_type, trigger_status, channel, message_body, custom_recipients, is_active)
    VALUES
      ('SANDBOX abuso do assinante', 'lead', 'novo', 'whatsapp',
       'Texto arbitrario saindo do WhatsApp da empresa', '5511999990000;5511999990001', true);
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: assinante criou regra de gatilho (envio arbitrario)'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: INSERT do assinante barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- 1b) UPDATE: tem de ERRAR, nao atingir zero linhas em silencio
  v_erro := NULL; v_state := NULL; v_n := -1;
  BEGIN
    UPDATE public.notification_triggers
       SET message_body = 'Sequestro do corpo da mensagem', custom_recipients = '5511999990000'
     WHERE id = v_gat;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN
    RAISE EXCEPTION 'FALHOU: assinante alterou regra de gatilho (% linha[s], sem erro)', v_n;
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: UPDATE do assinante barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- 1c) DELETE
  DELETE FROM public.notification_triggers WHERE id = v_gat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: assinante apagou regra de gatilho (% linha[s])', v_n; END IF;

  -- =====================================================================
  -- 2) EMBAIXADOR/ORIGINADOR: mesma regra
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emb, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.notification_triggers WHERE id = v_gat;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: embaixador perdeu a leitura da regra (SELECT devia continuar como hoje)'; END IF;

  v_erro := NULL; v_state := NULL;
  BEGIN
    INSERT INTO public.notification_triggers
      (name, entity_type, trigger_status, channel, message_body, custom_recipients, is_active)
    VALUES
      ('SANDBOX abuso do embaixador', 'invoice', 'atrasado', 'email',
       'Cobranca falsa', 'vitima@exemplo.invalid', true);
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador criou regra de gatilho'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: INSERT do embaixador barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- O botao ATIVO/INATIVO do painel: tem de recusar com erro, e nao dizer
  -- "Gatilho ativado!" sem ter ativado nada.
  v_erro := NULL; v_state := NULL; v_n := -1;
  BEGIN
    UPDATE public.notification_triggers SET is_active = false WHERE id = v_gat;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN
    RAISE EXCEPTION 'FALHOU: embaixador desligou regra de gatilho (% linha[s], sem erro)', v_n;
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: UPDATE do embaixador barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  DELETE FROM public.notification_triggers WHERE id = v_gat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador apagou regra de gatilho (% linha[s])', v_n; END IF;

  -- 2z) nada do que os dois tentaram encostou na regra
  SELECT is_active, message_body INTO v_ativo, v_corpo FROM public.notification_triggers WHERE id = v_gat;
  IF v_ativo IS DISTINCT FROM true OR v_corpo <> 'Ola, {{nome}}.' THEN
    RAISE EXCEPTION 'FALHOU: regra ficou is_active=%, message_body=% depois das tentativas', v_ativo, v_corpo;
  END IF;

  -- =====================================================================
  -- 3) ADMIN (papel interno): a tela Configuracoes > Gatilhos continua inteira
  --    (TriggerMessageDashboard + MessageTriggerModal)
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);

  INSERT INTO public.notification_triggers
    (id, name, entity_type, trigger_status, channel, message_body, custom_recipients, is_active)
  VALUES
    (v_gat2, 'SANDBOX regra do admin', 'subscriber', 'ativo', 'whatsapp',
     'Bem-vindo!', '5533999991234', true);
  SELECT count(*) INTO v_n FROM public.notification_triggers WHERE id = v_gat2;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue criar regra de gatilho'; END IF;

  UPDATE public.notification_triggers SET is_active = false WHERE id = v_gat2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue ligar/desligar regra (% linha[s])', v_n; END IF;

  DELETE FROM public.notification_triggers WHERE id = v_gat2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue apagar regra (% linha[s])', v_n; END IF;

  -- =====================================================================
  -- 4) SERVICE ROLE: BYPASSRLS — se um robo um dia escrever aqui, nao trava.
  --    O papel tem de ser `service_role` MESMO: rodar como dono da conexao
  --    provaria outra coisa.
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('role', 'service_role', true);

  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'FIXTURE: nao consegui assumir service_role (current_user = %)', current_user;
  END IF;

  UPDATE public.notification_triggers SET delay_days = 3 WHERE id = v_gat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: service role nao consegue gravar regra de gatilho'; END IF;

  PERFORM set_config('role', v_dono, true);

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
