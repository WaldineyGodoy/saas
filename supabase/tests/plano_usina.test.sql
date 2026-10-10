-- Teste: Plano de Usina (spec docs/superpowers/specs/2026-10-06-plano-usina-design.md).
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).
-- Casos novos entram ACIMA da linha marcada no fim do arquivo.
--
-- Fixture comum: concessionaria sandbox com tarifa 1,20 e Fio B 0,20 e planos
-- de recompensas com desconto 0 -> tarifa liquida 1,00/kWh. Toda fatura de
-- pg_temp.fatura_paga tem 1000 kWh compensados, valor 1000 e conta da
-- concessionaria 0: base = caixa = 1000, e a 1.1.2 nao recebe nada.
DO $$
DECLARE
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb;

    -- planos de recompensas (planos_assinatura_energia)
    v_rec_plano      uuid;   -- recorrente, piso 50
    v_rec_plano_uc   uuid;   -- recorrente, piso 50 -- o "plano proprio" da UC
    v_rec_piso675    uuid;   -- recorrente, piso 67,5
    v_rec_start      uuid;   -- start, janela [2]
    v_rec_start1     uuid;   -- start, janela [1]
    v_rec_sem_matriz uuid;   -- b2w.niveis null

    -- planos de usina
    v_pu         uuid;
    v_pu_novo    uuid;
    v_pu_sem_rec uuid;
    v_pu2        uuid;
    v_pu3        uuid;
    v_pu_orig    uuid;
    v_pu_corte   uuid;
    v_pu_start   uuid;
    v_pu_start1  uuid;
    v_row        public.planos_usina;

    -- usinas
    v_usina      uuid;
    v_usina2     uuid;
    v_usina3     uuid;
    v_usina4     uuid;
    v_usina_corte uuid;
    v_usina_inat uuid;
    v_usina_sem_orig uuid;
    v_usina_start uuid;
    v_usina_start1 uuid;
    v_usina_matriz uuid;

    -- originadores
    v_lider        uuid;
    v_ppe          uuid;
    v_orig_usina   uuid;
    v_orig_inativo uuid;

    -- fornecedores (o originador mora no fornecedor; a usina herda)
    v_forn_orig    uuid;
    v_forn_inat    uuid;

    v_sub    uuid;
    v_uc     uuid;
    v_inv    uuid;
    v_contas numeric[];
    v_rec    jsonb;
    v_ben    jsonb;
    v_regras jsonb;
    v_n      integer;
    v_msg    text;
    v_pegou  boolean;
BEGIN
    -- ------------------------------------------------------------------
    -- helpers (somem no rollback do SANDBOX_OK)
    -- ------------------------------------------------------------------
    EXECUTE $h$
      CREATE FUNCTION pg_temp.fatura_paga(p_usina uuid, p_ppe uuid, p_plano_uc uuid)
      RETURNS uuid LANGUAGE plpgsql AS $f$
      DECLARE v_sub uuid; v_uc uuid; v_inv uuid;
      BEGIN
        INSERT INTO public.subscribers (originator_id, status, short_url)
        VALUES (p_ppe, 'ativo', 'sandbox://pu/' || gen_random_uuid()) RETURNING id INTO v_sub;
        INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
        VALUES (v_sub, p_usina, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb, p_plano_uc)
        RETURNING id INTO v_uc;
        INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
        VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;
        UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;
        RETURN v_inv;
      END $f$
    $h$;

    EXECUTE $h$
      CREATE FUNCTION pg_temp.contas(p_inv uuid) RETURNS numeric[] LANGUAGE sql AS $f$
        SELECT ARRAY[
          COALESCE(SUM(e.amount) FILTER (WHERE a.code = '3.1.1'), 0),
          COALESCE(SUM(e.amount) FILTER (WHERE a.code = '2.1.2'), 0),
          COALESCE(SUM(e.amount) FILTER (WHERE a.code = '2.1.1'), 0),
          COALESCE(SUM(e.amount), 0)]
          FROM public.ledger_entries e
          JOIN public.ledger_accounts a ON a.id = e.account_id
         WHERE e.transaction_id = (
               SELECT e2.transaction_id FROM public.ledger_entries e2
                 JOIN public.ledger_accounts a2 ON a2.id = e2.account_id
                WHERE e2.reference_id = p_inv AND a2.code = '1.1.1.01' LIMIT 1)
      $f$
    $h$;

    -- ------------------------------------------------------------------
    -- fixture comum
    -- ------------------------------------------------------------------
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBXPU-C1', 'Sandbox Plano Usina', 'SANDBOX PU conc', 'RN', 1.20, 0.20);

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU rec piso50', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_rec_plano;

    -- ==================================================================
    -- T2 -- seguranca: RLS ligada, 4 politicas, anon sem leitura nem RPC.
    -- ==================================================================
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.planos_usina'::regclass) THEN
        RAISE EXCEPTION 'FALHA T2: planos_usina sem RLS';
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'planos_usina';
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'FALHA T2: esperadas 4 politicas em planos_usina, achei %', v_n;
    END IF;
    IF has_table_privilege('anon', 'public.planos_usina', 'SELECT') THEN
        RAISE EXCEPTION 'FALHA T2: anon le planos_usina';
    END IF;
    IF has_function_privilege('anon', 'public.fn_planos_usina_nova_versao(uuid, jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FALHA T2: anon executa fn_planos_usina_nova_versao';
    END IF;

    -- ==================================================================
    -- T3 -- trava de versao: sem usina edita tudo; com usina, numero e plano
    --       de recompensas sao recusados e nome/descricao passam.
    -- ==================================================================
    INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
    VALUES ('SANDBOX PU trava', 10, v_rec_plano) RETURNING id INTO v_pu;

    UPDATE public.planos_usina SET percentual_recorrente = 11 WHERE id = v_pu;   -- sem usina: passa

    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu) RETURNING id INTO v_usina;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET percentual_recorrente = 12 WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%nova versao%' THEN
        RAISE EXCEPTION 'FALHA T3: com usina, mudar percentual_recorrente devia ser recusado pedindo nova versao (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET originador_bonus_fechamentos = '{2}' WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T3: com usina, mudar originador_bonus_fechamentos devia ser recusado';
    END IF;

    v_pegou := false;
    BEGIN
        UPDATE public.planos_usina SET plano_assinatura_id = NULL WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T3: com usina, trocar o plano de recompensas devia ser recusado';
    END IF;

    UPDATE public.planos_usina SET nome = 'SANDBOX PU trava renomeado', descricao = 'outra' WHERE id = v_pu;  -- passa

    -- ==================================================================
    -- T4 -- excluir plano com usina e recusado pela FK RESTRICT.
    -- ==================================================================
    v_pegou := false;
    BEGIN
        DELETE FROM public.planos_usina WHERE id = v_pu;
    EXCEPTION WHEN foreign_key_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T4: excluir plano com usina vinculada devia ser recusado';
    END IF;

    -- ==================================================================
    -- T5 -- plano sem plano de recompensas nao recebe usina.
    -- ==================================================================
    INSERT INTO public.planos_usina (nome) VALUES ('SANDBOX PU sem recompensas') RETURNING id INTO v_pu_sem_rec;

    v_pegou := false;
    BEGIN
        INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_sem_rec);
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%plano de recompensas%' THEN
        RAISE EXCEPTION 'FALHA T5: plano sem plano de recompensas recebeu usina (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- T6 -- nova versao: nasce ativo com substitui_plano_id, herda o que
    --       nao veio em p_dados; o antigo vira somente_contratos e continua
    --       com a usina dele, mas nao aceita usina nova.
    -- ==================================================================
    v_pu_novo := public.fn_planos_usina_nova_versao(v_pu,
        jsonb_build_object('nome', 'SANDBOX PU trava v2', 'percentual_recorrente', 12));

    SELECT * INTO v_row FROM public.planos_usina WHERE id = v_pu_novo;
    IF v_row.percentual_recorrente <> 12 OR v_row.substitui_plano_id IS DISTINCT FROM v_pu
       OR v_row.status <> 'ativo' OR v_row.plano_assinatura_id IS DISTINCT FROM v_rec_plano
       OR v_row.taxa_admin_reais <> 10 OR v_row.nome <> 'SANDBOX PU trava v2' THEN
        RAISE EXCEPTION 'FALHA T6: nova versao errada: %', row_to_json(v_row);
    END IF;

    SELECT * INTO v_row FROM public.planos_usina WHERE id = v_pu;
    IF v_row.status <> 'somente_contratos' THEN
        RAISE EXCEPTION 'FALHA T6: o plano antigo devia virar somente_contratos, esta %', v_row.status;
    END IF;

    SELECT count(*) INTO v_n FROM public.usinas WHERE id = v_usina AND plano_usina_id = v_pu;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA T6: a usina do plano antigo nao pode mudar de plano sozinha';
    END IF;

    UPDATE public.usinas SET name = 'SANDBOX PU usina' WHERE id = v_usina;   -- outra coluna: passa

    v_pegou := false;
    BEGIN
        INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu);
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%somente para contratos%' THEN
        RAISE EXCEPTION 'FALHA T6: plano somente_contratos recebeu usina nova (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- T7 -- CHECKs: percentual acima de 100 e fechamento 0 sao recusados.
    -- ==================================================================
    v_pegou := false;
    BEGIN
        INSERT INTO public.planos_usina (nome, percentual_recorrente) VALUES ('SANDBOX PU 101', 101);
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T7: percentual_recorrente 101 foi aceito';
    END IF;

    v_pegou := false;
    BEGIN
        INSERT INTO public.planos_usina (nome, originador_bonus_fechamentos) VALUES ('SANDBOX PU bonus 0', '{0}');
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T7: fechamento 0 no bonus foi aceito';
    END IF;

    v_pegou := false;
    BEGIN
        INSERT INTO public.planos_usina (nome, dia_corte) VALUES ('SANDBOX PU dia 32', 32);
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA T7: dia_corte 32 foi aceito';
    END IF;

    -- ==================================================================
    -- T8 -- so admin vincula. Simula um usuario logado que nao e admin.
    -- ==================================================================
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    v_pegou := false;
    BEGIN
        UPDATE public.usinas SET plano_usina_id = v_pu_novo WHERE id = v_usina;
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_pegou OR v_msg NOT LIKE '%admin%' THEN
        RAISE EXCEPTION 'FALHA T8: usuario nao admin trocou o plano da usina (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- T9 -- o originador mora no fornecedor (decisao 6b): so admin muda.
    -- ==================================================================
    INSERT INTO public.suppliers (name) VALUES ('SANDBOX PU fornecedor T9') RETURNING id INTO v_forn_orig;
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU originador T9', 'ppf', true) RETURNING id INTO v_orig_usina;

    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
    v_pegou := false;
    BEGIN
        UPDATE public.suppliers SET originator_id = v_orig_usina WHERE id = v_forn_orig;
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT v_pegou OR v_msg NOT LIKE '%admin%' THEN
        RAISE EXCEPTION 'FALHA T9: usuario nao admin mudou o originador do fornecedor (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    UPDATE public.suppliers SET originator_id = v_orig_usina WHERE id = v_forn_orig;   -- SQL direto: passa

    -- ==================================================================
    -- fixture do motor: PPE com lider; venda direta (nivel 1)
    --   base 1000, piso 50 -> teto 1000 - 1000 x 1,20 x 50% = 400
    -- ==================================================================
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU Lider', 'lider', true) RETURNING id INTO v_lider;
    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX PU PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU rec da UC', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_rec_plano_uc;

    INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
    VALUES ('SANDBOX PU 12', 12, v_rec_plano) RETURNING id INTO v_pu2;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu2) RETURNING id INTO v_usina2;

    -- ==================================================================
    -- M1 -- gestao vem do plano de usina (12%), UC sem plano proprio.
    --   B2W 120 | PPE 5% 50 + Lider 1% 10 | fornecedor 1000 - 180 = 820
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina2, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -60, -820, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-60,-820,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_id')::uuid IS DISTINCT FROM v_rec_plano THEN
        RAISE EXCEPTION 'FALHA M1: plano_id congelado = %, esperado o plano de recompensas do plano de usina %', v_rec ->> 'plano_id', v_rec_plano;
    END IF;

    -- ==================================================================
    -- M2 -- UC com plano proprio na mesma usina: o plano de recompensas e o
    --       da UC, mas a gestao continua a do plano de usina (12%).
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina2, v_ppe, v_rec_plano_uc);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -60, -820, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-60,-820,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_id')::uuid IS DISTINCT FROM v_rec_plano_uc THEN
        RAISE EXCEPTION 'FALHA M2: plano_id congelado = %, esperado o plano da UC %', v_rec ->> 'plano_id', v_rec_plano_uc;
    END IF;

    -- ==================================================================
    -- M3 -- usina SEM plano de usina, UC com plano proprio: comportamento de
    --       hoje, gestao da matriz do plano da UC (10%).
    --   B2W 100 | 60 | fornecedor 840
    -- ==================================================================
    INSERT INTO public.usinas (name) VALUES ('SANDBOX PU sem plano de usina') RETURNING id INTO v_usina3;
    v_inv    := pg_temp.fatura_paga(v_usina3, v_ppe, v_rec_plano_uc);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-100, -60, -840, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-100,-60,-840,0}', v_contas;
    END IF;

    -- ==================================================================
    -- M4 -- matriz invalida NAO e consertada pela sobrescrita: b2w.niveis
    --       null continua null (o gatilho tem de cair em plano_sem_matriz).
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU matriz nula', 'recorrente', 10, 50,
            '{"regras_multinivel": {"b2w": {"niveis": null, "max_niveis": 4}}}'::jsonb)
    RETURNING id INTO v_rec_sem_matriz;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
    VALUES ('SANDBOX PU matriz nula', 12, v_rec_sem_matriz) RETURNING id INTO v_pu3;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu3) RETURNING id INTO v_usina_matriz;
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pu/m4') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_matriz, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;
    v_regras := public.fn_regras_recompensa_uc(v_uc);
    IF jsonb_typeof(v_regras #> '{regras_multinivel,b2w,niveis}') = 'object' THEN
        RAISE EXCEPTION 'FALHA M4: a sobrescrita do plano de usina "consertou" uma matriz sem b2w.niveis: %', v_regras -> 'regras_multinivel';
    END IF;
    IF (v_regras ->> 'gestao_pct')::numeric IS DISTINCT FROM 12::numeric THEN
        RAISE EXCEPTION 'FALHA M4: gestao_pct = %, esperado 12 (do plano de usina)', v_regras ->> 'gestao_pct';
    END IF;

    -- ==================================================================
    -- fixture do originador da usina: plano de usina 12% + originador 3%
    -- ==================================================================
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU quem trouxe a usina', 'ppf', true) RETURNING id INTO v_orig_usina;
    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX PU originador inativo', 'ppf', false) RETURNING id INTO v_orig_inativo;

    -- o originador mora no FORNECEDOR e a usina herda (decisao 6b)
    INSERT INTO public.suppliers (name, originator_id)
    VALUES ('SANDBOX PU fornecedor com originador', v_orig_usina) RETURNING id INTO v_forn_orig;
    INSERT INTO public.suppliers (name, originator_id)
    VALUES ('SANDBOX PU fornecedor com originador inativo', v_orig_inativo) RETURNING id INTO v_forn_inat;

    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU 12+3', 12, 3, v_rec_plano) RETURNING id INTO v_pu_orig;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orig, v_forn_orig) RETURNING id INTO v_usina4;

    -- ==================================================================
    -- O1 -- o originador da usina recebe 3% em 2.1.2.
    --   B2W 120 | 2.1.2 = PPE 50 + Lider 10 + originador 30 = 90
    --   fornecedor = 1000 - 210 = 790
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina4, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -90, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-90,-790,0}', v_contas;
    END IF;
    SELECT count(*) INTO v_n
      FROM public.ledger_entries e JOIN public.ledger_accounts a ON a.id = e.account_id
     WHERE a.code = '2.1.2' AND e.reference_type = 'originator' AND e.reference_id = v_orig_usina
       AND e.amount = -30 AND e.description = 'Recompensa Originador da Usina (nível 1)'
       AND e.transaction_id = (SELECT transaction_id FROM public.ledger_entries
                                WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA O1: esperado 1 lancamento de -30 em 2.1.2 para o originador da usina, achei %', v_n;
    END IF;
    -- o congelamento passa a dizer de qual plano de usina veio a gestao
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_usina_id')::uuid IS DISTINCT FROM v_pu_orig
       OR (v_rec ->> 'percentual_recorrente')::numeric IS DISTINCT FROM 12::numeric THEN
        RAISE EXCEPTION 'FALHA O1: congelamento sem plano_usina_id/percentual_recorrente certos: % / %',
            v_rec ->> 'plano_usina_id', v_rec ->> 'percentual_recorrente';
    END IF;

    -- ==================================================================
    -- O2 -- corte: o originador da usina e o PRIMEIRO a perder.
    --   piso 67,5: piso em R$ = 1000 x 1,20 x 67,5% = 810 -> teto 190
    --   bruto 210, excesso 20: originador 30 -> 10 (cortado 20); PPE 50 e
    --   Lider 10 intactos. fornecedor = 1000 - 190 = 810.
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX PU rec piso67.5', 'recorrente', 10, 67.5, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_rec_piso675;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU corte', 12, 3, v_rec_piso675) RETURNING id INTO v_pu_corte;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_corte, v_forn_orig) RETURNING id INTO v_usina_corte;

    v_inv    := pg_temp.fatura_paga(v_usina_corte, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -70, -810, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-70,-810,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
     WHERE b ->> 'papel' = 'originador_usina';
    IF (v_ben ->> 'cortado')::numeric IS DISTINCT FROM 20::numeric OR (v_ben ->> 'valor')::numeric IS DISTINCT FROM 10::numeric THEN
        RAISE EXCEPTION 'FALHA O2: originador da usina devia ser o 1o cortado (cortado 20, valor 10), veio %', v_ben;
    END IF;
    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
     WHERE b ->> 'papel' = 'ppe';
    IF COALESCE((v_ben ->> 'cortado')::numeric, 0) <> 0 OR (v_ben ->> 'valor')::numeric <> 50 THEN
        RAISE EXCEPTION 'FALHA O2: o PPE vem depois do originador da usina e devia ficar intacto (50), veio %', v_ben;
    END IF;
    IF (v_rec -> 'resultado' ->> 'teto_estourado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA O2: teto_estourado = %, esperado false', v_rec -> 'resultado' ->> 'teto_estourado';
    END IF;

    -- ==================================================================
    -- O3 -- originador inativo: a parte dele fica para a associacao (B2W).
    --   B2W 120 + 30 = 150 | 2.1.2 60 | fornecedor 790
    -- ==================================================================
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orig, v_forn_inat) RETURNING id INTO v_usina_inat;
    v_inv    := pg_temp.fatura_paga(v_usina_inat, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-150, -60, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-150,-60,-790,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O4 -- usina cujo fornecedor nao tem originador (aqui: sem fornecedor):
    --       o previsto no plano fica para a associacao.
    -- ==================================================================
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_orig) RETURNING id INTO v_usina_sem_orig;
    v_inv    := pg_temp.fatura_paga(v_usina_sem_orig, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-150, -60, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O4: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-150,-60,-790,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O5 -- plano start FORA da janela: parceiro e lider nao recebem, o
    --       originador da usina recebe (decisao 9).
    --   B2W 120 | 2.1.2 = so o originador, 30 | fornecedor 850
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX PU start janela 2', 'start', 10, 50, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [2], "regras": {"2": {"b2w": 0, "ppe": 20, "lider": 10, "ppp": 0, "ppf": 0, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_rec_start;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU start', 12, 3, v_rec_start) RETURNING id INTO v_pu_start;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_start, v_forn_orig) RETURNING id INTO v_usina_start;

    v_inv    := pg_temp.fatura_paga(v_usina_start, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -30, -850, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O5: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-30,-850,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O6 -- fatura DO Start: b2w do start_config (0), PPE 20% = 200, Lider
    --       10% = 100, originador da usina 3% = 30 -- e o lancamento dele NAO
    --       se chama "Bonus Start". Teto isento = base.
    --   3.1.1 0 | 2.1.2 330 | fornecedor 670
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX PU start janela 1', 'start', 10, 50, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [1], "regras": {"1": {"b2w": 0, "ppe": 20, "lider": 10, "ppp": 0, "ppf": 0, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_rec_start1;
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, plano_assinatura_id)
    VALUES ('SANDBOX PU start 1', 12, 3, v_rec_start1) RETURNING id INTO v_pu_start1;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_start1, v_forn_orig) RETURNING id INTO v_usina_start1;

    v_inv    := pg_temp.fatura_paga(v_usina_start1, v_ppe, NULL);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[0, -330, -670, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O6: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {0,-330,-670,0}', v_contas;
    END IF;
    SELECT count(*) INTO v_n FROM public.ledger_entries
     WHERE reference_id = v_orig_usina AND amount = -30
       AND description = 'Recompensa Originador da Usina (nível 1)'
       AND transaction_id = (SELECT transaction_id FROM public.ledger_entries
                              WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA O6: o lancamento do originador da usina na fatura do Start nao saiu como Recompensa (achei %)', v_n;
    END IF;

    -- ==================================================================
    -- O7 -- motor: dois originador_usina no mesmo pagamento e bug -> estoura.
    -- ==================================================================
    v_pegou := false;
    BEGIN
        PERFORM public.fn_calcular_split_recompensa(1000, 1000,
            '{"b2w": {"niveis": {"L1": "10"}, "max_niveis": 4},
              "originador_usina": {"niveis": {"L1": "3"}, "max_niveis": 1}}'::jsonb,
            '[{"papel": "originador_usina", "id": null, "nivel": 1},
              {"papel": "originador_usina", "id": null, "nivel": 1}]'::jsonb);
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%originador_usina%' THEN
        RAISE EXCEPTION 'FALHA O7: dois originador_usina deviam estourar no motor (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- ==================================================================
    -- O8 -- usina sem plano de usina: o originador dela nao entra (nao ha
    --       regra que diga quanto ele recebe).
    -- ==================================================================
    UPDATE public.usinas SET supplier_id = v_forn_orig WHERE id = v_usina3;
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://pu/o8') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina3, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb, v_rec_plano_uc)
    RETURNING id INTO v_uc;
    SELECT count(*) INTO v_n FROM jsonb_array_elements(public.fn_participantes_recompensa(v_uc)) b
     WHERE b ->> 'papel' = 'originador_usina';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA O8: usina sem plano de usina pos o originador dela entre os participantes';
    END IF;

    -- >>> casos novos entram acima desta linha <<<
    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
