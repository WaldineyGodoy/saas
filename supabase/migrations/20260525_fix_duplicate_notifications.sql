-- Migration: 20260525_fix_duplicate_notifications
-- Description: Update fn_process_notification_triggers to prevent sending notifications multiple times
-- when an UPDATE occurs on the entity but the status does not actually change.

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
    -- Determinar o tipo de evento e garantir que "Alteração de Status" só ocorra se o status realmente mudou
    IF (TG_OP = 'INSERT') THEN
        v_event_type := 'Criação de Registro';
    ELSIF (TG_OP = 'UPDATE') THEN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            v_event_type := 'Alteração de Status';
        ELSE
            -- Se o status não mudou, não dispara o gatilho de Alteração de Status
            RETURN NEW;
        END IF;
    ELSE
        RETURN NEW;
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
