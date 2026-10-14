-- Task 4 (Split de Pagamentos): rodada de correcoes de revisao do motor
-- puro do split -- guarda de entradas e contrato de saida.
-- Migracao: 20260928c_motor_split_guardas.sql
-- Spec original: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-4-brief.md
--
-- fn_calcular_split_recompensa nao toca tabela (IMMUTABLE), entao este
-- teste nao precisa de setup/teardown de linhas.
--
-- Sucesso = erro SANDBOX_OK. Rodar pelo MCP execute_sql. Qualquer outra
-- mensagem = falha.
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

  v_regras_sem_b2w jsonb := '{
    "ppe":  {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2}
  }'::jsonb;

  v_regras_pct_negativo jsonb := '{
    "b2w":  {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
    "ppe":  {"niveis": {"L1": "-5", "L2": "2",  "L3": "0",  "L4": "0"}, "max_niveis": 2}
  }'::jsonb;

  v_ppe    uuid := '11111111-1111-1111-1111-111111111111';
  v_ppp    uuid := '22222222-2222-2222-2222-222222222222';
  v_lider  uuid := '44444444-4444-4444-4444-444444444444';
  v_conect uuid := '55555555-5555-5555-5555-555555555555';

  v_result jsonb;
  v_erro_capturado boolean;
  v_priv boolean;
  v_search_path_fixo boolean;
BEGIN
  -- ======================================================================
  -- G1 (F1): p_teto_deducao NULL estoura erro (nao vira trava aberta)
  -- ======================================================================
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(
      100.00, NULL, v_regras,
      jsonb_build_array(jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false))
    );
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
    IF SQLERRM NOT ILIKE '%p_teto_deducao%' THEN
      RAISE EXCEPTION 'FALHOU G1: erro veio mas sem mencionar p_teto_deducao: %', SQLERRM;
    END IF;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU G1: p_teto_deducao NULL deveria estourar erro e nao estourou (trava anti-deficit ficaria aberta em silencio)';
  END IF;

  -- ======================================================================
  -- G2 (F2): p_base NULL estoura erro (nao vira fornecedor:null)
  -- ======================================================================
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(NULL, 1000.00, v_regras, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
    IF SQLERRM NOT ILIKE '%p_base%' THEN
      RAISE EXCEPTION 'FALHOU G2: erro veio mas sem mencionar p_base: %', SQLERRM;
    END IF;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU G2: p_base NULL deveria estourar erro e nao estourou (NULL propagando como dinheiro)';
  END IF;

  -- p_base <= 0 (nao-NULL) continua tratado como "tudo zerado", sem erro
  v_result := public.fn_calcular_split_recompensa(0.00, 1000.00, v_regras, '[]'::jsonb);
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU G2b: base 0 (nao-NULL) deveria continuar zerando sem erro, veio %', v_result;
  END IF;

  -- ======================================================================
  -- G3 (F5): p_regras sem a chave b2w.niveis estoura erro (B2W sempre recebe)
  -- ======================================================================
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(
      100.00, 1000.00, v_regras_sem_b2w,
      jsonb_build_array(jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false))
    );
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
    IF SQLERRM NOT ILIKE '%b2w%' THEN
      RAISE EXCEPTION 'FALHOU G3: erro veio mas sem mencionar b2w: %', SQLERRM;
    END IF;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU G3: p_regras sem b2w.niveis deveria estourar erro e nao estourou (B2W cairia para 0 em silencio)';
  END IF;

  -- p_regras NULL tambem estoura (mesmo caminho: #> '{b2w,niveis}' de NULL e NULL)
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(100.00, 1000.00, NULL, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU G3b: p_regras NULL deveria estourar erro e nao estourou';
  END IF;

  -- ======================================================================
  -- G4 (F3): base com fracao de centavo (100.005) e arredondada UMA VEZ
  -- na entrada -> fornecedor fecha em 2 casas, sem herdar a fracao.
  -- 100.005 -> 100.01 (meio-centavo para cima). B2W 10%=10.00, PPE
  -- 5%=5.00, Lider 1%=1.00 (nenhum desses bate em meio-centavo aqui).
  -- fornecedor = 100.01 - 16.00 = 84.01.
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.005, 1000.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false)
    )
  );
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 10.00 THEN
    RAISE EXCEPTION 'FALHOU G4: b2w.valor veio % (esperado 10.00)', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result->>'total_deduzido')::numeric IS DISTINCT FROM 16.00 THEN
    RAISE EXCEPTION 'FALHOU G4: total_deduzido veio % (esperado 16.00)', v_result->>'total_deduzido';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 84.01 THEN
    RAISE EXCEPTION 'FALHOU G4: fornecedor veio % (esperado 84.01, base arredondada 100.01 - 16.00)', v_result->>'fornecedor';
  END IF;
  -- sanidade generica: fornecedor nunca pode ter mais de 2 casas
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM round((v_result->>'fornecedor')::numeric, 2) THEN
    RAISE EXCEPTION 'FALHOU G4: fornecedor veio com mais de 2 casas decimais: %', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- G5 (F4): b2w.pct e b2w.valor sao sempre o TOTAL (nominal + absorvido),
  -- nunca discordantes. PPP nivel 1 suspenso -> pct=14, valor=14 (nao
  -- pct=10/valor=14 como antes da correcao).
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','ppp','id',v_ppp,'nivel',1,'suspenso',true))
  );
  IF (v_result#>>'{b2w,pct}')::numeric IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FALHOU G5: b2w.pct veio % (esperado 14 = 10 nominal + 4 absorvido, consistente com b2w.valor)', v_result#>>'{b2w,pct}';
  END IF;
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FALHOU G5: b2w.valor veio % (esperado 14)', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result#>>'{b2w,pct_absorvido}')::numeric IS DISTINCT FROM 4 OR (v_result#>>'{b2w,valor_absorvido}')::numeric IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FALHOU G5: pct_absorvido/valor_absorvido vieram %/% (esperado 4/4, ja contidos em pct/valor)', v_result#>>'{b2w,pct_absorvido}', v_result#>>'{b2w,valor_absorvido}';
  END IF;

  -- ======================================================================
  -- G6 (a): teto_estourado = false quando nao precisou cortar
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false))
  );
  IF (v_result->>'teto_estourado')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALHOU G6: teto_estourado veio % (esperado false, teto folgado)', v_result->>'teto_estourado';
  END IF;

  -- ======================================================================
  -- G6b (a): teto_estourado = true quando, mesmo cortando tudo que da
  -- para cortar (conect+ppe+lider = 8), a B2W sozinha (10, nunca
  -- cortada) ja deixa o total_deduzido (10) acima do teto (5).
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 5.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',1,'suspenso',false)
    )
  );
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU G6b: b2w deveria ficar intacta (10) mesmo com o teto estourado, veio %', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result->>'corte_aplicado')::numeric IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'FALHOU G6b: corte_aplicado veio % (esperado 8 = tudo que dava para cortar: 2+5+1)', v_result->>'corte_aplicado';
  END IF;
  IF (v_result->>'total_deduzido')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU G6b: total_deduzido veio % (esperado 10 = 18 bruto - 8 cortado)', v_result->>'total_deduzido';
  END IF;
  IF (v_result->>'teto_estourado')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALHOU G6b: teto_estourado veio % (esperado true: total_deduzido 10 > teto 5, mesmo apos cortar o maximo possivel)', v_result->>'teto_estourado';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'FALHOU G6b: fornecedor veio % (esperado 90)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- G7 (b): percentual negativo cadastrado nas regras nunca vira
  -- recompensa negativa -- GREATEST(pct, 0).
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras_pct_negativo,
    jsonb_build_array(jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false))
  );
  IF (v_result#>>'{beneficiarios,0,pct}')::numeric IS DISTINCT FROM 0 OR (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU G7: percentual negativo (-5) deveria virar pct=0/valor=0, veio %', v_result->'beneficiarios'->0;
  END IF;

  -- ======================================================================
  -- G8 (c): search_path fixo na funcao (linter do Supabase)
  -- ======================================================================
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'fn_calcular_split_recompensa'
       AND p.proconfig IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
  ) INTO v_search_path_fixo;
  IF NOT v_search_path_fixo THEN
    RAISE EXCEPTION 'FALHOU G8: fn_calcular_split_recompensa nao tem search_path fixo (proconfig)';
  END IF;

  -- ======================================================================
  -- G9 (d): grants -- anon sem EXECUTE, authenticated com EXECUTE
  -- ======================================================================
  SELECT has_function_privilege('anon', 'public.fn_calcular_split_recompensa(numeric,numeric,jsonb,jsonb)', 'EXECUTE')
    INTO v_priv;
  IF v_priv THEN
    RAISE EXCEPTION 'FALHOU G9: anon ainda pode executar fn_calcular_split_recompensa (deveria ter sido revogado)';
  END IF;

  SELECT has_function_privilege('authenticated', 'public.fn_calcular_split_recompensa(numeric,numeric,jsonb,jsonb)', 'EXECUTE')
    INTO v_priv;
  IF NOT v_priv THEN
    RAISE EXCEPTION 'FALHOU G9: authenticated deveria poder executar fn_calcular_split_recompensa e nao pode';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
