-- fn_onboarding_estado: cada UC passa a trazer cidade/uf/cep (de consumer_units.address).
-- A procuracao do termo de adesao imprime "Localidade" por UC; sem esses campos
-- todo contrato gerado pela adesao publica saia com "/". Resto identico a 20260921c.
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
      'concessionaria', concessionaria, 'franquia', franquia, 'desconto_assinante', desconto_assinante, 'dia_vencimento', dia_vencimento,
      'cidade', address->>'cidade', 'uf', address->>'uf', 'cep', address->>'cep')
      ORDER BY created_at), '[]'::jsonb) FROM consumer_units WHERE subscriber_id = v_sub),
    'faltantes', v_falt,
    'signature_link', s.signature_link);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_estado(uuid) TO anon, authenticated;
