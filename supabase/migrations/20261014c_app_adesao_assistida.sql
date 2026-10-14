-- =====================================================================
-- App: adesão assistida pelo Parceiro Power (decisão do dono, 14/10/2026).
--
-- Em Energia a pessoa faz a própria adesão (app_criar_adesao). Na Home
-- Connect o parceiro cadastra um novo assinante para a rede dele: mesmo
-- fluxo (conta -> plano -> dados -> documentos -> contrato), mas o cadastro
-- é do cliente. O contrato sai em nome do cliente e vai para o WhatsApp e
-- o e-mail dele: só o cliente assina. O originador é sempre quem chamou.
--
-- E a rede do parceiro volta para dentro do app (antes a tela mandava
-- para o CRM): clientes do parceiro, etapa da adesão e comissão acumulada.
-- =====================================================================

-- Parceiro ativo da conta logada (ou NULL).
CREATE OR REPLACE FUNCTION public.fn_app_parceiro_ativo()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT o.id FROM public.originators_v2 o
   WHERE o.id = auth.uid() AND o.ativo IS DISTINCT FROM false;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_app_parceiro_ativo() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Criar a adesão do cliente
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_criar_adesao_cliente(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_par uuid := public.fn_app_parceiro_ativo();
  v_email text := lower(btrim(coalesce(p_dados ->> 'email', '')));
  v_meu_email text;
  r jsonb;
BEGIN
  IF v_par IS NULL THEN
    RAISE EXCEPTION 'Disponivel para Parceiros Power ativos.' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Informe o e-mail do cliente: o contrato vai para ele.' USING ERRCODE = '22023';
  END IF;
  SELECT lower(u.email) INTO v_meu_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email = v_meu_email THEN
    RAISE EXCEPTION 'Este e-mail e o seu. Para a sua propria adesao, use a aba Energia.' USING ERRCODE = '22023';
  END IF;

  r := public.fn_criar_assinante_publico(
    p_dados ->> 'name', p_dados ->> 'cpf_cnpj', v_email, p_dados ->> 'phone',
    p_dados ->> 'cep', p_dados ->> 'rua', p_dados ->> 'numero', p_dados ->> 'complemento',
    p_dados ->> 'bairro', p_dados ->> 'cidade', p_dados ->> 'uf', p_dados ->> 'ibge',
    v_par::text, NULL, coalesce(p_dados -> 'ucs', '[]'::jsonb),
    nullif(p_dados ->> 'dia_vencimento', '')::integer,
    p_dados ->> 'representante_nome', p_dados ->> 'representante_cpf',
    p_dados ->> 'aceite_versao', NULL);

  -- O originador é quem cadastrou, mesmo que a função pública mude a regra.
  UPDATE public.subscribers SET originator_id = v_par
   WHERE id = (r ->> 'subscriber_id')::uuid AND originator_id IS DISTINCT FROM v_par;
  RETURN r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_criar_adesao_cliente(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_criar_adesao_cliente(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Continuar a adesão de um cliente do parceiro
-- ---------------------------------------------------------------------
-- Mesma regra de app_minha_adesao: o token de retomada renova enquanto a
-- adesão estiver em ativação. Só o parceiro do cliente vê.
CREATE OR REPLACE FUNCTION public.app_adesao_cliente(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_par uuid := public.fn_app_parceiro_ativo();
  v_sub record;
BEGIN
  IF v_par IS NULL THEN RETURN NULL; END IF;
  SELECT s.id, s.status, s.name, s.email, s.phone, s.onboarding_token INTO v_sub
    FROM public.subscribers s
   WHERE s.id = p_subscriber_id AND s.originator_id = v_par AND s.status <> 'cancelado';
  IF v_sub.id IS NULL THEN RETURN NULL; END IF;
  IF v_sub.status <> 'ativacao' THEN
    RETURN jsonb_build_object('etapa', 'assinado', 'status', v_sub.status, 'nome', v_sub.name);
  END IF;
  UPDATE public.subscribers
     SET onboarding_token = coalesce(onboarding_token, gen_random_uuid()),
         onboarding_token_expira_em = greatest(coalesce(onboarding_token_expira_em, now()), now() + interval '30 days')
   WHERE id = v_sub.id
  RETURNING onboarding_token INTO v_sub.onboarding_token;
  RETURN public.fn_onboarding_estado(v_sub.onboarding_token)
         || jsonb_build_object('token', v_sub.onboarding_token, 'nome', v_sub.name,
                               'email', v_sub.email, 'phone', v_sub.phone);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_adesao_cliente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_adesao_cliente(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Rede do parceiro: clientes e interessados
-- ---------------------------------------------------------------------
-- etapa: interessado (lead sem adesão), adesao (cadastro sem contrato
-- assinado), ou o status do assinante. comissao: soma da parte do parceiro
-- nas faturas do motor (beneficiarios[] com id = parceiro).
CREATE OR REPLACE FUNCTION public.app_rede_parceiro()
RETURNS TABLE (
  id uuid, tipo text, name text, status text, etapa text, numero_uc text,
  cidade text, uf text, consumo_kwh numeric, comissao numeric, criado_em timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH eu AS (SELECT public.fn_app_parceiro_ativo() AS id)
  SELECT s.id, 'assinante', s.name, s.status::text,
         CASE WHEN s.status::text = 'ativacao' AND s.signature_link IS NULL THEN 'adesao'
              WHEN s.status::text = 'ativacao' THEN 'assinatura'
              ELSE s.status::text END,
         u.numero_uc, s.cidade, s.uf,
         CASE WHEN u.franquia ~ '^[0-9]+(\.[0-9]+)?$' THEN u.franquia::numeric END,
         coalesce((
           SELECT sum((b ->> 'valor')::numeric)
             FROM public.consumer_units c
             JOIN public.invoices i ON i.uc_id = c.id
             CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(i.recompensas_aplicadas #> '{resultado,beneficiarios}') = 'array'
                         THEN i.recompensas_aplicadas #> '{resultado,beneficiarios}'
                         ELSE '[]'::jsonb END) b
            WHERE c.subscriber_id = s.id
              AND b ->> 'id' = eu.id::text
              AND b ->> 'papel' <> 'assinante_conect'
              AND (b ->> 'valor') ~ '^-?[0-9]+(\.[0-9]+)?$'), 0),
         s.created_at
    FROM eu
    JOIN public.subscribers s ON s.originator_id = eu.id
    LEFT JOIN LATERAL (
          SELECT c.numero_uc, c.franquia::text AS franquia FROM public.consumer_units c
           WHERE c.subscriber_id = s.id ORDER BY c.created_at LIMIT 1) u ON true
   WHERE s.status::text <> 'cancelado' OR s.signature_link IS NOT NULL
  UNION ALL
  SELECT l.id, 'lead', l.name, l.status::text, 'interessado', NULL, l.cidade, l.uf,
         CASE WHEN l.consumo_kwh::text ~ '^[0-9]+(\.[0-9]+)?$' THEN l.consumo_kwh::text::numeric END, 0, l.created_at
    FROM eu
    JOIN public.leads l ON l.originator_id = eu.id
   WHERE l.arquivado_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.subscribers s WHERE s.lead_id = l.id)
     -- Lead só de investimento não é cliente de energia.
     AND (NOT ('#Investidor' = ANY(coalesce(l.tags, '{}'::text[])))
          OR '#Energia por Assinatura' = ANY(l.tags))
   ORDER BY 11 DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.app_rede_parceiro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_rede_parceiro() TO authenticated;
