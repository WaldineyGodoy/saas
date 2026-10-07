-- Teste: BASE DA RECOMPENSA SOBRE A ENERGIA COMPENSADA (Task 12 do Split de
-- Pagamentos, decisao do dono de 29/09/2026).
--
-- Ate a Task 11 a base era `valor_a_pagar - valor_concessionaria`. Essa conta
-- abate da recompensa a conta INTEIRA da concessionaria -- iluminacao publica,
-- parcelamento e consumo nao compensado -- e por isso zerava ou negativava a
-- base em 25 das 60 faturas pagas que TINHAM compensacao (R$ 29.068,33 de
-- receita de compensada pagando zero de recompensa). O dono decidiu:
--   "as comissoes serao sobre a energia compensada. Se houve energia
--    compensada a comissao e devida, mesmo que a conta do assinante esteja
--    zerada ou negativa devido a outros debitos, como parcelamentos, IP, e
--    consumo excedente que nao foi compensado."
--
-- FORMULA:
--   base = consumo_compensado * (tarifa * (1 - desconto_pct/100) - fio_b)
--
-- FONTES (e nenhuma outra):
--   * kWh          -> invoices.consumo_compensado;
--   * tarifa/Fio B -> cadastro da concessionaria (tabela "Concessionaria"),
--                     resolvido por concessionaria da UC (+ UF do endereco,
--                     quando houver) e pela CLASSE (colunas base = B1, e as
--                     variantes _B2 / _B3 / _A);
--   * desconto     -> o plano (planos_assinatura_energia.desconto_assinante),
--                     que e a fonte de desconto desde a Task 3.
--   NUNCA invoices.fio_b_apurado (zero nas 60 faturas pagas) nem
--   invoices.tarifa_concessionaria (ausente em 40 delas).
--
-- O que este teste cobra:
--   0.  fn_base_recompensa_fatura existe, e SECURITY DEFINER, dona postgres,
--       search_path fixo, e devolve base + os componentes usados;
--   1.  resolucao de tarifa/Fio B pela concessionaria da UC, com varias linhas
--       de municipio e um unico valor (o caso real da Cosern: 143 linhas);
--   2.  a base aplica o desconto DO PLANO sobre a tarifa, e o Fio B depois:
--       1000 kWh x (1,25 x 0,80 - 0,25) = 750,00;
--   3.  O CASO DAS 25: fatura COM compensacao e conta da concessionaria MAIOR
--       que a cobranca -> paga recompensa normalmente (com a base antiga isso
--       era base -200 e nao pagava nada);
--   4.  fatura SEM compensacao -> base zero, ninguem recebe, e o motivo fica
--       gravado (nao se inventa base);
--   5.  concessionaria NAO cadastrada -> bloqueia como uc_sem_usina: nada no
--       razao e motivo gravado na fatura;
--   6.  concessionaria cadastrada com Fio B nulo -> bloqueia (um Fio B
--       faltando vira comissao inflada);
--   7.  concessionaria com tarifa zero -> bloqueia;
--   8.  duas linhas da mesma concessionaria com valores DISTINTOS -> bloqueia
--       por ambiguidade; nunca escolhe uma por "limit 1"/moda;
--   9.  classe da UC manda: usina em "B3 Comercial" usa as colunas _B3;
--  10.  classe cujas colunas estao ZERADAS no cadastro (B2 na Cosern real)
--       -> bloqueia, nao calcula com zero em silencio;
--  11.  congelamento: base, formula, kWh, tarifa, Fio B e desconto usados;
--  12.  a conta da concessionaria continua lancada em 2.1.3.01 como obrigacao
--       separada, e a soma da transacao fecha em ZERO EXATO, inclusive com
--       valor_a_pagar de mais de duas casas.
--
-- Task 13 (29/09/2026) -- atualizacao das ASSERCOES DO LADO DO RAZAO, nao do
-- assunto deste arquivo. A base (energia compensada) e os bloqueios de
-- cadastro continuam exatamente iguais; o que mudou foi QUEM absorve a
-- diferenca entre a base e o caixa. Na Task 12 era o fornecedor (2.1.1 =
-- residual do CAIXA); por decisao do dono passou a ser o assinante, na conta
-- nova 1.1.2, e o fornecedor voltou a ser o residual DA BASE. Cada numero de
-- 2.1.1 que mudou esta anotado no caso correspondente, e cada caso ganhou a
-- assercao de 1.1.2 que faltava -- nenhuma assercao foi afrouxada.
--
-- Rodar pelo MCP execute_sql. Sucesso = erro 'SANDBOX_OK' (tudo desfeito).

DO $$
DECLARE
    -- plano de contas
    v_acc_bank        uuid;  -- 1.1.1.01
    v_acc_taxa        uuid;  -- 4.1.1
    v_acc_gestao      uuid;  -- 3.1.1
    v_acc_investidor  uuid;  -- 2.1.1
    v_acc_receber     uuid;  -- 1.1.2 (Task 13)
    v_acc_comissoes   uuid;  -- 2.1.2
    v_acc_conces      uuid;  -- 2.1.3.01
    v_acc_conect      uuid;  -- 2.1.6

    -- catalogo
    v_secdef          boolean;
    v_dona            text;
    v_config          text;

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

    v_usina_b1        uuid;
    v_usina_b3        uuid;
    v_usina_b2        uuid;

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

    v_rec             jsonb;
    v_base            jsonb;
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
    SELECT id INTO v_acc_receber    FROM public.ledger_accounts WHERE code = '1.1.2';

    IF v_acc_bank IS NULL OR v_acc_gestao IS NULL OR v_acc_comissoes IS NULL
       OR v_acc_investidor IS NULL OR v_acc_conces IS NULL OR v_acc_conect IS NULL
       OR v_acc_receber IS NULL THEN
        RAISE EXCEPTION 'FALHA: plano de contas incompleto para rodar o teste';
    END IF;

    -- ==================================================================
    -- CASO 0 -- a funcao de base existe e tem as propriedades que a
    --   permitem ser chamada de dentro do gatilho.
    -- ==================================================================
    IF to_regprocedure('public.fn_base_recompensa_fatura(uuid)') IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 0: fn_base_recompensa_fatura(uuid) nao existe -- a base da Task 12 tem de morar numa funcao isolada e testavel';
    END IF;

    SELECT p.prosecdef, pg_get_userbyid(p.proowner), COALESCE(p.proconfig::text, '')
      INTO v_secdef, v_dona, v_config
      FROM pg_proc p WHERE p.oid = 'public.fn_base_recompensa_fatura(uuid)'::regprocedure;

    IF NOT v_secdef THEN
        RAISE EXCEPTION 'FALHA caso 0: fn_base_recompensa_fatura nao e SECURITY DEFINER';
    END IF;
    IF v_dona <> 'postgres' THEN
        RAISE EXCEPTION 'FALHA caso 0: dona de fn_base_recompensa_fatura e %, esperado postgres', v_dona;
    END IF;
    IF v_config NOT LIKE '%search_path=public, pg_temp%' THEN
        RAISE EXCEPTION 'FALHA caso 0: search_path de fn_base_recompensa_fatura nao esta fixo: %', v_config;
    END IF;

    -- o gatilho tem de usar a funcao nova, e NAO pode mais calcular a base
    -- como valor_a_pagar - valor_concessionaria. Comentarios sao descartados
    -- de proposito (o corpo novo cita a formula antiga para explicar o que
    -- mudou).
    SELECT COALESCE(string_agg(l, E'\n'), '')
      INTO v_config
      FROM unnest(string_to_array(
             pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure), E'\n')) l
     WHERE l !~ '^\s*--';

    IF v_config NOT ILIKE '%fn_base_recompensa_fatura%' THEN
        RAISE EXCEPTION 'FALHA caso 0: handle_invoice_paid_ledger nao chama fn_base_recompensa_fatura';
    END IF;

    -- ------------------------------------------------------------------
    -- fixture: cadastro da concessionaria
    -- ------------------------------------------------------------------
    -- (a) cadastro bom, em DUAS linhas de municipio com o MESMO valor -- e o
    --     formato real: Neoenergia Cosern tem 143 linhas e um unico valor.
    --     B1 (colunas base): tarifa 1,25 e Fio B 0,25
    --     B3:                tarifa 1,00 e Fio B 0,10
    --     B2:                ZERADO, como a Cosern real
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF",
         "Tarifa Concessionaria", "Fio B",
         "Tarifa Concessionaria_B3", "Fio B_B3",
         "Tarifa Concessionaria_B2", "Fio B_B2")
    VALUES
        ('SBX12-A1', 'Sandbox do Norte', 'SANDBOX Task12 OK', 'RN', 1.25, 0.25, 1.00, 0.10, 0, 0),
        ('SBX12-A2', 'Sandbox do Sul',   'SANDBOX Task12 OK', 'RN', 1.25, 0.25, 1.00, 0.10, 0, 0);

    -- (b) cadastro com Fio B NULO: um Fio B faltando vira comissao inflada
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX12-B1', 'Sandbox sem Fio', 'SANDBOX Task12 SEM FIO B', 'RN', 1.25, NULL);

    -- (c) cadastro com tarifa ZERO
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX12-C1', 'Sandbox sem Tarifa', 'SANDBOX Task12 TARIFA ZERO', 'RN', 0, 0.25);

    -- (d) cadastro AMBIGUO: duas linhas, dois valores de tarifa
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES
        ('SBX12-D1', 'Sandbox Ambigua A', 'SANDBOX Task12 AMBIGUA', 'RN', 1.25, 0.25),
        ('SBX12-D2', 'Sandbox Ambigua B', 'SANDBOX Task12 AMBIGUA', 'RN', 1.50, 0.25);

    -- ------------------------------------------------------------------
    -- fixture: plano, originadores e usinas
    -- ------------------------------------------------------------------
    -- tipo_recompensa 'recorrente' EXPLICITO: o default da coluna e 'start' e
    -- plano start nao paga recorrencia fora da fatura elegivel (Task 11).
    -- desconto_assinante 20: e o PLANO a fonte do desconto desde a Task 3.
    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX Task12 plano', 'recorrente', 10, 50, 20,
            jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Task12 Lider', 'lider', true) RETURNING id INTO v_lider;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX Task12 PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.usinas (plano_usina_id, grupo_tarifario)
    VALUES (pg_temp.pu(v_plano), 'B1 Residencial') RETURNING id INTO v_usina_b1;

    INSERT INTO public.usinas (plano_usina_id, grupo_tarifario)
    VALUES (pg_temp.pu(v_plano), 'B3 Comercial') RETURNING id INTO v_usina_b3;

    INSERT INTO public.usinas (plano_usina_id, grupo_tarifario)
    VALUES (pg_temp.pu(v_plano), 'B2 Rural') RETURNING id INTO v_usina_b2;

    -- ==================================================================
    -- CASO 1 + 2 + 11 -- base = kWh x (tarifa x (1 - desconto) - Fio B),
    --   com tarifa e Fio B vindos do cadastro e desconto vindo do plano.
    --     1000 kWh x (1,25 x 0,80 - 0,25) = 1000 x 0,75 = 750,00
    --   valor_a_pagar 1000 e concessionaria 0 -> caixa 1000
    --     3.1.1 = -75 (10%% de 750) | 2.1.2 = -(37,50 + 7,50) = -45
    --     2.1.1 = -(750 - 75 - 45) = -630   <- Task 13
    --     1.1.2 = 750 - 1000 = -250 (o assinante pagou mais que a base)
    --   (com a base antiga -- caixa 1000 -- seriam -100 / -60 / -840; na Task
    --    12, com o fornecedor no residual do CAIXA, 2.1.1 era -880 e nao havia
    --    1.1.2 -- o investidor levava 250 que sao saldo do assinante)
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c1') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    -- 0b) a funcao isolada, antes de qualquer lancamento
    v_base := public.fn_base_recompensa_fatura(v_inv);
    IF v_base IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: fn_base_recompensa_fatura devolveu NULL';
    END IF;
    IF (v_base->>'ok')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 1: fn_base_recompensa_fatura recusou um cadastro completo: %', v_base;
    END IF;
    IF (v_base->>'base')::numeric IS DISTINCT FROM 750::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: base = %, esperado 750 (1000 kWh x (1,25 x 0,80 - 0,25)); componentes: %',
            v_base->>'base', v_base;
    END IF;
    IF (v_base->>'kwh_compensado')::numeric IS DISTINCT FROM 1000::numeric
       OR (v_base->>'tarifa')::numeric IS DISTINCT FROM 1.25::numeric
       OR (v_base->>'fio_b')::numeric IS DISTINCT FROM 0.25::numeric
       OR (v_base->>'desconto_pct')::numeric IS DISTINCT FROM 20::numeric THEN
        RAISE EXCEPTION 'FALHA caso 11: os componentes da base vieram errados: kwh=% tarifa=% fio_b=% desconto=%',
            v_base->>'kwh_compensado', v_base->>'tarifa', v_base->>'fio_b', v_base->>'desconto_pct';
    END IF;
    IF v_base->>'classe' IS DISTINCT FROM 'B1 Residencial' THEN
        RAISE EXCEPTION 'FALHA caso 1: classe resolvida = %, esperado B1 Residencial', COALESCE(v_base->>'classe', '<nula>');
    END IF;
    IF v_base->>'formula' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 11: a funcao precisa devolver a formula usada, para o investidor auditar';
    END IF;

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
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn, v_receber)
       IS DISTINCT FROM (-75::numeric, -45::numeric, 0::numeric, -630::numeric, -250::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 2: 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% 1.1.2=% (esperado -75 / -45 / 0 / -630 / -250 -- base 750 da compensada, nao 1000 do caixa; o fornecedor e o residual da BASE e a diferenca e saldo do assinante)',
            v_gestao, v_com, v_conect, v_forn, v_receber;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- congelamento (CASO 11)
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 11: recompensas_aplicadas ficou NULL';
    END IF;
    IF (v_rec->>'base')::numeric IS DISTINCT FROM 750::numeric THEN
        RAISE EXCEPTION 'FALHA caso 11: base congelada = %, esperado 750', v_rec->>'base';
    END IF;
    IF v_rec->>'base_formula' NOT ILIKE '%compensad%' THEN
        RAISE EXCEPTION 'FALHA caso 11: base_formula congelada = %, tem de descrever a formula da energia compensada',
            COALESCE(v_rec->>'base_formula', '<nula>');
    END IF;
    IF v_rec->'base_componentes' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 11: o congelamento precisa guardar base_componentes (kWh, tarifa, Fio B e desconto usados naquele dia)';
    END IF;
    IF (v_rec->'base_componentes'->>'kwh_compensado')::numeric IS DISTINCT FROM 1000::numeric
       OR (v_rec->'base_componentes'->>'tarifa')::numeric IS DISTINCT FROM 1.25::numeric
       OR (v_rec->'base_componentes'->>'fio_b')::numeric IS DISTINCT FROM 0.25::numeric
       OR (v_rec->'base_componentes'->>'desconto_pct')::numeric IS DISTINCT FROM 20::numeric THEN
        RAISE EXCEPTION 'FALHA caso 11: base_componentes congelado errado: %', v_rec->'base_componentes';
    END IF;
    -- I1 (30/09/2026): o piso incide sobre a TARIFA BRUTA, nao sobre a base.
    --   piso em R$ = 1000 kWh x 1,25 (tarifa bruta) x 50/100 = 625,00
    --   teto       = GREATEST(round(750, 2) - 625,00, 0) = 125,00
    -- Com a formula antiga (base x (1 - 50/100)) o teto era 375 -- mais que o
    -- dobro do contratual, porque a base ja vem liquida de desconto e Fio B.
    -- O rateio deste caso soma 120 (75 + 37,50 + 7,50 = 16%% da base) e por
    -- 5,00 ainda cabe no teto novo: nada e cortado e os lancamentos nao mudam.
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM 125::numeric THEN
        RAISE EXCEPTION 'FALHA caso 11: teto_deducao = %, esperado 125 (base 750 - piso 625 = 1000 kWh x 1,25 x 50%%)', v_rec->>'teto_deducao';
    END IF;

    -- ==================================================================
    -- CASO 3 -- O CASO DAS 25: houve compensacao e a conta da
    --   concessionaria e MAIOR que a cobranca do assinante.
    --   valor_a_pagar 100, valor_concessionaria 300, 1000 kWh compensados.
    --   Base antiga: 100 - 300 = -200 -> prejuizo compartilhado, ninguem
    --   recebia. Base nova: 750 -> a recompensa e devida.
    --     2.1.3.01 = -300 (a conta continua lancada, so nao abate a base)
    --     3.1.1 = -75 | 2.1.2 = -45
    --     2.1.1 = -(750 - 75 - 45) = -630  <- Task 13: o fornecedor e o
    --             residual DA BASE e RECEBE; na Task 12 ele era o residual do
    --             caixa (+320), ou seja, era DEBITADO dos R$ 950 de
    --             parcelamento/IP/consumo nao compensado, que sao do assinante
    --     1.1.2 = 750 - (100 - 300) = +950 (o assinante DEVE esse saldo)
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c3') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 100, 300, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 3: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conces), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_conces, v_gestao, v_com, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_conces, v_gestao, v_com, v_forn, v_receber)
       IS DISTINCT FROM (-300::numeric, -75::numeric, -45::numeric, -630::numeric, 950::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 3 (o caso das 25): 2.1.3.01=% 3.1.1=% 2.1.2=% 2.1.1=% 1.1.2=% (esperado -300 / -75 / -45 / -630 / 950 -- houve compensacao, logo a comissao e devida mesmo com a conta da concessionaria maior que a cobranca, e o rombo e do assinante, nao do investidor)',
            v_conces, v_gestao, v_com, v_forn, v_receber;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 3: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec->>'motivo' IS DISTINCT FROM 'recorrencia' THEN
        RAISE EXCEPTION 'FALHA caso 3: motivo = %, esperado recorrencia (a base nova e positiva; base_negativa aqui seria a regra velha)',
            COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 4 -- fatura SEM compensacao: base zero, ninguem recebe.
    --   valor_a_pagar 500, consumo_compensado NULL.
    --     3.1.1 = 0 | 2.1.2 = 0 | 2.1.1 = 0  <- Task 13: sem base nao ha
    --             residual da base, entao o fornecedor nao repassa nada (na
    --             Task 12 ele levava os -500 do caixa)
    --     1.1.2 = 0 - 500 = -500 (o caixa inteiro vira saldo do assinante)
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c4') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 500, 0, NULL, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    v_base := public.fn_base_recompensa_fatura(v_inv);
    IF (v_base->>'base')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 4: sem compensacao a base tem de ser 0, veio % (%)', v_base->>'base', v_base;
    END IF;
    IF (v_base->>'sem_compensacao')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 4: a funcao precisa dizer que a base zero veio de SEM COMPENSACAO, nao de cadastro faltando: %', v_base;
    END IF;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn, v_receber)
       IS DISTINCT FROM (0::numeric, 0::numeric, 0::numeric, 0::numeric, -500::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 4 (sem compensacao): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% 1.1.2=% (esperado 0 / 0 / 0 / 0 / -500 -- sem base o fornecedor nao repassa nada e o caixa inteiro fica com o assinante)',
            v_gestao, v_com, v_conect, v_forn, v_receber;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 4: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec->>'motivo' IS DISTINCT FROM 'sem_compensacao' THEN
        RAISE EXCEPTION 'FALHA caso 4: motivo = %, esperado sem_compensacao', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 5 -- concessionaria NAO cadastrada: bloqueia como uc_sem_usina.
    --   Nada no razao e o motivo gravado. Calcular com tarifa zero seria
    --   pagar zero de recompensa em silencio.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c5') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 INEXISTENTE', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: concessionaria nao cadastrada lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'concessionaria_nao_cadastrada' THEN
        RAISE EXCEPTION 'FALHA caso 5: motivo = %, esperado concessionaria_nao_cadastrada', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;
    IF (v_rec->>'lancado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 5: lancado = %, esperado false', COALESCE(v_rec->>'lancado', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 6 -- Fio B NULO no cadastro: bloqueia.
    --   Fio B ausente tratado como zero inflaria a base (e a comissao) em
    --   ~20%% sem ninguem perceber.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c6') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 SEM FIO B', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 6: cadastro sem Fio B lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'concessionaria_sem_tarifa' THEN
        RAISE EXCEPTION 'FALHA caso 6: motivo = %, esperado concessionaria_sem_tarifa', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 7 -- tarifa ZERO no cadastro: bloqueia (base zero em silencio
    --   seria recompensa zero sem ninguem saber por que).
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c7') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 TARIFA ZERO', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 7: cadastro com tarifa zero lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'concessionaria_sem_tarifa' THEN
        RAISE EXCEPTION 'FALHA caso 7: motivo = %, esperado concessionaria_sem_tarifa', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 8 -- AMBIGUIDADE: duas linhas da mesma concessionaria/UF com
    --   tarifas distintas. A UC nao tem municipio nem como desempatar, e
    --   escolher uma por "limit 1" ou pela moda seria inventar dinheiro.
    --   Hoje nenhuma concessionaria real esta assim; a segunda que entrar
    --   pode estar.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c8') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 AMBIGUA', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 8: cadastro ambiguo lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'concessionaria_ambigua' THEN
        RAISE EXCEPTION 'FALHA caso 8: motivo = %, esperado concessionaria_ambigua (nao escolher por limit 1 nem pela moda)',
            COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 9 -- classe B3: usa as colunas _B3 do cadastro.
    --   1000 kWh x (1,00 x 0,80 - 0,10) = 700,00
    --     3.1.1 = -70 | 2.1.2 = -(35 + 7) = -42
    --     2.1.1 = -(700 - 112) = -588  <- Task 13 (na Task 12 era -888, o
    --             residual do caixa 1000)
    --     1.1.2 = 700 - 1000 = -300
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c9') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b3, 'consumidora', 'ativo', 'SANDBOX Task12 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    v_base := public.fn_base_recompensa_fatura(v_inv);
    IF v_base->>'classe' IS DISTINCT FROM 'B3 Comercial' THEN
        RAISE EXCEPTION 'FALHA caso 9: classe resolvida = %, esperado B3 Comercial', COALESCE(v_base->>'classe', '<nula>');
    END IF;
    IF (v_base->>'tarifa')::numeric IS DISTINCT FROM 1.00::numeric
       OR (v_base->>'fio_b')::numeric IS DISTINCT FROM 0.10::numeric THEN
        RAISE EXCEPTION 'FALHA caso 9: a classe B3 tem de ler as colunas _B3: tarifa=% fio_b=%',
            v_base->>'tarifa', v_base->>'fio_b';
    END IF;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_forn, v_receber)
       IS DISTINCT FROM (-70::numeric, -42::numeric, -588::numeric, -300::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 9 (classe B3): 3.1.1=% 2.1.2=% 2.1.1=% 1.1.2=% (esperado -70 / -42 / -588 / -300 -- base 700 pelas colunas _B3)',
            v_gestao, v_com, v_forn, v_receber;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 9: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- ==================================================================
    -- CASO 10 -- classe com as colunas ZERADAS no cadastro (B2 na Cosern
    --   real esta assim): bloqueia em vez de calcular base zero.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c10') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b2, 'consumidora', 'ativo', 'SANDBOX Task12 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 1000, 0, 1000, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT COUNT(*) INTO v_n FROM public.ledger_entries WHERE reference_id = v_inv;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 10: classe zerada no cadastro lancou % linha(s) no razao, esperado nenhuma', v_n;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL OR v_rec->>'motivo' IS DISTINCT FROM 'concessionaria_sem_tarifa' THEN
        RAISE EXCEPTION 'FALHA caso 10: motivo = %, esperado concessionaria_sem_tarifa', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;

    -- ==================================================================
    -- CASO 12 -- CENTAVO QUEBRADO: a transacao fecha em ZERO EXATO.
    --   valor_a_pagar 371,36480000000006 e concessionaria 196,62 (numeros
    --   reais de producao), 233 kWh compensados -> base 174,75.
    --     3.1.1 = -17,48 (10%% de 174,75, arredondado)
    --     2.1.2 = -(8,74 + 1,75) = -10,49
    --     2.1.1 = -(174,75 - 17,48 - 10,49) = -146,78  <- Task 13: o
    --             fornecedor e o residual DA BASE, com duas casas exatas (na
    --             Task 12 ele era -146,77480000000006 e carregava a fracao)
    --     1.1.2 = 174,75 - 174,74480000000006 = 0,00519999999999994
    --             (quem carrega a fracao de centavo agora e o saldo do
    --              assinante: ela vem do dinheiro que ELE pagou)
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task12/c12') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_b1, 'consumidora', 'ativo', 'SANDBOX Task12 OK', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 371.36480000000006, 196.62, 233, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 12: a fatura com centavos quebrados nao gerou lancamento nenhum';
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
        RAISE EXCEPTION 'FALHA caso 12: a transacao nao fecha em zero, soma = % -- o residuo abaixo do centavo ficou orfao no razao', v_total;
    END IF;
    IF v_bank IS DISTINCT FROM 371.36480000000006::numeric THEN
        RAISE EXCEPTION 'FALHA caso 12: o recebimento no banco veio %, esperado 371.36480000000006 (o razao registra o valor recebido, nunca uma versao arredondada)', v_bank;
    END IF;
    IF (v_taxa, v_conces) IS DISTINCT FROM (1.99::numeric, -196.62::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 12: taxa/concessionaria mudaram: 4.1.1=% 2.1.3.01=% (esperado 1.99 / -196.62)', v_taxa, v_conces;
    END IF;
    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-17.48::numeric, -10.49::numeric, -146.78::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 12: 3.1.1=% 2.1.2=% 2.1.1=% (esperado -17.48 / -10.49 / -146.78 -- 10%%, 5%% e 1%% de 174,75 e o residual da base)', v_gestao, v_com, v_forn;
    END IF;

    -- Task 13: gestao, recompensas E o repasse ao fornecedor ficam com duas
    -- casas; a fracao de centavo vai toda para a conta a receber.
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn
       AND account_id IN (v_acc_gestao, v_acc_comissoes, v_acc_conect, v_acc_investidor)
       AND amount <> round(amount, 2);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 12: % lancamento(s) de gestao/recompensa/repasse com mais de duas casas', v_n;
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 12: a conta 1.1.2 recebeu % lancamento(s), esperado exatamente 1', v_n;
    END IF;
    IF v_receber = round(v_receber, 2) THEN
        RAISE EXCEPTION 'FALHA caso 12: o saldo do assinante (%) nao carrega o residuo -- alguem tem de absorve-lo para a soma fechar em zero exato', v_receber;
    END IF;
    IF v_receber IS DISTINCT FROM (174.75::numeric - (371.36480000000006::numeric - 196.62::numeric)) THEN
        RAISE EXCEPTION 'FALHA caso 12: 1.1.2 = %, esperado base - caixa = 174.75 - 174.74480000000006', v_receber;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec->>'caixa_liquido' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 12: o congelamento precisa guardar caixa_liquido (valor_a_pagar - valor_concessionaria), que agora e coisa diferente da base';
    END IF;
    IF (v_rec->>'caixa_liquido')::numeric IS DISTINCT FROM (371.36480000000006::numeric - 196.62::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 12: caixa_liquido congelado = %, esperado 174.74480000000006', v_rec->>'caixa_liquido';
    END IF;
    IF (v_rec->>'base')::numeric IS DISTINCT FROM 174.75::numeric THEN
        RAISE EXCEPTION 'FALHA caso 12: base congelada = %, esperado 174.75 (233 kWh x 0,75) -- a base nao e mais o caixa', v_rec->>'base';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
