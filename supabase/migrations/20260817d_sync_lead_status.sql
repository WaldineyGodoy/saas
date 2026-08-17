-- =====================================================================
-- Sincronização lead → assinante: por vínculo, e com a semântica certa
-- Data: 17/08/2026
--
-- Havia DOIS gatilhos fazendo a mesma coisa de formas contraditórias:
--
--   sync_lead_status                → 'em_negociacao' WHERE email = NEW.email
--   sync_subscriber_to_lead_status  → 'ativacao'      WHERE email = NEW.email
--
-- Vencia o que rodasse por último, por acidente da ordem alfabética dos
-- nomes dos gatilhos. E ambos casavam por E-MAIL: um cliente que simulou
-- três vezes antes de assinar tinha os três leads convertidos de uma vez
-- — observado em produção, três linhas com `updated_at` idêntico ao
-- microssegundo.
--
-- Semântica correta, definida pelo dono:
--   Em Negociação → cliente que ainda NÃO assinou o contrato
--   Ativação      → cliente que assinou e aguarda a conexão da UC
--
-- Logo, assinante recém-criado (status 'ativacao') significa lead
-- 'em_negociacao'. Só quando o webhook da Autentique promove o assinante
-- para 'contrato_assinado' é que o lead vira 'ativacao'.
-- =====================================================================

DROP TRIGGER IF EXISTS trigger_sync_lead_status ON public.subscribers;
DROP TRIGGER IF EXISTS trigger_sync_subscriber_to_lead ON public.subscribers;
DROP FUNCTION IF EXISTS public.sync_lead_status();

CREATE OR REPLACE FUNCTION public.sync_subscriber_to_lead_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_novo_status public.lead_status;
BEGIN
  -- Sem vínculo explícito não há o que sincronizar. Casar por e-mail
  -- pegava todos os leads do mesmo endereço — inclusive simulações
  -- antigas que nunca viraram este assinante.
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Só reage ao que muda de fato: status alterado, ou vínculo recém-criado.
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.lead_id IS NOT DISTINCT FROM NEW.lead_id THEN
    RETURN NEW;
  END IF;

  v_novo_status := CASE NEW.status
    WHEN 'ativacao'          THEN 'em_negociacao'::public.lead_status
    WHEN 'contrato_assinado' THEN 'ativacao'::public.lead_status
    WHEN 'ativo'             THEN 'ativo'::public.lead_status
    ELSE NULL
  END;

  -- Cancelamento, transferência e inadimplência não têm mapeamento
  -- definido: o lead fica como está, e quem decide é uma pessoa.
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

COMMENT ON FUNCTION public.sync_subscriber_to_lead_status() IS
  'Espelha o status do assinante no lead de origem, pelo vínculo subscribers.lead_id. ativacao→em_negociacao (não assinou), contrato_assinado→ativacao (assinou, aguarda conexão), ativo→ativo. Demais status não mexem no lead.';

CREATE TRIGGER trg_sync_lead_status
  AFTER INSERT OR UPDATE ON public.subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_subscriber_to_lead_status();

-- ---------------------------------------------------------------------
-- `fn_criar_assinante_publico` também definia o status do lead na mão
-- (`SET status = 'ativacao'`). Com a semântica nova isso está errado: a
-- adesão não é assinatura. O bloco foi removido em produção — quem define
-- o status do lead agora é exclusivamente o gatilho acima, a partir de
-- `subscribers.lead_id`. Mesma correção aplicada em
-- src/pages/dashboards/LeadsList.jsx (conversão manual no CRM).
--
-- NÃO reaplicado aqui para não sobrescrever a versão em produção: veja
-- 20260817a_onboarding_publico.sql e remova o bloco `IF p_lead_id IS NOT
-- NULL THEN UPDATE public.leads ...` ao recriar a função do zero.
-- ---------------------------------------------------------------------
