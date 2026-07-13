-- Fix fatura_status enum comparison in handle_invoice_paid trigger function
CREATE OR REPLACE FUNCTION public.handle_invoice_paid()
RETURNS TRIGGER AS $$
DECLARE
    v_usina_id uuid;
BEGIN
    -- Check if status changed to 'pago' (instead of 'paga', which is invalid for enum fatura_status)
    IF NEW.status = 'pago' AND OLD.status != 'pago' THEN
        
        -- Get Usina ID from the Invoice's UC linkage
        SELECT usina_id INTO v_usina_id 
        FROM consumer_units 
        WHERE id = NEW.uc_id;

        IF v_usina_id IS NOT NULL THEN
            INSERT INTO cashbook (usina_id, type, category, description, amount, origin_id, origin_type, status, transaction_date)
            VALUES (
                v_usina_id,
                'entrada',
                'fatura_assinante',
                'Fatura Paga - Ref ' || to_char(NEW.mes_referencia, 'MM/YYYY'),
                NEW.valor_a_pagar,
                NEW.id,
                'invoice',
                'provisionado',
                CURRENT_DATE
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
