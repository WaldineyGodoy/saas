-- Task 14 (22/09/2026, decisao do dono): embaixador fora do portao de envio.
--
-- Qualquer pessoa vira `originator` pelo cadastro publico de embaixador. Com
-- o papel na policy, um embaixador logado inseria uma linha pending em
-- notification_logs e o gatilho fn_dispatch_notification disparava
-- WhatsApp/e-mail com texto e destino livres pelo numero/e-mail da B2W.
-- Mesma correcao em _shared/envio-portao.ts (PAPEIS_INTERNOS). O embaixador
-- fala com o proprio lead so pela Edge Function lead-mensagem, por modelo.
--
-- As fontes legitimas (fn_process_notification_triggers,
-- fn_check_invoice_due_reminders) sao SECURITY DEFINER e nao passam por RLS.
DROP POLICY IF EXISTS "notification_logs_insert_interno" ON public.notification_logs;

CREATE POLICY "notification_logs_insert_interno" ON public.notification_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'admin', 'manager', 'coordinator')
    )
  );
