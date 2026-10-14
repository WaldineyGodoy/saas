-- Sandbox: adesão assistida pelo Parceiro Power. Tudo é desfeito no fim
-- (RAISE com SANDBOX_OK). Rodar com a migração 20261014c colada antes.
DO $t$
DECLARE
  v_par uuid; v_outro uuid; r jsonb; e jsonb; n int; v_sub uuid; v_orig uuid; v_err text;
BEGIN
  SELECT o.id INTO v_par FROM originators_v2 o JOIN auth.users u ON u.id = o.id
   WHERE o.ativo IS DISTINCT FROM false LIMIT 1;
  SELECT o.id INTO v_outro FROM originators_v2 o JOIN auth.users u ON u.id = o.id
   WHERE o.ativo IS DISTINCT FROM false AND o.id <> v_par LIMIT 1;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_par, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- e-mail obrigatório
  BEGIN
    PERFORM public.app_criar_adesao_cliente('{"name":"Cliente Sandbox"}'::jsonb);
    RAISE EXCEPTION 'FALHOU: aceitou sem e-mail';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;

  r := public.app_criar_adesao_cliente(jsonb_build_object(
    'name', 'Cliente Sandbox Assistida', 'cpf_cnpj', '52998224725', 'email', 'cliente-sandbox@example.invalid',
    'phone', '84999990001', 'cep', '59000000', 'rua', 'Rua Teste', 'numero', '1', 'bairro', 'Centro',
    'cidade', 'Natal', 'uf', 'RN', 'ibge', '2408102', 'dia_vencimento', 10, 'aceite_versao', 'v-sandbox',
    'ucs', jsonb_build_array(jsonb_build_object('numero_uc', '999000222', 'titular_conta', 'Cliente Sandbox Assistida',
      'cpf_cnpj_fatura', '52998224725', 'tipo_ligacao', 'trifasico', 'concessionaria', 'Neoenergia Cosern', 'franquia', 300,
      'cep', '59000000', 'rua', 'Rua Teste', 'numero', '1', 'bairro', 'Centro', 'cidade', 'Natal', 'uf', 'RN', 'ibge', '2408102'))));
  v_sub := (r ->> 'subscriber_id')::uuid;

  RESET ROLE;
  SELECT originator_id INTO v_orig FROM subscribers WHERE id = v_sub;
  IF v_orig IS DISTINCT FROM v_par THEN RAISE EXCEPTION 'FALHOU: originador %', v_orig; END IF;
  IF (SELECT user_id FROM subscribers WHERE id = v_sub) = v_par THEN RAISE EXCEPTION 'FALHOU: ligou a conta do parceiro'; END IF;
  SET LOCAL ROLE authenticated;

  e := public.app_adesao_cliente(v_sub);
  IF e ->> 'token' IS NULL OR e ->> 'etapa' IS NULL THEN RAISE EXCEPTION 'FALHOU: estado %', e; END IF;
  SELECT count(*) INTO n FROM public.app_rede_parceiro() x WHERE x.id = v_sub AND x.etapa = 'adesao';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHOU: rede nao mostra o cliente'; END IF;

  -- outro parceiro não vê nem continua
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
  IF public.app_adesao_cliente(v_sub) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: outro parceiro viu a adesao'; END IF;
  SELECT count(*) INTO n FROM public.app_rede_parceiro() x WHERE x.id = v_sub;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHOU: outro parceiro ve o cliente'; END IF;

  -- quem não é parceiro não cria
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.app_criar_adesao_cliente(r);
    RAISE EXCEPTION 'FALHOU: nao parceiro criou';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  RESET ROLE;

  RAISE EXCEPTION 'SANDBOX_OK etapa=% rede_total_par=%', e ->> 'etapa', (SELECT count(*) FROM subscribers WHERE originator_id = v_par);
END
$t$;
