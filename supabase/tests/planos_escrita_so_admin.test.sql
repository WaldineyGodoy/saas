-- planos_assinatura_energia: so admin/super_admin logado grava.
-- Antes (ate 29/09/2026) a politica "Permitir controle total anon" deixava
-- qualquer um com a chave publica alterar os percentuais que o split paga.
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito). Rodar pelo MCP execute_sql.
DO $$
DECLARE
  v_adm    uuid := gen_random_uuid();
  v_super  uuid := gen_random_uuid();
  v_mgr    uuid := gen_random_uuid();
  v_assin  uuid := gen_random_uuid();
  v_dono   text := current_user;
  v_plano  uuid;
  v_novo   uuid;
  v_n      integer;
  v_state  text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_adm,   'adm.planos@teste.invalid',   '{"name":"Admin"}',       'authenticated', 'authenticated'),
    (v_super, 'super.planos@teste.invalid', '{"name":"Super"}',       'authenticated', 'authenticated'),
    (v_mgr,   'mgr.planos@teste.invalid',   '{"name":"Manager"}',     'authenticated', 'authenticated'),
    (v_assin, 'assin.planos@teste.invalid', '{"name":"Assinante"}',   'authenticated', 'authenticated');
  UPDATE public.profiles SET role = 'admin'       WHERE id = v_adm;
  UPDATE public.profiles SET role = 'super_admin' WHERE id = v_super;
  UPDATE public.profiles SET role = 'manager'     WHERE id = v_mgr;
  UPDATE public.profiles SET role = 'subscriber'  WHERE id = v_assin;

  INSERT INTO public.planos_assinatura_energia (nome, recorrente_config)
  VALUES ('Plano rls teste', '{}'::jsonb) RETURNING id INTO v_plano;

  -- 1) anon: nem le nem grava
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_state := NULL;
  BEGIN UPDATE public.planos_assinatura_energia SET desconto_assinante = 99 WHERE id = v_plano;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon alterou plano (SQLSTATE %)', v_state; END IF;
  v_state := NULL;
  BEGIN INSERT INTO public.planos_assinatura_energia (nome) VALUES ('forjado anon');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon criou plano (SQLSTATE %)', v_state; END IF;
  v_state := NULL;
  BEGIN SELECT count(*) INTO v_n FROM public.planos_assinatura_energia;
  EXCEPTION WHEN others THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: anon leu planos (SQLSTATE %)', v_state; END IF;

  -- 2) assinante logado: le, mas nao grava
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_assin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.planos_assinatura_energia WHERE id = v_plano;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: usuario logado nao le planos'; END IF;
  UPDATE public.planos_assinatura_energia SET desconto_assinante = 99 WHERE id = v_plano;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: assinante alterou plano'; END IF;
  DELETE FROM public.planos_assinatura_energia WHERE id = v_plano;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: assinante apagou plano'; END IF;
  v_state := NULL;
  BEGIN INSERT INTO public.planos_assinatura_energia (nome) VALUES ('forjado assinante');
  EXCEPTION WHEN others THEN v_state := SQLSTATE; END;
  IF v_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'FALHOU: assinante criou plano (SQLSTATE %)', v_state; END IF;

  -- 3) manager: le, mas nao grava ("somente admins")
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  UPDATE public.planos_assinatura_energia SET desconto_assinante = 99 WHERE id = v_plano;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: manager alterou plano'; END IF;

  -- 4) admin: cria, altera e apaga
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  UPDATE public.planos_assinatura_energia SET desconto_assinante = 12 WHERE id = v_plano;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao alterou plano'; END IF;
  INSERT INTO public.planos_assinatura_energia (nome) VALUES ('Plano admin teste') RETURNING id INTO v_novo;
  DELETE FROM public.planos_assinatura_energia WHERE id = v_novo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao apagou plano'; END IF;

  -- 5) super_admin: altera
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super, 'role', 'authenticated')::text, true);
  UPDATE public.planos_assinatura_energia SET desconto_assinante = 13 WHERE id = v_plano;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: super_admin nao alterou plano'; END IF;

  -- 6) quem le por dentro do banco (SECURITY DEFINER) segue lendo
  PERFORM set_config('role', v_dono, true);
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.fn_plano_da_uc'::regproc) THEN
    RAISE EXCEPTION 'FALHOU: fn_plano_da_uc deixou de ser SECURITY DEFINER';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
