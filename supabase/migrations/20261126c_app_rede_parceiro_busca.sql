-- Busca na "Minha rede de clientes" do app (Home Connect, dono 26/11/2026):
-- a lista passa a trazer CPF/CNPJ e telefone, para filtrar por nome, CPF
-- ou telefone. Só o parceiro dono da rede vê (fn_app_parceiro_ativo).
-- Mesmas linhas e ordem de antes; colunas novas no fim.
DROP FUNCTION IF EXISTS public.app_rede_parceiro();

CREATE FUNCTION public.app_rede_parceiro()
 RETURNS TABLE(id uuid, tipo text, name text, status text, etapa text, numero_uc text, cidade text, uf text,
               consumo_kwh numeric, comissao numeric, criado_em timestamp with time zone,
               cpf_cnpj text, representante_cpf text, telefone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         s.created_at,
         s.cpf_cnpj::text, s.representante_cpf::text, s.phone::text
    FROM eu
    JOIN public.subscribers s ON s.originator_id = eu.id
    LEFT JOIN LATERAL (
          SELECT c.numero_uc, c.franquia::text AS franquia FROM public.consumer_units c
           WHERE c.subscriber_id = s.id ORDER BY c.created_at LIMIT 1) u ON true
   WHERE s.status::text <> 'cancelado' OR s.signature_link IS NOT NULL
  UNION ALL
  SELECT l.id, 'lead', l.name, l.status::text, 'interessado', NULL, l.cidade, l.uf,
         CASE WHEN l.consumo_kwh::text ~ '^[0-9]+(\.[0-9]+)?$' THEN l.consumo_kwh::text::numeric END, 0, l.created_at,
         l.cpf_cnpj::text, NULL, l.phone::text
    FROM eu
    JOIN public.leads l ON l.originator_id = eu.id
   WHERE l.arquivado_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.subscribers s WHERE s.lead_id = l.id)
     AND (NOT ('#Investidor' = ANY(coalesce(l.tags, '{}'::text[])))
          OR '#Energia por Assinatura' = ANY(l.tags))
   ORDER BY 11 DESC;
$function$;

REVOKE ALL ON FUNCTION public.app_rede_parceiro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_rede_parceiro() TO authenticated, service_role;
