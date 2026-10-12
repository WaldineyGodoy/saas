-- Task 4 (Split de Pagamentos): motor puro do split.
-- Spec: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-4-brief.md
--
-- fn_calcular_split_recompensa nao toca tabela (IMMUTABLE), entao este
-- teste nao precisa de setup/teardown de linhas -- so chama a funcao com
-- varias combinacoes e confere o retorno.
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

  v_ppe  uuid := '11111111-1111-1111-1111-111111111111';
  v_ppp  uuid := '22222222-2222-2222-2222-222222222222';
  v_ppf  uuid := '33333333-3333-3333-3333-333333333333';
  v_lider uuid := '44444444-4444-4444-4444-444444444444';
  v_conect uuid := '55555555-5555-5555-5555-555555555555';

  v_result jsonb;
  v_ben    jsonb;
BEGIN
  -- ======================================================================
  -- 1) PPE nivel 1 + Lider nivel 1, teto folgado -> B2W 10, PPE 5, Lider 1,
  --    fornecedor 84
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false)
    )
  );

  IF (v_result#>>'{b2w,pct}')::numeric IS DISTINCT FROM 10 OR (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU 1: b2w veio %, esperado pct=10 valor=10', v_result->'b2w';
  END IF;
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FALHOU 1: ppe.valor veio % (esperado 5)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result#>>'{beneficiarios,1,valor}')::numeric IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FALHOU 1: lider.valor veio % (esperado 1)', v_result#>>'{beneficiarios,1,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 84 THEN
    RAISE EXCEPTION 'FALHOU 1: fornecedor veio % (esperado 84)', v_result->>'fornecedor';
  END IF;
  IF (v_result->>'total_deduzido')::numeric IS DISTINCT FROM 16 OR (v_result->>'corte_aplicado')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 1: total_deduzido/corte_aplicado vieram %/%, esperado 16/0', v_result->>'total_deduzido', v_result->>'corte_aplicado';
  END IF;

  -- ======================================================================
  -- 2) PPP nivel 1 sozinho -> PPP 4, fornecedor 86
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','ppp','id',v_ppp,'nivel',1,'suspenso',false))
  );
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FALHOU 2: ppp.valor veio % (esperado 4)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 86 THEN
    RAISE EXCEPTION 'FALHOU 2: fornecedor veio % (esperado 86)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 3) PPF nivel 1 sozinho -> PPF 2, fornecedor 88
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','ppf','id',v_ppf,'nivel',1,'suspenso',false))
  );
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FALHOU 3: ppf.valor veio % (esperado 2)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 88 THEN
    RAISE EXCEPTION 'FALHOU 3: fornecedor veio % (esperado 88)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 4) parceiro (ppe|ppp|ppf) nivel 2 -> 2, fornecedor 88 (para os tres papeis)
  -- ======================================================================
  FOR v_ben IN SELECT jsonb_build_object('papel', p, 'id', v_ppe, 'nivel', 2, 'suspenso', false)
                 FROM unnest(ARRAY['ppe','ppp','ppf']) p
  LOOP
    v_result := public.fn_calcular_split_recompensa(100.00, 1000.00, v_regras, jsonb_build_array(v_ben));
    IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'FALHOU 4 (%): valor veio % (esperado 2)', v_ben->>'papel', v_result#>>'{beneficiarios,0,valor}';
    END IF;
    IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 88 THEN
      RAISE EXCEPTION 'FALHOU 4 (%): fornecedor veio % (esperado 88)', v_ben->>'papel', v_result->>'fornecedor';
    END IF;
  END LOOP;

  -- ======================================================================
  -- 5) parceiro (ppe|ppp|ppf) nivel 3 -> 0 (acima de max_niveis=2), fornecedor 90
  -- ======================================================================
  FOR v_ben IN SELECT jsonb_build_object('papel', p, 'id', v_ppe, 'nivel', 3, 'suspenso', false)
                 FROM unnest(ARRAY['ppe','ppp','ppf']) p
  LOOP
    v_result := public.fn_calcular_split_recompensa(100.00, 1000.00, v_regras, jsonb_build_array(v_ben));
    IF (v_result#>>'{beneficiarios,0,pct}')::numeric IS DISTINCT FROM 0 OR (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'FALHOU 5 (%): pct/valor vieram %/% (esperado 0/0)', v_ben->>'papel', v_result#>>'{beneficiarios,0,pct}', v_result#>>'{beneficiarios,0,valor}';
    END IF;
    IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 90 THEN
      RAISE EXCEPTION 'FALHOU 5 (%): fornecedor veio % (esperado 90)', v_ben->>'papel', v_result->>'fornecedor';
    END IF;
  END LOOP;

  -- ======================================================================
  -- 6) Lider nivel 4 -> 0 (acima de max_niveis=3), fornecedor 90
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','lider','id',v_lider,'nivel',4,'suspenso',false))
  );
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 6: lider.valor veio % (esperado 0)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'FALHOU 6: fornecedor veio % (esperado 90)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 7) Assinante Conect nivel 1 -> 2, fornecedor 88
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',1,'suspenso',false))
  );
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FALHOU 7: conect.valor veio % (esperado 2)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 88 THEN
    RAISE EXCEPTION 'FALHOU 7: fornecedor veio % (esperado 88)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 8) Assinante Conect nivel 2 -> 0 (acima de max_niveis=1), fornecedor 90
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',2,'suspenso',false))
  );
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 8: conect.valor veio % (esperado 0)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'FALHOU 8: fornecedor veio % (esperado 90)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 9) PPP nivel 1 SUSPENSO -> PPP 0, B2W 14 (10 + 4 absorvidos),
  --    fornecedor inalterado (86, igual ao caso 2 nao-suspenso)
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','ppp','id',v_ppp,'nivel',1,'suspenso',true))
  );
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0 OR (v_result#>>'{beneficiarios,0,cortado}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 9: ppp suspenso deveria ter valor=0/cortado=0, veio %', v_result->'beneficiarios'->0;
  END IF;
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FALHOU 9: b2w.valor veio % (esperado 14 = 10 + 4 absorvidos)', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result#>>'{b2w,pct_absorvido}')::numeric IS DISTINCT FROM 4 OR (v_result#>>'{b2w,valor_absorvido}')::numeric IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FALHOU 9: pct_absorvido/valor_absorvido vieram %/% (esperado 4/4)', v_result#>>'{b2w,pct_absorvido}', v_result#>>'{b2w,valor_absorvido}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 86 THEN
    RAISE EXCEPTION 'FALHOU 9: fornecedor veio % (esperado 86, igual ao caso 2 sem suspensao)', v_result->>'fornecedor';
  END IF;
  IF (v_result->>'total_deduzido')::numeric IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FALHOU 9: total_deduzido veio % (esperado 14)', v_result->>'total_deduzido';
  END IF;

  -- ======================================================================
  -- 10) Teto apertado cortando SO o Conect.
  --     Participantes: PPE L1(5) + Lider L1(1) + Conect L1(2) = bruto 18
  --     (b2w 10 + 5 + 1 + 2). teto=17 -> excesso=1 -> conect 2 -> 1.
  --     B2W intacta (10).
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 17.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',1,'suspenso',false)
    )
  );
  IF (v_result#>>'{beneficiarios,2,valor}')::numeric IS DISTINCT FROM 1 OR (v_result#>>'{beneficiarios,2,cortado}')::numeric IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FALHOU 10: conect deveria ter valor=1/cortado=1, veio %', v_result->'beneficiarios'->2;
  END IF;
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 5 OR (v_result#>>'{beneficiarios,0,cortado}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 10: ppe deveria ficar intacto (valor=5/cortado=0), veio %', v_result->'beneficiarios'->0;
  END IF;
  IF (v_result#>>'{beneficiarios,1,valor}')::numeric IS DISTINCT FROM 1 OR (v_result#>>'{beneficiarios,1,cortado}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 10: lider deveria ficar intacto (valor=1/cortado=0), veio %', v_result->'beneficiarios'->1;
  END IF;
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU 10: b2w deveria ficar intacta (10), veio %', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result->>'corte_aplicado')::numeric IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FALHOU 10: corte_aplicado veio % (esperado 1)', v_result->>'corte_aplicado';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 83 THEN
    RAISE EXCEPTION 'FALHOU 10: fornecedor veio % (esperado 83)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 11) Teto ainda menor cortando Conect (todo) e o parceiro (parcial).
  --     Mesmos participantes do caso 10. teto=15 -> excesso=3: conect
  --     2->0 (cortado 2), sobra 1 -> ppe 5->4 (cortado 1). Lider intacto.
  --     B2W intacta (10) nos dois casos de corte (10 e 11).
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    100.00, 15.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','assinante_conect','id',v_conect,'nivel',1,'suspenso',false)
    )
  );
  IF (v_result#>>'{beneficiarios,2,valor}')::numeric IS DISTINCT FROM 0 OR (v_result#>>'{beneficiarios,2,cortado}')::numeric IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FALHOU 11: conect deveria ter valor=0/cortado=2, veio %', v_result->'beneficiarios'->2;
  END IF;
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 4 OR (v_result#>>'{beneficiarios,0,cortado}')::numeric IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FALHOU 11: ppe deveria ter valor=4/cortado=1, veio %', v_result->'beneficiarios'->0;
  END IF;
  IF (v_result#>>'{beneficiarios,1,valor}')::numeric IS DISTINCT FROM 1 OR (v_result#>>'{beneficiarios,1,cortado}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 11: lider deveria ficar intacto (valor=1/cortado=0), veio %', v_result->'beneficiarios'->1;
  END IF;
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU 11: b2w deveria ficar intacta (10), veio %', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result->>'corte_aplicado')::numeric IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FALHOU 11: corte_aplicado veio % (esperado 3)', v_result->>'corte_aplicado';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 85 THEN
    RAISE EXCEPTION 'FALHOU 11: fornecedor veio % (esperado 85)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 12) base = 0 -> tudo zerado, fornecedor = 0
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    0.00, 1000.00, v_regras,
    jsonb_build_array(
      jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false),
      jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false)
    )
  );
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 0 OR (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0
     OR (v_result#>>'{beneficiarios,1,valor}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 12: base 0 deveria zerar tudo, veio %', v_result;
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 12: fornecedor veio % (esperado 0)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 13) base negativa (-50) -> tudo zerado, fornecedor = -50 (a base como
  --     veio, nao 0)
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    -50.00, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','ppe','id',v_ppe,'nivel',1,'suspenso',false))
  );
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 0 OR (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHOU 13: base negativa deveria zerar as partes, veio %', v_result;
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM -50 THEN
    RAISE EXCEPTION 'FALHOU 13: fornecedor veio % (esperado -50)', v_result->>'fornecedor';
  END IF;

  -- ======================================================================
  -- 14) Arredondamento: base 12,50 com Lider nivel 1 (1%) cai exatamente
  --     em meio centavo (0,125) -> ROUND padrao do numeric arredonda para
  --     cima em modulo: 0,13. B2W 10% de 12,50 = 1,25 (exato, sem
  --     arredondar). fornecedor absorve o resto e a soma bate com a base
  --     ate o centavo, sem sobrar nem faltar.
  -- ======================================================================
  v_result := public.fn_calcular_split_recompensa(
    12.50, 1000.00, v_regras,
    jsonb_build_array(jsonb_build_object('papel','lider','id',v_lider,'nivel',1,'suspenso',false))
  );
  IF (v_result#>>'{b2w,valor}')::numeric IS DISTINCT FROM 1.25 THEN
    RAISE EXCEPTION 'FALHOU 14: b2w.valor veio % (esperado 1.25)', v_result#>>'{b2w,valor}';
  END IF;
  IF (v_result#>>'{beneficiarios,0,valor}')::numeric IS DISTINCT FROM 0.13 THEN
    RAISE EXCEPTION 'FALHOU 14: lider.valor veio % (esperado 0.13, meio centavo arredondado para cima)', v_result#>>'{beneficiarios,0,valor}';
  END IF;
  IF (v_result->>'fornecedor')::numeric IS DISTINCT FROM 11.12 THEN
    RAISE EXCEPTION 'FALHOU 14: fornecedor veio % (esperado 11.12)', v_result->>'fornecedor';
  END IF;
  -- a soma das partes tem que fechar exatamente com a base, sem sobrar
  -- nem faltar centavo -- esse e o ponto central da regra de
  -- arredondamento escolhida (fornecedor como resto, nunca percentual
  -- proprio arredondado isoladamente).
  IF (v_result#>>'{b2w,valor}')::numeric + (v_result#>>'{beneficiarios,0,valor}')::numeric + (v_result->>'fornecedor')::numeric IS DISTINCT FROM 12.50 THEN
    RAISE EXCEPTION 'FALHOU 14: soma das partes nao fechou com a base 12.50, veio %', (v_result#>>'{b2w,valor}')::numeric + (v_result#>>'{beneficiarios,0,valor}')::numeric + (v_result->>'fornecedor')::numeric;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
