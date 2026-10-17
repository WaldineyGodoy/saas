-- Status "pago + divergencia" da conta de energia (17/10/2026).
--
-- `energy_bill_status` ganha dois valores:
--   inconsistente_pago  conta paga, mas a concessionaria hoje mostra outro valor
--   contestada_pago     conta paga, com contestacao em andamento
--
-- A coluna e texto livre, sem enum nem CHECK, entao NAO ha DDL de dado: o unico
-- ponto do banco que enumera valores de energy_bill_status e esta funcao. Sem
-- esta mudanca, uma fatura nova inserida com reading_status nulo e um dos dois
-- status cairia no ELSE final e ficaria 'pending' -- a conta paga apareceria
-- como "pendente de leitura" no Calendario de Leituras.
--
-- Mantem sincronizada com src/lib/readingStatus.js (deriveReadingStatus). Os dois
-- status novos entram no conjunto SUCCESS, junto de 'pago'.

CREATE OR REPLACE FUNCTION public.derive_reading_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- IMPORTANTE: manter sincronizada com src/lib/readingStatus.js (deriveReadingStatus)
    IF NEW.reading_status IS NULL THEN
        IF lower(trim(NEW.status::text)) IN ('cancelado', 'cancelada') THEN
            NEW.reading_status := NULL;
        ELSIF lower(trim(NEW.status::text)) IN ('erro','error','indisponivel','indisponível')
           OR lower(trim(coalesce(NEW.energy_bill_status,''))) IN ('erro','error','indisponivel','indisponível') THEN
            NEW.reading_status := 'error';
        ELSIF lower(trim(NEW.status::text)) IN ('processing','processando')
           OR lower(trim(coalesce(NEW.energy_bill_status,''))) IN ('processing','processando') THEN
            NEW.reading_status := 'processing';
        ELSIF lower(trim(NEW.status::text)) IN ('pago','parcelada','contestada') THEN
            NEW.reading_status := 'success';
        ELSIF (coalesce(NEW.valor_concessionaria,0) > 0 AND NEW.concessionaria_pdf_url IS NOT NULL) THEN
            NEW.reading_status := 'success';
        ELSIF lower(trim(NEW.status::text)) IN ('pending','pendente','aguardando')
           OR lower(trim(coalesce(NEW.energy_bill_status,''))) IN ('pending','pendente','aguardando') THEN
            NEW.reading_status := 'pending';
        ELSIF NEW.is_placeholder THEN
            NEW.reading_status := 'pending';
        ELSIF lower(trim(NEW.status::text)) IN ('success','sucesso','pago','parcelada','contestada','consistente','a_vencer','atrasada','atrasado','confirmado')
           OR lower(trim(coalesce(NEW.energy_bill_status,''))) IN ('success','sucesso','pago','parcelada','contestada','consistente','a_vencer','atrasada','atrasado','confirmado','inconsistente_pago','contestada_pago') THEN
            NEW.reading_status := 'success';
        ELSE
            NEW.reading_status := 'pending';
        END IF;

        IF NEW.reading_status IS NOT NULL THEN
            NEW.reading_checked_at := now();
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
