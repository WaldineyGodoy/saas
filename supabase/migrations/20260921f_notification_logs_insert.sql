-- Fix round 1 da revisão da Task 4.
--
-- F1 (crítico): a policy "Allow authenticated users to insert logs" tinha
-- WITH CHECK (true) -- qualquer usuário logado (lead, subscriber, supplier)
-- podia inserir uma linha pending em notification_logs. Antes da Task 4 isso
-- era inofensivo porque fn_dispatch_notification não mandava autenticação
-- nenhuma para send-whatsapp/send-email (e agora, com verify_jwt = true nas
-- duas, nem chegava a passar do gateway). Agora que o gatilho anexa
-- x-b2w-internal + a anon key para o pg_net conseguir despachar de verdade,
-- essa mesma policy virou porta aberta: qualquer lead logado inseriria uma
-- linha e o gatilho mandaria WhatsApp/e-mail do número/e-mail da empresa por
-- ele. Confirmado por grep que nada em src/, scraper/ ou supabase/functions/
-- insere em notification_logs -- as duas únicas fontes são
-- fn_process_notification_triggers e fn_check_invoice_due_reminders, ambas
-- SECURITY DEFINER (ignoram RLS, continuam funcionando sem alteração).
DROP POLICY IF EXISTS "Allow authenticated users to insert logs" ON public.notification_logs;

CREATE POLICY "notification_logs_insert_interno" ON public.notification_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'coordinator', 'originator')
    )
  );

-- F2 (importante): fn_dispatch_notification é SECURITY DEFINER sem
-- SET search_path -- risco de sequestro de função via search_path
-- manipulado por quem tiver CREATE em algum schema do path de resolução.
-- Comportamento idêntico, só fixa o search_path.
CREATE OR REPLACE FUNCTION public.fn_dispatch_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, net, pg_temp AS $function$
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
