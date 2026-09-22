-- RPC de adesao v2. Tudo desfeito pelo SANDBOX_OK.
DO $$
DECLARE
  v_ibge text; v_uf text; v_desc numeric; r jsonb; v_sub uuid; v_org uuid; v_lead uuid;
  v_ucs jsonb; v_msg text;
  r2 jsonb; v_sub2 uuid; v_ucs2 jsonb;
BEGIN
  SELECT "Cod. Ibge", "UF", "Desconto Assinante" INTO v_ibge, v_uf, v_desc
    FROM public."Concessionaria" WHERE "Desconto Assinante" > 0 LIMIT 1;

  -- 1. desconto por municipio e fallback por UF
  IF public.fn_desconto_assinante_municipio(v_ibge, v_uf) IS DISTINCT FROM v_desc THEN
    RAISE EXCEPTION 'FALHOU: desconto por IBGE';
  END IF;
  IF public.fn_desconto_assinante_municipio('0000000', v_uf) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: sem fallback por UF';
  END IF;

  SELECT id INTO v_org FROM public.originators_v2 LIMIT 1;
  INSERT INTO public.leads (id, name, email, phone, status, originator_id)
  VALUES (gen_random_uuid(), 'Lead Teste', 'lt@teste.invalid', '84999990000', 'simulacao', v_org)
  RETURNING id INTO v_lead;

  v_ucs := jsonb_build_array(jsonb_build_object(
    'numero_uc','TESTE-UC-0001','titular_conta','Fulano Teste','cpf_cnpj_fatura','52998224725',
    'tipo_ligacao','monofasico','concessionaria','COSERN','franquia','300','ibge',v_ibge,
    'cep','59158155','rua','Rua A','numero','10','bairro','B','cidade','C','uf',v_uf));

  -- 2. sem aceite recusa
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Fulano Teste','52998224725','f@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,v_lead,v_ucs,10,null,null,null);
    RAISE EXCEPTION 'FALHOU: aceitou sem aceite';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT ILIKE '%termos%' THEN RAISE EXCEPTION 'FALHOU: erro inesperado sem aceite: %', v_msg; END IF;
  END;

  -- 3. CNPJ sem representante recusa
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Empresa Teste','11222333000181','e@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,10,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: CNPJ sem representante';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT ILIKE '%representante%' THEN RAISE EXCEPTION 'FALHOU: erro inesperado CNPJ: %', v_msg; END IF;
  END;

  -- 4. vencimento fora da lista recusa
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Fulano Teste','52998224725','f@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,7,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: aceitou vencimento 7';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT ILIKE '%vencimento%' THEN RAISE EXCEPTION 'FALHOU: erro inesperado venc: %', v_msg; END IF;
  END;

  -- 5. caminho feliz: originator_id invalido ignorado, herda do lead, grava desconto/vencimento/token
  r := public.fn_criar_assinante_publico('Fulano Teste','529.982.247-25','F@Teste.invalid','(84) 99999-0000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,'abc',v_lead,v_ucs,15,null,null,'3.0');
  v_sub := (r->>'subscriber_id')::uuid;
  IF (r->>'onboarding_token') IS NULL THEN RAISE EXCEPTION 'FALHOU: sem token'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscribers WHERE id = v_sub AND originator_id = v_org
                   AND aceite_termos_versao = '3.0' AND aceite_termos_em IS NOT NULL
                   AND onboarding_token_expira_em > now() + interval '29 days') THEN
    RAISE EXCEPTION 'FALHOU: assinante sem originador herdado/aceite/validade';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consumer_units WHERE subscriber_id = v_sub
                   AND desconto_assinante = v_desc AND dia_vencimento = 15
                   AND cpf_cnpj_fatura = '52998224725' AND tipo_ligacao = 'monofasico') THEN
    RAISE EXCEPTION 'FALHOU: UC sem desconto/vencimento/titular/ligacao';
  END IF;
  IF jsonb_typeof(r->'descontos') <> 'array' OR jsonb_array_length(r->'descontos') <> (r->>'ucs_criadas')::int THEN
    RAISE EXCEPTION 'FALHOU: descontos com tamanho diferente de ucs_criadas';
  END IF;
  IF (r->>'desconto')::numeric IS DISTINCT FROM (r->'descontos'->0->>'desconto')::numeric THEN
    RAISE EXCEPTION 'FALHOU: desconto nao e o do primeiro item de descontos';
  END IF;

  -- 5b. caminho feliz CNPJ: representante gravado (nome + cpf so digitos), descontos por UC em ordem
  v_ucs2 := jsonb_build_array(
    jsonb_build_object('numero_uc','TESTE-UC-0002','titular_conta','Empresa Teste','cpf_cnpj_fatura','52998224725',
      'tipo_ligacao','monofasico','concessionaria','COSERN','franquia','300','ibge',v_ibge,
      'cep','59158155','rua','Rua A','numero','10','bairro','B','cidade','C','uf',v_uf),
    jsonb_build_object('numero_uc','TESTE-UC-0003','titular_conta','Empresa Teste','cpf_cnpj_fatura','15350946056',
      'tipo_ligacao','bifasico','concessionaria','COSERN','franquia','500','ibge',v_ibge,
      'cep','59158155','rua','Rua A','numero','20','bairro','B','cidade','C','uf',v_uf));

  r2 := public.fn_criar_assinante_publico('Empresa Teste','11222333000181','emp@teste.invalid','84999990001',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs2,10,'Representante Teste','111.444.777-35','3.0');
  v_sub2 := (r2->>'subscriber_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.subscribers WHERE id = v_sub2
                   AND representante_nome = 'Representante Teste' AND representante_cpf = '11144477735') THEN
    RAISE EXCEPTION 'FALHOU: CNPJ happy path sem representante gravado';
  END IF;
  IF (r2->>'ucs_criadas')::int <> 2 OR jsonb_array_length(r2->'descontos') <> 2 THEN
    RAISE EXCEPTION 'FALHOU: CNPJ happy path com numero de descontos errado';
  END IF;
  IF (r2->'descontos'->0->>'numero_uc') <> 'TESTE-UC-0002' OR (r2->'descontos'->1->>'numero_uc') <> 'TESTE-UC-0003' THEN
    RAISE EXCEPTION 'FALHOU: ordem de descontos incorreta';
  END IF;
  IF (r2->>'desconto')::numeric IS DISTINCT FROM (r2->'descontos'->0->>'desconto')::numeric THEN
    RAISE EXCEPTION 'FALHOU: desconto do CNPJ nao e o do primeiro UC';
  END IF;

  -- 6. CPF duplicado recusa; UC duplicada recusa
  IF NOT public.fn_documento_em_uso('52998224725') THEN RAISE EXCEPTION 'FALHOU: documento em uso'; END IF;
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Outro','52998224725','o@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,10,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: CPF duplicado aceito';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.fn_criar_assinante_publico('Outro','15350946056','o@teste.invalid','84999990000',
      '59158155','Rua A','10',null,'B','C',v_uf,v_ibge,null,null,v_ucs,10,null,null,'3.0');
    RAISE EXCEPTION 'FALHOU: UC duplicada aceita';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
