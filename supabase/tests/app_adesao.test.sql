-- =====================================================================
-- Adesão pelo app (20261011d) · 11/10/2026
-- Padrao da casa: termina em RAISE EXCEPTION 'SANDBOX_OK' (tudo desfeito).
-- Usa o plano ativo da Neoenergia Cosern e o desconto municipal de Natal.
-- =====================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_plano uuid;
  v_desc_plano numeric;
  v_visita uuid; v_r jsonb; v_j jsonb; v_sub uuid; v_uc record;
  v_uc_base jsonb := jsonb_build_object(
    'numero_uc', '9990001234', 'titular_conta', 'Rita Adesao Teste', 'cpf_cnpj_fatura', '11144477735',
    'tipo_ligacao', 'monofasico', 'concessionaria', 'Neoenergia Cosern', 'franquia', 300,
    'ibge', '2408102', 'cep', '59000000', 'rua', 'Rua A', 'numero', '10', 'bairro', 'Centro', 'cidade', 'Natal', 'uf', 'RN');
BEGIN
  SELECT p.id, p.desconto_assinante INTO v_plano, v_desc_plano
    FROM public.planos_assinatura_energia p JOIN public.planos_distribuidoras d ON d.plano_id = p.id
   WHERE p.ativo AND d.concessionaria = 'Neoenergia Cosern' LIMIT 1;
  IF v_plano IS NULL THEN RAISE EXCEPTION 'pre-condicao: sem plano ativo da Cosern'; END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, email_confirmed_at)
  VALUES (v_uid, 'rita.adesao@example.test', '{"name":"Rita Adesao Teste"}', 'authenticated', 'authenticated', now());
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ---------------- 1. planos para quem ainda nao e assinante ----------------
  IF NOT EXISTS (SELECT 1 FROM public.app_planos_adesao('neoenergia cosern') WHERE id = v_plano) THEN
    RAISE EXCEPTION 'FALHA 1: login sem assinatura deveria ver os planos da distribuidora';
  END IF;

  -- ---------------- 2. adesao com plano: desconto do plano, e-mail da conta ----------------
  v_visita := public.app_registrar_interesse(jsonb_build_object('name', 'Rita Adesao Teste', 'phone', '84935353535'), NULL, 'app');
  v_r := public.app_criar_adesao(jsonb_build_object(
    'name', 'Rita Adesao Teste', 'cpf_cnpj', '111.444.777-35', 'phone', '84935353535',
    'cep', '59000-000', 'rua', 'Rua A', 'numero', '10', 'bairro', 'Centro', 'cidade', 'Natal', 'uf', 'RN', 'ibge', '2408102',
    'dia_vencimento', 10, 'aceite_versao', '3.0',
    'ucs', jsonb_build_array(v_uc_base || jsonb_build_object('plano_assinatura_id', v_plano))), v_visita);
  v_sub := (v_r ->> 'subscriber_id')::uuid;
  SELECT * INTO v_uc FROM public.consumer_units WHERE subscriber_id = v_sub;
  IF v_uc.plano_assinatura_id IS DISTINCT FROM v_plano OR v_uc.desconto_assinante <> v_desc_plano THEN
    RAISE EXCEPTION 'FALHA 2: UC deveria ter o plano e o desconto dele: % %', v_uc.plano_assinatura_id, v_uc.desconto_assinante;
  END IF;
  IF (SELECT email FROM public.subscribers WHERE id = v_sub) <> 'rita.adesao@example.test'
     OR (SELECT user_id FROM public.subscribers WHERE id = v_sub) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'FALHA 2b: o cadastro deveria ter o e-mail e o login da conta';
  END IF;
  IF (SELECT lead_id FROM public.subscribers WHERE id = v_sub) IS DISTINCT FROM (SELECT lead_id FROM public.lead_visitas WHERE id = v_visita) THEN
    RAISE EXCEPTION 'FALHA 2c: o cadastro deveria apontar para o lead da visita do app';
  END IF;

  -- ---------------- 3. retomar: token e etapa documentos ----------------
  v_j := public.app_minha_adesao();
  IF v_j ->> 'etapa' <> 'documentos' OR (v_j ->> 'token')::uuid IS DISTINCT FROM (SELECT onboarding_token FROM public.subscribers WHERE id = v_sub) THEN
    RAISE EXCEPTION 'FALHA 3: retomada deveria trazer o token e a etapa documentos: %', v_j;
  END IF;
  UPDATE public.subscribers SET onboarding_token_expira_em = now() - interval '1 day' WHERE id = v_sub;
  v_j := public.app_minha_adesao();
  IF v_j ->> 'etapa' <> 'documentos' THEN
    RAISE EXCEPTION 'FALHA 3b: token vencido deveria ser renovado para o dono: %', v_j;
  END IF;

  -- ---------------- 4. segunda adesao da mesma conta e recusada ----------------
  BEGIN
    PERFORM public.app_criar_adesao(jsonb_build_object('name', 'Rita'), NULL);
    RAISE EXCEPTION 'FALHA 4: abriu outra adesao com uma em andamento';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- ---------------- 5. plano de outra distribuidora e recusado; sem plano vale o municipio ----------------
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Outro Teste', '52998224725', 'outro.teste@example.test', '84936363636',
      '59000000', 'Rua B', '1', NULL, 'Centro', 'Natal', 'RN', '2408102', NULL, NULL,
      jsonb_build_array(v_uc_base || jsonb_build_object('numero_uc', '9990005678', 'cpf_cnpj_fatura', '52998224725',
                                                        'concessionaria', 'Equatorial Para', 'plano_assinatura_id', v_plano)),
      10, NULL, NULL, '3.0', NULL);
    RAISE EXCEPTION 'FALHA 5: aceitou plano de outra distribuidora';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_r := public.fn_criar_assinante_publico('Outro Teste', '52998224725', 'outro.teste@example.test', '84936363636',
    '59000000', 'Rua B', '1', NULL, 'Centro', 'Natal', 'RN', '2408102', NULL, NULL,
    jsonb_build_array(v_uc_base || jsonb_build_object('numero_uc', '9990005678', 'cpf_cnpj_fatura', '52998224725')),
    10, NULL, NULL, '3.0', NULL);
  SELECT * INTO v_uc FROM public.consumer_units WHERE subscriber_id = (v_r ->> 'subscriber_id')::uuid;
  IF v_uc.plano_assinatura_id IS NOT NULL OR v_uc.desconto_assinante <> public.fn_desconto_assinante_municipio('2408102', 'RN') THEN
    RAISE EXCEPTION 'FALHA 5b: sem plano o site deveria seguir com o desconto do municipio: % %', v_uc.plano_assinatura_id, v_uc.desconto_assinante;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END
$$;
