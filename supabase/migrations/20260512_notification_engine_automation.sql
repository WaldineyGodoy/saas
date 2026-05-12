-- Consolidação das melhorias do Motor de Notificações
-- Data: 2026-05-12
-- Descrição: Ativação de gatilhos para fornecedores, despacho automático de logs via Edge Functions e correção de variáveis.

-- 1. Função para substituir variáveis nas mensagens
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
        SELECT name, email, phone as telefone, status INTO v_data FROM public.leads WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Lead}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Lead}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Lead}}', COALESCE(v_data.status::TEXT, ''));
        END IF;
    
    -- ASSINANTE (SUBSCRIBER)
    ELSIF p_entity_type = 'subscriber' THEN
        SELECT name, email, phone as telefone, status, cpf_cnpj INTO v_data FROM public.subscribers WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Assinante}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Assinante}}', COALESCE(v_data.status::TEXT, ''));
            v_result := REPLACE(v_result, '{{CPF/CNPJ}}', COALESCE(v_data.cpf_cnpj, ''));
        END IF;

    -- UNIDADE CONSUMIDORA (CONSUMER_UNIT)
    ELSIF p_entity_type = 'consumer_unit' THEN
        SELECT 
            c.numero_uc, 
            c.address::TEXT as address, 
            c.status::TEXT as status,
            s.name as subscriber_name,
            s.email,
            s.phone as telefone
        INTO v_data 
        FROM public.consumer_units c
        LEFT JOIN public.subscribers s ON s.id = c.subscriber_id
        WHERE c.id = p_entity_id;
        
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Unidade Consumidora}}', COALESCE(v_data.numero_uc, ''));
            v_result := REPLACE(v_result, '{{Endereço da UC}}', COALESCE(v_data.address, ''));
            v_result := REPLACE(v_result, '{{Status da UC}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Número da UC}}', COALESCE(v_data.numero_uc, ''));
            v_result := REPLACE(v_result, '{{Nome do Assinante}}', COALESCE(v_data.subscriber_name, ''));
        END IF;

    -- FATURA (INVOICE)
    ELSIF p_entity_type = 'invoice' THEN
        SELECT mes_referencia, vencimento::TEXT as vencimento, linha_digitavel, status::TEXT as status, valor_total::TEXT as valor_total INTO v_data FROM public.invoices WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Mês de Referência da Fatura}}', COALESCE(v_data.mes_referencia, ''));
            v_result := REPLACE(v_result, '{{Vencimento da Fatura}}', COALESCE(v_data.vencimento, ''));
            v_result := REPLACE(v_result, '{{Linha Digitável de Pagamento}}', COALESCE(v_data.linha_digitavel, ''));
            v_result := REPLACE(v_result, '{{Status da Fatura}}', COALESCE(v_data.status, ''));
            v_result := REPLACE(v_result, '{{Valor Total}}', COALESCE(v_data.valor_total, '0.00'));
        END IF;

    -- ORIGINADOR (ORIGINATOR)
    ELSIF p_entity_type = 'originator' THEN
        SELECT name, email, phone as telefone, status::TEXT as status INTO v_data FROM public.originators_v2 WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Originador}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Originador}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Originador}}', COALESCE(v_data.status, ''));
        END IF;

    -- FORNECEDOR (SUPPLIER)
    ELSIF p_entity_type = 'supplier' THEN
        SELECT name, email, phone as telefone, status::TEXT as status INTO v_data FROM public.suppliers WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome do Fornecedor}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Nome Completo do Fornecedor}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status do Fornecedor}}', COALESCE(v_data.status, ''));
        END IF;

    -- USINA (POWER_PLANT)
    ELSIF p_entity_type = 'power_plant' THEN
        SELECT name, status::TEXT as status INTO v_data FROM public.usinas WHERE id = p_entity_id;
        IF FOUND THEN
            v_result := REPLACE(v_result, '{{Nome da Usina}}', COALESCE(v_data.name, ''));
            v_result := REPLACE(v_result, '{{Status da Usina}}', COALESCE(v_data.status, ''));
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

-- 2. Função para processar gatilhos e gerar logs de notificação
CREATE OR REPLACE FUNCTION public.fn_process_notification_triggers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_trigger RECORD;
    v_processed_body TEXT;
    v_recipient_type TEXT;
    v_recipient TEXT;
    v_custom_phone TEXT;
    v_event_type TEXT;
BEGIN
    -- Determinar o tipo de evento
    IF (TG_OP = 'INSERT') THEN
        v_event_type := 'Criação de Registro';
    ELSE
        v_event_type := 'Alteração de Status';
    END IF;

    -- Procurar gatilhos ativos para esta entidade, status E evento
    FOR v_trigger IN 
        SELECT * FROM public.notification_triggers 
        WHERE entity_type = TG_ARGV[0] 
        AND trigger_status = NEW.status::TEXT
        AND (trigger_event = v_event_type OR trigger_event IS NULL OR trigger_event = '' OR trigger_event = 'Qualquer Alteração')
        AND is_active = true
    LOOP
        -- Processar o corpo da mensagem com variáveis
        v_processed_body := public.fn_replace_notification_variables(v_trigger.message_body, v_trigger.entity_type, NEW.id);
        
        -- LOOP 1: Destinatários por Tipo (Entidades Vinculadas)
        FOREACH v_recipient_type IN ARRAY v_trigger.recipient_types
        LOOP
            v_recipient := NULL;

            -- Resolução do destinatário baseado no tipo
            IF v_recipient_type = 'self' OR v_recipient_type = 'subscriber' THEN
                -- Se for a própria entidade ou o assinante vinculado
                IF TG_ARGV[0] = 'subscriber' OR TG_ARGV[0] = 'lead' THEN
                    SELECT phone INTO v_recipient FROM (
                        SELECT phone FROM public.leads WHERE id = NEW.id
                        UNION ALL
                        SELECT phone FROM public.subscribers WHERE id = NEW.id
                    ) s LIMIT 1;
                ELSIF TG_ARGV[0] = 'supplier' THEN
                    SELECT phone INTO v_recipient FROM public.suppliers WHERE id = NEW.id;
                ELSIF TG_ARGV[0] = 'consumer_unit' THEN
                    SELECT s.phone INTO v_recipient 
                    FROM public.subscribers s 
                    JOIN public.consumer_units c ON c.subscriber_id = s.id 
                    WHERE c.id = NEW.id;
                ELSIF TG_ARGV[0] = 'invoice' THEN
                    SELECT s.phone INTO v_recipient 
                    FROM public.subscribers s 
                    JOIN public.consumer_units c ON c.subscriber_id = s.id 
                    WHERE c.id = NEW.uc_id;
                END IF;

            ELSIF v_recipient_type = 'originator' THEN
                -- Busca o originador vinculado
                IF TG_ARGV[0] = 'lead' THEN
                    SELECT o.phone INTO v_recipient FROM public.originators_v2 o JOIN public.leads l ON l.originator_id = o.id WHERE l.id = NEW.id;
                ELSIF TG_ARGV[0] = 'subscriber' THEN
                    SELECT o.phone INTO v_recipient FROM public.originators_v2 o JOIN public.subscribers s ON s.originator_id = o.id WHERE s.id = NEW.id;
                ELSIF TG_ARGV[0] = 'consumer_unit' THEN
                    SELECT o.phone INTO v_recipient FROM public.originators_v2 o JOIN public.subscribers s ON s.originator_id = o.id JOIN public.consumer_units c ON c.subscriber_id = s.id WHERE c.id = NEW.id;
                ELSIF TG_ARGV[0] = 'invoice' THEN
                    SELECT o.phone INTO v_recipient FROM public.originators_v2 o JOIN public.subscribers s ON s.originator_id = o.id JOIN public.consumer_units c ON c.subscriber_id = s.id WHERE c.id = NEW.uc_id;
                END IF;
            END IF;

            -- Se encontrou um destinatário válido, registra o log
            IF v_recipient IS NOT NULL AND v_recipient <> '' THEN
                INSERT INTO public.notification_logs (
                    trigger_id, entity_type, entity_id, channel, recipient, body, status, metadata
                ) VALUES (
                    v_trigger.id, v_trigger.entity_type, NEW.id, v_trigger.channel, v_recipient, v_processed_body, 'pending', 
                    jsonb_build_object('recipient_role', v_recipient_type)
                );
            END IF;
        END LOOP;

        -- LOOP 2: Destinatários Customizados (Lista de números)
        IF v_trigger.custom_recipients IS NOT NULL AND v_trigger.custom_recipients <> '' THEN
            FOR v_custom_phone IN SELECT trim(s) FROM unnest(string_to_array(v_trigger.custom_recipients, ';')) s
            LOOP
                IF v_custom_phone <> '' THEN
                    INSERT INTO public.notification_logs (
                        trigger_id, entity_type, entity_id, channel, recipient, body, status, metadata
                    ) VALUES (
                        v_trigger.id, v_trigger.entity_type, NEW.id, v_trigger.channel, v_custom_phone, v_processed_body, 'pending', 
                        jsonb_build_object('recipient_role', 'custom_list')
                    );
                END IF;
            END LOOP;
        END IF;

    END LOOP;

    RETURN NEW;
END;
$function$;

-- 3. Função para despachar notificações via Edge Functions
CREATE OR REPLACE FUNCTION public.fn_dispatch_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_project_url TEXT := 'https://abbysvxnnhwvvzhftoms.supabase.co';
    v_url TEXT;
    v_payload JSONB;
BEGIN
    -- Só processa se o status for 'pending'
    IF NEW.status = 'pending' THEN
        IF NEW.channel = 'whatsapp' THEN
            v_url := v_project_url || '/functions/v1/send-whatsapp';
            v_payload := jsonb_build_object(
                'phone', NEW.recipient,
                'text', NEW.body
            );
            
            -- Chamada via pg_net (extensão já instalada no projeto)
            PERFORM net.http_post(
                url := v_url,
                body := v_payload,
                headers := '{"Content-Type": "application/json"}'::jsonb
            );
            
            -- Marcar como 'sent' para evitar duplicidade
            UPDATE public.notification_logs 
            SET status = 'sent', updated_at = now() 
            WHERE id = NEW.id;
            
        ELSIF NEW.channel = 'email' THEN
            v_url := v_project_url || '/functions/v1/send-email';
            v_payload := jsonb_build_object(
                'to', NEW.recipient,
                'subject', NEW.subject,
                'body', NEW.body
            );
            
            PERFORM net.http_post(
                url := v_url,
                body := v_payload,
                headers := '{"Content-Type": "application/json"}'::jsonb
            );
            
            UPDATE public.notification_logs 
            SET status = 'sent', updated_at = now() 
            WHERE id = NEW.id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;

-- 4. Registro dos Gatilhos

-- Gatilho de despacho automático nos logs
DROP TRIGGER IF EXISTS trg_dispatch_notification ON public.notification_logs;
CREATE TRIGGER trg_dispatch_notification
    AFTER INSERT ON public.notification_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_dispatch_notification();

-- Gatilho para Fornecedores
DROP TRIGGER IF EXISTS trg_notify_supplier_status ON public.suppliers;
CREATE TRIGGER trg_notify_supplier_status
    AFTER INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_process_notification_triggers('supplier');

-- Gatilho para leads
DROP TRIGGER IF EXISTS trg_notify_lead_status ON public.leads;
CREATE TRIGGER trg_notify_lead_status
    AFTER INSERT OR UPDATE ON public.leads
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_process_notification_triggers('lead');

-- Gatilho para assinantes
DROP TRIGGER IF EXISTS trg_notify_subscriber_status ON public.subscribers;
CREATE TRIGGER trg_notify_subscriber_status
    AFTER INSERT OR UPDATE ON public.subscribers
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_process_notification_triggers('subscriber');

-- Gatilho para Unidades Consumidoras
DROP TRIGGER IF EXISTS trg_notify_uc_status ON public.consumer_units;
CREATE TRIGGER trg_notify_uc_status
    AFTER INSERT OR UPDATE ON public.consumer_units
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_process_notification_triggers('consumer_unit');

-- Gatilho para faturas
DROP TRIGGER IF EXISTS trg_notify_invoice_status ON public.invoices;
CREATE TRIGGER trg_notify_invoice_status
    AFTER INSERT OR UPDATE ON public.invoices
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_process_notification_triggers('invoice');
