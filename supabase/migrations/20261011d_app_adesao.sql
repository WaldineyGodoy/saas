-- =====================================================================
-- Adesão pelo app, etapa 3 (decisão do dono, 11/10/2026)
--
-- Conta de luz -> plano -> dados -> documentos são telas do app; só o
-- contrato abre o site (/contrato?retomar=<token>), que já entra no passo
-- de gerar e assinar. O cadastro é o mesmo do site (fn_criar_assinante_publico),
-- com duas diferenças:
--   1. A UC pode vir com o plano escolhido (plano_assinatura_id): o desconto
--      é o do plano, como no termo aditivo de nova UC (20261005a). Sem plano,
--      segue o desconto do município, como no site.
--   2. O e-mail é o da conta logada, e a indicação é a da visita registrada
--      no app (app_registrar_interesse).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Planos para quem ainda não é assinante
-- ---------------------------------------------------------------------
-- app_planos_para_uc exige assinante (é da nova UC). Na adesão a pessoa
-- ainda não é: mesmos planos (ofertas públicas), só para login confirmado.
CREATE OR REPLACE FUNCTION public.app_planos_adesao(p_concessionaria text)
RETURNS TABLE(id uuid, nome text, desconto_assinante numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id, p.nome, p.desconto_assinante
    FROM public.planos_assinatura_energia p
    JOIN public.planos_distribuidoras d ON d.plano_id = p.id
   WHERE p.ativo
     AND auth.uid() IS NOT NULL
     AND lower(btrim(d.concessionaria)) = lower(btrim(p_concessionaria))
   ORDER BY p.desconto_assinante DESC NULLS LAST, p.nome;
$$;
REVOKE EXECUTE ON FUNCTION public.app_planos_adesao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_planos_adesao(text) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. fn_criar_assinante_publico: plano opcional por UC
-- ---------------------------------------------------------------------
-- Remendo pontual no corpo (mesma assinatura, o site segue igual). Cada
-- trecho tem de aparecer exatamente uma vez, senão a migração falha.
DO $migr$
DECLARE
  v_def text := pg_get_functiondef(
    'public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)'::regprocedure);
  v_trocas text[][] := ARRAY[
    ARRAY['  v_substituidos uuid[];',
          '  v_substituidos uuid[];
  v_plano_id uuid; v_plano_desc numeric;'],
    ARRAY['    v_desc := public.fn_desconto_assinante_municipio(coalesce(nullif(v_uc->>''ibge'', ''''), p_ibge), coalesce(nullif(v_uc->>''uf'', ''''), p_uf));',
          '    -- Plano escolhido no app (20261011d): o desconto e o do plano, que
    -- precisa estar ativo e ligado a distribuidora da UC.
    v_plano_id := NULL; v_plano_desc := NULL;
    IF coalesce(v_uc->>''plano_assinatura_id'', '''') ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' THEN
      SELECT p.id, p.desconto_assinante INTO v_plano_id, v_plano_desc
        FROM public.planos_assinatura_energia p
        JOIN public.planos_distribuidoras d ON d.plano_id = p.id
       WHERE p.id = (v_uc->>''plano_assinatura_id'')::uuid AND p.ativo
         AND lower(btrim(d.concessionaria)) = lower(btrim(coalesce(v_uc->>''concessionaria'', '''')))
       LIMIT 1;
      IF v_plano_id IS NULL THEN
        RAISE EXCEPTION ''Este plano nao esta disponivel para a distribuidora da UC %.'', v_uc_num USING ERRCODE = ''22023'';
      END IF;
    END IF;
    v_desc := coalesce(v_plano_desc,
      public.fn_desconto_assinante_municipio(coalesce(nullif(v_uc->>''ibge'', ''''), p_ibge), coalesce(nullif(v_uc->>''uf'', ''''), p_uf)));'],
    ARRAY['dia_vencimento, address, indicado_por_uc_id)',
          'dia_vencimento, address, indicado_por_uc_id, plano_assinatura_id)'],
    ARRAY['      v_uc_indicadora);',
          '      v_uc_indicadora, v_plano_id);']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_trocas, 1) LOOP
    IF (length(v_def) - length(replace(v_def, v_trocas[i][1], ''))) / length(v_trocas[i][1]) <> 1 THEN
      RAISE EXCEPTION 'fn_criar_assinante_publico: trecho % nao encontrado exatamente uma vez', i;
    END IF;
    v_def := replace(v_def, v_trocas[i][1], v_trocas[i][2]);
  END LOOP;
  EXECUTE v_def;
END
$migr$;

-- ---------------------------------------------------------------------
-- 3. Adesão pela conta logada
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_criar_adesao(p_dados jsonb, p_visita uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_visita uuid := p_visita;
  r jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail para continuar.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscribers s WHERE s.user_id = v_uid AND s.status <> 'cancelado') THEN
    RAISE EXCEPTION 'Voce ja tem uma adesao. Continue por ela.' USING ERRCODE = '22023';
  END IF;

  -- Só vale visita do próprio lead (a que o app registrou para esta conta).
  IF v_visita IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.lead_visitas v JOIN public.leads l ON l.id = v.lead_id
        WHERE v.id = v_visita AND l.user_id = v_uid) THEN
    v_visita := NULL;
  END IF;
  IF v_visita IS NULL THEN
    SELECT v.id INTO v_visita
      FROM public.lead_visitas v JOIN public.leads l ON l.id = v.lead_id
     WHERE l.user_id = v_uid
     ORDER BY v.criado_em DESC NULLS LAST
     LIMIT 1;
  END IF;

  r := public.fn_criar_assinante_publico(
    p_dados ->> 'name', p_dados ->> 'cpf_cnpj', v_email, p_dados ->> 'phone',
    p_dados ->> 'cep', p_dados ->> 'rua', p_dados ->> 'numero', p_dados ->> 'complemento',
    p_dados ->> 'bairro', p_dados ->> 'cidade', p_dados ->> 'uf', p_dados ->> 'ibge',
    NULL, v_visita, coalesce(p_dados -> 'ucs', '[]'::jsonb),
    nullif(p_dados ->> 'dia_vencimento', '')::integer,
    p_dados ->> 'representante_nome', p_dados ->> 'representante_cpf',
    p_dados ->> 'aceite_versao', NULL);

  -- O gatilho de vínculo liga pelo e-mail; garante mesmo assim.
  UPDATE public.subscribers SET user_id = v_uid WHERE id = (r ->> 'subscriber_id')::uuid AND user_id IS NULL;
  RETURN r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_criar_adesao(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_criar_adesao(jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Retomar a adesão parada no meio
-- ---------------------------------------------------------------------
-- O token de retomada é do próprio cadastro da conta: quem chama é o dono.
-- Vencido (30 dias), ganha mais 30 enquanto a adesão estiver em ativação.
CREATE OR REPLACE FUNCTION public.app_minha_adesao()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_sub record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT s.id, s.status, s.onboarding_token INTO v_sub
    FROM public.subscribers s
   WHERE s.user_id = auth.uid() AND s.status <> 'cancelado'
   ORDER BY s.created_at DESC
   LIMIT 1;
  IF v_sub.id IS NULL THEN RETURN NULL; END IF;
  IF v_sub.status <> 'ativacao' THEN
    RETURN jsonb_build_object('etapa', 'assinado', 'status', v_sub.status);
  END IF;
  UPDATE public.subscribers
     SET onboarding_token = coalesce(onboarding_token, gen_random_uuid()),
         onboarding_token_expira_em = greatest(coalesce(onboarding_token_expira_em, now()), now() + interval '30 days')
   WHERE id = v_sub.id
  RETURNING onboarding_token INTO v_sub.onboarding_token;
  RETURN public.fn_onboarding_estado(v_sub.onboarding_token)
         || jsonb_build_object('token', v_sub.onboarding_token);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_minha_adesao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_minha_adesao() TO authenticated;
