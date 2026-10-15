-- =====================================================================
-- Simulação mostra o desconto do plano vigente (decisão do dono,
-- 15/10/2026: "Sim, plano vigente"). Os simuladores do site
-- (b2wenergia.com.br e /connect/) e do CRM (/simulacao, LeadCaptureForm)
-- liam "Desconto Assinante" da tabela Concessionaria (desconto do
-- município: Natal 20%), enquanto a adesão já aplica o plano vigente da
-- distribuidora (20261014d: Cosern, Plano Ultra Connect, 15%).
--
-- Mesma regra da adesão: um único plano ativo ligado à distribuidora dá o
-- desconto; senão NULL e o simulador fica com o desconto do município.
-- Pública (anon): devolve só o percentual que o próprio site anuncia.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_desconto_plano_vigente(p_concessionaria text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT (array_agg(p.desconto_assinante))[1]
    FROM public.planos_assinatura_energia p
   WHERE p.ativo AND p.status = 'ativo'
     AND EXISTS (SELECT 1 FROM public.planos_distribuidoras d
                  WHERE d.plano_id = p.id
                    AND lower(btrim(d.concessionaria)) = lower(btrim(coalesce(p_concessionaria, ''))))
  HAVING count(*) = 1;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_desconto_plano_vigente(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_desconto_plano_vigente(text) TO anon, authenticated, service_role;
