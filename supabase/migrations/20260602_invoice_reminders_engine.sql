-- Migration: 20260602_invoice_reminders_engine
-- Description: Implement daily check for scheduled invoice notifications (before and after due date),
-- fix invoice status mismatch in notification triggers ('vencida' -> 'atrasado'),
-- and fix/extend fn_replace_notification_variables to correctly handle invoice variables
-- like subscriber name, mes_referencia variations, and boleto links.

-- 1. Fix trigger_status in existing triggers
UPDATE public.notification_triggers
SET trigger_status = 'atrasado'
WHERE entity_type = 'invoice' AND trigger_status = 'vencida';

-- 2. Fix fn_replace_notification_variables to correctly handle all invoice variables
CREATE OR REPLACE FUNCTION public.fn_replace_notification_variables(p_text text, p_entity_type text, p_entity_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_result TEXT := p_text;
    v_data RECORD;
BEGIN
    -- LEAD
    IF p_entity_type = 'lead' THEN
        SELECT name, email, phone as telefone, status, concessionaria, address INTO v_data FROM public.leads WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Lead}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Lead}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Lead}}', COALESCE(v_data.status::TEXT, ''));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;
    
    -- ASSINANTE (SUBSCRIBER)
    ELSIF p_entity_type = 'subscriber' THEN
        SELECT name, email, phone as telefone, status, cpf_cnpj, address INTO v_data FROM public.subscribers WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Assinante}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Assinante}}', COALESCE(v_data.status::TEXT, ''));
            v_result := REPLACE(v_result, '{{CPF/CNPJ}}', COALESCE(v_data.cpf_cnpj, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;

    -- UNIDADE CONSUMIDORA (CONSUMER_UNIT)
    ELSIF p_entity_type = 'consumer_unit' THEN
        SELECT 
            c.numero_uc, 
            c.address, 
            c.status::TEXT as status,
            c.concessionaria,
            s.name as subscriber_name,
            s.email,
            s.phone as telefone
        INTO v_data 
        FROM public.consumer_units c
        LEFT JOIN public.subscribers s ON s.id = c.subscriber_id
        WHERE c.id = p_entity_id;
        
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Unidade Consumidora}}', COALESCE(v_data.numero_uc, ''));
            v_result := REPLACE(v_result, '{{Endereço da UC}}', public.fn_format_json_address(v_data.address));
            v_result := REPLACE(v_result, '{{Status da UC}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Número da UC}}', COALESCE(v_data.numero_uc, ''));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.subscriber_name, ''));
        END IF;

    -- FATURA (INVOICE)
    ELSIF p_entity_type = 'invoice' THEN
        SELECT 
            i.mes_referencia, 
            i.vencimento::TEXT as vencimento, 
            i.linha_digitavel, 
            i.status::TEXT as status, 
            i.valor_a_pagar::TEXT as valor_total, 
            i.concessionaria, 
            i.address,
            i.asaas_boleto_url,
            s.name as subscriber_name
        INTO v_data 
        FROM public.invoices i
        LEFT JOIN public.consumer_units cu ON cu.id = i.uc_id
        LEFT JOIN public.subscribers s ON s.id = cu.subscriber_id
        WHERE i.id = p_entity_id;
        
        IF FOUND THEN
            -- Support both exact UI variables and the ones commonly written by the user
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.subscriber_name, ''));
            v_result := REPLACE(v_result, '{{Mês de Referência da Fatura}}', COALESCE(v_data.mes_referencia::TEXT, ''));
            v_result := REPLACE(v_result, '{{Mês de Referência}}', COALESCE(v_data.mes_referencia::TEXT, ''));
            v_result := REPLACE(v_result, '{{Vencimento da Fatura}}', COALESCE(v_data.vencimento, ''));
            v_result := REPLACE(v_result, '{{Vencimento}}', COALESCE(v_data.vencimento, ''));
            v_result := REPLACE(v_result, '{{Linha Digitável de Pagamento}}', COALESCE(v_data.linha_digitavel, ''));
            v_result := REPLACE(v_result, '{{Status da Fatura}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Valor Total}}', COALESCE(v_data.valor_total, '0.00'));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Endereço da UC}}', public.fn_format_json_address(v_data.address));
            v_result := REPLACE(v_result, '{{Link do Boleto}}', COALESCE(v_data.asaas_boleto_url, ''));
            v_result := REPLACE(v_result, '{{Link da Fatura}}', COALESCE(v_data.asaas_boleto_url, ''));
        END IF;

    -- ORIGINADOR (ORIGINATOR)
    ELSIF p_entity_type = 'originator' THEN
        SELECT name, email, phone as telefone, status::TEXT as status, address INTO v_data FROM public.originators_v2 WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Originador}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Originador}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Originador}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;

    -- FORNECEDOR (SUPPLIER)
    ELSIF p_entity_type = 'supplier' THEN
        SELECT name, email, phone as telefone, status::TEXT as status, address INTO v_data FROM public.suppliers WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Fornecedor}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Fornecedor}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Fornecedor}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;

    -- USINA (POWER_PLANT)
    ELSIF p_entity_type = 'power_plant' THEN
        SELECT name, status::TEXT as status, concessionaria, address INTO v_data FROM public.usinas WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome da Usina}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status da Usina}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Concessionária}}', COALESCE(v_data.concessionaria, ''));
            v_result := REPLACE(v_result, '{{Endereço}}', public.fn_format_json_address(v_data.address));
        END IF;
    END IF;

    -- Campos genéricos
    IF v_data IS NOT NULL THEN
        BEGIN
            v_result := REPLACE(v_result, '{{email}}', COALESCE(v_data.email::TEXT, ''));
        EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN
            v_result := REPLACE(v_result, '{{telefone}}', COALESCE(v_data.telefone::TEXT, ''));
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    RETURN v_result;
END;
$function$;

-- 3. Create the daily check function for invoice reminders
CREATE OR REPLACE FUNCTION public.fn_check_invoice_due_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_trigger RECORD;
    v_invoice RECORD;
    v_target_date DATE;
    v_processed_body TEXT;
    v_recipient_type TEXT;
    v_recipient TEXT;
    v_custom_phone TEXT;
BEGIN
    -- Loop through active invoice triggers
    FOR v_trigger IN 
        SELECT * FROM public.notification_triggers 
        WHERE entity_type = 'invoice' 
        AND is_active = true
    LOOP
        -- Process before_due (warning before due date)
        IF v_trigger.delay_type = 'before_due' THEN
            v_target_date := CURRENT_DATE + COALESCE(v_trigger.delay_days, 0);
            
            -- Scan invoices that are 'a_vencer' or 'ag_emissao_boleto' due on target date
            FOR v_invoice IN 
                SELECT * FROM public.invoices 
                WHERE status IN ('a_vencer', 'ag_emissao_boleto')
                AND vencimento = v_target_date
            LOOP
                -- Prevent duplicate notification for same trigger and invoice
                IF NOT EXISTS (
                    SELECT 1 FROM public.notification_logs 
                    WHERE trigger_id = v_trigger.id 
                    AND entity_id = v_invoice.id
                ) THEN
                    v_processed_body := public.fn_replace_notification_variables(v_trigger.message_body, 'invoice', v_invoice.id);
                    
                    -- Send to each recipient type
                    FOREACH v_recipient_type IN ARRAY v_trigger.recipient_types
                    LOOP
                        v_recipient := NULL;
                        IF v_recipient_type = 'self' OR v_recipient_type = 'subscriber' THEN
                            SELECT s.phone INTO v_recipient 
                            FROM public.subscribers s 
                            JOIN public.consumer_units c ON c.subscriber_id = s.id 
                            WHERE c.id = v_invoice.uc_id;
                        ELSIF v_recipient_type = 'originator' THEN
                            SELECT o.phone INTO v_recipient 
                            FROM public.originators_v2 o 
                            JOIN public.subscribers s ON s.originator_id = o.id 
                            JOIN public.consumer_units c ON c.subscriber_id = s.id 
                            WHERE c.id = v_invoice.uc_id;
                        END IF;
                        
                        IF v_recipient IS NOT NULL AND v_recipient <> '' THEN
                            INSERT INTO public.notification_logs (
                                trigger_id, entity_type, entity_id, channel, recipient, body, status, metadata
                            ) VALUES (
                                v_trigger.id, 'invoice', v_invoice.id, v_trigger.channel, v_recipient, v_processed_body, 'pending', 
                                jsonb_build_object('recipient_role', v_recipient_type)
                            );
                        END IF;
                    END LOOP;
                    
                    -- Send to custom recipients list
                    IF v_trigger.custom_recipients IS NOT NULL AND v_trigger.custom_recipients <> '' THEN
                        FOR v_custom_phone IN SELECT trim(s) FROM unnest(string_to_array(v_trigger.custom_recipients, ';')) s
                        LOOP
                            IF v_custom_phone <> '' THEN
                                INSERT INTO public.notification_logs (
                                    trigger_id, entity_type, entity_id, channel, recipient, body, status, metadata
                                ) VALUES (
                                    v_trigger.id, 'invoice', v_invoice.id, v_trigger.channel, v_custom_phone, v_processed_body, 'pending', 
                                    jsonb_build_object('recipient_role', 'custom_list')
                                );
                            END IF;
                        END LOOP;
                    END IF;
                END IF;
            END LOOP;
            
        -- Process after_due (warning after due date / overdue)
        ELSIF v_trigger.delay_type = 'after_due' THEN
            v_target_date := CURRENT_DATE - COALESCE(v_trigger.delay_days, 0);
            
            -- Scan invoices that are currently 'atrasado' and due on target date
            FOR v_invoice IN 
                SELECT * FROM public.invoices 
                WHERE status = 'atrasado'
                AND vencimento = v_target_date
            LOOP
                -- Prevent duplicate notification for same trigger and invoice
                IF NOT EXISTS (
                    SELECT 1 FROM public.notification_logs 
                    WHERE trigger_id = v_trigger.id 
                    AND entity_id = v_invoice.id
                ) THEN
                    v_processed_body := public.fn_replace_notification_variables(v_trigger.message_body, 'invoice', v_invoice.id);
                    
                    -- Send to each recipient type
                    FOREACH v_recipient_type IN ARRAY v_trigger.recipient_types
                    LOOP
                        v_recipient := NULL;
                        IF v_recipient_type = 'self' OR v_recipient_type = 'subscriber' THEN
                            SELECT s.phone INTO v_recipient 
                            FROM public.subscribers s 
                            JOIN public.consumer_units c ON c.subscriber_id = s.id 
                            WHERE c.id = v_invoice.uc_id;
                        ELSIF v_recipient_type = 'originator' THEN
                            SELECT o.phone INTO v_recipient 
                            FROM public.originators_v2 o 
                            JOIN public.subscribers s ON s.originator_id = o.id 
                            JOIN public.consumer_units c ON c.subscriber_id = s.id 
                            WHERE c.id = v_invoice.uc_id;
                        END IF;
                        
                        IF v_recipient IS NOT NULL AND v_recipient <> '' THEN
                            INSERT INTO public.notification_logs (
                                trigger_id, entity_type, entity_id, channel, recipient, body, status, metadata
                            ) VALUES (
                                v_trigger.id, 'invoice', v_invoice.id, v_trigger.channel, v_recipient, v_processed_body, 'pending', 
                                jsonb_build_object('recipient_role', v_recipient_type)
                            );
                        END IF;
                    END LOOP;
                    
                    -- Send to custom recipients list
                    IF v_trigger.custom_recipients IS NOT NULL AND v_trigger.custom_recipients <> '' THEN
                        FOR v_custom_phone IN SELECT trim(s) FROM unnest(string_to_array(v_trigger.custom_recipients, ';')) s
                        LOOP
                            IF v_custom_phone <> '' THEN
                                INSERT INTO public.notification_logs (
                                    trigger_id, entity_type, entity_id, channel, recipient, body, status, metadata
                                ) VALUES (
                                    v_trigger.id, 'invoice', v_invoice.id, v_trigger.channel, v_custom_phone, v_processed_body, 'pending', 
                                    jsonb_build_object('recipient_role', 'custom_list')
                                );
                            END IF;
                        END LOOP;
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END;
$function$;
