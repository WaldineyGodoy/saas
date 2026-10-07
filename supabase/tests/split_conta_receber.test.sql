-- Teste: O ROMBO DE CAIXA VIRA CONTA A RECEBER DO ASSINANTE (Task 13 do Split
-- de Pagamentos, decisao do dono de 29/09/2026).
--
-- De onde vem o problema: com a Task 12 (20260929e) a base da recompensa
-- passou a ser a ENERGIA COMPENSADA e deixou de ser o mesmo numero que o
-- caixa da fatura (valor_a_pagar - valor_concessionaria). Alguem tem de
-- absorver a diferenca, senao o razao nao fecha. A Task 12 fez isso jogando a
-- diferenca no FORNECEDOR. Numa fatura real -- assinante pagou R$ 398,78,
-- conta da concessionaria R$ 766,98, 428 kWh compensados -- o investidor era
-- DEBITADO por um debito que e do assinante (parcelamento, iluminacao publica
-- e consumo nao compensado).
--
-- Decisao do dono: a diferenca vira CONTA A RECEBER DO ASSINANTE. A B2W
-- adiantou um debito que nao e dela.
--   * conta nova 1.1.2 -- Contas a Receber de Assinantes, tipo asset;
--   * o fornecedor volta a ser o RESIDUAL DA BASE -- exatamente o
--     `fornecedor` que fn_calcular_split_recompensa devolve (congelado como
--     `fornecedor_base` desde a 20260929e) -- e nao mais o residual do caixa;
--   * o lancamento que fecha a transacao vai para 1.1.2, com
--     reference_type = 'subscriber' e reference_id = o assinante da UC:
--     POSITIVO quando o assinante ainda deve, NEGATIVO quando ele esta
--     adiantado. E o saldo do ciclo com aquele assinante.
--
-- SINAL (deduzido, nao copiado). Nesta convencao de razao o recebimento no
-- banco entra POSITIVO e receitas/passivos entram NEGATIVOS. A soma da
-- transacao e:
--   banco(+caixa bruto) + taxa(+t) + deducao da taxa(-t)
--     + concessionaria(-conc) + gestao(-b2w) + beneficiarios(-ben)
--     + fornecedor(-forn) + X
--   = caixa - b2w - ben - forn + X
-- Para dar zero, X = b2w + ben + forn - caixa. Com forn = fornecedor_base =
-- round(base,2) - b2w - ben (o motor arredonda p_base na entrada), isso e
--   X = round(base, 2) - caixa,
-- ou seja POSITIVO (ativo, o assinante deve) quando a base supera o caixa --
-- que e exatamente o caso da conta da concessionaria maior que a cobranca --
-- e NEGATIVO quando o caixa supera a base. Bate com a decisao do dono.
--
-- RESIDUO DE CENTAVO: `valor_a_pagar` e numeric sem escala e 38 das 96
-- faturas tem mais de duas casas. Quem absorve o residuo passa a ser a conta
-- a receber (1.1.2), num lancamento so, e nao mais o fornecedor -- porque o
-- fornecedor agora e um numero fechado pelo motor (o motor faz
-- `p_base := round(p_base, 2)`, entao `fornecedor` sempre tem duas casas) e
-- porque a fracao de centavo vem do dinheiro que o ASSINANTE pagou, logo
-- pertence ao saldo dele. A soma continua fechando em ZERO EXATO, sem
-- tolerancia.
--
-- O que este teste cobra:
--   0.  a conta 1.1.2 existe, e do tipo asset e pendura em 1.1.0;
--   1.  O CASO DAS 10 -- conta da concessionaria MAIOR que a cobranca: o
--       fornecedor recebe o residual DA BASE (credito, 2.1.1 negativa) e NAO
--       e debitado do rombo; 1.1.2 fica com a diferenca, positiva, com o
--       assinante como referencia; soma da transacao = 0 exato;
--   2.  fatura normal (caixa maior que a base): o sinal se inverte, 1.1.2
--       fica NEGATIVA (assinante adiantado) e o fornecedor segue com o
--       residual da base;
--   3.  fatura SEM compensacao: base zero, ninguem recebe, e 1.1.2 absorve o
--       caixa inteiro (negativo);
--   4.  base IGUAL ao caixa: 1.1.2 nao lanca nada (nao se polui o razao com
--       saldo zero) e o fornecedor continua com o mesmo numero de sempre;
--   5.  CENTAVO QUEBRADO: soma = 0 exato, o banco registra o dinheiro que
--       entrou, gestao/recompensas/fornecedor ficam com duas casas e o
--       residuo fica em 1.1.2 -- num lancamento SO;
--   6.  congelamento: recompensas_aplicadas grava o valor, o sinal e o
--       assinante, para a tela do assinante mostrar o saldo.
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).

DO $$
DECLARE
    -- plano de contas
    v_acc_bank        uuid;  -- 1.1.1.01
    v_acc_taxa        uuid;  -- 4.1.1
    v_acc_receber     uuid;  -- 1.1.2  (a conta nova)
    v_acc_gestao      uuid;  -- 3.1.1
    v_acc_investidor  uuid;  -- 2.1.1
    v_acc_comissoes   uuid;  -- 2.1.2
    v_acc_conces      uuid;  -- 2.1.3.01
    v_acc_conect      uuid;  -- 2.1.6

    v_acc_tipo        text;
    v_acc_pai         text;

    -- matriz de recorrencia acordada pelo dono (identica a de producao)
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb;

    v_plano           uuid;
    v_lider           uuid;
    v_ppe             uuid;
    v_usina           uuid;

    v_sub             uuid;
    v_uc              uuid;
    v_inv             uuid;
    v_txn             uuid;

    v_bank            numeric;
    v_taxa            numeric;
    v_conces          numeric;
    v_gestao          numeric;
    v_com             numeric;
    v_conect          numeric;
    v_forn            numeric;
    v_receber         numeric;
    v_total           numeric;
    v_n               integer;

    v_ref_tipo        text;
    v_ref_id          uuid;
    v_descr           text;

    v_rec             jsonb;
BEGIN

    -- Plano de Usina (20261006f): a usina deixou de apontar direto para o
    -- plano de assinatura; agora aponta para um plano de usina, que aponta
    -- para ele. pg_temp.pu cria o plano de usina com a MESMA gestao que o
    -- plano ja dava (b2w.L1 da matriz valida, ou gestao_percentual), para
    -- nenhum numero esperado deste arquivo mudar. Some no rollback.
    EXECUTE $pu$
      CREATE FUNCTION pg_temp.pu(p_plano uuid) RETURNS uuid LANGUAGE sql AS $f$
        INSERT INTO public.planos_usina (nome, percentual_recorrente, plano_assinatura_id)
        SELECT 'SANDBOX pu ' || p.nome,
               COALESCE(CASE WHEN jsonb_typeof(p.recorrente_config #> '{regras_multinivel,b2w,niveis}') = 'object'
                             THEN (p.recorrente_config #>> '{regras_multinivel,b2w,niveis,L1}')::numeric END,
                        p.gestao_percentual, 0),
               p.id
          FROM public.planos_assinatura_energia p
         WHERE p.id = p_plano
        RETURNING id
      $f$
    $pu$;
    -- ------------------------------------------------------------------
    -- contas
    -- ------------------------------------------------------------------
    SELECT id INTO v_acc_bank       FROM public.ledger_accounts WHERE code = '1.1.1.01';
    SELECT id INTO v_acc_taxa       FROM public.ledger_accounts WHERE code = '4.1.1';
    SELECT id INTO v_acc_gestao     FROM public.ledger_accounts WHERE code = '3.1.1';
    SELECT id INTO v_acc_investidor FROM public.ledger_accounts WHERE code = '2.1.1';
    SELECT id INTO v_acc_comissoes  FROM public.ledger_accounts WHERE code = '2.1.2';
    SELECT id INTO v_acc_conces     FROM public.ledger_accounts WHERE code = '2.1.3.01';
    SELECT id INTO v_acc_conect     FROM public.ledger_accounts WHERE code = '2.1.6';

    IF v_acc_bank IS NULL OR v_acc_gestao IS NULL OR v_acc_comissoes IS NULL
       OR v_acc_investidor IS NULL OR v_acc_conces IS NULL OR v_acc_conect IS NULL THEN
        RAISE EXCEPTION 'FALHA: plano de contas incompleto para rodar o teste';
    END IF;

    -- ==================================================================
    -- CASO 0 -- a conta nova existe, e ATIVO e mora no Ativo Circulante.
    --   Sem ela o rombo nao tem para onde ir e a transacao nao fecha.
    -- ==================================================================
    SELECT a.id, a.type, p.code
      INTO v_acc_receber, v_acc_tipo, v_acc_pai
      FROM public.ledger_accounts a
      LEFT JOIN public.ledger_accounts p ON p.id = a.parent_id
     WHERE a.code = '1.1.2';

    IF v_acc_receber IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 0: a conta 1.1.2 (Contas a Receber de Assinantes) nao existe no plano de contas';
    END IF;
    IF v_acc_tipo IS DISTINCT FROM 'asset' THEN
        RAISE EXCEPTION 'FALHA caso 0: a conta 1.1.2 tem type = %, esperado asset (e um direito da B2W, nao um passivo)',
            COALESCE(v_acc_tipo, '<nulo>');
    END IF;
    IF v_acc_pai IS DISTINCT FROM '1.1.0' THEN
        RAISE EXCEPTION 'FALHA caso 0: a conta 1.1.2 pendura em %, esperado 1.1.0 (Ativo Circulante), como 1.1.1 e 1.1.3',
            COALESCE(v_acc_pai, '<nulo>');
    END IF;

    -- ------------------------------------------------------------------
    -- fixture: cadastro da concessionaria, plano, arvore e usina
    --   tarifa 1,25 e Fio B 0,25, desconto do plano 20%%
    --   -> tarifa liquida = 1,25 x 0,80 - 0,25 = 0,75 por kWh
    -- ------------------------------------------------------------------
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX13-A1', 'Sandbox Task13', 'SANDBOX Task13 OK', 'RN', 1.25, 0.25);

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX Task13 plano', 'recorrente', 10, 50, 20,
            jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Task13 Lider', 'lider', true) RETURNING id INTO v_lider;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX Task13 PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.usinas (plano_usina_id, grupo_tarifario)
    VALUES (pg_temp.pu(v_plano), 'B1 Residencial') RETURNING id INTO v_usina;

    -- ==================================================================
    -- CASO 1 -- O CASO DAS 10: a conta da concessionaria SUPERA a cobranca.
    --   valor_a_pagar 398,78 | valor_concessionaria 766,98 | 428 kWh
    --     caixa = 398,78 - 766,98 = -368,20
    --     base  = 428 x 0,75      =  321,00
    --     b2w 10%%     = 32,10
    --     ppe 5%% (L1) = 16,05 | lider 1%% (L1) = 3,21  -> 2.1.2 = -19,26
    --     teto do piso = round(321 x 0,50, 2) = 160,50 -> nao corta nada
    --     fornecedor = residual DA BASE = 321,00 - 32,10 - 19,26 = 269,64
    --       -> 2.1.1 = -269,64  (o investidor RECEBE)
    --     1.1.2 = 321,00 - (-368,20) = +689,20 (o assinante DEVE)
    --   Pela regra da Task 12 o fornecedor seria o residual do CAIXA,
    --   -368,20 - 51,36 = -419,56, e 2.1.1 viria +419,56: o investidor
    --   DEBITADO de um rombo que e do assinante. E o que esta tarefa corrige.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task13/c1') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task13 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 398.78, 766.98, 428, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conces), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_conces, v_gestao, v_com, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: a transacao nao fecha em zero, soma = %', v_total;
    END IF;
    IF v_forn > 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: 2.1.1 = % -- o investidor foi DEBITADO do rombo de caixa; ele tem de receber o residual da base', v_forn;
    END IF;
    IF (v_conces, v_gestao, v_com, v_forn, v_receber)
       IS DISTINCT FROM (-766.98::numeric, -32.10::numeric, -19.26::numeric, -269.64::numeric, 689.20::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 1 (o caso das 10): 2.1.3.01=% 3.1.1=% 2.1.2=% 2.1.1=% 1.1.2=% (esperado -766.98 / -32.10 / -19.26 / -269.64 / 689.20)',
            v_conces, v_gestao, v_com, v_forn, v_receber;
    END IF;

    -- o rombo tem dono: o assinante daquela UC, num lancamento so
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 1: a conta 1.1.2 recebeu % lancamento(s), esperado exatamente 1', v_n;
    END IF;

    SELECT reference_type, reference_id, description
      INTO v_ref_tipo, v_ref_id, v_descr
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;

    IF v_ref_tipo IS DISTINCT FROM 'subscriber' THEN
        RAISE EXCEPTION 'FALHA caso 1: reference_type do lancamento em 1.1.2 = %, esperado subscriber',
            COALESCE(v_ref_tipo, '<nulo>');
    END IF;
    IF v_ref_id IS DISTINCT FROM v_sub THEN
        RAISE EXCEPTION 'FALHA caso 1: reference_id do lancamento em 1.1.2 = %, esperado o assinante da UC (%) -- saldo sem dono nao e cobravel',
            COALESCE(v_ref_id::text, '<nulo>'), v_sub;
    END IF;
    IF COALESCE(btrim(v_descr), '') = '' THEN
        RAISE EXCEPTION 'FALHA caso 1: o lancamento em 1.1.2 ficou sem descricao';
    END IF;

    -- ==================================================================
    -- CASO 2 -- fatura NORMAL: o caixa supera a base e o sinal se inverte.
    --   valor_a_pagar 1000 | concessionaria 0 | 1000 kWh
    --     caixa = 1000 | base = 1000 x 0,75 = 750
    --     b2w 75 | ppe 37,50 + lider 7,50 = 45 | teto 375 -> nao corta
    --     fornecedor = 750 - 75 - 45 = 630 -> 2.1.1 = -630
    --     1.1.2 = 750 - 1000 = -250 (o assinante esta ADIANTADO)
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task13/c2') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task13 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 2: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: a transacao nao fecha em zero, soma = %', v_total;
    END IF;
    IF (v_gestao, v_com, v_conect, v_forn, v_receber)
       IS DISTINCT FROM (-75::numeric, -45::numeric, 0::numeric, -630::numeric, -250::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 2 (fatura normal): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% 1.1.2=% (esperado -75 / -45 / 0 / -630 / -250 -- o fornecedor e o residual da BASE e o assinante esta adiantado)',
            v_gestao, v_com, v_conect, v_forn, v_receber;
    END IF;

    SELECT reference_type, reference_id INTO v_ref_tipo, v_ref_id
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF (v_ref_tipo, v_ref_id) IS DISTINCT FROM ('subscriber', v_sub) THEN
        RAISE EXCEPTION 'FALHA caso 2: o saldo negativo tambem tem de referenciar o assinante: reference_type=% reference_id=%',
            COALESCE(v_ref_tipo, '<nulo>'), COALESCE(v_ref_id::text, '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 3 -- fatura SEM compensacao: base zero, ninguem recebe, e o
    --   caixa inteiro vira saldo do assinante.
    --   valor_a_pagar 500 | concessionaria 0 | consumo_compensado NULL
    --     base 0 -> 3.1.1 = 0 | 2.1.2 = 0 | 2.1.1 = 0
    --     1.1.2 = 0 - 500 = -500
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task13/c3') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task13 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 500, 0, NULL, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 3: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 3: a transacao nao fecha em zero, soma = %', v_total;
    END IF;
    IF (v_gestao, v_com, v_forn, v_receber)
       IS DISTINCT FROM (0::numeric, 0::numeric, 0::numeric, -500::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 3 (sem compensacao): 3.1.1=% 2.1.2=% 2.1.1=% 1.1.2=% (esperado 0 / 0 / 0 / -500 -- sem base o fornecedor nao repassa nada e o caixa inteiro fica com o assinante)',
            v_gestao, v_com, v_forn, v_receber;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec->>'motivo' IS DISTINCT FROM 'sem_compensacao' THEN
        RAISE EXCEPTION 'FALHA caso 3: motivo = %, esperado sem_compensacao', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 4 -- base IGUAL ao caixa: 1.1.2 nao tem o que lancar.
    --   valor_a_pagar 750 | concessionaria 0 | 1000 kWh -> base 750 = caixa
    --     3.1.1 = -75 | 2.1.2 = -45 | 2.1.1 = -630 | 1.1.2 SEM LANCAMENTO
    --   Garante que a conta nova nao polui o razao com saldo zero e que o
    --   rateio de quem nao tem rombo continua exatamente o de hoje.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task13/c4') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task13 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 750, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 4: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0),
           COUNT(*) FILTER (WHERE account_id = v_acc_receber)
      INTO v_gestao, v_com, v_forn, v_total, v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 4: a transacao nao fecha em zero, soma = %', v_total;
    END IF;
    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-75::numeric, -45::numeric, -630::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 4 (base = caixa): 3.1.1=% 2.1.2=% 2.1.1=% (esperado -75 / -45 / -630)',
            v_gestao, v_com, v_forn;
    END IF;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 4: sem rombo nenhum a conta 1.1.2 ganhou % lancamento(s), esperado nenhum', v_n;
    END IF;

    -- ==================================================================
    -- CASO 5 -- CENTAVO QUEBRADO: a transacao fecha em ZERO EXATO e o
    --   residuo fica na conta a receber, num lancamento so.
    --   valor_a_pagar 371,36480000000006 e concessionaria 196,62 (numeros
    --   reais de producao), 233 kWh compensados.
    --     caixa = 174,74480000000006
    --     base  = 233 x 0,75 = 174,75
    --     b2w 10%%  -> round(17,475, 2)  = 17,48
    --     ppe 5%%   -> round(8,7375, 2)  =  8,74
    --     lider 1%% -> round(1,7475, 2)  =  1,75   -> 2.1.2 = -10,49
    --     fornecedor = 174,75 - 17,48 - 10,49 = 146,78 (duas casas exatas)
    --     1.1.2 = 174,75 - 174,74480000000006 = 0,00519999999999994
    --   Quem carrega a fracao de centavo e a conta a receber: o fornecedor
    --   virou um numero fechado pelo motor e a fracao vem do dinheiro que o
    --   ASSINANTE pagou.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task13/c5') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task13 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 371.36480000000006, 196.62, 233, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 5: a fatura com centavos quebrados nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_bank AND amount > 0), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_taxa), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conces), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_bank, v_taxa, v_conces, v_gestao, v_com, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: a transacao nao fecha em zero, soma = % -- o residuo abaixo do centavo ficou orfao no razao', v_total;
    END IF;
    IF v_bank IS DISTINCT FROM 371.36480000000006::numeric THEN
        RAISE EXCEPTION 'FALHA caso 5: o recebimento no banco veio %, esperado 371.36480000000006 (o razao registra o valor recebido, nunca uma versao arredondada)', v_bank;
    END IF;
    IF (v_taxa, v_conces) IS DISTINCT FROM (1.99::numeric, -196.62::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 5: taxa/concessionaria mudaram: 4.1.1=% 2.1.3.01=% (esperado 1.99 / -196.62)', v_taxa, v_conces;
    END IF;
    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-17.48::numeric, -10.49::numeric, -146.78::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 5: 3.1.1=% 2.1.2=% 2.1.1=% (esperado -17.48 / -10.49 / -146.78 -- 10%%, 5%% e 1%% de 174,75 e o residual da base)',
            v_gestao, v_com, v_forn;
    END IF;

    -- gestao, recompensas E fornecedor ficam com duas casas
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn
       AND account_id IN (v_acc_gestao, v_acc_comissoes, v_acc_conect, v_acc_investidor)
       AND amount <> round(amount, 2);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: % lancamento(s) de gestao/recompensa/repasse com mais de duas casas -- o residuo foi parar em quem nao devia absorve-lo', v_n;
    END IF;

    -- ... e o residuo fica na conta a receber, num lancamento SO
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 5: a conta 1.1.2 recebeu % lancamento(s), esperado exatamente 1 (quem absorve o residuo e um lancamento so)', v_n;
    END IF;
    IF v_receber = round(v_receber, 2) THEN
        RAISE EXCEPTION 'FALHA caso 5: o saldo do assinante (%) nao carrega o residuo -- alguem tem de absorve-lo para a soma fechar em zero exato', v_receber;
    END IF;
    IF v_receber IS DISTINCT FROM (174.75::numeric - (371.36480000000006::numeric - 196.62::numeric)) THEN
        RAISE EXCEPTION 'FALHA caso 5: 1.1.2 = %, esperado base - caixa = 174.75 - 174.74480000000006', v_receber;
    END IF;

    -- ==================================================================
    -- CASO 6 -- CONGELAMENTO: o saldo e o sinal ficam gravados na fatura,
    --   para a tela do assinante conseguir mostrar o saldo do ciclo.
    --   (a fatura do caso 5, que ainda esta em v_inv)
    -- ==================================================================
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 6: recompensas_aplicadas ficou NULL';
    END IF;
    IF v_rec->>'conta_receber_assinante' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 6: o congelamento precisa gravar conta_receber_assinante (o saldo do ciclo com o assinante): %', v_rec;
    END IF;
    IF (v_rec->>'conta_receber_assinante')::numeric IS DISTINCT FROM v_receber THEN
        RAISE EXCEPTION 'FALHA caso 6: conta_receber_assinante congelado = %, mas o razao lancou % em 1.1.2',
            v_rec->>'conta_receber_assinante', v_receber;
    END IF;
    IF v_rec->>'conta_receber_sinal' IS DISTINCT FROM 'assinante_deve' THEN
        RAISE EXCEPTION 'FALHA caso 6: conta_receber_sinal = %, esperado assinante_deve (saldo positivo)',
            COALESCE(v_rec->>'conta_receber_sinal', '<nulo>');
    END IF;
    IF NULLIF(v_rec->>'assinante_id', '')::uuid IS DISTINCT FROM v_sub THEN
        RAISE EXCEPTION 'FALHA caso 6: assinante_id congelado = %, esperado % -- sem o dono a tela nao sabe de quem e o saldo',
            COALESCE(v_rec->>'assinante_id', '<nulo>'), v_sub;
    END IF;
    IF (v_rec->>'fornecedor_base')::numeric IS DISTINCT FROM 146.78::numeric THEN
        RAISE EXCEPTION 'FALHA caso 6: fornecedor_base congelado = %, esperado 146.78', v_rec->>'fornecedor_base';
    END IF;
    IF (v_rec->>'fornecedor_caixa')::numeric IS DISTINCT FROM (v_rec->>'fornecedor_base')::numeric THEN
        RAISE EXCEPTION 'FALHA caso 6: o que foi lancado ao fornecedor (%) tem de ser o residual da base (%) -- e a decisao do dono nesta tarefa',
            v_rec->>'fornecedor_caixa', v_rec->>'fornecedor_base';
    END IF;

    -- e o sinal negativo tambem e nomeado (fatura do caso 2)
    SELECT recompensas_aplicadas INTO v_rec
      FROM public.invoices i
      JOIN public.consumer_units cu ON cu.id = i.uc_id
      JOIN public.subscribers s ON s.id = cu.subscriber_id
     WHERE s.short_url = 'sandbox://task13/c2';

    IF (v_rec->>'conta_receber_assinante')::numeric IS DISTINCT FROM -250::numeric THEN
        RAISE EXCEPTION 'FALHA caso 6: conta_receber_assinante da fatura normal = %, esperado -250', v_rec->>'conta_receber_assinante';
    END IF;
    IF v_rec->>'conta_receber_sinal' IS DISTINCT FROM 'assinante_adiantado' THEN
        RAISE EXCEPTION 'FALHA caso 6: conta_receber_sinal do saldo negativo = %, esperado assinante_adiantado',
            COALESCE(v_rec->>'conta_receber_sinal', '<nulo>');
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
