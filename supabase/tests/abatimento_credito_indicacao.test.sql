-- =====================================================================
-- Abatimento do credito de indicacao (20261006a)
-- Data: 06/10/2026
--
-- Padrao da casa: tudo roda dentro de um DO que termina em
-- RAISE EXCEPTION 'SANDBOX_OK'. Sucesso = receber esse erro; o erro
-- desfaz a transacao inteira, entao nenhuma linha de teste sobra em
-- producao. Qualquer outra mensagem e falha de verdade.
-- =====================================================================

DO $$
DECLARE
  v_ind uuid; v_outro uuid; v_uc1 uuid; v_uc2 uuid; v_uc3 uuid; v_uc_outro uuid;
  v_conect uuid; v_f1 uuid; v_f2 uuid; v_f3 uuid; v_g1 uuid; v_g2 uuid; v_h1 uuid; v_h2 uuid;
  v_a1 uuid; v_n1 uuid; v_n2 uuid; v_n3 uuid; v_x uuid;
  v_ret jsonb; v_num numeric; v_txt text; v_ids uuid[]; v_total numeric; v_cnt int;
BEGIN
  SELECT id INTO v_conect FROM public.ledger_accounts WHERE code = '2.1.6';
  IF NOT EXISTS (SELECT 1 FROM public.ledger_accounts WHERE code = '3.1.5') THEN
    RAISE EXCEPTION 'FALHA: conta 3.1.5 nao existe';
  END IF;

  -- ---------------- fixture: indicador com tres UCs ----------------
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Teste Abatimento Indicador', '11144477735', 'abat.ind@example.test', '5511999990011', 'ativo')
  RETURNING id INTO v_ind;
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Teste Abatimento Outro', '52998224725', 'abat.outro@example.test', '5511999990012', 'ativo')
  RETURNING id INTO v_outro;

  INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
    status, modalidade, desconto_assinante, dia_vencimento)
  VALUES (v_ind, 'TST-ABAT-0001', 'Teste', '11144477735', 'monofasico', 'ativo', 'geracao_compartilhada', 0.20, 10)
  RETURNING id INTO v_uc1;
  INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
    status, modalidade, desconto_assinante, dia_vencimento)
  VALUES (v_ind, 'TST-ABAT-0002', 'Teste', '11144477735', 'monofasico', 'ativo', 'geracao_compartilhada', 0.20, 10)
  RETURNING id INTO v_uc2;
  INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
    status, modalidade, desconto_assinante, dia_vencimento)
  VALUES (v_ind, 'TST-ABAT-0003', 'Teste', '11144477735', 'monofasico', 'ativo', 'geracao_compartilhada', 0.20, 5)
  RETURNING id INTO v_uc3;
  INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
    status, modalidade, desconto_assinante, dia_vencimento)
  VALUES (v_outro, 'TST-ABAT-0009', 'Teste', '52998224725', 'monofasico', 'ativo', 'geracao_compartilhada', 0.20, 10)
  RETURNING id INTO v_uc_outro;

  -- credito de R$ 30,00 na 2.1.6, como o gatilho do razao lanca
  INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
  VALUES (gen_random_uuid(), v_conect, -30, 'teste credito', 'subscriber', v_ind);

  IF public.fn_saldo_credito_indicacao(v_ind) <> 30 THEN
    RAISE EXCEPTION 'FALHA 0: saldo inicial deveria ser 30, veio %', public.fn_saldo_credito_indicacao(v_ind);
  END IF;

  -- ---------------- ciclo 2099-01: ordem e transbordo ----------------
  -- F3 vence antes (dia 5); F1 e F2 empatam no dia 10 e F2 vale mais.
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, mes_referencia, vencimento)
  VALUES (v_uc1, 'ag_emissao_boleto', 20, 20, 0, '2099-01-01', '2099-02-10') RETURNING id INTO v_f1;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, mes_referencia, vencimento)
  VALUES (v_uc2, 'ag_emissao_boleto', 50, 50, 0, '2099-01-01', '2099-02-10') RETURNING id INTO v_f2;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, mes_referencia, vencimento)
  VALUES (v_uc3, 'ag_emissao_boleto', 15, 15, 0, '2099-01-01', '2099-02-05') RETURNING id INTO v_f3;

  v_ret := public.fn_aplicar_credito_indicacao(v_ind, ARRAY[v_f1, v_f2, v_f3]);

  IF (v_ret->>'aplicado')::numeric <> 30 OR (v_ret->>'descartado')::numeric <> 0 THEN
    RAISE EXCEPTION 'FALHA 1: aplicado/descartado errados: %', v_ret;
  END IF;
  -- F3 primeiro (15, zera), F2 depois (15 de 50), F1 intocada
  SELECT valor_a_pagar INTO v_num FROM public.invoices WHERE id = v_f3;
  IF v_num <> 0 THEN RAISE EXCEPTION 'FALHA 1a: F3 deveria zerar, ficou %', v_num; END IF;
  SELECT status::text || '/' || asaas_status INTO v_txt FROM public.invoices WHERE id = v_f3;
  IF v_txt <> 'pago/QUITADA_CREDITO' THEN RAISE EXCEPTION 'FALHA 1b: F3 deveria estar quitada por credito, esta %', v_txt; END IF;
  SELECT valor_a_pagar INTO v_num FROM public.invoices WHERE id = v_f2;
  IF v_num <> 35 THEN RAISE EXCEPTION 'FALHA 1c: empate -> maior valor primeiro; F2 deveria ficar 35, ficou %', v_num; END IF;
  SELECT valor_a_pagar INTO v_num FROM public.invoices WHERE id = v_f1;
  IF v_num <> 20 THEN RAISE EXCEPTION 'FALHA 1d: F1 nao deveria ser tocada, ficou %', v_num; END IF;
  IF (SELECT abatimento_indicacao FROM public.invoices WHERE id = v_f2) <> 15 THEN
    RAISE EXCEPTION 'FALHA 1e: abatimento_indicacao da F2 deveria ser 15';
  END IF;
  IF public.fn_saldo_credito_indicacao(v_ind) <> 0 THEN
    RAISE EXCEPTION 'FALHA 1f: saldo deveria zerar, ficou %', public.fn_saldo_credito_indicacao(v_ind);
  END IF;
  SELECT string_agg(ordem::text || ':' || to_char(valor, 'FM999990.00'), ',' ORDER BY ordem) INTO v_txt
    FROM public.creditos_indicacao_uso WHERE subscriber_id = v_ind AND tipo = 'abatimento';
  IF v_txt <> '1:15.00,2:15.00' THEN RAISE EXCEPTION 'FALHA 1g: extrato errado: %', v_txt; END IF;
  -- quitada por credito nao paga taxa do Asaas
  IF EXISTS (SELECT 1 FROM public.ledger_entries le JOIN public.ledger_accounts a ON a.id = le.account_id
              WHERE a.code = '4.1.1' AND le.reference_id = v_f3 AND le.amount <> 0) THEN
    RAISE EXCEPTION 'FALHA 1h: fatura quitada por credito lancou taxa do Asaas';
  END IF;

  -- ---------------- 2. chamada repetida nao abate de novo ----------------
  v_ret := public.fn_aplicar_credito_indicacao(v_ind, ARRAY[v_f1, v_f2]);
  IF (v_ret->>'aplicado')::numeric <> 0 THEN RAISE EXCEPTION 'FALHA 2: abateu duas vezes: %', v_ret; END IF;
  IF (SELECT valor_a_pagar FROM public.invoices WHERE id = v_f2) <> 35 THEN
    RAISE EXCEPTION 'FALHA 2b: F2 mudou na segunda chamada';
  END IF;

  -- ---------------- 3. recalcular mantem o abatimento ----------------
  SELECT r.valor_a_pagar INTO v_num FROM public.fn_calcular_fatura(v_f2, false) r;
  IF v_num <> 35 THEN RAISE EXCEPTION 'FALHA 3: recalculo deveria dar 50 - 15 = 35, deu %', v_num; END IF;

  -- ---------------- 4. cancelamento devolve ao saldo ----------------
  UPDATE public.invoices SET status = 'cancelado' WHERE id = v_f2;
  IF public.fn_saldo_credito_indicacao(v_ind) <> 15 THEN
    RAISE EXCEPTION 'FALHA 4: estorno deveria devolver 15, saldo %', public.fn_saldo_credito_indicacao(v_ind);
  END IF;
  SELECT valor_a_pagar INTO v_num FROM public.invoices WHERE id = v_f2;
  IF v_num <> 50 OR (SELECT abatimento_indicacao FROM public.invoices WHERE id = v_f2) <> 0 THEN
    RAISE EXCEPTION 'FALHA 4b: fatura cancelada deveria voltar a 50 sem abatimento, ficou %', v_num;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creditos_indicacao_uso WHERE invoice_id = v_f2 AND tipo = 'estorno' AND valor = 15) THEN
    RAISE EXCEPTION 'FALHA 4c: estorno nao foi para o extrato';
  END IF;

  -- ---------------- 5. sobra do ciclo fechado e descartada ----------------
  -- saldo agora: 15 + 85 = 100
  INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
  VALUES (gen_random_uuid(), v_conect, -85, 'teste credito', 'subscriber', v_ind);
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc1, 'ag_emissao_boleto', 30, '2099-02-01', '2099-03-10') RETURNING id INTO v_g1;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc2, 'ag_emissao_boleto', 40, '2099-02-01', '2099-03-10') RETURNING id INTO v_g2;

  v_ret := public.fn_aplicar_credito_indicacao(v_ind, ARRAY[v_g1, v_g2]);
  IF (v_ret->>'aplicado')::numeric <> 70 OR (v_ret->>'descartado')::numeric <> 30 THEN
    RAISE EXCEPTION 'FALHA 5: esperado aplicar 70 e descartar 30: %', v_ret;
  END IF;
  IF public.fn_saldo_credito_indicacao(v_ind) <> 0 THEN
    RAISE EXCEPTION 'FALHA 5b: depois do descarte o saldo deveria ser 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_entries le JOIN public.ledger_accounts a ON a.id = le.account_id
                  WHERE a.code = '3.1.5' AND le.reference_id = v_ind AND le.amount = -30) THEN
    RAISE EXCEPTION 'FALHA 5c: descarte nao foi lancado na 3.1.5';
  END IF;

  -- ---------------- 6. ciclo ainda aberto: sobra NAO e descartada ----------------
  INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
  VALUES (gen_random_uuid(), v_conect, -100, 'teste credito', 'subscriber', v_ind);
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc1, 'ag_emissao_boleto', 10, '2099-03-01', '2099-04-10') RETURNING id INTO v_h1;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc2, 'ag_emissao_boleto', 10, '2099-03-01', '2099-04-10') RETURNING id INTO v_h2;

  v_ret := public.fn_aplicar_credito_indicacao(v_ind, ARRAY[v_h1]);   -- emissao individual pela tela
  IF (v_ret->>'descartado')::numeric <> 0 OR public.fn_saldo_credito_indicacao(v_ind) <> 90 THEN
    RAISE EXCEPTION 'FALHA 6: com H2 aberta nao pode descartar: % / saldo %', v_ret, public.fn_saldo_credito_indicacao(v_ind);
  END IF;
  v_ret := public.fn_aplicar_credito_indicacao(v_ind, ARRAY[v_h2]);   -- ultima do mes fecha o ciclo
  IF (v_ret->>'aplicado')::numeric <> 10 OR (v_ret->>'descartado')::numeric <> 80 THEN
    RAISE EXCEPTION 'FALHA 6b: ultima fatura do mes deveria aplicar 10 e descartar 80: %', v_ret;
  END IF;

  -- ---------------- 7. fatura de outro assinante e recusada ----------------
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc_outro, 'ag_emissao_boleto', 10, '2099-03-01', '2099-04-10') RETURNING id INTO v_x;
  BEGIN
    PERFORM public.fn_aplicar_credito_indicacao(v_ind, ARRAY[v_x]);
    RAISE EXCEPTION 'FALHA 7: aceitou fatura de outro assinante';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- ---------------- 8. razao balanceado ----------------
  SELECT count(*) INTO v_cnt FROM (
    SELECT le.transaction_id
      FROM public.ledger_entries le
     WHERE le.transaction_id IN (SELECT transaction_id FROM public.creditos_indicacao_uso WHERE subscriber_id = v_ind)
     GROUP BY le.transaction_id
    HAVING round(sum(le.amount), 2) <> 0) z;
  IF v_cnt > 0 THEN RAISE EXCEPTION 'FALHA 8: % transacao(oes) do credito fora de balanco', v_cnt; END IF;

  -- ---------------- 9. fila: adiada vai junto no proximo ciclo ----------------
  -- A1: ciclo 2099-04 abaixo de R$ 5,00, adiado. N1..N3: ciclo 2099-05 das tres UCs.
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento, cobranca_adiada, cobranca_adiada_em)
  VALUES (v_uc1, 'ag_emissao_boleto', 3.50, '2099-04-01', '2099-05-10', true, now()) RETURNING id INTO v_a1;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc1, 'ag_emissao_boleto', 40, '2099-05-01', '2099-06-10') RETURNING id INTO v_n1;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc2, 'ag_emissao_boleto', 30, '2099-05-01', '2099-06-10') RETURNING id INTO v_n2;
  INSERT INTO public.invoices (uc_id, status, valor_a_pagar, mes_referencia, vencimento)
  VALUES (v_uc3, 'ag_emissao_boleto', 20, '2099-05-01', '2099-06-05') RETURNING id INTO v_n3;
  -- F1 (2099-01) ainda esta aberta; para isolar, ela e cancelada.
  UPDATE public.invoices SET status = 'cancelado' WHERE id = v_f1;
  UPDATE public.invoices SET status = 'cancelado' WHERE id = v_x;

  SELECT f.invoice_ids, f.total INTO v_ids, v_total
    FROM public.fn_fila_emissao_faturas(100000) f
   WHERE f.subscriber_id = v_ind AND f.ciclo = '2099-05-01';
  IF v_ids IS NULL OR NOT (v_a1 = ANY (v_ids)) THEN
    RAISE EXCEPTION 'FALHA 9: a adiada de 2099-04 deveria ir no ciclo 2099-05: %', v_ids;
  END IF;
  IF v_total <> 93.50 THEN RAISE EXCEPTION 'FALHA 9b: total do ciclo deveria ser 93,50, veio %', v_total; END IF;
  IF EXISTS (SELECT 1 FROM public.fn_fila_emissao_faturas(100000) f
              WHERE f.subscriber_id = v_ind AND f.ciclo = '2099-04-01') THEN
    RAISE EXCEPTION 'FALHA 9c: o ciclo adiado nao pode voltar sozinho para a fila';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END
$$;
