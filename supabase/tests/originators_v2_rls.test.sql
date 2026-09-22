-- Task 15: RLS de originators_v2 — cada um so le e grava a propria linha;
-- CPF/PIX/comissao deixam de ficar abertos a qualquer usuario logado.
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
--
-- Papeis simulados por set_config('role','authenticated') + request.jwt.claims,
-- que e exatamente como o PostgREST executa a consulta do navegador.
DO $$
DECLARE
  v_a      uuid := gen_random_uuid();   -- embaixador A (dono da linha)
  v_b      uuid := gen_random_uuid();   -- embaixador B (linha alheia)
  v_s      uuid := gen_random_uuid();   -- assinante (papel nao interno)
  v_adm    uuid := gen_random_uuid();   -- admin (papel interno)
  v_novo   uuid := gen_random_uuid();   -- cadastro publico com sessao ativa
  v_dono   text := current_user;
  v_n      integer;
  v_txt    text;
  v_erro   text;
BEGIN
  -- ---------------------------------------------------------------- fixtures
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (v_a,   'emb.a.rls@teste.invalid',   '{"name":"Embaixador A"}', 'authenticated', 'authenticated'),
    (v_b,   'emb.b.rls@teste.invalid',   '{"name":"Embaixador B"}', 'authenticated', 'authenticated'),
    (v_s,   'assin.rls@teste.invalid',   '{"name":"Assinante"}',    'authenticated', 'authenticated'),
    (v_adm, 'admin.rls@teste.invalid',   '{"name":"Admin"}',        'authenticated', 'authenticated'),
    (v_novo,'novo.emb.rls@teste.invalid','{"name":"Novo Emb"}',     'authenticated', 'authenticated');

  INSERT INTO public.originators_v2 (id, name, email, phone, cpf_cnpj, pix_key, pix_key_type, split_commission, short_url)
  VALUES
    (v_a, 'Embaixador A', 'emb.a.rls@teste.invalid', '84999990001', '52998224725', 'pix-do-a@teste.invalid', 'email',
     '{"start": 4, "recurrent": 4}'::jsonb, 'https://link.b2wenergia.com.br/a-rls'),
    (v_b, 'Embaixador B', 'emb.b.rls@teste.invalid', '84999990002', '15350946056', 'pix-do-b@teste.invalid', 'email',
     '{"start": 4, "recurrent": 4}'::jsonb, 'https://link.b2wenergia.com.br/b-rls');

  -- O gatilho trg_originador_confirma_perfil ja promove A e B a 'originator';
  -- os demais precisam do papel explicito.
  UPDATE public.profiles SET role = 'subscriber' WHERE id = v_s;
  UPDATE public.profiles SET role = 'admin'      WHERE id = v_adm;

  SELECT role INTO v_txt FROM public.profiles WHERE id = v_a;
  IF v_txt <> 'originator' THEN RAISE EXCEPTION 'FIXTURE: papel do embaixador A ficou %', v_txt; END IF;

  -- =====================================================================
  -- 1) ASSINANTE (papel nao interno) nao le nem altera a linha do embaixador
  -- =====================================================================
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.originators_v2;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHOU: assinante enxerga % linha(s) de originators_v2 (CPF/PIX expostos)', v_n;
  END IF;

  UPDATE public.originators_v2 SET pix_key = 'pix-do-ladrao@teste.invalid' WHERE id = v_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: assinante alterou o PIX de embaixador (% linha[s])', v_n; END IF;

  -- =====================================================================
  -- 2) EMBAIXADOR A: propria linha sim, linha alheia nao
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.originators_v2 WHERE id = v_a;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: embaixador nao le a propria linha'; END IF;

  SELECT count(*) INTO v_n FROM public.originators_v2 WHERE id = v_b;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador le a linha de outro embaixador'; END IF;

  -- 2a) altera o proprio PIX: permitido
  UPDATE public.originators_v2 SET pix_key = 'pix-novo-do-a@teste.invalid' WHERE id = v_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: embaixador nao consegue trocar o proprio PIX'; END IF;

  -- 2b) altera a propria comissao: barrado pelo gatilho, com mensagem clara
  v_erro := NULL;
  BEGIN
    UPDATE public.originators_v2 SET split_commission = '{"start": 90, "recurrent": 90}'::jsonb WHERE id = v_a;
  EXCEPTION WHEN others THEN v_erro := SQLERRM;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador alterou a propria split_commission'; END IF;
  IF v_erro NOT ILIKE '%comiss%' THEN RAISE EXCEPTION 'FALHOU: mensagem pouco clara ao barrar split_commission: %', v_erro; END IF;

  -- 2c) altera o proprio short_url / cpf_cnpj: barrado (so papel interno ou service role)
  v_erro := NULL;
  BEGIN
    UPDATE public.originators_v2 SET short_url = 'https://link.b2wenergia.com.br/sequestrado' WHERE id = v_a;
  EXCEPTION WHEN others THEN v_erro := SQLERRM;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador alterou o proprio short_url'; END IF;

  v_erro := NULL;
  BEGIN
    UPDATE public.originators_v2 SET cpf_cnpj = '15350946056' WHERE id = v_a;
  EXCEPTION WHEN others THEN v_erro := SQLERRM;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador alterou o proprio cpf_cnpj'; END IF;

  -- 2d) PIX alheio: nem uma linha alcancada
  UPDATE public.originators_v2 SET pix_key = 'pix-do-ladrao@teste.invalid' WHERE id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador alterou o PIX de outro embaixador'; END IF;

  -- 2e) cadastrar linha alheia (id que nao e o seu): barrado pelo WITH CHECK
  v_erro := NULL;
  BEGIN
    INSERT INTO public.originators_v2 (id, name, email, cpf_cnpj)
    VALUES (gen_random_uuid(), 'Laranja', 'laranja.rls@teste.invalid', '52998224725');
  EXCEPTION WHEN others THEN v_erro := SQLERRM;
  END;
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU: embaixador inseriu linha com id alheio'; END IF;

  -- 2f) apagar: so papel interno
  DELETE FROM public.originators_v2 WHERE id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador apagou linha alheia'; END IF;
  DELETE FROM public.originators_v2 WHERE id = v_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU: embaixador apagou a propria linha (DELETE e so do papel interno)'; END IF;

  -- =====================================================================
  -- 3) CADASTRO PUBLICO com sessao ativa: insere a PROPRIA linha
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_novo, 'role', 'authenticated')::text, true);
  INSERT INTO public.originators_v2 (id, name, email, phone, cpf_cnpj, pix_key, pix_key_type)
  VALUES (v_novo, 'Novo Emb', 'novo.emb.rls@teste.invalid', '84999990003', '15350946056', 'novo@teste.invalid', 'email');
  SELECT count(*) INTO v_n FROM public.originators_v2 WHERE id = v_novo;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: cadastro publico com sessao nao conseguiu gravar a propria linha'; END IF;

  -- =====================================================================
  -- 4) ADMIN (papel interno): le e grava qualquer linha
  -- =====================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_n FROM public.originators_v2 WHERE id IN (v_a, v_b);
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU: admin so enxerga % das 2 linhas', v_n; END IF;

  UPDATE public.originators_v2
     SET pix_key = 'pix-corrigido@teste.invalid', split_commission = '{"start": 5, "recurrent": 3}'::jsonb
   WHERE id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: admin nao consegue corrigir PIX/comissao'; END IF;

  -- =====================================================================
  -- 5) SERVICE ROLE / gatilho SECURITY DEFINER: short_url continua gravavel
  --    (trg_originador_short_url chama a Edge Function originador-short-url,
  --     que escreve sem sessao de usuario — auth.uid() nulo)
  -- =====================================================================
  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.originators_v2 SET short_url = 'https://link.b2wenergia.com.br/gerado' WHERE id = v_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU: service role nao consegue gravar short_url'; END IF;

  -- =====================================================================
  -- 6) anon segue como estava: SELECT so de id/phone, INSERT do formulario
  -- =====================================================================
  IF NOT has_column_privilege('anon', 'public.originators_v2', 'phone', 'SELECT') THEN
    RAISE EXCEPTION 'FALHOU: anon perdeu o SELECT de phone';
  END IF;
  IF has_column_privilege('anon', 'public.originators_v2', 'pix_key', 'SELECT') THEN
    RAISE EXCEPTION 'FALHOU: anon passou a ler pix_key';
  END IF;
  IF NOT has_column_privilege('anon', 'public.originators_v2', 'pix_key', 'INSERT') THEN
    RAISE EXCEPTION 'FALHOU: anon perdeu o INSERT do formulario publico';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
