-- Task 10 (Split de Pagamentos): o cadastro publico (anon) nao escolhe o
-- proprio cargo, lider nem licenca.
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste; inclusive o GRANT
-- temporario de colunas ao anon, que e DDL transacional).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
--
-- Papeis simulados como o PostgREST faz: set_config('role', ...) +
-- request.jwt.claims. O `anon` real so tem INSERT nas 9 colunas do formulario
-- (20260921d), entao para exercitar o gatilho com cargo/lider/licenca o teste
-- concede, DENTRO da transacao, INSERT nessas colunas ao anon — simula o dia em
-- que alguem alargar o grant (ou criar uma RPC anonima) e a guarda for a unica
-- barreira.
DO $$
DECLARE
  v_dono   text := current_user;
  v_lider  uuid;
  v_adm    uuid := gen_random_uuid();
  v_pub    uuid := gen_random_uuid();   -- cadastro publico real (so as 9 colunas)
  v_pub2   uuid := gen_random_uuid();   -- anon tentando escolher cargo (grant temporario)
  v_pub3   uuid := gen_random_uuid();   -- so claims role=anon (sem SET ROLE)
  v_svc    uuid := gen_random_uuid();
  v_pg     uuid := gen_random_uuid();
  v_int    uuid := gen_random_uuid();
  v_auth   uuid := gen_random_uuid();
  r        record;
  v_erro   text;
  v_state  text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_adm,  'adm.anon.t10@teste.invalid',  '{"name":"Admin"}', 'authenticated', 'authenticated'),
    (v_auth, 'auth.anon.t10@teste.invalid', '{"name":"Auth"}',  'authenticated', 'authenticated'),
    (v_pub,  'pub.anon.t10@teste.invalid',  '{"name":"Pub"}',   'authenticated', 'authenticated');
  UPDATE public.profiles SET role = 'admin' WHERE id = v_adm;

  -- lider real para os testes que tentam se pendurar nele
  INSERT INTO public.originators_v2 (name, cargo)
  VALUES ('SANDBOX Lider T10', 'lider') RETURNING id INTO v_lider;

  -- ======================================================================
  -- 1) cadastro publico REAL: anon + as 9 colunas do formulario
  -- ======================================================================
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  INSERT INTO public.originators_v2 (id, name, email, phone, cpf_cnpj, pix_key, pix_key_type, profession, address)
  VALUES (v_pub, 'Publico T10', 'pub.anon.t10@teste.invalid', '84999990010', '52998224725',
          'pub@teste.invalid', 'email', 'Engenheiro', '{"cidade":"Natal","uf":"RN"}'::jsonb);

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_pub;
  IF r.id IS NULL THEN RAISE EXCEPTION 'FALHOU 1: cadastro publico nao gravou a linha'; END IF;
  IF r.cargo <> 'ppf' OR r.lider_id IS NOT NULL OR r.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 1: cadastro publico saiu com cargo=% lider=% ativo=%', r.cargo, r.lider_id, r.ativo;
  END IF;
  IF r.name <> 'Publico T10' OR r.profession <> 'Engenheiro' OR r.address->>'uf' <> 'RN' THEN
    RAISE EXCEPTION 'FALHOU 1: colunas do formulario nao foram gravadas';
  END IF;

  -- ======================================================================
  -- 2) camada 1 (grant de colunas) continua barrando cargo no anon real
  -- ======================================================================
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_erro := NULL; v_state := NULL;
  BEGIN
    INSERT INTO public.originators_v2 (id, name, cargo) VALUES (gen_random_uuid(), 'X', 'ppe');
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'FALHOU 2: anon inserindo cargo deu SQLSTATE % (esperado 42501): %', v_state, v_erro;
  END IF;

  -- ======================================================================
  -- 3) anon (SET ROLE anon + claims sem sub) escolhendo tudo: NORMALIZA
  --    (grant temporario alarga as colunas para o gatilho ser a unica barreira)
  -- ======================================================================
  GRANT INSERT (cargo, lider_id, licenca_valor, licenca_vencimento, split_commission, short_url, ativo)
    ON public.originators_v2 TO anon;

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  INSERT INTO public.originators_v2 (id, name, email, cargo, lider_id, licenca_valor, licenca_vencimento,
                                     split_commission, short_url, ativo)
  VALUES (v_pub2, 'Anon Espertinho T10', 'esperto.t10@teste.invalid', 'ppe', v_lider, 1234.56, current_date + 365,
          '{"start": 50, "recurrent": 50}'::jsonb, 'https://evil.invalid/x', false);

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_pub2;
  IF r.cargo <> 'ppf' THEN RAISE EXCEPTION 'FALHOU 3: anon gravou cargo=%', r.cargo; END IF;
  IF r.lider_id IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 3: anon gravou lider_id=%', r.lider_id; END IF;
  IF r.licenca_valor IS NOT NULL OR r.licenca_vencimento IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 3: anon gravou licenca (valor=% venc=%)', r.licenca_valor, r.licenca_vencimento;
  END IF;
  IF r.licenca_status <> 'isenta' THEN RAISE EXCEPTION 'FALHOU 3: licenca_status=%', r.licenca_status; END IF;
  IF r.split_commission <> '{"start": 0, "recurrent": 0}'::jsonb THEN
    RAISE EXCEPTION 'FALHOU 3: anon gravou split_commission=%', r.split_commission;
  END IF;
  IF r.short_url IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 3: anon gravou short_url=%', r.short_url; END IF;
  IF r.ativo IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 3: anon gravou ativo=%', r.ativo; END IF;

  -- ======================================================================
  -- 4) so o claim role=anon (sem SET ROLE, sessao postgres): tambem normaliza
  -- ======================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  INSERT INTO public.originators_v2 (id, name, cargo, lider_id, licenca_valor)
  VALUES (v_pub3, 'Claim Anon T10', 'ppe', v_lider, 99);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_pub3;
  IF r.cargo <> 'ppf' OR r.lider_id IS NOT NULL OR r.licenca_valor IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 4: claim role=anon escolheu cargo=% lider=% licenca=%', r.cargo, r.lider_id, r.licenca_valor;
  END IF;

  -- ======================================================================
  -- 5) service_role (SET ROLE service_role + claim) mantem tudo
  -- ======================================================================
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

  INSERT INTO public.originators_v2 (id, name, cargo, lider_id, licenca_valor, licenca_vencimento,
                                     split_commission, ativo)
  VALUES (v_svc, 'Service T10', 'ppe', v_lider, 500, current_date + 30,
          '{"start": 7, "recurrent": 7}'::jsonb, false);

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_svc;
  IF r.cargo <> 'ppe' OR r.lider_id IS DISTINCT FROM v_lider OR r.licenca_valor IS DISTINCT FROM 500
     OR r.licenca_vencimento IS NULL OR r.ativo IS NOT FALSE
     OR r.split_commission <> '{"start": 7, "recurrent": 7}'::jsonb THEN
    RAISE EXCEPTION 'FALHOU 5: service_role perdeu controle: cargo=% lider=% licenca=% ativo=% split=%',
      r.cargo, r.lider_id, r.licenca_valor, r.ativo, r.split_commission;
  END IF;

  -- ======================================================================
  -- 6) postgres direto (migracao, cron): sem claims, role 'none' — mantem
  -- ======================================================================
  INSERT INTO public.originators_v2 (id, name, cargo, lider_id, licenca_valor, ativo)
  VALUES (v_pg, 'Postgres T10', 'ppp', v_lider, 800, false);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_pg;
  IF r.cargo <> 'ppp' OR r.lider_id IS DISTINCT FROM v_lider OR r.licenca_valor IS DISTINCT FROM 800 OR r.ativo IS NOT FALSE THEN
    RAISE EXCEPTION 'FALHOU 6: postgres/migracao perdeu controle: cargo=% lider=% ativo=%', r.cargo, r.lider_id, r.ativo;
  END IF;

  -- ======================================================================
  -- 7) papel interno (admin logado) mantem
  -- ======================================================================
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);

  INSERT INTO public.originators_v2 (id, name, cargo, lider_id, licenca_valor)
  VALUES (v_int, 'Interno T10', 'ppe', v_lider, 300);

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_int;
  IF r.cargo <> 'ppe' OR r.lider_id IS DISTINCT FROM v_lider OR r.licenca_valor IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'FALHOU 7: admin perdeu controle: cargo=% lider=% licenca=%', r.cargo, r.lider_id, r.licenca_valor;
  END IF;

  -- ======================================================================
  -- 8) authenticated comum (comportamento anterior preservado): normaliza
  -- ======================================================================
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);

  INSERT INTO public.originators_v2 (id, name, email, cargo, lider_id, licenca_valor, ativo)
  VALUES (v_auth, 'Auth T10', 'auth.anon.t10@teste.invalid', 'ppe', v_lider, 10, false);

  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT * INTO r FROM public.originators_v2 WHERE id = v_auth;
  IF r.cargo <> 'ppf' OR r.lider_id IS NOT NULL OR r.licenca_valor IS NOT NULL OR r.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 8: authenticated comum escolheu cargo=% lider=% licenca=% ativo=%',
      r.cargo, r.lider_id, r.licenca_valor, r.ativo;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
