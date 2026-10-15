-- =====================================================================
-- Leitura da conta de luz na adesão pelo site (/contrato), decisão do dono
-- em 15/10/2026: "leia a conta na criação da UC".
--
-- O PDF é lido no navegador (pdfjs), sem custo. A FOTO passa pela Edge
-- Function parse-invoice-image (modelo pago), que exigia usuário logado.
-- Quem vem da simulação do site não tem login: a função passa a aceitar o
-- id da visita (lead_visitas, ou o lead do link do CRM) com teto de leituras
-- por visita, para a leitura paga não ficar aberta a qualquer um.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.leituras_conta_publica (
  chave uuid PRIMARY KEY,
  total integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.leituras_conta_publica ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leituras_conta_publica FROM PUBLIC, anon, authenticated;

-- Consome uma leitura da visita: true se a visita existe, é recente e ainda
-- tem leitura. Só a Edge Function (service_role) chama.
CREATE OR REPLACE FUNCTION public.fn_consumir_leitura_conta(p_chave uuid, p_teto integer DEFAULT 5)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_total integer;
BEGIN
  IF p_chave IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_visitas v WHERE v.id = p_chave AND v.criado_em > now() - interval '30 days')
     AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_chave AND l.arquivado_em IS NULL) THEN
    RETURN false;
  END IF;
  INSERT INTO public.leituras_conta_publica AS t (chave, total) VALUES (p_chave, 1)
  ON CONFLICT (chave) DO UPDATE SET total = t.total + 1, atualizado_em = now()
  RETURNING total INTO v_total;
  RETURN v_total <= p_teto;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_consumir_leitura_conta(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consumir_leitura_conta(uuid, integer) TO service_role;
