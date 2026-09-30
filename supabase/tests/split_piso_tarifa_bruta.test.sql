-- Teste: O PISO DO FORNECEDOR INCIDE SOBRE A TARIFA BRUTA (achado I1 da
-- revisao final, decisao do dono de 30/09/2026) + O CAMINHO SEM PLANO
-- (achado critico da mesma revisao, corrigido em 20260930a_revisao_final).
--
-- Os dois casos deste arquivo faltavam na suite. Cada um guarda uma conta que
-- ninguem mais confere:
--
-- CASO 1 -- PISO SOBRE A TARIFA BRUTA.
--   O COMMENT de planos_assinatura_energia.piso_fornecedor_pct sempre disse
--   "percentual minimo da TARIFA BRUTA que o fornecedor recebe", e a spec 1
--   idem. O codigo aplicava o percentual sobre a BASE, que desde a Task 12 ja
--   vem liquida de desconto e de Fio B -- o teto de deducao saia mais que o
--   dobro do contratual e a trava anti-deficit deixava passar o que devia
--   barrar. Formula nova:
--       piso em R$ = round(kWh compensado * tarifa bruta * piso_pct/100, 2)
--       teto       = GREATEST(round(base, 2) - piso em R$, 0)
--   O que este caso prova, com os numeros REAIS da Neoenergia Cosern
--   (tarifa 1,0347 / Fio B 0,213) e desconto de 20%, numa venda direta de PPE
--   com lider (B2W 10% + PPE 5% + Lider 1% = 16% da base):
--     * 2.1.1 fica EXATAMENTE em kWh x tarifa bruta x piso_pct/100 -- o
--       fornecedor recebe o piso contratual ao centavo, nem mais nem menos;
--     * corte_aplicado > 0: com a formula antiga o teto seria 307,38 e NADA
--       seria cortado. A trava passa a morder numa configuracao NORMAL, que e
--       a consequencia que o dono conhece e aceitou.
--
-- CASO 2 -- CAMINHO SEM PLANO: O FORNECEDOR FICA COM O CAIXA, NAO COM A BASE.
--   Era o achado CRITICO da revisao. Com a UC sem plano_assinatura_id nao
--   existe matriz, ninguem recebe recompensa -- e o gatilho creditava ao
--   fornecedor a BASE. Como a base (energia compensada) nao e o dinheiro que
--   entrou, isso pagava ao investidor um valor que o assinante nunca pagou e
--   inventava conta a receber contra assinante EM DIA. Pior: sem plano nao ha
--   desconto, entao a base sai inflada (fn_base_recompensa_fatura devolve
--   desconto_origem = uc_sem_plano e desconto 0 de proposito -- bloquear ali
--   deixaria de lancar ate o recebimento no banco).
--   Numeros reais reproduzidos pelo dono: cobranca R$ 4.792,81, conta da
--   concessionaria R$ 1.764,91, 4.948 kWh compensados.
--     caixa = 4.792,81 - 1.764,91 = 3.027,90
--     base  = 4.948 x (1,0347 - 0,213) = 4.065,7716   (desconto 0, sem plano)
--   O teste exige 2.1.1 = -3.027,90 (o CAIXA) e 1.1.2 = 0. Se alguem reverter
--   a correcao, 2.1.1 vira -4.065,77 e aparece +1.037,87 em 1.1.2 contra um
--   assinante que nao deve nada -- e o teste acusa nos dois lugares.
--
-- Em TODOS os casos a soma dos lancamentos da transacao tem de ser ZERO
-- EXATO, sem tolerancia.
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
    v_acc_conect      uuid;  -- 2.1.6
    v_acc_receber     uuid;  -- 1.1.2

    -- matriz de recorrencia acordada pelo dono (identica a de producao)
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb;

    -- cadastro REAL da Neoenergia Cosern, B1 Residencial (30/09/2026)
    c_tarifa constant numeric := 1.0347;
    c_fio_b  constant numeric := 0.213;
    c_piso   constant numeric := 50;
    c_kwh    constant numeric := 1000;

    v_plano           uuid;
    v_lider           uuid;
    v_ppe             uuid;
    v_usina           uuid;
    v_usina_sem_plano uuid;

    v_sub             uuid;
    v_uc              uuid;
    v_inv             uuid;
    v_txn             uuid;

    v_gestao          numeric;
    v_com             numeric;
    v_conect          numeric;
    v_forn            numeric;
    v_receber         numeric;
    v_conces          numeric;
    v_total           numeric;
    v_n               integer;

    v_rec             jsonb;
    v_base            jsonb;
    v_ben             jsonb;

    v_esp_piso        numeric;
    v_esp_teto        numeric;
BEGIN
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

    -- ------------------------------------------------------------------
    -- fixture: cadastro da concessionaria (Cosern real), plano, arvore e
    --          duas usinas -- uma COM plano e uma SEM.
    -- ------------------------------------------------------------------
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBXI1-A1', 'Sandbox Cosern', 'SANDBOX I1 Cosern', 'RN', c_tarifa, c_fio_b);

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, desconto_assinante, recorrente_config)
    VALUES ('SANDBOX I1 plano Cosern 20', 'recorrente', 10, c_piso, 20,
            jsonb_build_object('regras_multinivel', c_matriz))
    RETURNING id INTO v_plano;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX I1 Lider', 'lider', true) RETURNING id INTO v_lider;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX I1 PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.usinas (plano_assinatura_id, grupo_tarifario)
    VALUES (v_plano, 'B1 Residencial') RETURNING id INTO v_usina;

    -- usina SEM plano_assinatura_id: e o caminho do caso 2. gestao_percentual
    -- 15 de proposito -- sem plano NAO existe gestao nenhuma, e se alguem
    -- voltar a ler a usina o caso 2 acusa em 3.1.1.
    INSERT INTO public.usinas (gestao_percentual, grupo_tarifario)
    VALUES (15, 'B1 Residencial') RETURNING id INTO v_usina_sem_plano;

    -- ==================================================================
    -- CASO 1 -- PISO SOBRE A TARIFA BRUTA, com corte numa configuracao
    --   NORMAL (venda direta de PPE com lider, o arranjo mais comum).
    --
    --   base = 1000 x (1,0347 x 0,80 - 0,213)
    --        = 1000 x (0,82776 - 0,213) = 1000 x 0,61476 = 614,76
    --   piso em R$ = round(1000 x 1,0347 x 50/100, 2) = 517,35
    --   teto       = GREATEST(round(614,76 , 2) - 517,35, 0) = 97,41
    --                (= 15,846% da base; a formula antiga dava 307,38)
    --
    --   bruto, sobre a base 614,76:
    --     B2W   10%  -> round(61,476 , 2) = 61,48
    --     PPE    5%  -> round(30,738 , 2) = 30,74
    --     Lider  1%  -> round(6,1476 , 2) =  6,15
    --     total                            = 98,37  (16% da base)
    --   excesso = 98,37 - 97,41 = 0,96 -> A TRAVA MORDE.
    --
    --   ORDEM DO CORTE (assinante_conect -> parceiro -> lider): nao ha Conect
    --   nesta montagem (venda direta, sem assinante indicador), entao o 1o
    --   alvo efetivo e o PARCEIRO POWER, que absorve os 0,96 inteiros; o
    --   LIDER, ultimo da fila, fica INTACTO porque o excesso ja zerou. E essa
    --   sobrevivencia do lider que prova a ordem -- se a ordem invertesse,
    --   quem perderia os 0,96 era ele. (O degrau em que os tres sao drenados
    --   esta em supabase/tests/split_gatilho.test.sql, casos 5 e 5b.)
    --     PPE   30,74 - 0,96 = 29,78  (cortado 0,96)
    --     Lider  6,15         =  6,15 (cortado 0)
    --
    --   total_deduzido = 98,37 - 0,96 = 97,41 -> encosta EXATAMENTE no teto,
    --   logo teto_estourado = false.
    --   fornecedor = 614,76 - 97,41 = 517,35 = 1000 x 1,0347 x 50/100, que e o
    --   piso contratual ao centavo.
    --
    --   No razao (caixa = base, para 1.1.2 nao entrar na conta):
    --     3.1.1 = -61,48 | 2.1.2 = -(29,78 + 6,15) = -35,93
    --     2.1.6 = 0      | 2.1.1 = -517,35        | 1.1.2 sem lancamento
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://i1/c1') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina, 'consumidora', 'ativo', 'SANDBOX I1 Cosern', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 614.76, 0, c_kwh, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    -- a base, antes de qualquer lancamento: e ela que o piso agora NAO usa
    v_base := public.fn_base_recompensa_fatura(v_inv);
    IF (v_base->>'ok')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 1: fn_base_recompensa_fatura recusou o cadastro da Cosern: %', v_base;
    END IF;
    IF (v_base->>'base')::numeric IS DISTINCT FROM 614.76::numeric THEN
        RAISE EXCEPTION 'FALHA caso 1: base = %, esperado 614.76 (1000 kWh x (1,0347 x 0,80 - 0,213))', v_base->>'base';
    END IF;
    IF (v_base->>'tarifa')::numeric IS DISTINCT FROM c_tarifa THEN
        RAISE EXCEPTION 'FALHA caso 1: a tarifa BRUTA lida do cadastro = %, esperado % -- e ela que o piso usa',
            v_base->>'tarifa', c_tarifa;
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

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- (a) O CORACAO DESTE CASO: o fornecedor recebe EXATAMENTE o piso
    --     contratual, kWh x tarifa BRUTA x piso_pct/100. Comparado contra a
    --     conta, nao contra uma constante decorada.
    v_esp_piso := round(c_kwh * c_tarifa * c_piso / 100, 2);
    IF v_esp_piso IS DISTINCT FROM 517.35::numeric THEN
        RAISE EXCEPTION 'FALHA caso 1: a propria fixture mudou -- kWh x tarifa bruta x piso/100 = %, esperado 517.35', v_esp_piso;
    END IF;
    IF v_forn IS DISTINCT FROM -v_esp_piso THEN
        RAISE EXCEPTION 'FALHA caso 1: 2.1.1 = %, esperado % (= 1000 kWh x tarifa bruta 1,0347 x piso 50%%) -- o piso NAO incide sobre a base',
            v_forn, -v_esp_piso;
    END IF;

    -- (b) as demais contas do rateio
    IF (v_gestao, v_com, v_conect) IS DISTINCT FROM (-61.48::numeric, -35.93::numeric, 0::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 1: 3.1.1=% 2.1.2=% 2.1.6=% (esperado -61.48 / -35.93 / 0 -- B2W 10%% de 614,76, e PPE 29,78 (ja cortado) + Lider 6,15)',
            v_gestao, v_com, v_conect;
    END IF;

    -- (c) caixa = base, entao a conta a receber do assinante nao entra
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 0 OR v_receber <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: 1.1.2 ganhou % lancamento(s) somando % -- com caixa igual a base nao ha saldo nenhum', v_n, v_receber;
    END IF;

    -- (d) o teto congelado e o do piso NOVO
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: recompensas_aplicadas ficou NULL';
    END IF;
    v_esp_teto := GREATEST(round(614.76::numeric, 2) - v_esp_piso, 0);
    IF v_esp_teto IS DISTINCT FROM 97.41::numeric THEN
        RAISE EXCEPTION 'FALHA caso 1: a conta do teto mudou -- base - piso = %, esperado 97.41', v_esp_teto;
    END IF;
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM v_esp_teto THEN
        RAISE EXCEPTION 'FALHA caso 1: teto_deducao = %, esperado % (com a formula antiga seria 307.38)',
            v_rec->>'teto_deducao', v_esp_teto;
    END IF;
    IF v_rec->>'teto_formula' NOT ILIKE '%tarifa_bruta%' THEN
        RAISE EXCEPTION 'FALHA caso 1: teto_formula congelada = %, tem de citar a tarifa bruta (e o que o investidor audita)',
            COALESCE(v_rec->>'teto_formula', '<nula>');
    END IF;

    -- (e) A TRAVA MORDEU: corte > 0 numa configuracao normal. Com a formula
    --     antiga (teto 307,38) corte_aplicado seria 0.
    IF (v_rec->'resultado'->>'corte_aplicado')::numeric IS NULL
       OR (v_rec->'resultado'->>'corte_aplicado')::numeric <= 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: corte_aplicado = %, esperado MAIOR QUE ZERO -- com o piso sobre a tarifa bruta os 16%% de uma venda direta de PPE nao cabem nos 15,846%% de teto',
            COALESCE(v_rec->'resultado'->>'corte_aplicado', '<nulo>');
    END IF;
    IF (v_rec->'resultado'->>'corte_aplicado')::numeric IS DISTINCT FROM 0.96::numeric THEN
        RAISE EXCEPTION 'FALHA caso 1: corte_aplicado = %, esperado 0.96 (bruto 98,37 - teto 97,41)',
            v_rec->'resultado'->>'corte_aplicado';
    END IF;
    IF (v_rec->'resultado'->>'total_deduzido')::numeric IS DISTINCT FROM v_esp_teto THEN
        RAISE EXCEPTION 'FALHA caso 1: total_deduzido = %, esperado % -- depois do corte o total tem de encostar exatamente no teto',
            v_rec->'resultado'->>'total_deduzido', v_esp_teto;
    END IF;
    IF (v_rec->'resultado'->>'teto_estourado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 1: teto_estourado = %, esperado false (o corte de 0,96 deu conta do excesso inteiro)',
            v_rec->'resultado'->>'teto_estourado';
    END IF;

    -- (f) ORDEM DO CORTE: Conect (ausente) -> Parceiro Power (leva os 0,96)
    --     -> Lider (INTACTO, porque o excesso zerou antes de chegar nele).
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
                WHERE b->>'papel' = 'assinante_conect') THEN
        RAISE EXCEPTION 'FALHA caso 1: a montagem e venda DIRETA e nao podia ter assinante_conect entre os beneficiarios: %',
            v_rec->'resultado'->'beneficiarios';
    END IF;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'ppe';
    IF v_ben IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: o parceiro nao aparece entre os beneficiarios congelados: %',
            v_rec->'resultado'->'beneficiarios';
    END IF;
    IF (v_ben->>'cortado')::numeric <> 0.96 OR (v_ben->>'valor')::numeric <> 29.78 THEN
        RAISE EXCEPTION 'FALHA caso 1: sem Conect na lista, o Parceiro Power e o 1o alvo e devia absorver os 0,96 inteiros (30,74 -> 29,78), veio %', v_ben;
    END IF;

    SELECT b INTO v_ben FROM jsonb_array_elements(v_rec->'resultado'->'beneficiarios') b
     WHERE b->>'papel' = 'lider';
    IF v_ben IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: o lider nao aparece entre os beneficiarios congelados: %',
            v_rec->'resultado'->'beneficiarios';
    END IF;
    IF (v_ben->>'cortado')::numeric <> 0 OR (v_ben->>'valor')::numeric <> 6.15 THEN
        RAISE EXCEPTION 'FALHA caso 1: o Lider e o ULTIMO da ordem e nao podia ser tocado (6,15 intactos), veio % -- se ele perdeu algo, a ordem do corte inverteu', v_ben;
    END IF;

    -- (g) e cada beneficiario tem de chegar ao razao com o valor JA cortado
    SELECT amount INTO v_com
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes AND reference_id = v_ppe;
    IF v_com IS DISTINCT FROM -29.78::numeric THEN
        RAISE EXCEPTION 'FALHA caso 1: o parceiro foi lancado em 2.1.2 com %, esperado -29.78 (o corte tem de chegar ao razao, nao so ao congelamento)', v_com;
    END IF;

    SELECT amount INTO v_com
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes AND reference_id = v_lider;
    IF v_com IS DISTINCT FROM -6.15::numeric THEN
        RAISE EXCEPTION 'FALHA caso 1: o lider foi lancado em 2.1.2 com %, esperado -6.15', v_com;
    END IF;

    -- ==================================================================
    -- CASO 2 -- CAMINHO SEM PLANO: o fornecedor fica com o CAIXA.
    --   UC numa usina SEM plano_assinatura_id, concessionaria cadastrada
    --   (Cosern) e valor_concessionaria > 0.
    --     cobranca 4.792,81 | conta 1.764,91 | 4.948 kWh
    --     caixa = 4.792,81 - 1.764,91 = 3.027,90
    --     base  = 4.948 x (1,0347 - 0,213) = 4.065,7716
    --             (sem plano nao ha desconto: desconto_origem = uc_sem_plano e
    --              desconto 0 de proposito -- a base sai inflada em 33,7%, e
    --              justamente por isso ela NAO pode ser o que se paga)
    --   Exigido:
    --     3.1.1 = 0        (sem plano nao ha matriz, nem gestao da B2W)
    --     2.1.2 = 0 | 2.1.6 = 0
    --     2.1.1 = -3.027,90  (o CAIXA, nao a base)
    --     1.1.2 = 0 -- so o residuo, e o caixa aqui tem duas casas exatas
    --     2.1.3.01 = -1.764,91 (a conta continua lancada como obrigacao)
    --   Antes da correcao de 30/09: 2.1.1 = -4.065,77 e 1.1.2 = +1.037,87
    --   contra um assinante que nao devia nada.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://i1/c2') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_sem_plano, 'consumidora', 'ativo', 'SANDBOX I1 Cosern', '{"uf": "RN"}'::jsonb)
    RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, consumo_compensado, vencimento)
    VALUES (v_uc, 'a_vencer', 4792.81, 1764.91, 4948, CURRENT_DATE + 5) RETURNING id INTO v_inv;

    -- a base existe e e INFLADA (desconto 0 por falta de plano): e exatamente
    -- por isso que ela nao pode ser o que o fornecedor recebe.
    v_base := public.fn_base_recompensa_fatura(v_inv);
    IF (v_base->>'ok')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 2: uc_sem_plano NAO pode bloquear a base -- se bloquear, nem o recebimento no banco e lancado: %', v_base;
    END IF;
    IF v_base->>'desconto_origem' IS DISTINCT FROM 'uc_sem_plano' THEN
        RAISE EXCEPTION 'FALHA caso 2: desconto_origem = %, esperado uc_sem_plano', COALESCE(v_base->>'desconto_origem', '<nulo>');
    END IF;
    IF (v_base->>'base')::numeric IS DISTINCT FROM 4065.7716::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: base = %, esperado 4065.7716 (4.948 kWh x (1,0347 - 0,213), sem desconto)', v_base->>'base';
    END IF;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 2: a fatura paga nao gerou lancamento nenhum -- o caminho sem plano tem de lancar o recebimento';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conces), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_receber), 0),
           COALESCE(SUM(amount), 0)
      INTO v_conces, v_gestao, v_com, v_conect, v_forn, v_receber, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- sem plano nao existe gestao da B2W nem recompensa nenhuma
    IF (v_gestao, v_com, v_conect) IS DISTINCT FROM (0::numeric, 0::numeric, 0::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 2: 3.1.1=% 2.1.2=% 2.1.6=% (esperado 0 / 0 / 0 -- sem plano nao ha matriz, e a gestao NAO vem da usina)',
            v_gestao, v_com, v_conect;
    END IF;

    -- O ACHADO CRITICO: o fornecedor fica com o CAIXA, nao com a base
    IF v_forn IS DISTINCT FROM -(4792.81::numeric - 1764.91::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 2: 2.1.1 = %, esperado % (= o CAIXA, 4.792,81 - 1.764,91). Se veio -4065.77 o fornecedor voltou a receber a BASE, que o assinante nunca pagou',
            v_forn, -(4792.81::numeric - 1764.91::numeric);
    END IF;
    IF v_forn IS DISTINCT FROM -3027.90::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: 2.1.1 = %, esperado -3027.90', v_forn;
    END IF;

    -- ... e a conta a receber do assinante carrega SO o residuo (aqui zero)
    IF v_receber <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: 1.1.2 = %, esperado 0 -- o caixa 3.027,90 tem duas casas exatas, entao nao ha residuo e o assinante EM DIA nao pode ganhar saldo devedor', v_receber;
    END IF;
    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: 1.1.2 ganhou % lancamento(s); saldo zero nao se lanca', v_n;
    END IF;

    -- a conta da concessionaria continua sendo obrigacao separada
    IF v_conces IS DISTINCT FROM -1764.91::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: 2.1.3.01 = %, esperado -1764.91 (a conta da concessionaria nao deixa de ser provisionada)', v_conces;
    END IF;

    -- congelamento: motivo e os dois numeros do fornecedor
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 2: recompensas_aplicadas ficou NULL';
    END IF;
    IF v_rec->>'motivo' IS DISTINCT FROM 'uc_sem_plano' THEN
        RAISE EXCEPTION 'FALHA caso 2: motivo = %, esperado uc_sem_plano', COALESCE(v_rec->>'motivo', '<nulo>');
    END IF;
    IF (v_rec->>'aplicado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 2: aplicado = %, esperado false (nenhuma recompensa foi aplicada)', v_rec->>'aplicado';
    END IF;
    IF (v_rec->>'lancado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 2: lancado = %, esperado true -- sem plano nao ha recompensa, mas a transacao financeira E lancada', v_rec->>'lancado';
    END IF;
    IF (v_rec->>'caixa_liquido')::numeric IS DISTINCT FROM 3027.90::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: caixa_liquido congelado = %, esperado 3027.90', v_rec->>'caixa_liquido';
    END IF;
    IF (v_rec->>'fornecedor_caixa')::numeric IS DISTINCT FROM 3027.90::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: fornecedor_caixa congelado = %, esperado 3027.90 (o que foi de fato lancado ao fornecedor)',
            v_rec->>'fornecedor_caixa';
    END IF;
    IF (v_rec->>'base')::numeric IS DISTINCT FROM 4065.7716::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: base congelada = %, esperado 4065.7716 -- a base tem de ficar registrada mesmo sem virar dinheiro, para o investidor ver a diferenca',
            v_rec->>'base';
    END IF;
    IF (v_rec->>'conta_receber_assinante')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 2: conta_receber_assinante congelado = %, esperado 0', v_rec->>'conta_receber_assinante';
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
