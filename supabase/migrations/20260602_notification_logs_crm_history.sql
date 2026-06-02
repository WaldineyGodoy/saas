-- Migration: 20260602_notification_logs_crm_history
-- Description: Create a trigger on public.notification_logs to record a log in public.crm_history
-- when a notification is successfully sent (status changed to 'sent').

CREATE OR REPLACE FUNCTION public.handle_notification_log_history()
RETURNS trigger AS $$
DECLARE
    v_channel_label TEXT;
BEGIN
    -- Log to CRM history when status changes/is set to 'sent'
    IF NEW.status = 'sent' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sent') THEN
        v_channel_label := CASE 
            WHEN NEW.channel = 'whatsapp' THEN 'WhatsApp' 
            WHEN NEW.channel = 'email' THEN 'E-mail' 
            ELSE NEW.channel 
        END;
        
        INSERT INTO public.crm_history (
            entity_type,
            entity_id,
            content,
            metadata
        ) VALUES (
            NEW.entity_type,
            NEW.entity_id,
            v_channel_label || ' enviado para ' || NEW.recipient,
            jsonb_build_object(
                'message', NEW.body,
                'channel', NEW.channel,
                'recipient', NEW.recipient,
                'status', NEW.status,
                'notification_log_id', NEW.id
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notification_log_history ON public.notification_logs;
CREATE TRIGGER trg_notification_log_history
    AFTER INSERT OR UPDATE ON public.notification_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_notification_log_history();
