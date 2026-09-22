-- Task 14, fix round 1: lead_mensagens_envios e so do service_role.
-- authenticated (ex.: embaixador) nao le, nao insere e nao apaga.
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
DO $$
DECLARE
  v_originator_id uuid;
  v_lead_id uuid := gen_random_uuid();
  v_bloqueado boolean;
  v_n int;
BEGIN
  SELECT id INTO v_originator_id FROM public.profiles WHERE role = 'originator' LIMIT 1;
  IF v_originator_id IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: faltou perfil originator para o teste';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lead_mensagens_envios'::regclass) THEN
    RAISE EXCEPTION 'FALHOU: RLS desligada em lead_mensagens_envios';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lead_mensagens_envios') THEN
    RAISE EXCEPTION 'FALHOU: lead_mensagens_envios nao deveria ter policy nenhuma';
  END IF;

  -- Linha semeada como dono (postgres), para o DELETE ter o que apagar.
  INSERT INTO public.lead_mensagens_envios (originator_id, lead_id, modelo)
  VALUES (v_originator_id, v_lead_id, 'convite');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_originator_id, 'role', 'authenticated')::text, true);

  v_bloqueado := false;
  BEGIN
    PERFORM count(*) FROM public.lead_mensagens_envios;
  EXCEPTION WHEN insufficient_privilege THEN v_bloqueado := true;
  END;
  IF NOT v_bloqueado THEN RAISE EXCEPTION 'FALHOU: authenticated conseguiu SELECT'; END IF;

  v_bloqueado := false;
  BEGIN
    INSERT INTO public.lead_mensagens_envios (originator_id, lead_id, modelo)
    VALUES (v_originator_id, v_lead_id, 'convite');
  EXCEPTION WHEN insufficient_privilege THEN v_bloqueado := true;
  END;
  IF NOT v_bloqueado THEN RAISE EXCEPTION 'FALHOU: authenticated conseguiu INSERT'; END IF;

  v_bloqueado := false;
  BEGIN
    DELETE FROM public.lead_mensagens_envios WHERE lead_id = v_lead_id;
  EXCEPTION WHEN insufficient_privilege THEN v_bloqueado := true;
  END;
  IF NOT v_bloqueado THEN RAISE EXCEPTION 'FALHOU: authenticated conseguiu DELETE'; END IF;

  -- anon tambem nao.
  PERFORM set_config('role', 'anon', true);
  v_bloqueado := false;
  BEGIN
    PERFORM count(*) FROM public.lead_mensagens_envios;
  EXCEPTION WHEN insufficient_privilege THEN v_bloqueado := true;
  END;
  IF NOT v_bloqueado THEN RAISE EXCEPTION 'FALHOU: anon conseguiu SELECT'; END IF;

  -- service_role le e escreve (e o caminho da Edge Function).
  PERFORM set_config('role', 'service_role', true);
  SELECT count(*) INTO v_n FROM public.lead_mensagens_envios WHERE lead_id = v_lead_id;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: service_role nao leu a linha semeada (n=%)', v_n; END IF;
  DELETE FROM public.lead_mensagens_envios WHERE lead_id = v_lead_id;

  RESET ROLE;
  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
