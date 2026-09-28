-- =====================================================================
-- Assinante Conect: link de indicacao, arvore e guarda de ciclo
-- Data: 28/09/2026
--
-- Padrao da casa: tudo roda dentro de um DO que termina em
-- RAISE EXCEPTION 'SANDBOX_OK'. Sucesso = receber esse erro; o erro
-- desfaz a transacao inteira, entao nenhuma linha de teste sobra em
-- producao. Qualquer outra mensagem e falha de verdade.
-- =====================================================================

DO $$
DECLARE
  v_ind uuid; v_uc_ind uuid; v_uc_ind2 uuid;
  v_outro uuid; v_novo uuid; v_lead uuid; v_orig uuid;
  v_ret jsonb; v_tmp uuid; v_ucs jsonb;
BEGIN
  -- ---------------- 0. colunas e gatilhos existem ----------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='subscribers' AND column_name='short_url') THEN
    RAISE EXCEPTION 'FALHA: subscribers.short_url nao existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='subscribers' AND column_name='indicador_assinante_id') THEN
    RAISE EXCEPTION 'FALHA: subscribers.indicador_assinante_id nao existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='leads' AND column_name='indicador_assinante_id') THEN
    RAISE EXCEPTION 'FALHA: leads.indicador_assinante_id nao existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_assinante_short_url') THEN
    RAISE EXCEPTION 'FALHA: gatilho trg_assinante_short_url nao existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_assinante_indicador_sem_ciclo') THEN
    RAISE EXCEPTION 'FALHA: gatilho trg_assinante_indicador_sem_ciclo nao existe';
  END IF;

  SELECT id INTO v_orig FROM public.originators_v2 ORDER BY created_at LIMIT 1;

  -- ---------------- fixture: o indicador, com duas UCs ----------------
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status, originator_id, short_url)
  VALUES ('Teste Conect Indicador', '52998224725', 'conect.ind@example.test', '5511999990001', 'ativo', v_orig,
          'https://link.b2wenergia.com.br/teste-cind')
  RETURNING id INTO v_ind;

  INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
    status, modalidade, desconto_assinante, dia_vencimento, created_at)
  VALUES (v_ind, 'TST-CONECT-0001', 'Teste Conect Indicador', '52998224725', 'monofasico',
    'ativo', 'geracao_compartilhada', 0.20, 10, now() - interval '2 years')
  RETURNING id INTO v_uc_ind;

  INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
    status, modalidade, desconto_assinante, dia_vencimento, created_at)
  VALUES (v_ind, 'TST-CONECT-0002', 'Teste Conect Indicador', '52998224725', 'monofasico',
    'ativo', 'geracao_compartilhada', 0.20, 10, now())
  RETURNING id INTO v_uc_ind2;

  -- ---------------- 1. guarda: ninguem indica a si mesmo ----------------
  BEGIN
    UPDATE public.subscribers SET indicador_assinante_id = v_ind WHERE id = v_ind;
    RAISE EXCEPTION 'FALHA: aceitou assinante como indicador de si mesmo';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- ---------------- 2. guarda: ciclo A -> B -> A recusado ----------------
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status, indicador_assinante_id)
  VALUES ('Teste Conect Filho', '11144477735', 'conect.filho@example.test', '5511999990002', 'ativo', v_ind)
  RETURNING id INTO v_outro;

  BEGIN
    UPDATE public.subscribers SET indicador_assinante_id = v_outro WHERE id = v_ind;
    RAISE EXCEPTION 'FALHA: aceitou ciclo de indicacao entre dois assinantes';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- ---------------- 3. RPC: indicador valido entra na arvore ----------------
  v_ucs := jsonb_build_array(jsonb_build_object(
    'numero_uc', 'TST-CONECT-9001', 'cpf_cnpj_fatura', '39053344705', 'tipo_ligacao', 'monofasico',
    'titular_conta', 'Teste Conect Indicado', 'concessionaria', 'CEMIG',
    'cep', '35110000', 'rua', 'Rua Teste', 'numero', '1', 'bairro', 'Centro',
    'cidade', 'Acucena', 'uf', 'MG', 'ibge', '3100500'));

  v_ret := public.fn_criar_assinante_publico(
    p_nome := 'Teste Conect Indicado', p_cpf_cnpj := '39053344705', p_email := 'conect.ind1@example.test',
    p_telefone := '5511999990003', p_cep := '35110000', p_rua := 'Rua Teste', p_numero := '1',
    p_complemento := NULL, p_bairro := 'Centro', p_cidade := 'Acucena', p_uf := 'MG', p_ibge := '3100500',
    p_originator_id := NULL, p_lead_id := NULL, p_ucs := v_ucs, p_dia_vencimento := 10,
    p_representante_nome := NULL, p_representante_cpf := NULL, p_aceite_versao := '3.0',
    p_indicador_assinante_id := v_ind::text);

  v_novo := (v_ret->>'subscriber_id')::uuid;

  IF (v_ret->>'indicador_vinculado') <> 'true' THEN
    RAISE EXCEPTION 'FALHA: RPC nao devolveu indicador_vinculado=true (%)', v_ret::text;
  END IF;

  SELECT indicador_assinante_id INTO v_tmp FROM public.subscribers WHERE id = v_novo;
  IF v_tmp IS DISTINCT FROM v_ind THEN
    RAISE EXCEPTION 'FALHA: subscribers.indicador_assinante_id ficou % em vez de %', v_tmp, v_ind;
  END IF;

  -- a arvore do split e por UC: a UC nova pendura na PRIMEIRA UC do indicador
  SELECT indicado_por_uc_id INTO v_tmp FROM public.consumer_units WHERE subscriber_id = v_novo;
  IF v_tmp IS DISTINCT FROM v_uc_ind THEN
    RAISE EXCEPTION 'FALHA: indicado_por_uc_id ficou % em vez da primeira UC %', v_tmp, v_uc_ind;
  END IF;

  -- o Parceiro Power do indicador continua na linha
  SELECT originator_id INTO v_tmp FROM public.subscribers WHERE id = v_novo;
  IF v_tmp IS DISTINCT FROM v_orig THEN
    RAISE EXCEPTION 'FALHA: originador nao foi herdado do indicador (ficou %)', v_tmp;
  END IF;

  -- ---------------- 4. RPC: indicador vem do lead quando nao vem na chamada ----
  INSERT INTO public.leads (name, phone, email, status, indicador_assinante_id)
  VALUES ('Teste Conect Lead', '5511999990004', 'conect.lead@example.test', 'simulacao', v_ind)
  RETURNING id INTO v_lead;

  v_ucs := jsonb_build_array(jsonb_build_object(
    'numero_uc', 'TST-CONECT-9002', 'cpf_cnpj_fatura', '11222333000181', 'tipo_ligacao', 'bifasico',
    'titular_conta', 'Teste Conect Lead', 'concessionaria', 'CEMIG',
    'cep', '35110000', 'rua', 'Rua Teste', 'numero', '2', 'bairro', 'Centro',
    'cidade', 'Acucena', 'uf', 'MG', 'ibge', '3100500'));

  v_ret := public.fn_criar_assinante_publico(
    p_nome := 'Teste Conect Lead Assinante', p_cpf_cnpj := '11222333000181', p_email := 'conect.lead2@example.test',
    p_telefone := '5511999990005', p_cep := '35110000', p_rua := 'Rua Teste', p_numero := '2',
    p_complemento := NULL, p_bairro := 'Centro', p_cidade := 'Acucena', p_uf := 'MG', p_ibge := '3100500',
    p_originator_id := NULL, p_lead_id := v_lead, p_ucs := v_ucs, p_dia_vencimento := 10,
    p_representante_nome := 'Teste Representante', p_representante_cpf := '52998224725',
    p_aceite_versao := '3.0', p_indicador_assinante_id := NULL);

  SELECT indicador_assinante_id INTO v_tmp FROM public.subscribers WHERE id = (v_ret->>'subscriber_id')::uuid;
  IF v_tmp IS DISTINCT FROM v_ind THEN
    RAISE EXCEPTION 'FALHA: indicador do lead nao foi herdado (ficou %)', v_tmp;
  END IF;

  -- ---------------- 5. RPC: texto invalido de indicador nao derruba a adesao ----
  v_ucs := jsonb_build_array(jsonb_build_object(
    'numero_uc', 'TST-CONECT-9003', 'cpf_cnpj_fatura', '39053344705', 'tipo_ligacao', 'trifasico',
    'titular_conta', 'Teste Conect Lixo', 'concessionaria', 'CEMIG',
    'cep', '35110000', 'rua', 'Rua Teste', 'numero', '3', 'bairro', 'Centro',
    'cidade', 'Acucena', 'uf', 'MG', 'ibge', '3100500'));

  v_ret := public.fn_criar_assinante_publico(
    p_nome := 'Teste Conect Lixo', p_cpf_cnpj := '98765432100', p_email := 'conect.lixo@example.test',
    p_telefone := '5511999990006', p_cep := '35110000', p_rua := 'Rua Teste', p_numero := '3',
    p_complemento := NULL, p_bairro := 'Centro', p_cidade := 'Acucena', p_uf := 'MG', p_ibge := '3100500',
    p_originator_id := NULL, p_lead_id := NULL, p_ucs := v_ucs, p_dia_vencimento := 10,
    p_representante_nome := NULL, p_representante_cpf := NULL, p_aceite_versao := '3.0',
    p_indicador_assinante_id := 'nao-e-uuid');

  IF (v_ret->>'indicador_vinculado') <> 'false' THEN
    RAISE EXCEPTION 'FALHA: indicador invalido deveria ser ignorado (%)', v_ret::text;
  END IF;
  SELECT indicado_por_uc_id INTO v_tmp FROM public.consumer_units
   WHERE subscriber_id = (v_ret->>'subscriber_id')::uuid;
  IF v_tmp IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA: UC ganhou indicado_por_uc_id sem indicador valido (%)', v_tmp;
  END IF;

  -- ---------------- 6. RPC: quem ainda nao assinou nao indica ----------------
  UPDATE public.subscribers SET status = 'ativacao' WHERE id = v_ind;

  v_ucs := jsonb_build_array(jsonb_build_object(
    'numero_uc', 'TST-CONECT-9004', 'cpf_cnpj_fatura', '39053344705', 'tipo_ligacao', 'monofasico',
    'titular_conta', 'Teste Conect Inelegivel', 'concessionaria', 'CEMIG',
    'cep', '35110000', 'rua', 'Rua Teste', 'numero', '4', 'bairro', 'Centro',
    'cidade', 'Acucena', 'uf', 'MG', 'ibge', '3100500'));

  v_ret := public.fn_criar_assinante_publico(
    p_nome := 'Teste Conect Inelegivel', p_cpf_cnpj := '12345678909', p_email := 'conect.inel@example.test',
    p_telefone := '5511999990007', p_cep := '35110000', p_rua := 'Rua Teste', p_numero := '4',
    p_complemento := NULL, p_bairro := 'Centro', p_cidade := 'Acucena', p_uf := 'MG', p_ibge := '3100500',
    p_originator_id := NULL, p_lead_id := NULL, p_ucs := v_ucs, p_dia_vencimento := 10,
    p_representante_nome := NULL, p_representante_cpf := NULL, p_aceite_versao := '3.0',
    p_indicador_assinante_id := v_ind::text);

  IF (v_ret->>'indicador_vinculado') <> 'false' THEN
    RAISE EXCEPTION 'FALHA: assinante em ativacao nao pode indicar (%)', v_ret::text;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
