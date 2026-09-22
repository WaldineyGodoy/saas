-- Task 2: documentos do assinante, bucket privado e estado da retomada do onboarding.
-- Nota: public.check_user_is_admin() existe apenas como check_user_is_admin(user_id uuid),
-- então as políticas abaixo usam check_user_is_admin(auth.uid()) em vez da forma sem argumentos do brief.

CREATE TABLE IF NOT EXISTS public.subscriber_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  consumer_unit_id uuid REFERENCES public.consumer_units(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('identidade', 'conta_energia', 'contrato_social')),
  storage_path text NOT NULL UNIQUE,
  mime text NOT NULL,
  tamanho int NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriber_documents_sub_idx ON public.subscriber_documents(subscriber_id);
ALTER TABLE public.subscriber_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriber_documents_interno ON public.subscriber_documents;
CREATE POLICY subscriber_documents_interno ON public.subscriber_documents FOR ALL TO authenticated
  USING (public.check_user_is_admin(auth.uid())) WITH CHECK (public.check_user_is_admin(auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documentos-assinante', 'documentos-assinante', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS documentos_assinante_interno_leitura ON storage.objects;
CREATE POLICY documentos_assinante_interno_leitura ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documentos-assinante' AND public.check_user_is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.fn_onboarding_assinante_por_token(p_token uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.subscribers
   WHERE onboarding_token = p_token AND onboarding_token_expira_em > now();
$$;

CREATE OR REPLACE FUNCTION public.fn_onboarding_documentos_faltantes(p_subscriber uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(f), '[]'::jsonb) FROM (
    SELECT 'identidade' AS tipo, NULL::uuid AS consumer_unit_id, NULL::text AS numero_uc
     WHERE NOT EXISTS (SELECT 1 FROM subscriber_documents d WHERE d.subscriber_id = p_subscriber AND d.tipo = 'identidade')
    UNION ALL
    SELECT 'contrato_social', NULL, NULL
      FROM subscribers s WHERE s.id = p_subscriber AND length(s.cpf_cnpj) = 14
       AND NOT EXISTS (SELECT 1 FROM subscriber_documents d WHERE d.subscriber_id = p_subscriber AND d.tipo = 'contrato_social')
    UNION ALL
    SELECT 'conta_energia', cu.id, cu.numero_uc
      FROM consumer_units cu WHERE cu.subscriber_id = p_subscriber
       AND NOT EXISTS (SELECT 1 FROM subscriber_documents d WHERE d.consumer_unit_id = cu.id AND d.tipo = 'conta_energia')
  ) f;
$$;

CREATE OR REPLACE FUNCTION public.fn_onboarding_estado(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub uuid := public.fn_onboarding_assinante_por_token(p_token); s record; v_falt jsonb; v_etapa text;
BEGIN
  IF v_sub IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM subscribers WHERE id = v_sub;
  v_falt := public.fn_onboarding_documentos_faltantes(v_sub);
  v_etapa := CASE
    WHEN s.status <> 'ativacao' THEN 'assinado'
    WHEN jsonb_array_length(v_falt) > 0 THEN 'documentos'
    WHEN EXISTS (SELECT 1 FROM signatures g WHERE g.signer_id = v_sub AND g.signer_type = 'subscriber' AND g.status = 'pending') THEN 'enviado'
    ELSE 'contrato' END;
  RETURN jsonb_build_object('etapa', v_etapa,
    'subscriber', jsonb_build_object('id', s.id, 'name', s.name, 'cpf_cnpj', s.cpf_cnpj, 'email', s.email, 'phone', s.phone,
      'cep', s.cep, 'rua', s.rua, 'numero', s.numero, 'complemento', s.complemento, 'bairro', s.bairro, 'cidade', s.cidade, 'uf', s.uf,
      'representante_nome', s.representante_nome, 'representante_cpf', s.representante_cpf),
    'ucs', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero_uc', numero_uc, 'titular_conta', titular_conta,
      'concessionaria', concessionaria, 'franquia', franquia, 'desconto_assinante', desconto_assinante, 'dia_vencimento', dia_vencimento)
      ORDER BY created_at), '[]'::jsonb) FROM consumer_units WHERE subscriber_id = v_sub),
    'faltantes', v_falt,
    'signature_link', s.signature_link);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_onboarding_assinante_por_token(uuid), public.fn_onboarding_documentos_faltantes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_assinante_por_token(uuid), public.fn_onboarding_documentos_faltantes(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) TO anon, authenticated;
