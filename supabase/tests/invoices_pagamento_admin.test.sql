-- Task 17: so papel interno grava faturas e razao.
-- Regra do dono (22/09/2026): "embaixador nao pode marcar fatura como paga,
-- somente admins". Antes disto `invoices` e `ledger_entries` tinham politica
-- ALL com USING true para `authenticated` — qualquer papel logado gravava, e a
-- tela Faturas (InvoiceListManager) aparecia no menu de TODOS os papeis, com
-- arrastar-para-Pago, apagar e baixar conta.
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
--
-- Papeis simulados por set_config('role','authenticated') + request.jwt.claims,
-- que e exatamente como o PostgREST executa a consulta do navegador.
DO $$
DECLARE
  v_ass    uuid := gen_random_uuid();   -- assinante (papel nao interno)
  v_emb    uuid := gen_random_uuid();   -- embaixador/originador (o da regra)
  v_adm    uuid := gen_random_uuid();   -- admin (papel interno)
  v_fat    uuid := gen_random_uuid();   -- fatura fixture
  v_fat2   uuid := gen_random_uuid();   -- fatura que o admin insere
  v_conta  uuid;                        -- ledger_accounts 2.1.2 (comissoes)
  v_dono   text := current_user;
  v_n      integer;
  v_status text;
  v_erro   text;
  v_state  text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_ass, 'assin.fat@teste.invalid', '{"name":"Assinante"}',  'authenticated', 'authenticated'),
    (v_emb, 'emb.fat@teste.invalid',   '{"name":"Embaixador"}', 'authenticated', 'authenticated'),
    (v_adm, 'admin.fat@teste.invalid', '{"name":"Admin"}',      'authenticated', 'authenticated');

  UPDATE public.profiles SET role = 'subscriber' WHERE id = v_ass;
  UPDATE public.profiles SET role = 'originator' WHERE id = v_emb;
  UPDATE public.profiles SET role = 'admin'      WHERE id = v_adm;

  SELECT role INTO v_status FROM public.profiles WHERE id = v_emb;
  IF v_status <> 'originator' THEN RAISE EXCEPTION 'FIXTURE: papel do embaixador ficou %', v_status; END IF;

  SELECT id INTO v_conta FROM public.ledger_accounts WHERE code = '2.1.2';
  IF v_conta IS NULL THEN RAISE EXCEPTION 'FIXTURE: conta 2.1.2 (comissoes) nao existe'; END IF;

  -- Fatura sem UC de proposito: o alvo do teste e o portao de escrita, nao o
  -- rateio. Os gatilhos de invoices toleram uc_id nulo (conferido um a um).
  INSERT INTO public.invoices (id, uc_id, mes_referencia, vencimento, valor_a_pagar, valor_concessionaria, status)
  VALUES (v_fat, NULL, date_trunc('month', current_date)::date, current_date + 10, 123.45, 0, 'a_vencer');

  -- Um lancamento em 2.1.2 apontando para o embaixador: e o que o painel
  -- "Minhas Comissoes" (OriginatorDashboard) le. A leitura tem de sobreviver.
  INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
  VALUES (gen_random_uuid(), v_conta, -10.00, 'Comissao fixture', 'originator', v_emb);

  -- =====================================================================
  -- 1) ASSINANTE: le o que ja lia, mas nao grava fatura nem razao
  -- =====================================================================
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ass, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.invoices WHERE id = v_fat;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: assinante perdeu a leitura da fatura (SELECT devia continuar como hoje)'; END IF;

  v_erro := NULL; v_state := NULL; v_n := -1;
  BEGIN
    UPDATE public.invoices SET status = 'pago' WHERE id = v_fat;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN
    RAISE EXCEPTION 'FALHOU: assinante marcou fatura como paga (% linha[s], sem erro)', v_n;
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: assinante barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  v_erro := NULL; v_state := NULL;
  BEGIN
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (gen_random_uuid(), v_conta, -999.00, 'Comissao forjada pelo assinante', 'originator', v_ass);
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: assinante lancou no razao'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: INSERT no razao pelo assinante barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- =====================================================================
  -- 2) EMBAIXADOR: a regra do dono, letra por letra
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emb, 'role', 'authenticated')::text, true);

  -- 2a) leitura do proprio extrato de comissao continua (Minhas Comissoes)
  SELECT count(*) INTO v_n
    FROM public.ledger_entries
   WHERE reference_type = 'originator' AND reference_id = v_emb;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: embaixador perdeu a leitura do proprio extrato 2.1.2 (% linha[s])', v_n; END IF;

  -- 2b) marcar como paga: barrado, e com erro — nao em silencio
  v_erro := NULL; v_state := NULL; v_n := -1;
  BEGIN
    UPDATE public.invoices SET status = 'pago' WHERE id = v_fat;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN
    RAISE EXCEPTION 'FALHOU: embaixador marcou fatura como paga (% linha[s], sem erro)', v_n;
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: embaixador barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- 2c) o status da fatura nao se mexeu
  SELECT status::text INTO v_status FROM public.invoices WHERE id = v_fat;
  IF v_status <> 'a_vencer' THEN RAISE EXCEPTION 'FALHOU: status da fatura virou % depois da tentativa do embaixador', v_status; END IF;

  -- 2d) criar fatura
  v_erro := NULL; v_state := NULL;
  BEGIN
    INSERT INTO public.invoices (uc_id, mes_referencia, vencimento, valor_a_pagar, status)
    VALUES (NULL, date_trunc('month', current_date)::date, current_date + 10, 1.00, 'a_vencer');
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador inseriu fatura'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: INSERT de fatura pelo embaixador barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- 2e) apagar fatura: nem uma linha alcancada (DELETE e so do papel interno)
  DELETE FROM public.invoices WHERE id = v_fat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador apagou fatura (% linha[s])', v_n; END IF;

  -- 2f) razao: nem inserir, nem alterar, nem apagar o proprio lancamento
  v_erro := NULL; v_state := NULL;
  BEGIN
    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
    VALUES (gen_random_uuid(), v_conta, -5000.00, 'Comissao forjada pelo embaixador', 'originator', v_emb);
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador lancou comissao para si no razao'; END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'FALHOU: INSERT no razao pelo embaixador barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  UPDATE public.ledger_entries SET amount = -5000.00
   WHERE reference_type = 'originator' AND reference_id = v_emb;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador aumentou a propria comissao no razao (% linha[s])', v_n; END IF;

  DELETE FROM public.ledger_entries WHERE reference_type = 'originator' AND reference_id = v_emb;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador apagou lancamento do razao (% linha[s])', v_n; END IF;

  -- =====================================================================
  -- 3) ADMIN (papel interno): tudo o que a operacao faz hoje continua
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);

  UPDATE public.invoices SET status = 'pago' WHERE id = v_fat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue marcar fatura como paga (% linha[s])', v_n; END IF;

  -- O gatilho tr_invoice_paid_ledger (SECURITY DEFINER, Task 16) tem de
  -- continuar lancando no razao mesmo com a escrita fechada ao usuario comum.
  SELECT count(*) INTO v_n FROM public.ledger_entries WHERE reference_type = 'invoice' AND reference_id = v_fat;
  IF v_n = 0 THEN RAISE EXCEPTION 'FALHOU: baixa do admin nao lancou nada no razao (gatilho de fatura paga quebrou)'; END IF;

  INSERT INTO public.invoices (id, uc_id, mes_referencia, vencimento, valor_a_pagar, status)
  VALUES (v_fat2, NULL, date_trunc('month', current_date)::date, current_date + 10, 50.00, 'a_vencer');
  SELECT count(*) INTO v_n FROM public.invoices WHERE id = v_fat2;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue criar fatura'; END IF;

  INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
  VALUES (gen_random_uuid(), v_conta, -1.00, 'Ajuste manual do admin', 'originator', v_emb);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue lancar no razao'; END IF;

  DELETE FROM public.invoices WHERE id = v_fat2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue apagar fatura'; END IF;

  -- =====================================================================
  -- 4) SERVICE ROLE / robos (faturista, emissor, enviador, webhook Asaas):
  --    escrevem sem sessao de usuario e nao podem ser atingidos
  -- =====================================================================
  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  UPDATE public.invoices SET valor_a_pagar = 321.00 WHERE id = v_fat;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: robo/service role nao consegue gravar fatura'; END IF;

  INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
  VALUES (gen_random_uuid(), v_conta, -2.00, 'Lancamento do robo', 'originator', v_emb);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: robo/service role nao consegue lancar no razao'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
