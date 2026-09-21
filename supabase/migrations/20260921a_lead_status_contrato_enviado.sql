-- =====================================================================
-- Status de lead: convite_enviado aposentado, adesão = contrato_enviado
-- Data: 21/09/2026 — aplicado em produção via MCP (lead_status_20260921_...)
-- =====================================================================

-- 1. convite_enviado -> indicado
-- Os dois significavam a mesma coisa e o kanban só tinha coluna para
-- 'indicado': os 3 leads em 'convite_enviado' sumiam do quadro. Postgres
-- não remove valor de enum, então o valor fica no tipo mas é proibido na
-- tabela.
UPDATE public.leads SET status = 'indicado', updated_at = now()
 WHERE status = 'convite_enviado';

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_sem_convite_enviado;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_sem_convite_enviado
  CHECK (status <> 'convite_enviado');

COMMENT ON TYPE public.lead_status IS
  'convite_enviado está APOSENTADO (21/09/2026): use indicado. O valor segue no tipo porque o Postgres não remove valor de enum; a constraint leads_status_sem_convite_enviado impede o uso.';

-- 2. Adesão pública já envia o contrato no mesmo minuto: assinante
--    recém-criado -> lead 'contrato_enviado' (antes 'negociacao').
-- 3. SECURITY DEFINER restaurado: tinha sido perdido na renomeação de
--    em_negociacao -> negociacao, e sem ele um usuário do CRM sem política
--    de UPDATE em leads mudava o assinante e o lead ficava para trás.
CREATE OR REPLACE FUNCTION public.sync_subscriber_to_lead_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_novo_status public.lead_status;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.lead_id IS NOT DISTINCT FROM NEW.lead_id THEN
    RETURN NEW;
  END IF;

  v_novo_status := CASE NEW.status
    WHEN 'ativacao'          THEN 'contrato_enviado'::public.lead_status
    WHEN 'contrato_assinado' THEN 'ativacao'::public.lead_status
    WHEN 'ativo'             THEN 'ativo'::public.lead_status
    ELSE NULL
  END;

  IF v_novo_status IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.leads
     SET status = v_novo_status,
         updated_at = now()
   WHERE id = NEW.lead_id
     AND status IS DISTINCT FROM v_novo_status;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.sync_subscriber_to_lead_status() FROM PUBLIC, anon, authenticated;
