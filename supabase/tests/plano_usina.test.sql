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
    -- T3 -- trava de versao: sem usina edita tudo; com usina, numero e %
    --       do Lider do originador sao recusados e nome/descricao passam.
    -- ==================================================================
    INSERT INTO public.planos_usina (nome, percentual_recorrente)
    VALUES ('SANDBOX PU trava', 10) RETURNING id INTO v_pu;

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
        UPDATE public.planos_usina SET originador_lider_recorrente_pct = 1 WHERE id = v_pu;
    EXCEPTION WHEN others THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%nova versao%' THEN
        RAISE EXCEPTION 'FALHA T3: com usina, mudar originador_lider_recorrente_pct devia ser recusado pedindo nova versao (pegou=%, msg=%)', v_pegou, v_msg;
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
    -- T5 -- decisao 16: plano de usina sem plano de recompensas recebe usina.
    -- ==================================================================
    INSERT INTO public.planos_usina (nome) VALUES ('SANDBOX PU sem recompensas') RETURNING id INTO v_pu_sem_rec;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_sem_rec);   -- passa: plano de usina so precisa estar ativo

    -- ==================================================================
    -- T6 -- nova versao: nasce ativo com substitui_plano_id, herda o que
    --       nao veio em p_dados; o antigo vira somente_contratos e continua
    --       com a usina dele, mas nao aceita usina nova.
    -- ==================================================================
    v_pu_novo := public.fn_planos_usina_nova_versao(v_pu,
        jsonb_build_object('nome', 'SANDBOX PU trava v2', 'percentual_recorrente', 12));

    SELECT * INTO v_row FROM public.planos_usina WHERE id = v_pu_novo;
    IF v_row.percentual_recorrente <> 12 OR v_row.substitui_plano_id IS DISTINCT FROM v_pu
       OR v_row.status <> 'ativo'
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

    INSERT INTO public.planos_usina (nome, percentual_recorrente)
    VALUES ('SANDBOX PU 12', 12) RETURNING id INTO v_pu2;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu2) RETURNING id INTO v_usina2;

    -- ==================================================================
    -- M1 -- gestao vem do plano de usina (12%), UC com o plano de recompensas.
    --   B2W 120 | PPE 5% 50 + Lider 1% 10 | fornecedor 1000 - 180 = 820
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina2, v_ppe, v_rec_plano);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-120, -60, -820, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA M1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-60,-820,0}', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec ->> 'plano_id')::uuid IS DISTINCT FROM v_rec_plano THEN
        RAISE EXCEPTION 'FALHA M1: plano_id congelado = %, esperado o plano de recompensas da UC %', v_rec ->> 'plano_id', v_rec_plano;
    END IF;

    -- M1b -- UC sem plano proprio NAO herda mais o plano da usina (decisao 16):
    --        fatura cai em uc_sem_plano, sem gestao nem recompensa.
    --        A UC fica em 'ativacao' porque UC ativa sem plano e recusada.
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://pu/m1b') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina2, 'consumidora', 'ativacao', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;
    v_contas := pg_temp.contas(v_inv);
    IF v_contas[1] <> 0 OR v_contas[2] <> 0 OR v_contas[3] <> -1000 OR v_contas[4] <> 0 THEN
        RAISE EXCEPTION 'FALHA M1b: UC sem plano em usina com plano de usina lancou gestao/recompensa: %', v_contas;
    END IF;
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec ->> 'motivo' IS DISTINCT FROM 'uc_sem_plano' THEN
        RAISE EXCEPTION 'FALHA M1b: motivo = %, esperado uc_sem_plano', v_rec ->> 'motivo';
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
    INSERT INTO public.planos_usina (nome, percentual_recorrente)
    VALUES ('SANDBOX PU matriz nula', 12) RETURNING id INTO v_pu3;
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu3) RETURNING id INTO v_usina_matriz;
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pu/m4') RETURNING id INTO v_sub;
    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address, plano_assinatura_id)
    VALUES (v_sub, v_usina_matriz, 'consumidora', 'ativo', 'SANDBOX PU conc', '{"uf": "RN"}'::jsonb, v_rec_sem_matriz)
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

    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct)
    VALUES ('SANDBOX PU 12+3', 12, 3) RETURNING id INTO v_pu_orig;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orig, v_forn_orig) RETURNING id INTO v_usina4;

    -- ==================================================================
    -- O1 -- o originador da usina recebe 3% em 2.1.2.
    --   B2W 120 | 2.1.2 = PPE 50 + Lider 10 + originador 30 = 90
    --   fornecedor = 1000 - 210 = 790
    -- ==================================================================
    v_inv    := pg_temp.fatura_paga(v_usina4, v_ppe, v_rec_plano);
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
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct)
    VALUES ('SANDBOX PU corte', 12, 3) RETURNING id INTO v_pu_corte;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_corte, v_forn_orig) RETURNING id INTO v_usina_corte;

    v_inv    := pg_temp.fatura_paga(v_usina_corte, v_ppe, v_rec_piso675);
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
    v_inv    := pg_temp.fatura_paga(v_usina_inat, v_ppe, v_rec_plano);
    v_contas := pg_temp.contas(v_inv);
    IF v_contas IS DISTINCT FROM ARRAY[-150, -60, -790, 0]::numeric[] THEN
        RAISE EXCEPTION 'FALHA O3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-150,-60,-790,0}', v_contas;
    END IF;

    -- ==================================================================
    -- O4 -- usina cujo fornecedor nao tem originador (aqui: sem fornecedor):
    --       o previsto no plano fica para a associacao.
    -- ==================================================================
    INSERT INTO public.usinas (plano_usina_id) VALUES (v_pu_orig) RETURNING id INTO v_usina_sem_orig;
    v_inv    := pg_temp.fatura_paga(v_usina_sem_orig, v_ppe, v_rec_plano);
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
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct)
    VALUES ('SANDBOX PU start', 12, 3) RETURNING id INTO v_pu_start;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_start, v_forn_orig) RETURNING id INTO v_usina_start;

    v_inv    := pg_temp.fatura_paga(v_usina_start, v_ppe, v_rec_start);
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
    INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct)
    VALUES ('SANDBOX PU start 1', 12, 3) RETURNING id INTO v_pu_start1;
    INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_start1, v_forn_orig) RETURNING id INTO v_usina_start1;

    v_inv    := pg_temp.fatura_paga(v_usina_start1, v_ppe, v_rec_start1);
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

    -- ==================================================================
    -- U1 -- UC ativa sem plano de assinatura e recusada (escrita direta).
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url) VALUES ('ativo', 'sandbox://pu/u1') RETURNING id INTO v_sub;
    v_pegou := false;
    BEGIN
        INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_sub, 'beneficiaria', 'ativo');
    EXCEPTION WHEN check_violation THEN v_pegou := true; v_msg := SQLERRM;
    END;
    IF NOT v_pegou OR v_msg NOT LIKE '%plano de assinatura%' THEN
        RAISE EXCEPTION 'FALHA U1: UC ativa sem plano foi aceita (pegou=%, msg=%)', v_pegou, v_msg;
    END IF;

    -- U2 -- em ativacao sem plano passa (onboarding publico); ativar sem plano e recusado.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status)
    VALUES (v_sub, 'beneficiaria', 'ativacao') RETURNING id INTO v_uc;
    v_pegou := false;
    BEGIN
        UPDATE public.consumer_units SET status = 'ativo' WHERE id = v_uc;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA U2: ativar UC sem plano devia ser recusado';
    END IF;

    -- U3 -- geradora nao precisa de plano.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status) VALUES (v_sub, 'geradora', 'ativo');

    -- U4 -- tirar o plano de UC ativa e recusado.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status, plano_assinatura_id)
    VALUES (v_sub, 'beneficiaria', 'ativo', v_rec_plano) RETURNING id INTO v_uc;
    v_pegou := false;
    BEGIN
        UPDATE public.consumer_units SET plano_assinatura_id = NULL WHERE id = v_uc;
    EXCEPTION WHEN check_violation THEN v_pegou := true;
    END;
    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA U4: tirar o plano de UC ativa devia ser recusado';
    END IF;

    -- U5 -- cascata (gatilho de outro gatilho) NAO e barrada: simulada por
    --       um gatilho de teste em invoices que ativa a UC. Funcao e gatilho
    --       sao DDL dentro da transacao: somem no rollback do SANDBOX_OK.
    INSERT INTO public.consumer_units (subscriber_id, tipo_unidade, status)
    VALUES (v_sub, 'beneficiaria', 'ativacao') RETURNING id INTO v_uc;
    EXECUTE $t$
      CREATE FUNCTION public.fn_sandbox_ativa_uc() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN UPDATE public.consumer_units SET status = 'ativo' WHERE id = NEW.uc_id; RETURN NEW; END $f$
    $t$;
    EXECUTE 'CREATE TRIGGER tr_sandbox_ativa_uc AFTER INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_sandbox_ativa_uc()';
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 10, 0, CURRENT_DATE + 5);
    EXECUTE 'DROP TRIGGER tr_sandbox_ativa_uc ON public.invoices';
    IF (SELECT status::text FROM public.consumer_units WHERE id = v_uc) <> 'ativo' THEN
        RAISE EXCEPTION 'FALHA U5: a cascata devia ativar a UC mesmo sem plano';
    END IF;

    -- ==================================================================
    -- fixture: Lider do originador da usina
    -- ==================================================================
    DECLARE
        v_lider_usina   uuid;
        v_lider_inat    uuid;
        v_orig_c_lider  uuid;
        v_orig_c_linat  uuid;
        v_orig_s_lider  uuid;
        v_forn_c_lider  uuid;
        v_forn_c_linat  uuid;
        v_forn_s_lider  uuid;
        v_forn_sem      uuid;
        v_pu_lider      uuid;
        v_pu_orfa675    uuid;
        v_rec_piso68    uuid;
        v_rec_piso70    uuid;
    BEGIN
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU lider da usina', 'lider', true) RETURNING id INTO v_lider_usina;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU lider inativo', 'lider', false) RETURNING id INTO v_lider_inat;
        INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PU orig c/ lider', 'ppf', true, v_lider_usina) RETURNING id INTO v_orig_c_lider;
        INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PU orig c/ lider inativo', 'ppf', true, v_lider_inat) RETURNING id INTO v_orig_c_linat;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU orig s/ lider', 'ppf', true) RETURNING id INTO v_orig_s_lider;

        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn c/ lider', v_orig_c_lider) RETURNING id INTO v_forn_c_lider;
        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn c/ lider inativo', v_orig_c_linat) RETURNING id INTO v_forn_c_linat;
        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn s/ lider', v_orig_s_lider) RETURNING id INTO v_forn_s_lider;
        INSERT INTO public.suppliers (name) VALUES ('SANDBOX PU forn sem originador') RETURNING id INTO v_forn_sem;

        -- plano de usina 12% + originador 3% + Lider dele 1%
        INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct, originador_lider_recorrente_pct)
        VALUES ('SANDBOX PU 12+3+1', 12, 3, 1) RETURNING id INTO v_pu_lider;

        -- L1 -- o Lider do originador recebe 1% em 2.1.2.
        --   B2W 120 | 2.1.2 = PPE 50 + Lider 10 + originador 30 + Lider do originador 10 = 100 | fornecedor 780
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_c_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -100, -780, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-100,-780,0}', v_contas;
        END IF;
        SELECT count(*) INTO v_n FROM public.ledger_entries
         WHERE reference_id = v_lider_usina AND reference_type = 'originator' AND amount = -10
           AND description = 'Recompensa Líder do Originador da Usina (nível 1)'
           AND transaction_id = (SELECT transaction_id FROM public.ledger_entries
                                  WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'FALHA L1: esperado 1 lancamento de -10 em 2.1.2 para o Lider do originador, achei %', v_n;
        END IF;

        -- L2 -- Lider inativo: a cota dele (10) vai para a B2W (cabe no teto 400).
        --   B2W 130 | 2.1.2 = 90 | fornecedor 780
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_c_linat) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-130, -90, -780, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-90,-780,0}', v_contas;
        END IF;

        -- L3 -- originador sem Lider: mesma conta do L2.
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_s_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-130, -90, -780, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L3: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-90,-780,0}', v_contas;
        END IF;

        -- L4 -- ordem de corte: originador da usina, depois o Lider dele, antes do PPE.
        --   piso 68: piso em R$ = 1000 x 1,20 x 68% = 816 -> teto 184
        --   bruto 220 (120 + 30 + 10 + 50 + 10), excesso 36:
        --   originador 30 -> 0 (cortado 30), Lider do originador 10 -> 4 (cortado 6),
        --   PPE 50 e Lider 10 intactos. 2.1.2 = 4 + 50 + 10 = 64; fornecedor 816.
        INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
        VALUES ('SANDBOX PU rec piso68', 'recorrente', 10, 68, jsonb_build_object('regras_multinivel', c_matriz))
        RETURNING id INTO v_rec_piso68;
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_c_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso68);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -64, -816, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L4: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-64,-816,0}', v_contas;
        END IF;
        SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
        SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
         WHERE b ->> 'papel' = 'lider_originador_usina';
        IF (v_ben ->> 'cortado')::numeric IS DISTINCT FROM 6::numeric OR (v_ben ->> 'valor')::numeric IS DISTINCT FROM 4::numeric THEN
            RAISE EXCEPTION 'FALHA L4: Lider do originador devia ser o 2o cortado (cortado 6, valor 4), veio %', v_ben;
        END IF;

        -- plano de usina 12% + originador 3%, fornecedor SEM originador
        INSERT INTO public.planos_usina (nome, percentual_recorrente, originador_recorrente_pct)
        VALUES ('SANDBOX PU 12+3 orfa', 12, 3) RETURNING id INTO v_pu_orfa675;

        -- C1 -- cota sem dono so vai a B2W se couber (decisao 12).
        --   piso 67,5 -> teto 190; bruto 210 (B2W 120 + cota orfa 30 + PPE 50 + Lider 10),
        --   excesso 20 sai da cota orfa: 30 -> 10, e so esses 10 vao a B2W.
        --   B2W 130 | 2.1.2 = 60 (PPE e Lider intactos) | fornecedor 810
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orfa675, v_forn_sem) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso675);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-130, -60, -810, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA C1: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-60,-810,0}', v_contas;
        END IF;
        SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
        SELECT b INTO v_ben FROM jsonb_array_elements(v_rec -> 'resultado' -> 'beneficiarios') b
         WHERE b ->> 'papel' = 'originador_usina';
        IF (v_ben ->> 'valor')::numeric <> 0 OR (v_ben ->> 'cortado')::numeric <> 20 OR (v_ben ->> 'absorvido_b2w')::numeric <> 10 THEN
            RAISE EXCEPTION 'FALHA C1: cota orfa congelada errada (esperado valor 0, cortado 20, absorvido_b2w 10): %', v_ben;
        END IF;
        IF (v_rec -> 'resultado' -> 'b2w' ->> 'valor_absorvido')::numeric <> 10 THEN
            RAISE EXCEPTION 'FALHA C1: b2w.valor_absorvido = %, esperado 10', v_rec -> 'resultado' -> 'b2w' ->> 'valor_absorvido';
        END IF;

        -- C2 -- excesso maior que a cota: ela zera e o resto sai do PPE.
        --   piso 70 -> piso em R$ 840 -> teto 160; excesso 50:
        --   cota orfa 30 -> 0, PPE 50 -> 30. B2W 120 | 2.1.2 = 40 | fornecedor 840
        INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
        VALUES ('SANDBOX PU rec piso70', 'recorrente', 10, 70, jsonb_build_object('regras_multinivel', c_matriz))
        RETURNING id INTO v_rec_piso70;
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_orfa675, v_forn_sem) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso70);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -40, -840, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA C2: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-40,-840,0}', v_contas;
        END IF;

        -- L5 -- a cota de Lider sem dono e a PRIMEIRA da fila: uma pessoa real
        --   (o originador) nunca paga para ela ir a B2W (decisao 12).
        --   plano 12+3+1, originador ativo SEM Lider, UC piso 67,5 -> teto 190.
        --   bruto 220 (B2W 120 + originador 30 + Lider sem dono 10 + PPE 50 + Lider 10),
        --   excesso 30: Lider sem dono 10 -> 0 (nada vai a B2W), originador 30 -> 10.
        --   B2W 120 | 2.1.2 = 10 + 50 + 10 = 70 | fornecedor 810
        INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_s_lider) RETURNING id INTO v_usina;
        v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_piso675);
        v_contas := pg_temp.contas(v_inv);
        IF v_contas IS DISTINCT FROM ARRAY[-120, -70, -810, 0]::numeric[] THEN
            RAISE EXCEPTION 'FALHA L5: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-120,-70,-810,0}', v_contas;
        END IF;

        -- L6 -- originador cujo lider_id aponta para ele mesmo: nao ha Lider
        --   valido, a cota vai a B2W (cabe no teto 400) e ele nao recebe duas vezes.
        --   B2W 130 | 2.1.2 = 90 | fornecedor 780, e nenhum lancamento de Lider do originador.
        DECLARE
            v_orig_auto uuid;
            v_forn_auto uuid;
        BEGIN
            INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU lider de si mesmo', 'lider', true) RETURNING id INTO v_orig_auto;
            UPDATE public.originators_v2 SET lider_id = v_orig_auto WHERE id = v_orig_auto;
            INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn lider de si mesmo', v_orig_auto) RETURNING id INTO v_forn_auto;
            INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_auto) RETURNING id INTO v_usina;
            v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
            v_contas := pg_temp.contas(v_inv);
            IF v_contas IS DISTINCT FROM ARRAY[-130, -90, -780, 0]::numeric[] THEN
                RAISE EXCEPTION 'FALHA L6: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-130,-90,-780,0}', v_contas;
            END IF;
            SELECT count(*) INTO v_n FROM public.ledger_entries
             WHERE description = 'Recompensa Líder do Originador da Usina (nível 1)'
               AND transaction_id = (SELECT transaction_id FROM public.ledger_entries
                                      WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
            IF v_n <> 0 THEN
                RAISE EXCEPTION 'FALHA L6: originador que e Lider de si mesmo recebeu a cota de Lider (% lancamento)', v_n;
            END IF;
        END;

        -- L7 -- originador INATIVO com Lider ativo: o Lider tambem nao recebe
        --   (dono, 12/10/2026: o Lider deve incentivar o originador a ficar ativo).
        --   As duas cotas ficam sem dono e cabem no teto 400: vao a B2W.
        --   B2W 160 (120 + 30 + 10) | 2.1.2 = PPE 50 + Lider 10 = 60 | fornecedor 780
        DECLARE
            v_orig_inat uuid;
            v_forn_inat uuid;
        BEGIN
            INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id) VALUES ('SANDBOX PU orig inativo c/ lider', 'ppf', false, v_lider_usina) RETURNING id INTO v_orig_inat;
            INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU forn orig inativo', v_orig_inat) RETURNING id INTO v_forn_inat;
            INSERT INTO public.usinas (plano_usina_id, supplier_id) VALUES (v_pu_lider, v_forn_inat) RETURNING id INTO v_usina;
            v_inv    := pg_temp.fatura_paga(v_usina, v_ppe, v_rec_plano);
            v_contas := pg_temp.contas(v_inv);
            IF v_contas IS DISTINCT FROM ARRAY[-160, -60, -780, 0]::numeric[] THEN
                RAISE EXCEPTION 'FALHA L7: [3.1.1, 2.1.2, 2.1.1, soma] = %, esperado {-160,-60,-780,0}', v_contas;
            END IF;
            SELECT count(*) INTO v_n FROM public.ledger_entries
             WHERE description = 'Recompensa Líder do Originador da Usina (nível 1)'
               AND transaction_id = (SELECT transaction_id FROM public.ledger_entries
                                      WHERE reference_id = v_inv AND reference_type = 'invoice' LIMIT 1);
            IF v_n <> 0 THEN
                RAISE EXCEPTION 'FALHA L7: Lider de originador inativo recebeu (% lancamento)', v_n;
            END IF;
        END;
    END;

    -- ==================================================================
    -- F1-F3 -- originador copiado do lead (20261010d): fornecedor criado com
    -- lead_id e sem originador herda o do lead; nao admin so passa com o MESMO.
    -- ==================================================================
    DECLARE
        v_mgr   uuid := gen_random_uuid();
        v_lead  uuid;
        v_orig1 uuid;
        v_orig2 uuid;
        v_forn  uuid;
    BEGIN
        INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
        VALUES (v_mgr, 'mgr.pu.lead@teste.invalid', '{"name":"Mgr"}', 'authenticated', 'authenticated');
        UPDATE public.profiles SET role = 'manager' WHERE id = v_mgr;

        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU orig do lead', 'ppf', true) RETURNING id INTO v_orig1;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU outro orig', 'ppf', true) RETURNING id INTO v_orig2;
        INSERT INTO public.leads (name, originator_id) VALUES ('SANDBOX PU lead', v_orig1) RETURNING id INTO v_lead;

        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);

        -- F1 -- fornecedor nasce do lead sem originador: o banco copia o do lead
        INSERT INTO public.suppliers (name, lead_id) VALUES ('SANDBOX PU forn do lead', v_lead) RETURNING id INTO v_forn;
        IF (SELECT originator_id FROM public.suppliers WHERE id = v_forn) IS DISTINCT FROM v_orig1 THEN
            RAISE EXCEPTION 'FALHA F1: originador do lead nao foi copiado';
        END IF;

        -- F2 -- nao admin mandando o MESMO originador do lead: passa
        INSERT INTO public.suppliers (name, lead_id, originator_id) VALUES ('SANDBOX PU forn do lead 2', v_lead, v_orig1);

        -- F3 -- nao admin mandando OUTRO originador: recusado
        v_pegou := false;
        BEGIN
            INSERT INTO public.suppliers (name, lead_id, originator_id) VALUES ('SANDBOX PU forn do lead 3', v_lead, v_orig2);
        EXCEPTION WHEN insufficient_privilege THEN v_pegou := true;
        END;
        PERFORM set_config('request.jwt.claims', '', true);
        IF NOT v_pegou THEN
            RAISE EXCEPTION 'FALHA F3: nao admin gravou originador diferente do lead';
        END IF;
    END;

    -- ==================================================================
    -- F4-F6 -- originador do fornecedor (20261012c): a copia so vale no INSERT;
    -- nao admin nao limpa nem troca via lead_id; retirada por admin nao volta.
    -- ==================================================================
    DECLARE
        v_mgr   uuid := gen_random_uuid();
        v_lead  uuid;
        v_orig1 uuid;
        v_orig2 uuid;
        v_forn  uuid;
    BEGIN
        INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
        VALUES (v_mgr, 'mgr.pu.lead2@teste.invalid', '{"name":"Mgr2"}', 'authenticated', 'authenticated');
        UPDATE public.profiles SET role = 'manager' WHERE id = v_mgr;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU F4 orig1', 'ppf', true) RETURNING id INTO v_orig1;
        INSERT INTO public.originators_v2 (name, cargo, ativo) VALUES ('SANDBOX PU F4 orig2', 'ppf', true) RETURNING id INTO v_orig2;
        INSERT INTO public.leads (name, originator_id) VALUES ('SANDBOX PU F4 lead', v_orig1) RETURNING id INTO v_lead;

        -- F4 -- nao admin limpando o originador de fornecedor sem lead: recusado
        INSERT INTO public.suppliers (name, originator_id) VALUES ('SANDBOX PU F4 forn', v_orig2) RETURNING id INTO v_forn;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
        v_pegou := false;
        BEGIN
            UPDATE public.suppliers SET originator_id = NULL WHERE id = v_forn;
        EXCEPTION WHEN insufficient_privilege THEN v_pegou := true;
        END;
        IF NOT v_pegou THEN
            RAISE EXCEPTION 'FALHA F4: nao admin limpou o originador do fornecedor';
        END IF;

        -- F5 -- nao admin apontando lead_id para o lead de X e originador X: recusado
        PERFORM set_config('request.jwt.claims', '', true);
        INSERT INTO public.suppliers (name) VALUES ('SANDBOX PU F5 forn') RETURNING id INTO v_forn;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
        v_pegou := false;
        BEGIN
            UPDATE public.suppliers SET lead_id = v_lead, originator_id = v_orig1 WHERE id = v_forn;
        EXCEPTION WHEN insufficient_privilege THEN v_pegou := true;
        END;
        PERFORM set_config('request.jwt.claims', '', true);
        IF NOT v_pegou THEN
            RAISE EXCEPTION 'FALHA F5: nao admin atribuiu originador trocando o lead_id';
        END IF;

        -- F6 -- admin retira o originador; o proximo salvar (com o mesmo lead_id) nao copia de volta
        INSERT INTO public.suppliers (name, lead_id) VALUES ('SANDBOX PU F6 forn', v_lead) RETURNING id INTO v_forn;
        UPDATE public.suppliers SET originator_id = NULL WHERE id = v_forn;
        UPDATE public.suppliers SET name = 'SANDBOX PU F6 forn 2', lead_id = v_lead WHERE id = v_forn;
        IF (SELECT originator_id FROM public.suppliers WHERE id = v_forn) IS NOT NULL THEN
            RAISE EXCEPTION 'FALHA F6: originador retirado voltou no proximo salvar';
        END IF;
    END;

    -- >>> casos novos entram acima desta linha <<<
    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
