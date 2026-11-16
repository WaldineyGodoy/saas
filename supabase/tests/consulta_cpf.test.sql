-- =====================================================================
-- Consulta de CPF (CPFHub): cache, limites do publico e nascimento do assinante
-- Data: 16/11/2026
--
-- Padrao da casa: DO que termina em RAISE EXCEPTION 'SANDBOX_OK'. Sucesso =
-- receber esse erro; ele desfaz tudo, entao nada de teste sobra em producao.
-- =====================================================================

DO $$
DECLARE
  v_r jsonb; v_id bigint; v_id2 bigint; v_nasc date; v_sub uuid; i int;
  CPF_A constant text := '52998224725';
  CPF_B constant text := '11144477735';
  CPF_C constant text := '39053344705';
BEGIN
  -- ---------- 0. objetos existem ----------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscribers' AND column_name='data_nascimento') THEN
    RAISE EXCEPTION 'FALHA: subscribers.data_nascimento nao existe'; END IF;
  IF to_regclass('public.cpf_consultas') IS NULL THEN RAISE EXCEPTION 'FALHA: tabela cpf_consultas nao existe'; END IF;
  IF to_regclass('public.cpf_consultas_uso') IS NULL THEN RAISE EXCEPTION 'FALHA: tabela cpf_consultas_uso nao existe'; END IF;
  IF to_regprocedure('public.fn_cpf_reservar(text,text,boolean,integer,integer)') IS NULL THEN RAISE EXCEPTION 'FALHA: fn_cpf_reservar nao existe'; END IF;
  IF to_regprocedure('public.fn_cpf_registrar(bigint,text,integer)') IS NULL THEN RAISE EXCEPTION 'FALHA: fn_cpf_registrar nao existe'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_subscriber_nascimento_do_cache') THEN RAISE EXCEPTION 'FALHA: gatilho do nascimento nao existe'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integrations_config WHERE service_name='cpfhub') THEN RAISE EXCEPTION 'FALHA: linha cpfhub em integrations_config nao existe'; END IF;

  -- ---------- 1. cache e uso sao inacessiveis a anon e a logado comum ----------
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.cpf_consultas LIMIT 1;
    RAISE EXCEPTION 'FALHA: anon leu cpf_consultas (nome + nascimento de qualquer CPF)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM public.cpf_consultas_uso LIMIT 1;
    RAISE EXCEPTION 'FALHA: anon leu cpf_consultas_uso';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.fn_cpf_reservar('publico', 'x', true, 5, 150);
    RAISE EXCEPTION 'FALHA: anon executou fn_cpf_reservar (o limite seria burlavel)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM public.cpf_consultas LIMIT 1;
    RAISE EXCEPTION 'FALHA: usuario logado leu cpf_consultas';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.fn_cpf_reservar('interno', '', true, 5, 150);
    RAISE EXCEPTION 'FALHA: usuario logado executou fn_cpf_reservar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- ---------- 2. equipe nao tem limite ----------
  FOR i IN 1..8 LOOP
    v_r := public.fn_cpf_reservar('interno', '', true, 1, 1);
    IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: equipe foi limitada na tentativa % (%)', i, v_r; END IF;
  END LOOP;

  -- ---------- 3. limite por IP (cada IP vale por si) ----------
  v_r := public.fn_cpf_reservar('publico', 'ip-teste-A', true, 2, 1000);
  IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: 1a consulta do IP recusada (%)', v_r; END IF;
  v_r := public.fn_cpf_reservar('publico', 'ip-teste-A', false, 2, 1000);   -- consulta so de cache tambem conta
  IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: 2a consulta do IP recusada (%)', v_r; END IF;
  v_r := public.fn_cpf_reservar('publico', 'ip-teste-A', true, 2, 1000);
  IF (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: 3a consulta do mesmo IP passou do limite de 2'; END IF;
  IF v_r->>'motivo' <> 'limite_publico' THEN RAISE EXCEPTION 'FALHA: motivo errado (%)', v_r; END IF;
  v_r := public.fn_cpf_reservar('publico', 'ip-teste-B', true, 2, 1000);
  IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: outro IP foi bloqueado pelo limite do primeiro (%)', v_r; END IF;

  -- limite 0 = publico desligado
  v_r := public.fn_cpf_reservar('publico', 'ip-teste-C', true, 0, 1000);
  IF (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: limite 0 por IP deveria bloquear tudo'; END IF;

  -- sem IP (hash vazio) cai num balde unico compartilhado
  v_r := public.fn_cpf_reservar('publico', '', true, 1, 1000);
  IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: 1a consulta sem IP recusada'; END IF;
  v_r := public.fn_cpf_reservar('publico', '', true, 1, 1000);
  IF (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: consultas sem IP deveriam dividir um unico balde'; END IF;

  -- ---------- 4. teto diario so conta o que gasta credito ----------
  DELETE FROM public.cpf_consultas_uso;   -- zera dentro do teste (volta com o rollback)
  v_id  := (public.fn_cpf_reservar('publico', 'dia-1', true, 100, 3)->>'id')::bigint;
  v_id2 := (public.fn_cpf_reservar('publico', 'dia-2', true, 100, 3)->>'id')::bigint;
  PERFORM public.fn_cpf_reservar('publico', 'dia-3', true, 100, 3);
  v_r := public.fn_cpf_reservar('publico', 'dia-4', true, 100, 3);
  IF (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: 4a consulta paga do dia passou do teto de 3'; END IF;
  -- cache nao gasta: passa mesmo com o teto estourado
  v_r := public.fn_cpf_reservar('publico', 'dia-5', false, 100, 3);
  IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: consulta de cache foi barrada pelo teto de credito (%)', v_r; END IF;
  -- uma que acabou em "nao encontrado" nao gastou: libera uma vaga
  PERFORM public.fn_cpf_registrar(v_id, 'nao_encontrado', 0);
  v_r := public.fn_cpf_reservar('publico', 'dia-6', true, 100, 3);
  IF NOT (v_r->>'ok')::boolean THEN RAISE EXCEPTION 'FALHA: vaga nao foi liberada apos consulta que nao gastou credito (%)', v_r; END IF;
  -- uma que gastou continua ocupando a vaga
  PERFORM public.fn_cpf_registrar(v_id2, 'encontrado', 1);
  IF (SELECT creditos FROM public.cpf_consultas_uso WHERE id = v_id2) <> 1 THEN RAISE EXCEPTION 'FALHA: credito gasto nao foi registrado'; END IF;
  -- registrar sem id (equipe/cache sem reserva) nao explode
  PERFORM public.fn_cpf_registrar(NULL, 'cache', 0);

  -- ---------- 5. nascimento do cache vai para o assinante novo ----------
  INSERT INTO public.cpf_consultas (cpf, nome, data_nascimento) VALUES (CPF_A, 'Fulano de Tal', DATE '1990-06-15');
  INSERT INTO public.cpf_consultas (cpf, nome, data_nascimento) VALUES (CPF_C, 'Beltrano', DATE '1999-09-09');

  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Fulano', '529.982.247-25', 'consulta.cpf1@example.test', '5511999990011', 'ativacao') RETURNING id INTO v_sub;
  SELECT data_nascimento INTO v_nasc FROM public.subscribers WHERE id = v_sub;
  IF v_nasc IS DISTINCT FROM DATE '1990-06-15' THEN RAISE EXCEPTION 'FALHA: nascimento nao veio do cache (ficou %)', v_nasc; END IF;

  -- o que a equipe digitou nao e sobrescrito
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status, data_nascimento)
  VALUES ('Fulano2', CPF_C, 'consulta.cpf2@example.test', '5511999990012', 'ativacao', DATE '1985-01-02') RETURNING id INTO v_sub;
  SELECT data_nascimento INTO v_nasc FROM public.subscribers WHERE id = v_sub;
  IF v_nasc IS DISTINCT FROM DATE '1985-01-02' THEN RAISE EXCEPTION 'FALHA: cache sobrescreveu a data informada (ficou %)', v_nasc; END IF;

  -- CPF que nunca foi consultado fica sem data (nada inventado)
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Sicrano', CPF_B, 'consulta.cpf3@example.test', '5511999990013', 'ativacao') RETURNING id INTO v_sub;
  SELECT data_nascimento INTO v_nasc FROM public.subscribers WHERE id = v_sub;
  IF v_nasc IS NOT NULL THEN RAISE EXCEPTION 'FALHA: assinante sem consulta ganhou data (%)', v_nasc; END IF;

  -- CNPJ nunca recebe nascimento de CPF
  INSERT INTO public.subscribers (name, cpf_cnpj, email, phone, status)
  VALUES ('Empresa', '11222333000181', 'consulta.cnpj@example.test', '5511999990014', 'ativacao') RETURNING id INTO v_sub;
  SELECT data_nascimento INTO v_nasc FROM public.subscribers WHERE id = v_sub;
  IF v_nasc IS NOT NULL THEN RAISE EXCEPTION 'FALHA: CNPJ ganhou nascimento (%)', v_nasc; END IF;

  -- ---------- 6. cache: CPF malformado e recusado pela tabela ----------
  BEGIN
    INSERT INTO public.cpf_consultas (cpf, nome) VALUES ('123', 'X');
    RAISE EXCEPTION 'FALHA: cache aceitou CPF com 3 digitos';
  EXCEPTION WHEN check_violation THEN NULL; END;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
