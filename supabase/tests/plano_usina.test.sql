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

    -- >>> casos novos entram acima desta linha <<<
    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
