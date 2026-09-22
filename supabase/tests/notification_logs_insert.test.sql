-- Fix round 1 da Task 4 (F1): notification_logs só aceita INSERT de
-- authenticated com papel interno (super_admin/admin/manager/coordinator/
-- originator). Assinante/lead/fornecedor tem que ser barrado.
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
DO $$
DECLARE
  v_subscriber_id uuid;
  v_admin_id uuid;
  v_log_id uuid;
  v_rejeitado boolean := false;
BEGIN
  SELECT id INTO v_subscriber_id FROM public.profiles WHERE role = 'subscriber' LIMIT 1;
  SELECT id INTO v_admin_id FROM public.profiles WHERE role IN ('admin', 'super_admin') LIMIT 1;

  IF v_subscriber_id IS NULL OR v_admin_id IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: faltou perfil subscriber ou admin/super_admin para o teste';
  END IF;

  -- Assinante (papel externo) autenticado tenta inserir -- tem que ser barrado.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_subscriber_id, 'role', 'authenticated')::text, true);

  BEGIN
    INSERT INTO public.notification_logs (entity_type, entity_id, channel, recipient, body, status)
    VALUES ('subscriber', v_subscriber_id, 'whatsapp', '5533999991234', 'tentativa indevida', 'pending');
    v_rejeitado := false;
  EXCEPTION WHEN OTHERS THEN
    v_rejeitado := true;
  END;

  IF NOT v_rejeitado THEN
    RAISE EXCEPTION 'FALHOU: assinante (papel externo) conseguiu inserir em notification_logs';
  END IF;

  -- Usuário interno (admin) autenticado tenta inserir -- tem que passar.
  -- status = 'sent' (não 'pending') para o gatilho fn_dispatch_notification
  -- não tentar chamar pg_net de dentro do teste -- e de qualquer forma tudo
  -- desfaz no RAISE EXCEPTION final.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);

  INSERT INTO public.notification_logs (entity_type, entity_id, channel, recipient, body, status)
  VALUES ('subscriber', v_admin_id, 'whatsapp', '5533999991234', 'admin pode inserir', 'sent')
  RETURNING id INTO v_log_id;

  IF v_log_id IS NULL THEN
    RAISE EXCEPTION 'FALHOU: admin não conseguiu inserir em notification_logs';
  END IF;

  RESET ROLE;
  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
