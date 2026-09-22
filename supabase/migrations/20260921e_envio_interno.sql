-- Segredo interno para chamadas servidor→servidor (pg_net) às funções de envio.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'b2w:internal_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'b2w:internal_secret', 'Header x-b2w-internal de send-whatsapp/send-email');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_segredo_interno_confere(p_valor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT coalesce(p_valor, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'b2w:internal_secret' AND decrypted_secret = p_valor);
$$;
REVOKE EXECUTE ON FUNCTION public.fn_segredo_interno_confere(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_segredo_interno_confere(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_dispatch_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_project_url text := 'https://abbysvxnnhwvvzhftoms.supabase.co';
  v_segredo text; v_anon text; v_headers jsonb;
BEGIN
  IF NEW.status <> 'pending' OR NEW.channel NOT IN ('whatsapp', 'email') THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_segredo FROM vault.decrypted_secrets WHERE name = 'b2w:internal_secret';
  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'cron:anon_key';
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-b2w-internal', v_segredo,
                                  'Authorization', 'Bearer ' || v_anon, 'apikey', v_anon);
  IF NEW.channel = 'whatsapp' THEN
    PERFORM net.http_post(url := v_project_url || '/functions/v1/send-whatsapp',
      body := jsonb_build_object('phone', NEW.recipient, 'text', NEW.body), headers := v_headers);
  ELSE
    PERFORM net.http_post(url := v_project_url || '/functions/v1/send-email',
      body := jsonb_build_object('to', NEW.recipient, 'subject', NEW.subject, 'text', NEW.body), headers := v_headers);
  END IF;
  UPDATE public.notification_logs SET status = 'sent', updated_at = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;
