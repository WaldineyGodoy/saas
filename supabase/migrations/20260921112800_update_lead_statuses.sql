-- Update enum
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'sem_interacao';
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'reuniao_agendada';
ALTER TYPE public.lead_status ADD VALUE IF NOT EXISTS 'contrato_enviado';
ALTER TYPE public.lead_status RENAME VALUE 'em_negociacao' TO 'negociacao';

-- Update trigger function
CREATE OR REPLACE FUNCTION public.sync_subscriber_to_lead_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_novo_status public.lead_status;
BEGIN
  -- Sem vinculo explicito nao ha o que sincronizar. Casar por e-mail
  -- pegava todos os leads do mesmo endereco -- inclusive simulacoes
  -- antigas que nunca viraram este assinante.
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Só reage ao que muda de fato: status alterado, ou vinculo recem-criado.
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.lead_id IS NOT DISTINCT FROM NEW.lead_id THEN
    RETURN NEW;
  END IF;

  v_novo_status := CASE NEW.status
    WHEN 'ativacao'          THEN 'negociacao'::public.lead_status
    WHEN 'contrato_assinado' THEN 'ativacao'::public.lead_status
    WHEN 'ativo'             THEN 'ativo'::public.lead_status
    ELSE NULL
  END;

  -- Cancelamento, transferencia e inadimplencia nao tem mapeamento
  -- definido: o lead fica como esta, e quem decide e uma pessoa.
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
$function$;
