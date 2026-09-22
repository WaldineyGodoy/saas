DO $$
DECLARE r jsonb; v_sub uuid; v_tok uuid; v_uc uuid; v_ibge text; v_uf text; e jsonb;
BEGIN
  SELECT "Cod. Ibge","UF" INTO v_ibge, v_uf FROM public."Concessionaria" WHERE "Desconto Assinante" > 0 LIMIT 1;
  r := public.fn_criar_assinante_publico('Fulano Docs','52998224725','fd@teste.invalid','84999990000','59158155','Rua','1',null,'B','C',v_uf,v_ibge,null,null,
    jsonb_build_array(jsonb_build_object('numero_uc','TESTE-UC-DOC1','cpf_cnpj_fatura','52998224725','tipo_ligacao','bifasico','franquia','200','ibge',v_ibge,'uf',v_uf)),10,null,null,'3.0');
  v_sub := (r->>'subscriber_id')::uuid; v_tok := (r->>'onboarding_token')::uuid;
  SELECT id INTO v_uc FROM public.consumer_units WHERE subscriber_id = v_sub;

  IF public.fn_onboarding_assinante_por_token(v_tok) IS DISTINCT FROM v_sub THEN RAISE EXCEPTION 'FALHOU: token nao resolve'; END IF;
  IF public.fn_onboarding_assinante_por_token(gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: token falso resolve'; END IF;

  e := public.fn_onboarding_estado(v_tok);
  IF e->>'etapa' <> 'documentos' OR jsonb_array_length(e->'faltantes') <> 2 THEN
    RAISE EXCEPTION 'FALHOU: estado inicial %', e;
  END IF;
  -- A procuracao do contrato imprime a localidade de cada UC.
  IF e->'ucs'->0->>'uf' IS NULL THEN RAISE EXCEPTION 'FALHOU: uf da UC ausente no estado %', e->'ucs'; END IF;

  INSERT INTO public.subscriber_documents (subscriber_id, tipo, storage_path, mime, tamanho)
  VALUES (v_sub, 'identidade', v_sub || '/identidade/a.pdf', 'application/pdf', 10);
  INSERT INTO public.subscriber_documents (subscriber_id, consumer_unit_id, tipo, storage_path, mime, tamanho)
  VALUES (v_sub, v_uc, 'conta_energia', v_sub || '/conta_energia/b.pdf', 'application/pdf', 10);

  e := public.fn_onboarding_estado(v_tok);
  IF e->>'etapa' <> 'contrato' OR jsonb_array_length(e->'faltantes') <> 0 THEN RAISE EXCEPTION 'FALHOU: estado completo %', e; END IF;

  -- create-autentique-document grava a assinatura 'pending' ANTES de saber
  -- se a Autentique devolveu link; se nao devolveu (502), a linha fica com
  -- short_url NULL. Isso nao pode contar como 'enviado' (nada foi enviado
  -- e o Reenviar, que exige short_url, nao teria o que reenviar).
  INSERT INTO public.signatures (signer_id, signer_type, autentique_doc_id, status, short_url)
  VALUES (v_sub, 'subscriber', 'DOC-TESTE-SANDBOX', 'pending', NULL);

  e := public.fn_onboarding_estado(v_tok);
  IF e->>'etapa' <> 'contrato' THEN
    RAISE EXCEPTION 'FALHOU: assinatura pendente sem link curto nao deveria contar como enviado %', e;
  END IF;

  UPDATE public.signatures SET short_url = 'https://x/y' WHERE autentique_doc_id = 'DOC-TESTE-SANDBOX';

  e := public.fn_onboarding_estado(v_tok);
  IF e->>'etapa' <> 'enviado' THEN
    RAISE EXCEPTION 'FALHOU: assinatura pendente com link curto deveria ser enviado %', e;
  END IF;

  UPDATE public.subscribers SET onboarding_token_expira_em = now() - interval '1 minute' WHERE id = v_sub;
  IF public.fn_onboarding_estado(v_tok) IS NOT NULL THEN RAISE EXCEPTION 'FALHOU: token expirado aceito'; END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
