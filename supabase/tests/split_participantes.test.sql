-- Task 5 (Split de Pagamentos): fn_participantes_recompensa(p_uc) resolve QUEM
-- recebe numa fatura, olhando a arvore de indicacao.
-- Migracao: 20260928e_participantes.sql
--
-- Formato de saida (o que fn_calcular_split_recompensa consome):
--   [{papel, id, nivel, suspenso}]   -- no maximo 1 por categoria
--   categorias: parceiro (ppe|ppp|ppf), lider, assinante_conect
--
-- Regras conferidas aqui:
--   * nivel do parceiro = 1 + saltos em indicado_por_uc_id; lider = mesmo nivel;
--     assinante_conect = sempre 1 e e o dono da UC indicadora
--   * suspenso (o participante ENTRA, com suspenso:true): PPP com
--     licenca_vencimento < current_date (nunca licenca_status), originador /
--     lider inativos (originators_v2.ativo = false), assinante do Conect que
--     nao esta 'ativo'
--   * UC geradora, UC sem assinante, UC inexistente: [] ; sem originador: sem
--     parceiro nem lider (o Conect, que independe do originador, continua)
--   * ponta a ponta: a saida alimenta o motor sem estourar a guarda
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste).
-- Rodar pelo MCP execute_sql. Qualquer outra mensagem = falha.
DO $$
DECLARE
  v_regras jsonb := '{
    "b2w":  {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
    "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"}, "max_niveis": 3},
    "ppe":  {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2},
    "ppp":  {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2},
    "ppf":  {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2},
    "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
  }'::jsonb;

  v_dono     text := current_user;
  v_emb      uuid := gen_random_uuid();

  -- originadores
  v_lider    uuid;   -- cargo lider
  v_lider_in uuid;   -- cargo lider, inativo
  v_ppf      uuid;   -- ppf com lider
  v_ppp      uuid;   -- ppp com licenca em dia, com lider
  v_ppp_venc uuid;   -- ppp com licenca vencida ontem, com lider
  v_ppp_hoje uuid;   -- ppp com licenca vencendo hoje (ainda vale)
  v_ppe      uuid;   -- ppe sem lider
  v_ppf_in   uuid;   -- ppf inativo, com lider
  v_ppf_lin  uuid;   -- ppf ativo, com lider inativo

  -- assinantes / UCs
  v_sa uuid; v_sb uuid; v_sc uuid; v_sd uuid; v_se uuid; v_sf uuid;
  v_ua uuid; v_ub uuid; v_uc uuid; v_ud uuid; v_ue uuid; v_uf uuid;
  v_sx uuid; v_ux uuid;

  v_out   jsonb;
  v_p     jsonb;
  v_n     integer;
  v_split jsonb;
  v_txt   text;
  v_erro  text;
  v_state text;
BEGIN
  -- ======================================================================
  -- Fixtures: originadores
  -- ======================================================================
  INSERT INTO public.originators_v2 (name, cargo) VALUES ('SBX Lider', 'lider') RETURNING id INTO v_lider;
  INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SBX Lider Inativo', 'lider', false) RETURNING id INTO v_lider_in;
  INSERT INTO public.originators_v2 (name, cargo, lider_id) VALUES ('SBX PPF', 'ppf', v_lider) RETURNING id INTO v_ppf;
  INSERT INTO public.originators_v2 (name, cargo, lider_id, licenca_valor, licenca_vencimento)
    VALUES ('SBX PPP em dia', 'ppp', v_lider, 199.90, current_date + 30) RETURNING id INTO v_ppp;
  INSERT INTO public.originators_v2 (name, cargo, lider_id, licenca_valor, licenca_vencimento)
    VALUES ('SBX PPP vencido', 'ppp', v_lider, 199.90, current_date - 1) RETURNING id INTO v_ppp_venc;
  INSERT INTO public.originators_v2 (name, cargo, lider_id, licenca_valor, licenca_vencimento)
    VALUES ('SBX PPP vence hoje', 'ppp', v_lider, 199.90, current_date) RETURNING id INTO v_ppp_hoje;
  INSERT INTO public.originators_v2 (name, cargo) VALUES ('SBX PPE', 'ppe') RETURNING id INTO v_ppe;
  INSERT INTO public.originators_v2 (name, cargo, lider_id, ativo) VALUES ('SBX PPF inativo', 'ppf', v_lider, false) RETURNING id INTO v_ppf_in;
  INSERT INTO public.originators_v2 (name, cargo, lider_id) VALUES ('SBX PPF lider inativo', 'ppf', v_lider_in) RETURNING id INTO v_ppf_lin;

  -- ======================================================================
  -- 0) 'ativo' existe, default true, e a guarda de campos sensiveis o protege
  -- ======================================================================
  SELECT count(*) INTO v_n FROM public.originators_v2 WHERE id IN (v_lider, v_ppf, v_ppp) AND ativo IS TRUE;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FALHOU 0a: originators_v2.ativo nao tem default true (% de 3)', v_n; END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  VALUES (v_emb, 'emb.participantes@teste.invalid', '{"name":"Emb Participantes"}', 'authenticated', 'authenticated');
  INSERT INTO public.originators_v2 (id, name, email) VALUES (v_emb, 'SBX Emb', 'emb.participantes@teste.invalid');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_emb, 'role', 'authenticated')::text, true);
  v_erro := NULL; v_state := NULL;
  BEGIN
    UPDATE public.originators_v2 SET ativo = false WHERE id = v_emb;
  EXCEPTION WHEN others THEN v_erro := SQLERRM; v_state := SQLSTATE;
  END;
  PERFORM set_config('role', v_dono, true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_erro IS NULL THEN RAISE EXCEPTION 'FALHOU 0b: embaixador alterou o proprio ativo'; END IF;
  IF v_state <> '42501' THEN RAISE EXCEPTION 'FALHOU 0b: ativo barrado com SQLSTATE % (esperado 42501): %', v_state, v_erro; END IF;

  -- ======================================================================
  -- Fixtures: assinantes e UCs
  --   A: venda direta do PPF
  --   B: indicada por A, originador PPP em dia            (1 salto)
  --   C: indicada por B, originador PPF                   (2 saltos)
  --   D: indicada por C                                   (3 saltos)
  --   E: indicada por D                                   (4 saltos)
  --   F: indicada por E                                   (5 saltos)
  -- ======================================================================
  INSERT INTO public.subscribers (name, originator_id) VALUES ('SBX A', v_ppf) RETURNING id INTO v_sa;
  INSERT INTO public.subscribers (name, originator_id) VALUES ('SBX B', v_ppp) RETURNING id INTO v_sb;
  INSERT INTO public.subscribers (name, originator_id) VALUES ('SBX C', v_ppf) RETURNING id INTO v_sc;
  INSERT INTO public.subscribers (name, originator_id) VALUES ('SBX D', v_ppf) RETURNING id INTO v_sd;
  INSERT INTO public.subscribers (name, originator_id) VALUES ('SBX E', v_ppf) RETURNING id INTO v_se;
  INSERT INTO public.subscribers (name, originator_id) VALUES ('SBX F', v_ppf) RETURNING id INTO v_sf;

  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_sa, 'beneficiaria', 'ativacao') RETURNING id INTO v_ua;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, indicado_por_uc_id) VALUES (v_sb, 'beneficiaria', 'ativacao', v_ua) RETURNING id INTO v_ub;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, indicado_por_uc_id) VALUES (v_sc, 'beneficiaria', 'ativacao', v_ub) RETURNING id INTO v_uc;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, indicado_por_uc_id) VALUES (v_sd, 'beneficiaria', 'ativacao', v_uc) RETURNING id INTO v_ud;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, indicado_por_uc_id) VALUES (v_se, 'beneficiaria', 'ativacao', v_ud) RETURNING id INTO v_ue;
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, indicado_por_uc_id) VALUES (v_sf, 'beneficiaria', 'ativacao', v_ue) RETURNING id INTO v_uf;

  -- status do assinante por ultimo (gatilhos de UC podem recalcular)
  UPDATE public.subscribers SET status = 'ativo' WHERE id IN (v_sa, v_sb, v_sc, v_sd, v_se, v_sf);
  SELECT count(*) INTO v_n FROM public.subscribers WHERE id IN (v_sa, v_sb, v_sc, v_sd, v_se, v_sf) AND status = 'ativo';
  IF v_n <> 6 THEN RAISE EXCEPTION 'FALHOU fixture: so % de 6 assinantes ficaram ativos', v_n; END IF;

  -- ======================================================================
  -- 1) venda direta (UC A): parceiro ppf nivel 1 + lider nivel 1, sem conect
  -- ======================================================================
  v_out := public.fn_participantes_recompensa(v_ua);
  IF jsonb_typeof(v_out) <> 'array' THEN RAISE EXCEPTION 'FALHOU 1: nao devolveu array: %', v_out; END IF;
  IF jsonb_array_length(v_out) <> 2 THEN RAISE EXCEPTION 'FALHOU 1: esperava 2 participantes, veio %', v_out; END IF;

  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF v_p IS NULL OR (v_p->>'id')::uuid <> v_ppf OR (v_p->>'nivel')::int <> 1 OR (v_p->>'suspenso')::boolean THEN
    RAISE EXCEPTION 'FALHOU 1: parceiro venda direta errado: %', v_out;
  END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'lider';
  IF v_p IS NULL OR (v_p->>'id')::uuid <> v_lider OR (v_p->>'nivel')::int <> 1 OR (v_p->>'suspenso')::boolean THEN
    RAISE EXCEPTION 'FALHOU 1: lider venda direta errado: %', v_out;
  END IF;

  -- 1e) ponta a ponta: alimenta o motor (base 100, teto folgado)
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (v_split #>> '{b2w,valor}')::numeric <> 10
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'ppf') <> 2
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'lider') <> 1
     OR (v_split->>'fornecedor')::numeric <> 87 THEN
    RAISE EXCEPTION 'FALHOU 1e: split da venda direta: %', v_split;
  END IF;

  -- ======================================================================
  -- 2) indicacao em 1 salto (UC B, indicada por A): ppp nivel 2, lider nivel 2,
  --    assinante_conect = assinante A, nivel 1
  -- ======================================================================
  v_out := public.fn_participantes_recompensa(v_ub);
  IF jsonb_array_length(v_out) <> 3 THEN RAISE EXCEPTION 'FALHOU 2: esperava 3 participantes, veio %', v_out; END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppp';
  IF v_p IS NULL OR (v_p->>'id')::uuid <> v_ppp OR (v_p->>'nivel')::int <> 2 OR (v_p->>'suspenso')::boolean THEN
    RAISE EXCEPTION 'FALHOU 2: ppp em 1 salto errado: %', v_out;
  END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'lider';
  IF v_p IS NULL OR (v_p->>'id')::uuid <> v_lider OR (v_p->>'nivel')::int <> 2 OR (v_p->>'suspenso')::boolean THEN
    RAISE EXCEPTION 'FALHOU 2: lider em 1 salto errado: %', v_out;
  END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'assinante_conect';
  IF v_p IS NULL OR (v_p->>'id')::uuid <> v_sa OR (v_p->>'nivel')::int <> 1 OR (v_p->>'suspenso')::boolean THEN
    RAISE EXCEPTION 'FALHOU 2: conect em 1 salto errado: %', v_out;
  END IF;

  -- 2e) ponta a ponta: ppp L2=2, lider L2=1, conect L1=2, b2w 10 => 15 => fornecedor 85
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (v_split #>> '{b2w,valor}')::numeric <> 10
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'ppp') <> 2
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'lider') <> 1
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'assinante_conect') <> 2
     OR (v_split->>'fornecedor')::numeric <> 85 THEN
    RAISE EXCEPTION 'FALHOU 2e: split do 1 salto: %', v_split;
  END IF;

  -- ======================================================================
  -- 3) cadeia longa: nivel = 1 + saltos; conect sempre nivel 1 e dono da
  --    UC indicadora IMEDIATA
  -- ======================================================================
  -- UC C = 2 saltos -> nivel 3 ; UC D = 3 saltos -> nivel 4 ; UC E = 4 saltos -> nivel 5
  v_out := public.fn_participantes_recompensa(v_uc);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF (v_p->>'nivel')::int <> 3 THEN RAISE EXCEPTION 'FALHOU 3a: nivel do parceiro em 2 saltos = %, esperado 3', v_p->>'nivel'; END IF;

  v_out := public.fn_participantes_recompensa(v_ud);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF (v_p->>'nivel')::int <> 4 THEN RAISE EXCEPTION 'FALHOU 3b: nivel do parceiro em 3 saltos = %, esperado 4', v_p->>'nivel'; END IF;

  v_out := public.fn_participantes_recompensa(v_ue);   -- 4 saltos
  IF jsonb_array_length(v_out) <> 3 THEN RAISE EXCEPTION 'FALHOU 3c: esperava 3 participantes, veio %', v_out; END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF (v_p->>'id')::uuid <> v_ppf OR (v_p->>'nivel')::int <> 5 THEN RAISE EXCEPTION 'FALHOU 3c: parceiro em 4 saltos: %', v_out; END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'lider';
  IF (v_p->>'id')::uuid <> v_lider OR (v_p->>'nivel')::int <> 5 THEN RAISE EXCEPTION 'FALHOU 3c: lider em 4 saltos: %', v_out; END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'assinante_conect';
  IF (v_p->>'id')::uuid <> v_sd OR (v_p->>'nivel')::int <> 1 THEN
    RAISE EXCEPTION 'FALHOU 3c: conect deveria ser o assinante D (UC indicadora imediata), nivel 1: %', v_out;
  END IF;

  -- 3d) ponta a ponta: nivel 5 passa do max_niveis => ppf 0, lider 0; so conect 2 + b2w 10
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'ppf') <> 0
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'lider') <> 0
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'assinante_conect') <> 2
     OR (v_split->>'fornecedor')::numeric <> 88 THEN
    RAISE EXCEPTION 'FALHOU 3d: split da cadeia de 4 saltos: %', v_split;
  END IF;

  -- 3e) o teto de 50 saltos: cadeia de 52 UCs (51 saltos) nao pode travar nem estourar
  --     e o nivel fica limitado a 51 (1 + 50 saltos)
  DECLARE
    v_prev uuid := v_uf;
    v_novo uuid;
    v_subs uuid;
    i integer;
  BEGIN
    FOR i IN 1..50 LOOP
      INSERT INTO public.subscribers (name, originator_id, status) VALUES ('SBX cadeia '||i, v_ppf, 'ativo') RETURNING id INTO v_subs;
      INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, indicado_por_uc_id)
      VALUES (v_subs, 'beneficiaria', 'ativacao', v_prev) RETURNING id INTO v_novo;
      v_prev := v_novo;
    END LOOP;
    -- v_uf ja e 5 saltos; +50 => 55 saltos reais, o teto corta em 50 => nivel 51
    v_out := public.fn_participantes_recompensa(v_prev);
    SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
    IF (v_p->>'nivel')::int <> 51 THEN
      RAISE EXCEPTION 'FALHOU 3e: teto de 50 saltos: nivel = %, esperado 51', v_p->>'nivel';
    END IF;
  END;

  -- ======================================================================
  -- 4) originador inativo: ENTRA, com suspenso:true (nao some)
  -- ======================================================================
  UPDATE public.subscribers SET originator_id = v_ppf_in WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  IF jsonb_array_length(v_out) <> 2 THEN RAISE EXCEPTION 'FALHOU 4: originador inativo sumiu da lista: %', v_out; END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF v_p IS NULL OR NOT (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 4: ppf inativo deveria vir suspenso: %', v_out; END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'lider';
  IF v_p IS NULL OR (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 4: lider ativo nao deveria ser suspenso: %', v_out; END IF;

  -- 4e) ponta a ponta: o 2% do ppf vai para a B2W (12), lider 1, fornecedor 87
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (v_split #>> '{b2w,valor}')::numeric <> 12
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'ppf') <> 0
     OR (v_split->>'fornecedor')::numeric <> 87 THEN
    RAISE EXCEPTION 'FALHOU 4e: split com originador inativo: %', v_split;
  END IF;

  -- 4f) lider inativo: ele entra suspenso, o parceiro (ativo) nao
  UPDATE public.subscribers SET originator_id = v_ppf_lin WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'lider';
  IF v_p IS NULL OR NOT (v_p->>'suspenso')::boolean OR (v_p->>'id')::uuid <> v_lider_in THEN
    RAISE EXCEPTION 'FALHOU 4f: lider inativo deveria vir suspenso: %', v_out;
  END IF;
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 4f: ppf ativo nao deveria ser suspenso: %', v_out; END IF;

  -- ======================================================================
  -- 5) PPP com licenca vencida: suspenso. Vence hoje ainda vale (< e nao <=).
  -- ======================================================================
  UPDATE public.subscribers SET originator_id = v_ppp_venc WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppp';
  IF v_p IS NULL OR NOT (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 5a: ppp vencido ontem deveria vir suspenso: %', v_out; END IF;

  -- 5e) ponta a ponta: 4% do ppp vai para a B2W (14), lider 1, fornecedor 85
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (v_split #>> '{b2w,valor}')::numeric <> 14
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'ppp') <> 0
     OR (v_split->>'fornecedor')::numeric <> 85 THEN
    RAISE EXCEPTION 'FALHOU 5e: split com ppp vencido: %', v_split;
  END IF;

  UPDATE public.subscribers SET originator_id = v_ppp_hoje WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppp';
  IF v_p IS NULL OR (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 5b: ppp que vence hoje nao esta vencido: %', v_out; END IF;

  -- 5c) a decisao vem de licenca_vencimento, NAO do licenca_status gravado:
  --     status gravado 'ativa' com vencimento no passado (dado envelhecido)
  --     continua suspenso; status gravado 'vencida' com vencimento futuro nao.
  -- (o gatilho trg_originador_licenca_status re-deriva o status a cada escrita; para
  -- simular o envelhecimento pelo passar do tempo ele e desligado so nesta transacao,
  -- que termina em rollback)
  ALTER TABLE public.originators_v2 DISABLE TRIGGER trg_originador_licenca_status;
  UPDATE public.originators_v2 SET licenca_status = 'ativa'   WHERE id = v_ppp_venc;
  UPDATE public.originators_v2 SET licenca_status = 'vencida' WHERE id = v_ppp;
  ALTER TABLE public.originators_v2 ENABLE TRIGGER trg_originador_licenca_status;
  SELECT licenca_status INTO v_txt FROM public.originators_v2 WHERE id = v_ppp_venc;
  IF v_txt <> 'ativa' THEN RAISE EXCEPTION 'FALHOU 5c: fixture do status envelhecido nao pegou (%)', v_txt; END IF;

  UPDATE public.subscribers SET originator_id = v_ppp_venc WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppp';
  IF NOT (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 5c: licenca_status ''ativa'' envelhecido mascarou o vencimento: %', v_out; END IF;

  UPDATE public.subscribers SET originator_id = v_ppp WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppp';
  IF (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 5c: licenca_status ''vencida'' gravado suspendeu PPP com vencimento futuro: %', v_out; END IF;

  -- 5d) PPE/PPF nao dependem de licenca (ppf com licenca_vencimento no passado segue ativo)
  UPDATE public.originators_v2 SET licenca_vencimento = current_date - 400 WHERE id = v_ppf;
  UPDATE public.subscribers SET originator_id = v_ppf WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'ppf';
  IF (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 5d: licenca so vale para PPP: %', v_out; END IF;

  -- ======================================================================
  -- 6) assinante do Conect inativo: ENTRA com suspenso:true.
  --    Considerado ativo so o status 'ativo'.
  -- ======================================================================
  UPDATE public.subscribers SET status = 'cancelado' WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ub);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'assinante_conect';
  IF v_p IS NULL OR NOT (v_p->>'suspenso')::boolean OR (v_p->>'id')::uuid <> v_sa THEN
    RAISE EXCEPTION 'FALHOU 6a: conect cancelado deveria vir suspenso: %', v_out;
  END IF;
  -- 6b) ponta a ponta: 2% do conect vai para a B2W (12); ppp L2 2, lider 1 => fornecedor 85
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (v_split #>> '{b2w,valor}')::numeric <> 12
     OR (SELECT (b->>'valor')::numeric FROM jsonb_array_elements(v_split->'beneficiarios') b WHERE b->>'papel' = 'assinante_conect') <> 0
     OR (v_split->>'fornecedor')::numeric <> 85 THEN
    RAISE EXCEPTION 'FALHOU 6b: split com conect inativo: %', v_split;
  END IF;

  UPDATE public.subscribers SET status = 'ativo_inadimplente' WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ub);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'assinante_conect';
  IF NOT (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 6c: conect inadimplente deveria vir suspenso: %', v_out; END IF;

  UPDATE public.subscribers SET status = 'ativo' WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ub);
  SELECT e INTO v_p FROM jsonb_array_elements(v_out) e WHERE e->>'papel' = 'assinante_conect';
  IF (v_p->>'suspenso')::boolean THEN RAISE EXCEPTION 'FALHOU 6d: conect ativo nao deveria ser suspenso: %', v_out; END IF;

  -- ======================================================================
  -- 7) sem originador: sem parceiro nem lider (array vazio); indicada por
  --    alguem: so o assinante do Conect
  -- ======================================================================
  UPDATE public.subscribers SET originator_id = NULL WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  IF v_out <> '[]'::jsonb THEN RAISE EXCEPTION 'FALHOU 7a: UC sem originador deveria dar [], veio %', v_out; END IF;

  UPDATE public.subscribers SET originator_id = NULL WHERE id = v_sb;
  v_out := public.fn_participantes_recompensa(v_ub);
  IF jsonb_array_length(v_out) <> 1 OR v_out->0->>'papel' <> 'assinante_conect' THEN
    RAISE EXCEPTION 'FALHOU 7b: UC indicada e sem originador deveria trazer so o conect: %', v_out;
  END IF;
  -- e esse resultado vai para o motor sem estourar
  v_split := public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);
  IF (v_split->>'fornecedor')::numeric <> 88 THEN RAISE EXCEPTION 'FALHOU 7c: split so com conect: %', v_split; END IF;

  -- ======================================================================
  -- 8) UC geradora, UC sem assinante, UC inexistente: []
  -- ======================================================================
  UPDATE public.subscribers SET originator_id = v_ppf WHERE id = v_sa;
  UPDATE public.consumer_units SET tipo_unidade = 'geradora' WHERE id = v_ua;
  v_out := public.fn_participantes_recompensa(v_ua);
  IF v_out <> '[]'::jsonb THEN RAISE EXCEPTION 'FALHOU 8a: UC geradora deveria dar [], veio %', v_out; END IF;

  -- geradora que veio de indicacao tambem: nada
  UPDATE public.consumer_units SET tipo_unidade = 'geradora' WHERE id = v_ub;
  v_out := public.fn_participantes_recompensa(v_ub);
  IF v_out <> '[]'::jsonb THEN RAISE EXCEPTION 'FALHOU 8b: UC geradora indicada deveria dar [], veio %', v_out; END IF;
  UPDATE public.consumer_units SET tipo_unidade = 'beneficiaria' WHERE id IN (v_ua, v_ub);

  INSERT INTO public.consumer_units (tipo_unidade, status) VALUES ('beneficiaria', 'ativacao') RETURNING id INTO v_ux;
  v_out := public.fn_participantes_recompensa(v_ux);
  IF v_out <> '[]'::jsonb THEN RAISE EXCEPTION 'FALHOU 8c: UC sem assinante deveria dar [], veio %', v_out; END IF;

  v_out := public.fn_participantes_recompensa(gen_random_uuid());
  IF v_out <> '[]'::jsonb THEN RAISE EXCEPTION 'FALHOU 8d: UC inexistente deveria dar [], veio %', v_out; END IF;

  v_out := public.fn_participantes_recompensa(NULL);
  IF v_out <> '[]'::jsonb THEN RAISE EXCEPTION 'FALHOU 8e: UC nula deveria dar [], veio %', v_out; END IF;

  -- ======================================================================
  -- 9) originador de cargo lider vendendo direto: entra como lider (uma vez);
  --    sem parceiro; nao se duplica com o proprio lider_id
  -- ======================================================================
  UPDATE public.subscribers SET originator_id = v_lider WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  IF jsonb_array_length(v_out) <> 1 OR v_out->0->>'papel' <> 'lider' OR (v_out->0->>'id')::uuid <> v_lider OR (v_out->0->>'nivel')::int <> 1 THEN
    RAISE EXCEPTION 'FALHOU 9: originador lider vendendo direto: %', v_out;
  END IF;

  -- ======================================================================
  -- 10) PPE sem lider: so o parceiro (categoria lider ausente)
  -- ======================================================================
  UPDATE public.subscribers SET originator_id = v_ppe WHERE id = v_sa;
  v_out := public.fn_participantes_recompensa(v_ua);
  IF jsonb_array_length(v_out) <> 1 OR v_out->0->>'papel' <> 'ppe' THEN
    RAISE EXCEPTION 'FALHOU 10: ppe sem lider: %', v_out;
  END IF;

  -- ======================================================================
  -- 11) contrato com o motor: nunca mais de um por categoria, formato exato
  -- ======================================================================
  FOR v_sx IN SELECT unnest(ARRAY[v_ua, v_ub, v_uc, v_ud, v_ue, v_uf]) LOOP
    v_out := public.fn_participantes_recompensa(v_sx);
    PERFORM public.fn_calcular_split_recompensa(100, 50, v_regras, v_out);  -- estoura se violar a guarda
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_out) e
       WHERE NOT (e ?& ARRAY['papel','id','nivel','suspenso'])
          OR jsonb_typeof(e->'nivel') <> 'number'
          OR jsonb_typeof(e->'suspenso') <> 'boolean'
    ) THEN
      RAISE EXCEPTION 'FALHOU 11: formato fora do contrato: %', v_out;
    END IF;
  END LOOP;

  -- 11b) a funcao nao e exposta a anon/authenticated (le a rede de indicacao)
  IF has_function_privilege('anon', 'public.fn_participantes_recompensa(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_participantes_recompensa(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU 11b: fn_participantes_recompensa exposta a anon/authenticated';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
