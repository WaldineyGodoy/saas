-- Teste: handle_invoice_paid_ledger divide a fatura paga pela MATRIZ DO PLANO
-- (Task 6 do Split de Pagamentos), e nao mais por originators_v2.split_commission.
--
-- O que este teste cobra:
--   0. conta 2.1.6 existe (Creditos de Indicacao a Assinantes) e invoices tem
--      a coluna recompensas_aplicadas;
--   1. venda direta PPE          -> B2W 10%, PPE 5% (L1), Lider 1% (L1);
--   2. indicacao nivel 2 + Conect-> PPE 2% (L2), Conect 2% (L1), B2W 10%;
--   3. PPP com licenca vencida   -> parceiro 0 e a B2W absorve (10% + 4% = 14%);
--   4. UC sem plano              -> nenhum lancamento de recompensa, fornecedor
--                                   fica com o residual inteiro, motivo gravado;
--   5. piso furado (piso 88%)    -> corte na ordem assinante_conect -> parceiro
--                                   -> lider, parando quando o excesso zera;
--   5b. piso 95%                 -> corta tudo que da e a B2W NUNCA e cortada
--                                   (teto_estourado = true);
--   6. UC geradora               -> nada (como hoje), nem recompensas_aplicadas;
--   7. banco / taxa Asaas / concessionaria continuam IDENTICOS aos de hoje;
--   8. bonus Start: a fatura elegivel e DETECTADA e registrada no congelamento,
--      e (enquanto o nivel do Start nao for definido pelo dono) a recorrencia
--      continua sendo aplicada -- ver task-6-report.md;
--   9. congelamento: recompensas_aplicadas guarda plano, percentuais e o
--      retorno do motor;
--  10. a funcao continua SECURITY DEFINER, dona postgres, search_path fixo.
--
-- Fix round 1 (29/09/2026):
--   9.  base negativa -> prejuizo compartilhado: a B2W absorve a fatia dela
--       (decisao do dono 18/08/2026, reconfirmada 28/09/2026);
--  10.  execucao dupla (pago -> outro status -> pago) NAO duplica a transacao;
--  11.  valor_a_pagar nulo;
--  12.  UC sem usina -> nao lanca nada e grava o motivo;
--  13.  plano com "niveis": null -> plano_sem_matriz;
--  14.  papel que o plano paga e o razao nao tem conta -> RAISE EXCEPTION.
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).

DO $$
DECLARE
    -- plano de contas
    v_acc_bank        uuid;  -- 1.1.1.01
    v_acc_taxa        uuid;  -- 4.1.1
    v_acc_gestao      uuid;  -- 3.1.1
    v_acc_investidor  uuid;  -- 2.1.1
    v_acc_comissoes   uuid;  -- 2.1.2
    v_acc_conces      uuid;  -- 2.1.3.01
    v_acc_conect      uuid;  -- 2.1.6  (novo nesta task)

    v_conta_nome      text;
    v_conta_tipo      text;
    v_conta_pai       text;

    -- catalogo da funcao
    v_secdef          boolean;
    v_dona            text;
    v_config          text;

    -- matriz acordada pelo dono (identica a de producao, 27/09/2026)
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb;

    -- planos de teste
    v_plano           uuid;   -- piso 50 (padrao)
    v_plano_p88       uuid;   -- piso 88 -> teto 120 sobre base 1000
    v_plano_p95       uuid;   -- piso 95 -> teto  50 sobre base 1000
    v_plano_start     uuid;   -- piso 50 + start_config na 1a fatura

    -- atores
    v_lider           uuid;
    v_ppe             uuid;
    v_ppe2            uuid;
    v_ppp             uuid;

    v_usina           uuid;
    v_usina_p88       uuid;
    v_usina_p95       uuid;
    v_usina_start     uuid;
    v_usina_sem_plano uuid;

    v_sub             uuid;
    v_sub_ref         uuid;
    v_uc              uuid;
    v_inv             uuid;
    v_txn             uuid;

    -- leituras do razao
    v_bank            numeric;
    v_taxa            numeric;
    v_gestao          numeric;
    v_com             numeric;
    v_conect          numeric;
    v_forn            numeric;
    v_conces          numeric;
    v_total           numeric;
    v_n               integer;

    v_rec             jsonb;
    v_ben             jsonb;
    v_desc            text;

    -- fix round 1
    v_plano_nula      uuid;
    v_plano_orfao     uuid;
    v_usina_nula      uuid;
    v_usina_orfao     uuid;
    v_msg             text;
    v_pegou           boolean := false;
BEGIN
    -- ------------------------------------------------------------------
    -- 0. pre-requisitos estruturais
    -- ------------------------------------------------------------------
    SELECT id INTO v_acc_bank       FROM public.ledger_accounts WHERE code = '1.1.1.01';
    SELECT id INTO v_acc_taxa       FROM public.ledger_accounts WHERE code = '4.1.1';
    SELECT id INTO v_acc_gestao     FROM public.ledger_accounts WHERE code = '3.1.1';
    SELECT id INTO v_acc_investidor FROM public.ledger_accounts WHERE code = '2.1.1';
    SELECT id INTO v_acc_comissoes  FROM public.ledger_accounts WHERE code = '2.1.2';
    SELECT id INTO v_acc_conces     FROM public.ledger_accounts WHERE code = '2.1.3.01';

    SELECT a.id, a.name, a.type, p.code
      INTO v_acc_conect, v_conta_nome, v_conta_tipo, v_conta_pai
      FROM public.ledger_accounts a
      LEFT JOIN public.ledger_accounts p ON p.id = a.parent_id
     WHERE a.code = '2.1.6';

    IF v_acc_conect IS NULL THEN
        RAISE EXCEPTION 'FALHA: conta 2.1.6 (Creditos de Indicacao a Assinantes) nao existe no plano de contas';
    END IF;
    IF v_conta_nome <> 'Créditos de Indicação a Assinantes' THEN
        RAISE EXCEPTION 'FALHA: conta 2.1.6 chama-se "%", esperado "Créditos de Indicação a Assinantes"', v_conta_nome;
    END IF;
    IF v_conta_tipo <> 'liability' THEN
        RAISE EXCEPTION 'FALHA: conta 2.1.6 e do tipo %, esperado liability (e obrigacao com o Assinante Conect)', v_conta_tipo;
    END IF;
    IF v_conta_pai IS DISTINCT FROM '2.1.0' THEN
        RAISE EXCEPTION 'FALHA: conta 2.1.6 pendurada em %, esperado 2.1.0 (Passivo Circulante)', COALESCE(v_conta_pai, '<nula>');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'invoices'
           AND column_name = 'recompensas_aplicadas' AND data_type = 'jsonb'
    ) THEN
        RAISE EXCEPTION 'FALHA: invoices.recompensas_aplicadas (jsonb) nao existe -- sem ela nao ha congelamento';
    END IF;

    -- 10. a funcao nao pode perder SECURITY DEFINER / dona / search_path:
    --     e isso que permite chamar fn_participantes_recompensa (EXECUTE so
    --     para service_role) de dentro do gatilho.
    SELECT p.prosecdef, pg_get_userbyid(p.proowner), COALESCE(p.proconfig::text, '')
      INTO v_secdef, v_dona, v_config
      FROM pg_proc p WHERE p.oid = 'public.handle_invoice_paid_ledger()'::regprocedure;

    IF NOT v_secdef THEN
        RAISE EXCEPTION 'FALHA: handle_invoice_paid_ledger voltou a ser SECURITY INVOKER';
    END IF;
    IF v_dona <> 'postgres' THEN
        RAISE EXCEPTION 'FALHA: dona da funcao e %, esperado postgres', v_dona;
    END IF;
    IF v_config NOT LIKE '%search_path=public, pg_temp%' THEN
        RAISE EXCEPTION 'FALHA: search_path da funcao nao esta fixo: %', v_config;
    END IF;

    -- o motor antigo nao pode mais ser lido. Compara so o CODIGO: as linhas de
    -- comentario sao descartadas de proposito, porque o corpo novo cita
    -- split_commission justamente para dizer que nao a le mais.
    SELECT COALESCE(string_agg(l, E'\n'), '')
      INTO v_desc
      FROM unnest(string_to_array(
             pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure), E'\n')) l
     WHERE l !~ '^\s*--';

    IF v_desc ILIKE '%split_commission%' THEN
        RAISE EXCEPTION 'FALHA: o gatilho ainda le originators_v2.split_commission';
    END IF;
    IF v_desc NOT ILIKE '%fn_calcular_split_recompensa%' THEN
        RAISE EXCEPTION 'FALHA: o gatilho nao chama fn_calcular_split_recompensa';
    END IF;

    -- ------------------------------------------------------------------
    -- fixture comum
    -- ------------------------------------------------------------------
    INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 piso50', 10, 50, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano;

    INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 piso88', 10, 88, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano_p88;

    INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 piso95', 10, 95, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano_p95;

    INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX Task6 start', 10, 50, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [1],
              "regras": {"1": {"b2w": 0, "lider": 50, "ppe": 50, "ppp": 40, "ppf": 20, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_plano_start;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Task6 Lider', 'lider', true) RETURNING id INTO v_lider;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX Task6 PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Task6 PPE sem lider', 'ppe', true, NULL) RETURNING id INTO v_ppe2;

    -- PPP com licenca vencida ONTEM: recorrencia suspensa, valor vai para a B2W
    INSERT INTO public.originators_v2 (name, cargo, ativo, licenca_vencimento)
    VALUES ('SANDBOX Task6 PPP vencido', 'ppp', true, CURRENT_DATE - 1) RETURNING id INTO v_ppp;

    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano)       RETURNING id INTO v_usina;
    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_p88)   RETURNING id INTO v_usina_p88;
    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_p95)   RETURNING id INTO v_usina_p95;
    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_start) RETURNING id INTO v_usina_start;
    -- gestao_percentual 15 de proposito: se o gatilho voltar a ler a usina em
    -- vez do plano, os numeros dos casos 1-3 mudam e o teste acusa.
    INSERT INTO public.usinas (gestao_percentual) VALUES (15) RETURNING id INTO v_usina_sem_plano;

    -- ==================================================================
    -- CASO 1 -- venda direta PPE: B2W 10% + PPE 5% (L1) + Lider 1% (L1)
    --   base 1000, teto = 1000 * (1 - 50/100) = 500 -> nada e cortado
    --   3.1.1 = -100 | 2.1.2 = -(50 + 10) = -60 | 2.1.6 = 0 | 2.1.1 = -840
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c1') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-100::numeric, -60::numeric, 0::numeric, -840::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 1 (venda direta PPE): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / -60 / 0 / -840)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- parceiro e lider tem de ir para 2.1.2 com reference_type = originator,
    -- e reference_id apontando para cada um deles (nao para a fatura).
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes
       AND reference_type = 'originator' AND reference_id IN (v_ppe, v_lider);
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'FALHA caso 1: esperados 2 lancamentos em 2.1.2 com reference_type=originator (PPE e Lider), achei %', v_n;
    END IF;

    SELECT amount INTO v_com
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes AND reference_id = v_ppe;
    IF v_com <> -50 THEN
        RAISE EXCEPTION 'FALHA caso 1: PPE recebeu % em 2.1.2, esperado -50 (5%% de 1000)', v_com;
    END IF;

    SELECT amount INTO v_com
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes AND reference_id = v_lider;
    IF v_com <> -10 THEN
        RAISE EXCEPTION 'FALHA caso 1: Lider recebeu % em 2.1.2, esperado -10 (1%% de 1000)', v_com;
    END IF;

    -- 9. congelamento
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: recompensas_aplicadas ficou NULL (sem congelamento)';
    END IF;
    IF (v_rec->>'aplicado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 1: recompensas_aplicadas.aplicado = %, esperado true', v_rec->>'aplicado';
    END IF;
    IF (v_rec->>'plano_id')::uuid IS DISTINCT FROM v_plano THEN
        RAISE EXCEPTION 'FALHA caso 1: recompensas_aplicadas.plano_id = %, esperado %', v_rec->>'plano_id', v_plano;
    END IF;
    IF (v_rec->>'base')::numeric <> 1000 OR (v_rec->>'teto_deducao')::numeric <> 500 THEN
        RAISE EXCEPTION 'FALHA caso 1: base=% teto_deducao=% (esperado 1000 / 500)',
            v_rec->>'base', v_rec->>'teto_deducao';
    END IF;
    IF v_rec->'regras' IS DISTINCT FROM c_matriz THEN
        RAISE EXCEPTION 'FALHA caso 1: a matriz congelada nao e a matriz usada no calculo: %', v_rec->'regras';
    END IF;
    IF v_rec->'resultado'->'b2w' IS NULL OR (v_rec->'resultado'->'b2w'->>'valor')::numeric <> 100 THEN
        RAISE EXCEPTION 'FALHA caso 1: resultado.b2w congelado errado: %', v_rec->'resultado'->'b2w';
    END IF;
    IF (v_rec->'resultado'->>'fornecedor')::numeric <> 840 THEN
        RAISE EXCEPTION 'FALHA caso 1: resultado.fornecedor congelado = %, esperado 840', v_rec->'resultado'->>'fornecedor';
    END IF;
    IF v_rec->'participantes' IS NULL OR jsonb_array_length(v_rec->'participantes') <> 2 THEN
        RAISE EXCEPTION 'FALHA caso 1: participantes congelados = %', v_rec->'participantes';
    END IF;

    -- congelamento de verdade: mexer no plano DEPOIS nao pode reescrever a fatura
    UPDATE public.planos_assinatura_energia
       SET gestao_percentual = 30,
           recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,b2w,niveis,L1}', '"30"')
     WHERE id = v_plano;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->'resultado'->'b2w'->>'valor')::numeric <> 100 THEN
        RAISE EXCEPTION 'FALHA caso 1: mudar o plano reescreveu o congelamento da fatura (b2w virou %)',
            v_rec->'resultado'->'b2w'->>'valor';
    END IF;

    UPDATE public.planos_assinatura_energia
       SET gestao_percentual = 10,
           recorrente_config = jsonb_set(recorrente_config, '{regras_multinivel,b2w,niveis,L1}', '"10"')
     WHERE id = v_plano;

    -- ==================================================================
    -- CASO 2 -- indicacao: parceiro no nivel 2 (PPE L2 = 2%) + Conect (2%)
    --   base 1000, teto 500
    --   3.1.1 = -100 | 2.1.2 = -20 | 2.1.6 = -20 | 2.1.1 = -860
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task6/c2-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe2, 'ativo', 'sandbox://task6/c2', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-100::numeric, -20::numeric, -20::numeric, -860::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 2 (indicacao nivel 2 + Conect): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / -20 / -20 / -860)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- o Conect e um ASSINANTE: 2.1.6, reference_id = subscribers.id
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_conect AND reference_id = v_sub_ref;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 2: o credito do Conect em 2.1.6 nao aponta para o assinante indicador (%)', v_sub_ref;
    END IF;

    -- ==================================================================
    -- CASO 3 -- PPP com licenca vencida: parceiro 0 e a B2W absorve os 4%
    --   3.1.1 = -140 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -860
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppp, 'ativo', 'sandbox://task6/c3') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-140::numeric, 0::numeric, 0::numeric, -860::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 3 (PPP licenca vencida): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -140 / 0 / 0 / -860)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 3: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->'resultado'->'b2w'->>'valor_absorvido')::numeric <> 40 THEN
        RAISE EXCEPTION 'FALHA caso 3: valor_absorvido congelado = %, esperado 40', v_rec->'resultado'->'b2w'->>'valor_absorvido';
    END IF;

    -- ==================================================================
    -- CASO 4 -- UC sem plano: NENHUM lancamento de recompensa; o fornecedor
    --           fica com o residual inteiro e o motivo e gravado.
    --   3.1.1 = 0 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -1000
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c4') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina_sem_plano, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (0::numeric, 0::numeric, 0::numeric, -1000::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 4 (UC sem plano): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado 0 / 0 / 0 / -1000)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 4: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 4: UC sem plano precisa registrar o motivo em recompensas_aplicadas';
    END IF;
    IF (v_rec->>'aplicado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 4: aplicado = %, esperado false', v_rec->>'aplicado';
    END IF;
    IF v_rec->>'motivo' IS DISTINCT FROM 'uc_sem_plano' THEN
        RAISE EXCEPTION 'FALHA caso 4: motivo = %, esperado uc_sem_plano', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 5 -- piso furado (piso 88% -> teto 120 sobre base 1000)
    --   Ha indicacao, entao o parceiro esta no NIVEL 2 (PPE L2 = 2%) e o
    --   lider tambem (L2 = 1%); o Conect e sempre nivel 1 (2%).
    --   bruto: B2W 100 + PPE 20 + Lider 10 + Conect 20 = 150
    --   excesso 30 -> corta Conect (20) e depois 10 do parceiro; o Lider
    --   nao e tocado porque o excesso ja zerou.
    --   3.1.1 = -100 | 2.1.2 = -(10 + 10) = -20 | 2.1.6 = 0 | 2.1.1 = -880
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task6/c5-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c5', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina_p88, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-100::numeric, -20::numeric, 0::numeric, -880::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 5 (piso 88%%): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / -20 / 0 / -880)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- ordem do corte, no congelamento: Conect perdeu tudo (20), parceiro
    -- perdeu 10, lider nao perdeu nada.
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'assinante_conect';
    IF (v_ben->>'cortado')::numeric <> 20 OR (v_ben->>'valor')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: Conect devia ser cortado primeiro e inteiro, veio %', v_ben;
    END IF;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'ppe';
    IF (v_ben->>'cortado')::numeric <> 10 OR (v_ben->>'valor')::numeric <> 10 THEN
        RAISE EXCEPTION 'FALHA caso 5: parceiro devia ser cortado em 10 (sobrando 10), veio %', v_ben;
    END IF;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'lider';
    IF (v_ben->>'cortado')::numeric <> 0 OR (v_ben->>'valor')::numeric <> 10 THEN
        RAISE EXCEPTION 'FALHA caso 5: lider e o ULTIMO da ordem e nao devia ser tocado, veio %', v_ben;
    END IF;

    IF (v_rec->'resultado'->>'teto_estourado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 5: teto_estourado = %, esperado false (o corte deu conta)',
            v_rec->'resultado'->>'teto_estourado';
    END IF;

    -- ==================================================================
    -- CASO 5b -- piso 95% (teto 50): bruto 150 (mesma montagem do caso 5),
    --            excesso 100: corta Conect 20, parceiro 20 e lider 10 -- e
    --            ainda estoura, porque a B2W (100) nunca e alvo do corte.
    --   3.1.1 = -100 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -900
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task6/c5b-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c5b', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina_p95, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-100::numeric, 0::numeric, 0::numeric, -900::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 5b (piso 95%%): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / 0 / 0 / -900)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5b: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->'resultado'->>'teto_estourado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 5b: teto_estourado = %, esperado true (a B2W sozinha ja passa do teto)',
            v_rec->'resultado'->>'teto_estourado';
    END IF;

    -- ==================================================================
    -- CASO 6 -- UC geradora: nada, como hoje.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c6') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, fatura_consumo_terceiro)
    VALUES (v_sub, v_usina, 'geradora', 'ativo', false) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 6 (UC geradora): gerou % lancamento(s) no razao, esperado nenhum', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NOT NULL THEN
        RAISE EXCEPTION 'FALHA caso 6: UC geradora nao deve nem escrever recompensas_aplicadas, veio %', v_rec;
    END IF;

    -- ==================================================================
    -- CASO 7 -- banco / taxa Asaas / concessionaria IDENTICOS aos de hoje.
    --   valor_a_pagar 1000, concessionaria 300 -> base 700
    --   1.1.1.01 = 1000 - 1.99 = 998.01 | 4.1.1 = 1.99 | 2.1.3.01 = -300
    --   B2W 70 | PPE 35 | Lider 7 | fornecedor 588
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c7') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, asaas_payment_id)
    VALUES (v_uc, 'a_vencer', 1000, 300, CURRENT_DATE + 5, 'pay_sandbox_task6') RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_bank), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_taxa), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conces), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_bank, v_taxa, v_conces, v_gestao, v_com, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_bank, v_taxa, v_conces) IS DISTINCT FROM (998.01::numeric, 1.99::numeric, -300::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 7: banco/taxa/concessionaria mudaram: 1.1.1.01=% 4.1.1=% 2.1.3.01=% (esperado 998.01 / 1.99 / -300)',
            v_bank, v_taxa, v_conces;
    END IF;
    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-70::numeric, -42::numeric, -588::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 7: a base da recompensa nao e (valor_a_pagar - valor_concessionaria): 3.1.1=% 2.1.2=% 2.1.1=% (esperado -70 / -42 / -588)',
            v_gestao, v_com, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 7: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- descricoes e external_id do recebimento continuam os de hoje
    SELECT description INTO v_desc
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_bank AND amount > 0;
    IF v_desc <> ('Recebimento Fatura ' || v_inv) THEN
        RAISE EXCEPTION 'FALHA caso 7: descricao do recebimento mudou: %', v_desc;
    END IF;

    SELECT external_id INTO v_desc
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_bank AND amount > 0;
    IF v_desc IS DISTINCT FROM ('pay_sandbox_task6:' || v_inv) THEN
        RAISE EXCEPTION 'FALHA caso 7: external_id do recebimento mudou: %', COALESCE(v_desc, '<nulo>');
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn
       AND description IN ('Taxa Boleto Asaas', 'Dedução Taxa Asaas', 'Provisão Conta Energia');
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'FALHA caso 7: as 3 descricoes de hoje (Taxa Boleto Asaas / Dedução Taxa Asaas / Provisão Conta Energia) viraram %', v_n;
    END IF;

    -- ==================================================================
    -- CASO 8 -- bonus Start: a 1a fatura paga da UC e elegivel pelo plano.
    --   Enquanto o nivel do Start nao for definido pelo dono, o gatilho
    --   APLICA A RECORRENCIA e apenas REGISTRA a elegibilidade -- por isso
    --   3.1.1 tem de continuar -100 (10%), nunca 0 (b2w do start_config).
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c8') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina_start, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0)
      INTO v_gestao, v_com, v_forn
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-100::numeric, -60::numeric, -840::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 8: com o Start ainda nao aplicado, o rateio tem de ser o da recorrencia: 3.1.1=% 2.1.2=% 2.1.1=% (esperado -100 / -60 / -840)',
            v_gestao, v_com, v_forn;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec->'bonus_start' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 8: o congelamento precisa registrar bonus_start';
    END IF;
    IF (v_rec->'bonus_start'->>'elegivel')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.elegivel = %, esperado true (1a fatura paga, faturas_elegiveis = [1])',
            v_rec->'bonus_start'->>'elegivel';
    END IF;
    IF (v_rec->'bonus_start'->>'aplicado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.aplicado = %, esperado false enquanto o nivel do Start nao for definido',
            v_rec->'bonus_start'->>'aplicado';
    END IF;
    IF (v_rec->'bonus_start'->>'fatura_ordinal')::int IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.fatura_ordinal = %, esperado 1',
            v_rec->'bonus_start'->>'fatura_ordinal';
    END IF;
    IF v_rec->'bonus_start'->>'motivo' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start precisa dizer POR QUE nao foi aplicado';
    END IF;

    -- segunda fatura da mesma UC: ordinal 2, fora de faturas_elegiveis = [1]
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->'bonus_start'->>'fatura_ordinal')::int IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'FALHA caso 8: a 2a fatura paga da UC devia ter fatura_ordinal 2, veio %',
            v_rec->'bonus_start'->>'fatura_ordinal';
    END IF;
    IF (v_rec->'bonus_start'->>'elegivel')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 8: a 2a fatura nao esta em faturas_elegiveis = [1] e nao podia ser elegivel';
    END IF;


    -- ==================================================================
    -- CASO 9 -- BASE NEGATIVA: prejuizo compartilhado.
    --   valor_a_pagar 100, concessionaria 300 -> base -200.
    --   Decisao do dono de 18/08/2026, RECONFIRMADA em 28/09/2026: a B2W
    --   absorve a fatia dela do prejuizo; parceiro/lider/Conect nao recebem
    --   nada (percentual de base negativa nao e recompensa).
    --   Fatia da B2W = 10% de -200 = -20 (NEGATIVA no congelamento); no razao
    --   sai com o sinal invertido, como toda receita, logo 3.1.1 = +20.
    --   Fornecedor = -200 - (-20) = -180 -> 2.1.1 = +180.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c9') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 100, 300, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (20::numeric, 0::numeric, 0::numeric, 180::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 9 (base negativa): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado 20 / 0 / 0 / 180 -- a B2W tem de absorver a fatia dela)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 9: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->'resultado'->'b2w'->>'valor')::numeric <> -20 THEN
        RAISE EXCEPTION 'FALHA caso 9: a fatia congelada da B2W tem de ser NEGATIVA (-20), veio %',
            v_rec->'resultado'->'b2w'->>'valor';
    END IF;
    IF v_rec->>'motivo' IS DISTINCT FROM 'base_negativa' THEN
        RAISE EXCEPTION 'FALHA caso 9: motivo = %, esperado base_negativa', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ledger_entries
                    WHERE transaction_id = v_txn AND account_id = v_acc_gestao
                      AND description = 'Gestão B2W — Prejuízo Compartilhado') THEN
        RAISE EXCEPTION 'FALHA caso 9: o lancamento em 3.1.1 nao esta marcado como prejuizo compartilhado';
    END IF;

    -- ==================================================================
    -- CASO 10 -- execucao dupla NAO pode duplicar a transacao.
    --   pago -> ag_emissao_boleto -> pago -> confirmado -> pago gerava, antes
    --   do fix, uma transacao COMPLETA por passagem (banco, gestao, comissoes
    --   e repasse em dobro), cada uma fechando em zero -- por isso a assercao
    --   "fecha em zero" sozinha nao protegia.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c10') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago'              WHERE id = v_inv;
    UPDATE public.invoices SET status = 'ag_emissao_boleto' WHERE id = v_inv;
    UPDATE public.invoices SET status = 'pago'              WHERE id = v_inv;
    UPDATE public.invoices SET status = 'confirmado'        WHERE id = v_inv;
    UPDATE public.invoices SET status = 'pago'              WHERE id = v_inv;

    SELECT COUNT(DISTINCT transaction_id) INTO v_n
      FROM public.ledger_entries WHERE reference_id = v_inv AND reference_type = 'invoice';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 10 (execucao dupla): a fatura gerou % transacoes no razao, esperado 1', v_n;
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0)
      INTO v_gestao, v_com, v_forn
      FROM public.ledger_entries
     WHERE transaction_id = (SELECT transaction_id FROM public.ledger_entries
                              WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1);

    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-100::numeric, -60::numeric, -840::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 10: rateio duplicado: 3.1.1=% 2.1.2=% 2.1.1=% (esperado -100 / -60 / -840)',
            v_gestao, v_com, v_forn;
    END IF;

    -- ==================================================================
    -- CASO 11 -- valor_a_pagar nulo: base 0, nada estoura, tudo zerado.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c11') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', NULL, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 11: valor_a_pagar nulo nao gerou transacao nenhuma';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_forn, v_total) IS DISTINCT FROM (0::numeric, 0::numeric, 0::numeric, 0::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 11 (valor_a_pagar nulo): 3.1.1=% 2.1.2=% 2.1.1=% soma=% (esperado 0 / 0 / 0 / 0)',
            v_gestao, v_com, v_forn, v_total;
    END IF;

    -- ==================================================================
    -- CASO 12 -- UC sem usina: nao da para saber de quem e o repasse.
    --   Antes do fix lancava 2.1.1 com reference_id NULL (repasse sem dono) e
    --   uma transacao pela metade. Agora nao lanca NADA e grava o motivo.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c12') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, NULL, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 12 (UC sem usina): lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'uc_sem_usina' THEN
        RAISE EXCEPTION 'FALHA caso 12: motivo = %, esperado uc_sem_usina', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;
    IF (v_rec->>'lancado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 12: lancado = %, esperado false', COALESCE(v_rec->>'lancado', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 13 -- plano com "niveis": null.
    --   jsonb null NAO e SQL NULL: com o IS NULL antigo isso passava batido,
    --   o motor devolvia b2w 0% e a fatura saia como "recorrencia" com a
    --   gestao zerada em silencio. Agora cai em plano_sem_matriz.
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 matriz nula', 10, 50,
            '{"regras_multinivel": {"b2w": {"niveis": null, "max_niveis": 4}}}'::jsonb)
    RETURNING id INTO v_plano_nula;

    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_nula) RETURNING id INTO v_usina_nula;

    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c13') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina_nula, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec->>'motivo' IS DISTINCT FROM 'plano_sem_matriz' THEN
        RAISE EXCEPTION 'FALHA caso 13: "niveis": null devia cair em plano_sem_matriz, veio motivo = %',
            COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;
    IF (v_gestao, v_forn, v_total) IS DISTINCT FROM (0::numeric, -1000::numeric, 0::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 13: 3.1.1=% 2.1.1=% soma=% (esperado 0 / -1000 / 0)',
            v_gestao, v_forn, v_total;
    END IF;

    -- ==================================================================
    -- CASO 14 -- papel que o PLANO paga e o razao nao tem conta: estoura.
    --   Precisa de percentual > 0: papel com valor 0 e pulado antes da
    --   guarda, entao um plano "orfao" paga 3% a um papel inexistente.
    --   fn_participantes_recompensa e trocada DENTRO desta transacao (some no
    --   rollback) -- por isso este e o ULTIMO caso do arquivo.
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 papel orfao', 10, 50,
            '{"regras_multinivel": {"b2w": {"niveis": {"L1":"10"}, "max_niveis": 4},
                                    "papel_inexistente": {"niveis": {"L1":"3"}, "max_niveis": 1}}}'::jsonb)
    RETURNING id INTO v_plano_orfao;

    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_orfao) RETURNING id INTO v_usina_orfao;

    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.fn_participantes_recompensa(p_uc uuid)
      RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
      AS $body$ SELECT '[{"papel":"papel_inexistente","id":"00000000-0000-0000-0000-000000000001","nivel":1,"suspenso":false}]'::jsonb $body$;
    $f$;

    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c14') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status)
    VALUES (v_sub, v_usina_orfao, 'consumidora', 'ativo') RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    BEGIN
        UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;
    EXCEPTION WHEN others THEN
        v_pegou := true;
        v_msg := SQLERRM;
    END;

    IF NOT v_pegou THEN
        RAISE EXCEPTION 'FALHA caso 14: papel sem conta no razao NAO estourou -- o gatilho lancou no lugar errado ou engoliu o valor';
    END IF;
    IF v_msg NOT LIKE '%papel_inexistente%' OR v_msg NOT LIKE '%nao tem conta no razao%' THEN
        RAISE EXCEPTION 'FALHA caso 14: estourou com a mensagem errada: %', v_msg;
    END IF;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 14: sobraram % linha(s) no razao depois do RAISE', v_n;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
