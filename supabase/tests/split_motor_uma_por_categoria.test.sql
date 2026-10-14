-- Task 4 (Split de Pagamentos): F7 resolvido -- no maximo um participante
-- por categoria (parceiro=ppe|ppp|ppf, lider, assinante_conect).
-- Migracao: 20260928d_motor_split_uma_por_categoria.sql
-- Decisao do dono (28/09/2026): "Nao existe PPE e PPP no mesmo
-- assinante. PPE, PPP e PPF sao variacoes do mesmo agente originador."
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

  v_ppe     uuid := '11111111-1111-1111-1111-111111111111';
  v_ppp     uuid := '22222222-2222-2222-2222-222222222222';
  v_lider   uuid := '44444444-4444-4444-4444-444444444444';
  v_lider2  uuid := '44444444-4444-4444-4444-444444444445';
  v_conect  uuid := '55555555-5555-5555-5555-555555555555';
  v_conect2 uuid := '55555555-5555-5555-5555-555555555556';

  v_result jsonb;
  v_erro_capturado boolean;
BEGIN
  -- ======================================================================
  -- H1: dois parceiros (ppe + ppp) no mesmo pagamento -> erro nomeando
  -- "parceiro" (PPE/PPP/PPF sao o mesmo agente, nunca coexistem)
  -- ======================================================================
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(
      100.00, 1000.00, v_regras,
      jsonb_build_array(
        jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
        jsonb_build_object('papel','ppp','id',v_ppp,'nivel',1,'suspenso',false)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
    IF SQLERRM NOT ILIKE '%parceiro%' THEN
      RAISE EXCEPTION 'FALHOU H1: erro veio mas sem mencionar a categoria "parceiro": %', SQLERRM;
    END IF;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU H1: dois parceiros (ppe+ppp) deveria estourar erro e nao estourou';
  END IF;

  -- ======================================================================
  -- H2: dois assinante_conect no mesmo pagamento -> erro nomeando
  -- "assinante_conect"
  -- ======================================================================
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(
      100.00, 1000.00, v_regras,
      jsonb_build_array(
        jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',1,'suspenso',false),
        jsonb_build_object('papel','assinante_conect','id',v_conect2,'nivel',1,'suspenso',false)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
    IF SQLERRM NOT ILIKE '%assinante_conect%' THEN
      RAISE EXCEPTION 'FALHOU H2: erro veio mas sem mencionar a categoria "assinante_conect": %', SQLERRM;
    END IF;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU H2: dois assinante_conect deveria estourar erro e nao estourou';
  END IF;

  -- ======================================================================
  -- H3 (bonus, mesma logica para a 3a categoria): dois lideres -> erro
  -- nomeando "lider"
  -- ======================================================================
  v_erro_capturado := false;
  BEGIN
    PERFORM public.fn_calcular_split_recompensa(
      100.00, 1000.00, v_regras,
      jsonb_build_array(
        jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false),
        jsonb_build_object('papel','lider','id',v_lider2,'nivel',1,'suspenso',false)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_erro_capturado := true;
    IF SQLERRM NOT ILIKE '%lider%' THEN
      RAISE EXCEPTION 'FALHOU H3: erro veio mas sem mencionar a categoria "lider": %', SQLERRM;
    END IF;
  END;
  IF NOT v_erro_capturado THEN
    RAISE EXCEPTION 'FALHOU H3: dois lideres deveria estourar erro e nao estourou';
  END IF;

  -- ======================================================================
  -- H4: um de cada categoria (parceiro + lider + conect) continua
  -- funcionando normalmente, com os mesmos numeros de sempre
  -- (b2w=10, ppe=5, lider=1, conect=2, fornecedor=82, sem corte).
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',1,'suspenso',false)
    )
  );
  IF (v_result#>>'{b2w,pct}')::numeric IS DISTINCT FROM 10 OR (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU H4: b2w veio % (esperado pct=10/valor=10)', v_result->'b2w';
  END IF;
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FALHOU H4: ppe.valor veio % (esperado 5)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result#>>'{beneficiarios,1,valor}')::numeric IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FALHOU H4: lider.valor veio % (esperado 1)', v_result#>>'{beneficiarios,1,valor}';
  END IF;
  IF (v_result#>>'{beneficiarios,2,valor}')::numeric IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FALHOU H4: conect.valor veio % (esperado 2)', v_result#>>'{beneficiarios,2,valor}';
  END IF;
  IF (v_result->>'total_deduzido')::numeric IS DISTINCT FROM 18 OR (v_result->>'corte_aplicado')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU H4: total_deduzido/corte_aplicado vieram %/% (esperado 18/0)', v_result->>'total_deduzido', v_result->>'corte_aplicado';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 82 THEN
    RAISE EXCEPTION 'FALHOU H4: fornecedor veio % (esperado 82)', v_result->>'fornecedor';
  END IF;
  IF (v_result->>'teto_estourado')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FALHOU H4: teto_estourado veio % (esperado false)', v_result->>'teto_estourado';
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
