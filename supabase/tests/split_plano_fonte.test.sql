-- Task 3 (Split de Pagamentos): o plano como fonte unica de gestao, piso,
-- desconto, modalidade e matriz de comissao por cargo/nivel.
-- Spec: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-3-brief.md
--
-- Sucesso = erro SANDBOX_OK (tudo desfeito, nada persiste). Rodar pelo MCP
-- execute_sql. Qualquer outra mensagem = falha.
DO $$
DECLARE
  v_plano_uc    uuid;   -- plano ligado direto na UC
  v_plano_usina uuid;   -- plano ligado so na usina
  v_usina1      uuid;   -- usina com plano
  v_usina2      uuid;   -- usina sem plano
  v_sub         uuid;

  v_uc_com_plano_proprio   uuid;  -- UC com plano_assinatura_id proprio
  v_uc_so_usina            uuid;  -- UC sem plano, usina com plano
  v_uc_sem_nenhum          uuid;  -- nem UC nem usina com plano

  v_plano_row public.planos_assinatura_energia;
  v_regras    jsonb;
  v_n         integer;
  v_txt       text;
BEGIN

    -- Plano de Usina (20261006f): a usina deixou de apontar direto para o
    -- plano de assinatura; agora aponta para um plano de usina, que aponta
    -- para ele. pg_temp.pu cria o plano de usina com a MESMA gestao que o
    -- plano ja dava (b2w.L1 da matriz valida, ou gestao_percentual), para
    -- nenhum numero esperado deste arquivo mudar. Some no rollback.
    EXECUTE $pu$
      CREATE FUNCTION pg_temp.pu(p_plano uuid) RETURNS uuid LANGUAGE sql AS $f$
        INSERT INTO public.planos_usina (nome, percentual_recorrente)
        SELECT 'SANDBOX pu ' || p.nome,
               COALESCE(CASE WHEN jsonb_typeof(p.recorrente_config #> '{regras_multinivel,b2w,niveis}') = 'object'
                             THEN (p.recorrente_config #>> '{regras_multinivel,b2w,niveis,L1}')::numeric END,
                        p.gestao_percentual, 0)
          FROM public.planos_assinatura_energia p
         WHERE p.id = p_plano
        RETURNING id
      $f$
    $pu$;
  -- ======================================================================
  -- setup: dois planos de teste, duas usinas, tres UCs
  -- ======================================================================
  INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, modalidade, desconto_assinante)
  VALUES ('SANDBOX Plano da UC', 12, 55, 'auto_consumo_remoto', 18)
  RETURNING id INTO v_plano_uc;

  INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, modalidade, desconto_assinante)
  VALUES ('SANDBOX Plano da Usina', 9, 40, 'geracao_compartilhada', 22)
  RETURNING id INTO v_plano_usina;

  INSERT INTO public.usinas (name, plano_usina_id) VALUES ('SANDBOX Usina Com Plano', pg_temp.pu(v_plano_usina)) RETURNING id INTO v_usina1;
  INSERT INTO public.usinas (name) VALUES ('SANDBOX Usina Sem Plano') RETURNING id INTO v_usina2;

  INSERT INTO public.subscribers DEFAULT VALUES RETURNING id INTO v_sub;

  -- UC com plano proprio E usina com plano diferente: o da UC deve ganhar
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, usina_id, plano_assinatura_id)
  VALUES (v_sub, 'beneficiaria', 'ativo', v_usina1, v_plano_uc)
  RETURNING id INTO v_uc_com_plano_proprio;

  -- UC sem plano proprio, mas da usina com plano
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, usina_id)
  VALUES (v_sub, 'beneficiaria', 'ativacao', v_usina1)
  RETURNING id INTO v_uc_so_usina;

  -- UC sem plano proprio e usina tambem sem plano
  INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, usina_id)
  VALUES (v_sub, 'beneficiaria', 'ativacao', v_usina2)
  RETURNING id INTO v_uc_sem_nenhum;

  -- ======================================================================
  -- 1) fn_plano_da_uc: UC com plano proprio ganha do plano da usina
  -- ======================================================================
  v_plano_row := public.fn_plano_da_uc(v_uc_com_plano_proprio);
  IF v_plano_row.id IS DISTINCT FROM v_plano_uc THEN
    RAISE EXCEPTION 'FALHOU 1: UC com plano proprio devolveu plano % (esperado %, o da UC, nao o da usina)', v_plano_row.id, v_plano_uc;
  END IF;

  -- ======================================================================
  -- 2) fn_plano_da_uc: UC sem plano proprio -> NULL (sem fallback ao plano da usina)
  -- ======================================================================
  v_plano_row := public.fn_plano_da_uc(v_uc_so_usina);
  IF v_plano_row.id IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 2: UC sem plano proprio devolveu % (esperado NULL: o plano de usina nao da mais plano de recompensas)', v_plano_row.id;
  END IF;

  -- ======================================================================
  -- 3) fn_plano_da_uc: nem UC nem usina com plano -> NULL
  -- ======================================================================
  v_plano_row := public.fn_plano_da_uc(v_uc_sem_nenhum);
  IF v_plano_row.id IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 3: UC sem plano e usina sem plano deveria devolver NULL, devolveu %', v_plano_row.id;
  END IF;

  -- UC inexistente tambem NULL (nao estoura erro)
  v_plano_row := public.fn_plano_da_uc(gen_random_uuid());
  IF v_plano_row.id IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 3b: UC inexistente deveria devolver NULL, devolveu %', v_plano_row.id;
  END IF;

  -- ======================================================================
  -- 4) fn_regras_recompensa_uc: devolve os campos normalizados da UC com
  --    plano proprio (gestao/piso/desconto/modalidade + matriz + start)
  -- ======================================================================
  v_regras := public.fn_regras_recompensa_uc(v_uc_com_plano_proprio);

  IF v_regras IS NULL THEN
    RAISE EXCEPTION 'FALHOU 4: fn_regras_recompensa_uc devolveu NULL para UC com plano';
  END IF;
  IF (v_regras->>'plano_id')::uuid IS DISTINCT FROM v_plano_uc THEN
    RAISE EXCEPTION 'FALHOU 4: plano_id veio % (esperado %)', v_regras->>'plano_id', v_plano_uc;
  END IF;
  -- Plano de Usina (spec 2026-10-06 secao 2): a gestao B2W vem do plano de
  -- usina mesmo quando a UC tem plano proprio. O plano da UC continua
  -- mandando no resto (plano_id, piso, desconto, modalidade).
  IF (v_regras->>'gestao_pct')::numeric IS DISTINCT FROM 9::numeric THEN
    RAISE EXCEPTION 'FALHOU 4: gestao_pct veio % (esperado 9, a gestao do plano de usina)', v_regras->>'gestao_pct';
  END IF;
  IF (v_regras->>'piso_pct')::numeric IS DISTINCT FROM 55::numeric THEN
    RAISE EXCEPTION 'FALHOU 4: piso_pct veio % (esperado 55)', v_regras->>'piso_pct';
  END IF;
  IF (v_regras->>'desconto_pct')::numeric IS DISTINCT FROM 18::numeric THEN
    RAISE EXCEPTION 'FALHOU 4: desconto_pct veio % (esperado 18)', v_regras->>'desconto_pct';
  END IF;
  IF v_regras->>'modalidade' IS DISTINCT FROM 'auto_consumo_remoto' THEN
    RAISE EXCEPTION 'FALHOU 4: modalidade veio % (esperado auto_consumo_remoto)', v_regras->>'modalidade';
  END IF;
  IF v_regras->'regras_multinivel' IS NULL THEN
    RAISE EXCEPTION 'FALHOU 4: regras_multinivel veio NULL';
  END IF;
  IF NOT (v_regras ? 'start_config') THEN
    RAISE EXCEPTION 'FALHOU 4: start_config ausente no retorno';
  END IF;

  -- ======================================================================
  -- 5) fn_regras_recompensa_uc: NULL quando nao ha plano (nem UC nem usina)
  -- ======================================================================
  v_regras := public.fn_regras_recompensa_uc(v_uc_sem_nenhum);
  IF v_regras IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 5: fn_regras_recompensa_uc deveria ser NULL sem plano, veio %', v_regras;
  END IF;

  -- ======================================================================
  -- 6) planos existentes (Premium/Ultra): matriz acordada pelo dono e sem
  --    chaves legadas em `regras` (recorrente e start, todos os niveis)
  -- ======================================================================
  FOR v_txt, v_regras IN
    SELECT nome, recorrente_config->'regras_multinivel' FROM public.planos_assinatura_energia
     WHERE nome IN ('Plano Premium', 'Plano Ultra')
  LOOP
    IF v_regras IS NULL THEN
      RAISE EXCEPTION 'FALHOU 6 (%): regras_multinivel ausente', v_txt;
    END IF;

    IF v_regras#>>'{ppe,niveis,L1}' IS DISTINCT FROM '5' OR v_regras#>>'{ppe,niveis,L2}' IS DISTINCT FROM '2'
       OR (v_regras#>>'{ppe,max_niveis}')::int IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'FALHOU 6 (%): ppe fora do acordado (L1=5/L2=2/max=2), veio %', v_txt, v_regras->'ppe';
    END IF;

    IF v_regras#>>'{ppp,niveis,L1}' IS DISTINCT FROM '4' OR v_regras#>>'{ppp,niveis,L2}' IS DISTINCT FROM '2'
       OR (v_regras#>>'{ppp,max_niveis}')::int IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'FALHOU 6 (%): ppp fora do acordado (L1=4/L2=2/max=2), veio %', v_txt, v_regras->'ppp';
    END IF;

    IF v_regras#>>'{ppf,niveis,L1}' IS DISTINCT FROM '2' OR v_regras#>>'{ppf,niveis,L2}' IS DISTINCT FROM '2'
       OR (v_regras#>>'{ppf,max_niveis}')::int IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'FALHOU 6 (%): ppf fora do acordado (L1=2/L2=2/max=2), veio %', v_txt, v_regras->'ppf';
    END IF;

    IF v_regras#>>'{lider,niveis,L1}' IS DISTINCT FROM '1' OR v_regras#>>'{lider,niveis,L2}' IS DISTINCT FROM '1'
       OR v_regras#>>'{lider,niveis,L3}' IS DISTINCT FROM '1' OR v_regras#>>'{lider,niveis,L4}' IS DISTINCT FROM '0'
       OR (v_regras#>>'{lider,max_niveis}')::int IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION 'FALHOU 6 (%): lider fora do acordado (1/1/1/0, max=3), veio %', v_txt, v_regras->'lider';
    END IF;

    IF v_regras#>>'{b2w,niveis,L1}' IS DISTINCT FROM '10' OR v_regras#>>'{b2w,niveis,L2}' IS DISTINCT FROM '10'
       OR v_regras#>>'{b2w,niveis,L3}' IS DISTINCT FROM '10' OR v_regras#>>'{b2w,niveis,L4}' IS DISTINCT FROM '10'
       OR (v_regras#>>'{b2w,max_niveis}')::int IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION 'FALHOU 6 (%): b2w fora do acordado (10 em todos, max=4), veio %', v_txt, v_regras->'b2w';
    END IF;

    IF v_regras#>>'{assinante_conect,niveis,L1}' IS DISTINCT FROM '2'
       OR (v_regras#>>'{assinante_conect,max_niveis}')::int IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'FALHOU 6 (%): assinante_conect fora do acordado (L1=2, max=1), veio %', v_txt, v_regras->'assinante_conect';
    END IF;
  END LOOP;

  -- chaves legadas fora de `regras` (recorrente_config) nos dois planos
  SELECT count(*) INTO v_n
    FROM public.planos_assinatura_energia
   WHERE nome IN ('Plano Premium', 'Plano Ultra')
     AND (recorrente_config->'regras' ?| array['associacao','embaixador','coordenador','assinante']);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHOU 6: % plano(s) ainda com chave legada em recorrente_config.regras', v_n;
  END IF;

  -- chaves legadas fora de `regras` do start_config, todos os 3 niveis
  SELECT count(*) INTO v_n
    FROM public.planos_assinatura_energia
   WHERE nome IN ('Plano Premium', 'Plano Ultra')
     AND (
       (start_config#>'{regras,1}' ?| array['associacao','embaixador','coordenador','assinante'])
       OR (start_config#>'{regras,2}' ?| array['associacao','embaixador','coordenador','assinante'])
       OR (start_config#>'{regras,3}' ?| array['associacao','embaixador','coordenador','assinante'])
     );
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHOU 6: % plano(s) ainda com chave legada em start_config.regras', v_n;
  END IF;

  RAISE EXCEPTION 'SANDBOX_OK';
END $$;
