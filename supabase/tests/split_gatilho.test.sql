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
--                                   -> lider; desde a I1 de 30/09/2026 (piso
--                                   sobre a TARIFA BRUTA) o teto zera e os
--                                   tres sao drenados por inteiro;
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
-- Fix round 2 (29/09/2026):
--  15.  residuo de arredondamento: valor_a_pagar com mais de duas casas -- a
--       transacao fecha EXATAMENTE em zero, o banco registra o valor recebido
--       e quem absorve a fracao de centavo e a conta a receber do assinante
--       (G1 + Task 13);
--  16.  fatura bloqueada por uc_sem_usina volta a ser lancavel depois que
--       alguem conserta o vinculo -- e so uma vez (G2).
--
-- Task 12 (29/09/2026) -- atualizacao das FIXTURES, nao das assercoes:
--   a base saiu de `valor_a_pagar - valor_concessionaria` e virou
--   `consumo_compensado x (tarifa x (1 - desconto/100) - Fio B)`, com tarifa e
--   Fio B do cadastro da concessionaria. As UCs deste arquivo passaram a ter
--   concessionaria cadastrada (tarifa 1,20 / Fio B 0,20 -> liquida 1,00) e as
--   faturas, consumo_compensado igual a base que tinham antes -- por isso
--   NENHUM numero esperado mudou. As unicas mudancas de assercao sao:
--     * caso 9 usa uma concessionaria de Fio B maior que a tarifa, unico jeito
--       de a formula nova dar base negativa;
--     * caso 15 compara o residuo com caixa_liquido em vez de base, porque
--       base e caixa deixaram de ser o mesmo numero e quem tem de fechar a
--       transacao e o caixa.
--
-- Task 13 (29/09/2026) -- unica assercao tocada: o caso 15. O fornecedor
--   deixou de ser o residual do CAIXA e voltou a ser o residual DA BASE, entao
--   quem absorve a fracao de centavo passou a ser a conta a receber do
--   assinante (1.1.2). Nos demais casos base e caixa sao o mesmo numero (a
--   fixture da Task 12 fez consumo_compensado = base), a diferenca e zero,
--   1.1.2 nao recebe lancamento e NENHUM numero mudou.
--
-- OBS: o caso 14 troca fn_participantes_recompensa DENTRO da transacao, entao
-- ele tem de continuar sendo o ULTIMO caso do arquivo. Casos novos entram
-- ANTES dele.
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
    v_acc_receber     uuid;  -- 1.1.2  (Task 13)

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
    v_plano_p88       uuid;   -- piso 88 -> teto 0 (I1: piso sobre a tarifa bruta)
    v_plano_p95       uuid;   -- piso 95 -> teto 0 (idem)
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
    v_receber         numeric;   -- 1.1.2 (Task 13)
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

    -- fix round 2
    v_residuo         numeric;
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
    SELECT id INTO v_acc_receber    FROM public.ledger_accounts WHERE code = '1.1.2';

    IF v_acc_receber IS NULL THEN
        RAISE EXCEPTION 'FALHA: conta 1.1.2 (Contas a Receber de Assinantes) nao existe no plano de contas';
    END IF;

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
    -- Task 12 (20260929e): a base deixou de ser valor_a_pagar -
    -- valor_concessionaria e passou a ser consumo_compensado x (tarifa x
    -- (1 - desconto/100) - Fio B), com tarifa e Fio B vindos do cadastro da
    -- concessionaria. Para que TODOS os numeros deste arquivo continuem os
    -- mesmos, o cadastro sandbox tem tarifa 1,20 e Fio B 0,20 e os planos nao
    -- tem desconto (0), o que da tarifa liquida 1,00/kWh: cada fatura recebe
    -- consumo_compensado igual a base que ela tinha antes. Quem esta medindo a
    -- DIVISAO nao muda; quem mede a BASE e supabase/tests/split_base_compensada.test.sql.
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX6-C1', 'Sandbox Task6', 'SANDBOX Task6 conc', 'RN', 1.20, 0.20);

    -- Cadastro com Fio B MAIOR que a tarifa: tarifa liquida -0,20/kWh. E o
    -- unico jeito de a formula nova produzir base NEGATIVA, que e o que o
    -- caso 9 (prejuizo compartilhado) precisa medir.
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX6-C2', 'Sandbox Task6 Fio Maior', 'SANDBOX Task6 fio maior', 'RN', 1.00, 1.20);

    -- tipo_recompensa EXPLICITO a partir da Task 11 (20260929d): o default da
    -- coluna e 'start', e em plano 'start' parceiro/lider/Conect so recebem na
    -- fatura elegivel -- nas demais nao recebem nada. Os casos abaixo testam a
    -- RECORRENCIA, entao o plano tem de dizer que e recorrente; sem isso eles
    -- passariam a medir o caminho errado.
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 piso50', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano;

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 piso88', 'recorrente', 10, 88, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano_p88;

    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 piso95', 'recorrente', 10, 95, jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano_p95;

    -- caso 8: plano RECORRENTE com start_config preenchido -- a elegibilidade
    -- da fatura e detectada e congelada, mas o Start nao se aplica neste tipo
    -- de plano (a aplicacao em plano start/hibrido e coberta por
    -- supabase/tests/split_bonus_start.test.sql).
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX Task6 start', 'recorrente', 10, 50, jsonb_build_object('regras_multinivel', c_matriz),
            '{"faturas_elegiveis": [1],
              "regras": {"1": {"b2w": 0, "lider": 50, "ppe": 50, "ppp": 40, "ppf": 20, "assinante_conect": 0}}}'::jsonb)
    RETURNING id INTO v_plano_start;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Task6 Lider', 'lider', true) RETURNING id INTO v_lider;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX Task6 PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
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
    --   base 1000; I1 (30/09/2026) -- o piso incide sobre a TARIFA BRUTA:
    --     piso em R$ = 1000 kWh x 1,20 x 50/100 = 600,00
    --     teto       = GREATEST(round(1000,2) - 600,00, 0) = 400,00
    --   (com a formula antiga, base x (1 - 50/100), o teto era 500)
    --   bruto 160 (100 + 50 + 10) cabe nos 400 -> nada e cortado
    --   3.1.1 = -100 | 2.1.2 = -(50 + 10) = -60 | 2.1.6 = 0 | 2.1.1 = -840
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c1') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
    IF (v_rec->>'base')::numeric <> 1000 OR (v_rec->>'teto_deducao')::numeric <> 400 THEN
        RAISE EXCEPTION 'FALHA caso 1: base=% teto_deducao=% (esperado 1000 / 400 = base 1000 - piso 600, com o piso de 50%% sobre a tarifa bruta de 1,20)',
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
    --   base 1000, teto 400 (piso de 50% sobre a tarifa bruta de 1,20);
    --   bruto 140 (100 + 20 + 20) cabe -> nada e cortado
    --   3.1.1 = -100 | 2.1.2 = -20 | 2.1.6 = -20 | 2.1.1 = -860
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task6/c2-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe2, 'ativo', 'sandbox://task6/c2', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_sem_plano, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
    -- CASO 5 -- piso furado (piso 88%).
    --   I1 (30/09/2026) -- o piso incide sobre a TARIFA BRUTA:
    --     piso em R$ = round(1000 kWh x 1,20 x 88/100, 2) = 1.056,00
    --     teto       = GREATEST(round(1000,2) - 1.056,00, 0) = 0,00
    --   Um piso de 88% da tarifa BRUTA nao cabe numa base que e so 83,33% da
    --   tarifa bruta (1,00 de 1,20), entao o teto zera: acima de 83,33% de
    --   piso NADA pode ser deduzido. Com a formula antiga o teto era 120 e
    --   sobrava espaco -- era exatamente essa a calibracao errada da trava.
    --   Ha indicacao, entao o parceiro esta no NIVEL 2 (PPE L2 = 2%) e o
    --   lider tambem (L2 = 1%); o Conect e sempre nivel 1 (2%).
    --   bruto: B2W 100 + PPE 20 + Lider 10 + Conect 20 = 150
    --   excesso 150 -> a ordem Conect -> Parceiro Power -> Lider drena os tres
    --   por inteiro: Conect 20, parceiro 20, lider 10 = corte_aplicado 50.
    --   Sobram 100 de excesso que o motor nao pode cortar, porque a B2W nunca
    --   e alvo -> total_deduzido 100 e teto_estourado = true.
    --   3.1.1 = -100 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -(1000 - 100) = -900
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task6/c5-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c5', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_p88, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
        RAISE EXCEPTION 'FALHA caso 5 (piso 88%%): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / 0 / 0 / -900 -- teto 0, os tres beneficiarios sao drenados por inteiro e so a B2W sobrevive)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- o teto novo e ZERO: nada pode ser deduzido alem do que a B2W leva
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 5: teto_deducao = %, esperado 0 (base 1000 - piso 1056, com o piso de 88%% sobre a tarifa bruta de 1,20)',
            v_rec->>'teto_deducao';
    END IF;

    -- quanto foi cortado, no total: os 150 de bruto menos os 100 da B2W, que
    -- nunca e alvo do corte.
    IF (v_rec->'resultado'->>'corte_aplicado')::numeric IS DISTINCT FROM 50::numeric THEN
        RAISE EXCEPTION 'FALHA caso 5: corte_aplicado = %, esperado 50 (Conect 20 + parceiro 20 + lider 10)',
            v_rec->'resultado'->>'corte_aplicado';
    END IF;
    IF (v_rec->'resultado'->>'total_deduzido')::numeric IS DISTINCT FROM 100::numeric THEN
        RAISE EXCEPTION 'FALHA caso 5: total_deduzido = %, esperado 100 (so a fatia da B2W sobrevive ao corte)',
            v_rec->'resultado'->>'total_deduzido';
    END IF;

    -- ordem do corte, no congelamento: Conect primeiro, depois o Parceiro
    -- Power, depois o Lider -- e com teto 0 os tres perdem TUDO.
    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'assinante_conect';
    IF (v_ben->>'cortado')::numeric <> 20 OR (v_ben->>'valor')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: Conect e o 1o da ordem e devia ser cortado inteiro (20), veio %', v_ben;
    END IF;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'ppe';
    IF (v_ben->>'cortado')::numeric <> 20 OR (v_ben->>'valor')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: o Parceiro Power e o 2o da ordem e devia ser cortado inteiro (20), veio %', v_ben;
    END IF;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'lider';
    IF (v_ben->>'cortado')::numeric <> 10 OR (v_ben->>'valor')::numeric <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: o Lider e o 3o e ULTIMO da ordem e, com teto 0, tambem perde tudo (10), veio %', v_ben;
    END IF;

    IF (v_rec->'resultado'->>'teto_estourado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 5: teto_estourado = %, esperado true (com teto 0 a B2W sozinha ja passa, e ela nunca e cortada)',
            v_rec->'resultado'->>'teto_estourado';
    END IF;

    -- ==================================================================
    -- CASO 5b -- piso 95%: bruto 150 (mesma montagem do caso 5), excesso 150:
    --            corta Conect 20, parceiro 20 e lider 10 -- e ainda estoura,
    --            porque a B2W (100) nunca e alvo do corte.
    --   I1 (30/09/2026): piso em R$ = round(1000 x 1,20 x 95/100, 2) = 1.140,00
    --   e teto = GREATEST(1000 - 1.140, 0) = 0,00 (antes o teto era 50).
    --   ATENCAO: com o piso sobre a TARIFA BRUTA qualquer piso acima de
    --   83,33% zera o teto, entao 88% (caso 5) e 95% (caso 5b) produzem hoje
    --   exatamente o mesmo resultado -- este caso deixou de ser um degrau
    --   diferente do anterior. Mantido como esta porque o piso da fixture e
    --   dado; quem quiser um corte PARCIAL de novo precisa de um piso abaixo
    --   de 83,33% (o caso novo da Cosern, em
    --   supabase/tests/split_piso_tarifa_bruta.test.sql, cobre isso).
    --   3.1.1 = -100 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -900
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task6/c5b-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c5b', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_p95, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 5b: teto_deducao = %, esperado 0 (base 1000 - piso 1140, com o piso de 95%% sobre a tarifa bruta de 1,20)',
            v_rec->>'teto_deducao';
    END IF;
    IF (v_rec->'resultado'->>'corte_aplicado')::numeric IS DISTINCT FROM 50::numeric THEN
        RAISE EXCEPTION 'FALHA caso 5b: corte_aplicado = %, esperado 50 (Conect 20 + parceiro 20 + lider 10; os 100 restantes sao da B2W, que nunca e cortada)',
            v_rec->'resultado'->>'corte_aplicado';
    END IF;
    IF (v_rec->'resultado'->>'teto_estourado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 5b: teto_estourado = %, esperado true (a B2W sozinha ja passa do teto)',
            v_rec->'resultado'->>'teto_estourado';
    END IF;

    -- ==================================================================
    -- CASO 6 -- UC geradora: nada, como hoje.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c6') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, fatura_consumo_terceiro, concessionaria, address)
    VALUES (v_sub, v_usina, 'geradora', 'ativo', false, 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
    --   valor_a_pagar 1000, concessionaria 300, 700 kWh compensados -> base 700
    --   1.1.1.01 = 1000 - 1.99 = 998.01 | 4.1.1 = 1.99 | 2.1.3.01 = -300
    --   B2W 70 | PPE 35 | Lider 7 | fornecedor 588
    --   Task 12: os 300 da concessionaria continuam lancados em 2.1.3.01 como
    --   obrigacao separada, mas NAO abatem mais a base -- a base e a energia
    --   compensada. Task 13: o fornecedor e o residual DA BASE,
    --   700 - 70 - 42 = 588; aqui base e caixa coincidem (1000 - 300 = 700),
    --   entao o numero e o mesmo das duas formas e 1.1.2 nao lanca nada.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c7') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, asaas_payment_id, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 300, CURRENT_DATE + 5, 'pay_sandbox_task6', 700) RETURNING id INTO v_inv;

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
        RAISE EXCEPTION 'FALHA caso 7: o rateio sobre a energia compensada (700 kWh x 1,00) mudou: 3.1.1=% 2.1.2=% 2.1.1=% (esperado -70 / -42 / -588)',
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
    -- CASO 8 -- bonus Start: a 1a fatura paga da UC e elegivel pelo plano,
    --   mas o plano e do tipo 'recorrente' -- e nesse tipo o Start NAO existe
    --   (decisao do dono, 29/09/2026, Task 11). O gatilho REGISTRA a
    --   elegibilidade de calendario e APLICA A RECORRENCIA -- por isso 3.1.1
    --   tem de continuar -100 (10%), nunca 0 (b2w do start_config).
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c8') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_start, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.aplicado = %, esperado false (plano tipo_recompensa=recorrente ignora o start_config)',
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
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35, 1000) RETURNING id INTO v_inv;

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
    --   1000 kWh compensados na concessionaria de Fio B maior que a tarifa
    --   (1,00 - 1,20 = -0,20/kWh) -> base -200. Com a base da Task 12 e esse o
    --   unico caminho para base negativa: cadastro em que o Fio B supera a
    --   tarifa com desconto. valor_a_pagar 100 e concessionaria 300 deixam o
    --   caixa tambem em -200, entao os lancamentos sao os mesmos de antes.
    --   Decisao do dono de 18/08/2026, RECONFIRMADA em 28/09/2026: a B2W
    --   absorve a fatia dela do prejuizo; parceiro/lider/Conect nao recebem
    --   nada (percentual de base negativa nao e recompensa).
    --   Fatia da B2W = 10% de -200 = -20 (NEGATIVA no congelamento); no razao
    --   sai com o sinal invertido, como toda receita, logo 3.1.1 = +20.
    --   Fornecedor = -200 - (-20) = -180 -> 2.1.1 = +180.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c9') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 fio maior', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 100, 300, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
    --   Task 12: sem consumo_compensado a base tambem e 0 (caminho
    --   sem_compensacao), e o caixa tambem e 0 -- o fornecedor fica com nada.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c11') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', NULL, 0, CURRENT_DATE + 5, NULL) RETURNING id INTO v_inv;

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

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, NULL, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_nula, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
    -- CASO 15 -- RESIDUO DE ARREDONDAMENTO (achado G1).
    --   invoices.valor_a_pagar e numeric SEM escala: 38 das 96 faturas reais
    --   tem mais de duas casas. Com valor_a_pagar 371,36480000000006 e
    --   concessionaria 196,62 a base e 174,74480000000006, e o motor arredonda
    --   a base na entrada (174,74). Antes do fix os 0,0048 abaixo do centavo
    --   ficavam sem contrapartida e a transacao fechava em +0,0048 --
    --   lancamento orfao, exatamente o que o Global Constraint do razao
    --   proibe. Agora quem absorve o residuo e o FORNECEDOR: o banco continua
    --   registrando o dinheiro que entrou de verdade e a B2W e os
    --   beneficiarios continuam com duas casas.
    --   Montagem igual a do caso 1 (rateio padrao: PPE com lider, piso 50).
    --   Task 12: a base agora vem de 174,7448 kWh compensados x 1,00, e o
    --   residuo que tem de ser absorvido passou a ser o do CAIXA
    --   (valor_a_pagar - valor_concessionaria), que e quem fecha a transacao.
    --   Por isso a assercao (e) compara com caixa_liquido, nao com a base.
    --   Task 13: quem absorve o residuo deixou de ser o FORNECEDOR e passou a
    --   ser a CONTA A RECEBER DO ASSINANTE (1.1.2). Com a base arredondada
    --   pelo motor (174,74):
    --     3.1.1 = -17,47 | 2.1.2 = -(8,74 + 1,75) = -10,49
    --     2.1.1 = -(174,74 - 17,47 - 10,49) = -146,78 (duas casas exatas)
    --     1.1.2 = 174,74 - 174,74480000000006 = -0,00480000000006
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c15') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 371.36480000000006, 196.62, CURRENT_DATE + 5, 174.7448) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 15: a fatura com centavos quebrados nao gerou lancamento nenhum';
    END IF;

    -- a) a transacao fecha EXATAMENTE em zero, sem tolerancia nenhuma
    SELECT COALESCE(SUM(amount), 0) INTO v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 15 (residuo): a transacao nao fecha em zero, soma = % -- o residuo abaixo do centavo ficou orfao no razao', v_total;
    END IF;

    -- b) o razao registra o DINHEIRO QUE ENTROU, nao uma versao arredondada
    SELECT amount INTO v_bank
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_bank
       AND description = 'Recebimento Fatura ' || v_inv;
    IF v_bank IS DISTINCT FROM 371.36480000000006::numeric THEN
        RAISE EXCEPTION 'FALHA caso 15: o recebimento no banco veio %, esperado 371.36480000000006 (o razao registra o valor recebido, nunca uma versao arredondada)', v_bank;
    END IF;

    -- c) gestao da B2W e recompensas nunca ficam com fracao de centavo
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn
       AND account_id IN (v_acc_gestao, v_acc_comissoes, v_acc_conect)
       AND amount <> round(amount, 2);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 15: % lancamento(s) de gestao/recompensa com mais de duas casas -- o residuo foi parar em quem nao devia absorve-lo', v_n;
    END IF;

    -- d) Task 13: o fornecedor recebe o residual DA BASE, com duas casas
    --    exatas, e quem carrega a fracao de centavo e a conta a receber do
    --    assinante (1.1.2), num lancamento so.
    SELECT amount INTO v_forn
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_investidor;
    IF v_forn IS DISTINCT FROM -146.78::numeric THEN
        RAISE EXCEPTION 'FALHA caso 15: 2.1.1 = %, esperado -146.78 (residual da base 174,74 menos 17,47 de gestao e 10,49 de recompensas) -- o fornecedor nao pode carregar o residuo do caixa', v_forn;
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 15: a conta 1.1.2 recebeu % lancamento(s), esperado exatamente 1 (quem absorve o residuo e um lancamento so)', v_n;
    END IF;

    SELECT amount INTO v_receber
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_receber = round(v_receber, 2) THEN
        RAISE EXCEPTION 'FALHA caso 15: o saldo do assinante (%) nao carrega o residuo -- alguem tem de absorve-lo para a soma fechar em zero exato', v_receber;
    END IF;
    IF v_receber IS DISTINCT FROM (174.74::numeric - (371.36480000000006::numeric - 196.62::numeric)) THEN
        RAISE EXCEPTION 'FALHA caso 15: 1.1.2 = %, esperado base arredondada - caixa = 174.74 - 174.74480000000006', v_receber;
    END IF;

    -- e) o congelamento tem de dizer quanto de residuo foi absorvido E POR
    --    QUEM (Task 13: a chave residuo_fornecedor virou residuo_caixa +
    --    residuo_absorvido_por, porque o fornecedor nao absorve mais nada)
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'residuo_caixa' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 15: recompensas_aplicadas.residuo_caixa nao foi congelado';
    END IF;
    v_residuo := (v_rec->>'residuo_caixa')::numeric;
    IF v_rec->>'caixa_liquido' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 15: o congelamento precisa guardar caixa_liquido -- desde a Task 12 ele nao e mais igual a base';
    END IF;
    IF v_residuo = 0 THEN
        RAISE EXCEPTION 'FALHA caso 15: residuo_caixa congelado = 0, mas o caixa (%) tem mais de duas casas', v_rec->>'caixa_liquido';
    END IF;
    IF v_residuo IS DISTINCT FROM ((v_rec->>'caixa_liquido')::numeric - round((v_rec->>'caixa_liquido')::numeric, 2)) THEN
        RAISE EXCEPTION 'FALHA caso 15: residuo_caixa = %, esperado caixa_liquido - round(caixa_liquido,2) (caixa congelado = %)',
            v_residuo, v_rec->>'caixa_liquido';
    END IF;
    IF v_rec->>'residuo_absorvido_por' IS DISTINCT FROM 'conta_receber_assinante' THEN
        RAISE EXCEPTION 'FALHA caso 15: residuo_absorvido_por = %, esperado conta_receber_assinante -- o investidor nao absorve mais a fracao de centavo',
            COALESCE(v_rec->>'residuo_absorvido_por', '<nulo>');
    END IF;
    IF (v_rec->>'conta_receber_assinante')::numeric IS DISTINCT FROM v_receber THEN
        RAISE EXCEPTION 'FALHA caso 15: conta_receber_assinante congelado = %, mas o razao lancou % em 1.1.2',
            v_rec->>'conta_receber_assinante', v_receber;
    END IF;

    -- ==================================================================
    -- CASO 16 -- FATURA BLOQUEADA volta a ser lancavel (achado G2).
    --   UC sem usina bloqueia a transacao inteira e congela lancado:false.
    --   Antes do fix a trava de dupla execucao olhava so "existe
    --   recompensas_aplicadas" e prendia a fatura PARA SEMPRE: depois de
    --   alguem consertar o vinculo da UC, a passagem por 'pago' era recusada
    --   e o dinheiro recebido nunca chegava ao razao (banco, gestao e repasse
    --   todos ausentes), sem saida a nao ser SQL na mao. Agora a trava olha o
    --   campo 'lancado': bloqueia o que foi lancado de fato e solta o que
    --   ficou congelado como nao lancado -- e uma vez so.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task6/c16') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, NULL, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

    -- 1) primeira passagem por 'pago': bloqueada, nada no razao
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 16: UC sem usina lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'uc_sem_usina' THEN
        RAISE EXCEPTION 'FALHA caso 16: motivo = %, esperado uc_sem_usina', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;
    IF (v_rec->>'lancado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 16: lancado = %, esperado false', COALESCE(v_rec->>'lancado', '<nulo>');
    END IF;

    -- 2) alguem conserta o vinculo da UC
    UPDATE public.consumer_units SET usina_id = v_usina WHERE id = v_uc;

    -- 3) a fatura volta a passar por 'pago'
    UPDATE public.invoices SET status = 'a_vencer' WHERE id = v_inv;
    UPDATE public.invoices SET status = 'pago'     WHERE id = v_inv;

    -- 4) agora a transacao COMPLETA tem de ter sido lancada
    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 16: consertado o vinculo da UC, a fatura continuou presa -- dinheiro recebido e nunca lancado';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_bank AND amount > 0), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_bank, v_gestao, v_com, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_bank, v_gestao, v_com, v_forn) IS DISTINCT FROM (1000::numeric, -100::numeric, -60::numeric, -840::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 16: a transacao relancada veio incompleta: 1.1.1.01=% 3.1.1=% 2.1.2=% 2.1.1=% (esperado 1000 / -100 / -60 / -840)',
            v_bank, v_gestao, v_com, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 16: a transacao relancada nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF (v_rec->>'lancado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 16: depois do relancamento lancado = %, esperado true', COALESCE(v_rec->>'lancado', '<nulo>');
    END IF;
    IF v_rec->>'motivo' IS DISTINCT FROM 'recorrencia' THEN
        RAISE EXCEPTION 'FALHA caso 16: depois do relancamento motivo = %, esperado recorrencia', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- 5) destravada nao quer dizer relancavel sempre: a TERCEIRA passagem por
    --    'pago' ja encontra lancado:true e nao pode duplicar nada.
    UPDATE public.invoices SET status = 'a_vencer' WHERE id = v_inv;
    UPDATE public.invoices SET status = 'pago'     WHERE id = v_inv;

    SELECT COUNT(DISTINCT transaction_id) INTO v_n
      FROM public.ledger_entries WHERE reference_id = v_inv AND reference_type = 'invoice';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 16: depois de destravada, a fatura gerou % transacoes no razao, esperado 1', v_n;
    END IF;

    -- ==================================================================
    -- CASO 14 -- papel que o PLANO paga e o razao nao tem conta: estoura.
    --   Precisa de percentual > 0: papel com valor 0 e pulado antes da
    --   guarda, entao um plano "orfao" paga 3% a um papel inexistente.
    --   fn_participantes_recompensa e trocada DENTRO desta transacao (some no
    --   rollback) -- por isso este e o ULTIMO caso do arquivo.
    -- ==================================================================
    INSERT INTO public.planos_assinatura_energia (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config)
    VALUES ('SANDBOX Task6 papel orfao', 'recorrente', 10, 50,
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

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_orfao, 'consumidora', 'ativo', 'SANDBOX Task6 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv;

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
