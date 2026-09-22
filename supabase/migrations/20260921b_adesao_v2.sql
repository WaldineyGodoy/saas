ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS representante_nome text,
  ADD COLUMN IF NOT EXISTS representante_cpf text,
  ADD COLUMN IF NOT EXISTS aceite_termos_em timestamptz,
  ADD COLUMN IF NOT EXISTS aceite_termos_versao text,
  ADD COLUMN IF NOT EXISTS onboarding_token uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS onboarding_token_expira_em timestamptz;

-- Desconto do simulador, resolvido no servidor. Mesma regra da raiz:
-- municipio pelo IBGE; sem linha, media da UF.
CREATE OR REPLACE FUNCTION public.fn_desconto_assinante_municipio(p_ibge text, p_uf text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT "Desconto Assinante" FROM public."Concessionaria"
      WHERE "Cod. Ibge" = p_ibge AND "Desconto Assinante" > 0 LIMIT 1),
    (SELECT round(avg("Desconto Assinante"), 2) FROM public."Concessionaria"
      WHERE upper("UF") = upper(p_uf) AND "Desconto Assinante" > 0)
  );
$$;

-- Regra unica de duplicidade (RPC publica e SubscriberModal).
CREATE OR REPLACE FUNCTION public.fn_documento_em_uso(p_doc text, p_ignorar uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
     WHERE public.fn_so_digitos(cpf_cnpj) = public.fn_so_digitos(p_doc)
       AND status NOT IN ('cancelado', 'cancelado_inadimplente')
       AND (p_ignorar IS NULL OR id <> p_ignorar));
$$;
REVOKE EXECUTE ON FUNCTION public.fn_documento_em_uso(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_documento_em_uso(text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,jsonb);

CREATE OR REPLACE FUNCTION public.fn_criar_assinante_publico(
  p_nome text, p_cpf_cnpj text, p_email text, p_telefone text,
  p_cep text, p_rua text, p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text,
  p_ibge text, p_originator_id text, p_lead_id uuid, p_ucs jsonb,
  p_dia_vencimento int, p_representante_nome text, p_representante_cpf text, p_aceite_versao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_doc text := public.fn_so_digitos(p_cpf_cnpj);
  v_tel text := public.fn_so_digitos(p_telefone);
  v_rep text := public.fn_so_digitos(p_representante_cpf);
  v_originator uuid; v_sub_id uuid; v_token uuid := gen_random_uuid();
  v_uc jsonb; v_uc_num text; v_tit text; v_desc numeric; v_n int := 0;
  v_descontos jsonb := '[]'::jsonb; v_desc_primeiro numeric;
BEGIN
  IF coalesce(btrim(p_aceite_versao), '') = '' THEN
    RAISE EXCEPTION 'Aceite os termos de uso e a politica de privacidade para continuar.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_nome), '') = '' THEN RAISE EXCEPTION 'Informe o nome completo.' USING ERRCODE = '22023'; END IF;
  IF v_doc IS NULL OR NOT public.fn_documento_valido(v_doc) THEN RAISE EXCEPTION 'CPF/CNPJ invalido.' USING ERRCODE = '22023'; END IF;
  IF length(v_doc) = 14 AND (coalesce(btrim(p_representante_nome), '') = '' OR v_rep IS NULL
       OR length(v_rep) <> 11 OR NOT public.fn_documento_valido(v_rep)) THEN
    RAISE EXCEPTION 'Para CNPJ, informe nome e CPF validos do representante legal.' USING ERRCODE = '22023';
  END IF;
  IF v_tel IS NULL OR length(v_tel) < 10 THEN RAISE EXCEPTION 'Telefone invalido. Informe DDD + numero.' USING ERRCODE = '22023'; END IF;
  IF coalesce(btrim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail invalido.' USING ERRCODE = '22023'; END IF;
  IF p_dia_vencimento IS NULL OR p_dia_vencimento NOT IN (5, 10, 15, 20) THEN
    RAISE EXCEPTION 'Escolha o dia de vencimento: 5, 10, 15 ou 20.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_ucs) <> 'array' OR jsonb_array_length(p_ucs) = 0 THEN
    RAISE EXCEPTION 'Cadastre pelo menos uma unidade consumidora.' USING ERRCODE = '22023';
  END IF;
  IF public.fn_documento_em_uso(v_doc) THEN
    RAISE EXCEPTION 'Ja existe um assinante com este CPF/CNPJ.' USING ERRCODE = '23505';
  END IF;

  -- originator_id vem da URL: texto invalido e ignorado, nunca derruba a adesao.
  IF p_originator_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT o.id INTO v_originator FROM public.originators_v2 o WHERE o.id = p_originator_id::uuid;
  END IF;
  IF v_originator IS NULL AND p_lead_id IS NOT NULL THEN
    SELECT l.originator_id INTO v_originator FROM public.leads l WHERE l.id = p_lead_id;
  END IF;

  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status, cep, rua, numero, complemento, bairro, cidade, uf,
    originator_id, lead_id, representante_nome, representante_cpf, aceite_termos_em, aceite_termos_versao,
    onboarding_token, onboarding_token_expira_em)
  VALUES (btrim(p_nome), v_doc, lower(btrim(p_email)), v_tel, 'ativacao', public.fn_so_digitos(p_cep), p_rua, p_numero,
    p_complemento, p_bairro, p_cidade, upper(p_uf), v_originator, p_lead_id,
    nullif(btrim(coalesce(p_representante_nome, '')), ''), v_rep, now(), btrim(p_aceite_versao),
    v_token, now() + interval '30 days')
  RETURNING id INTO v_sub_id;

  FOR v_uc IN SELECT * FROM jsonb_array_elements(p_ucs) LOOP
    v_uc_num := btrim(coalesce(v_uc->>'numero_uc', ''));
    v_tit := public.fn_so_digitos(v_uc->>'cpf_cnpj_fatura');
    IF v_uc_num = '' THEN RAISE EXCEPTION 'Numero da UC e obrigatorio.' USING ERRCODE = '22023'; END IF;
    IF v_tit IS NULL OR NOT public.fn_documento_valido(v_tit) THEN
      RAISE EXCEPTION 'CPF/CNPJ do titular da conta invalido na UC %.', v_uc_num USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_uc->>'tipo_ligacao', '') NOT IN ('monofasico', 'bifasico', 'trifasico') THEN
      RAISE EXCEPTION 'Informe o tipo de ligacao da UC %.', v_uc_num USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.consumer_units cu WHERE btrim(cu.numero_uc) = v_uc_num
                 AND cu.status NOT IN ('cancelado', 'cancelado_inadimplente')) THEN
      RAISE EXCEPTION 'A UC % ja esta cadastrada.', v_uc_num USING ERRCODE = '23505';
    END IF;
    v_desc := public.fn_desconto_assinante_municipio(coalesce(nullif(v_uc->>'ibge', ''), p_ibge), coalesce(nullif(v_uc->>'uf', ''), p_uf));
    IF coalesce(v_desc, 0) <= 0 THEN
      RAISE EXCEPTION 'Ainda nao temos desconto disponivel para este municipio.' USING ERRCODE = '22023';
    END IF;
    IF v_n = 0 THEN v_desc_primeiro := v_desc; END IF;
    v_descontos := v_descontos || jsonb_build_array(jsonb_build_object('numero_uc', v_uc_num, 'desconto', v_desc));

    INSERT INTO public.consumer_units (subscriber_id, numero_uc, titular_conta, cpf_cnpj_fatura, tipo_ligacao,
      concessionaria, status, modalidade, franquia, desconto_assinante, dia_vencimento, address)
    VALUES (v_sub_id, v_uc_num, nullif(btrim(coalesce(v_uc->>'titular_conta', '')), ''), v_tit,
      (v_uc->>'tipo_ligacao')::public.uc_tipo_ligacao, nullif(btrim(coalesce(v_uc->>'concessionaria', '')), ''),
      'em_ativacao', 'geracao_compartilhada', nullif(v_uc->>'franquia', '')::numeric, v_desc, p_dia_vencimento,
      jsonb_build_object('cep', public.fn_so_digitos(v_uc->>'cep'), 'rua', v_uc->>'rua', 'numero', v_uc->>'numero',
        'complemento', v_uc->>'complemento', 'bairro', v_uc->>'bairro', 'cidade', v_uc->>'cidade', 'uf', upper(v_uc->>'uf')));
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('subscriber_id', v_sub_id, 'onboarding_token', v_token, 'ucs_criadas', v_n,
    'originador_vinculado', v_originator IS NOT NULL, 'desconto', v_desc_primeiro, 'descontos', v_descontos);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,int,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,int,text,text,text) TO anon, authenticated;
