-- Originador copiado do lead, no servidor (spec 2026-10-06, secao 6, decisao 15).
-- Fornecedor criado (ou atualizado) com lead_id e sem originador recebe o
-- originador do lead. A trava "so admin altera" aceita esse valor.

CREATE OR REPLACE FUNCTION public.fn_suppliers_originador_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_do_lead uuid;
BEGIN
    IF NEW.lead_id IS NOT NULL THEN
        SELECT l.originator_id INTO v_do_lead FROM public.leads l WHERE l.id = NEW.lead_id;
    END IF;

    -- copia so quando o fornecedor ainda nao tinha originador
    IF NEW.originator_id IS NULL AND v_do_lead IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD.originator_id IS NULL) THEN
        NEW.originator_id := v_do_lead;
    END IF;

    IF ((TG_OP = 'INSERT' AND NEW.originator_id IS NOT NULL)
        OR (TG_OP = 'UPDATE' AND NEW.originator_id IS DISTINCT FROM OLD.originator_id))
       AND NEW.originator_id IS DISTINCT FROM v_do_lead
       AND auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin define o originador do fornecedor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER tr_suppliers_originador_admin ON public.suppliers;
CREATE TRIGGER tr_suppliers_originador_admin
    BEFORE INSERT OR UPDATE OF originator_id, lead_id ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_suppliers_originador_admin();

-- fornecedores que ja vieram de lead e ainda estao sem originador
UPDATE public.suppliers s
   SET originator_id = l.originator_id
  FROM public.leads l
 WHERE l.id = s.lead_id
   AND l.originator_id IS NOT NULL
   AND s.originator_id IS NULL;
