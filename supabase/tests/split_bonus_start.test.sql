-- Teste: BONUS START (Task 11 do Split de Pagamentos).
--
-- Regras decididas pelo dono (28-29/09/2026), sem margem:
--   planos_assinatura_energia.tipo_recompensa manda.
--   * 'recorrente' -> o Start NAO existe; start_config e ignorado por inteiro.
--   * 'start'      -> SOMENTE bonus: na fatura elegivel paga o Start; em TODAS
--                     as outras faturas da UC parceiro, lider e Conect nao
--                     recebem nada (sobra a gestao da B2W + o fornecedor).
--   * 'hibrido'/'ambos' -> Start na fatura elegivel (nivel 1) MAIS recorrencia
--                     (nivel 2+) na mesma fatura, e recorrencia cheia nas demais.
--   * O percentual do Start vale SO no nivel 1; nivel 2+ recebe recorrencia
--     (hibrido) ou nada (start).
--   * Os percentuais vem de start_config.regras[<ordinal>], INCLUSIVE a chave
--     b2w -- na fatura do Start e o b2w do start_config que vale, nao o da
--     matriz de recorrencia.
--   * A fatura do Start e ISENTA do piso do fornecedor: nao ha corte, mesmo que
--     o fornecedor fique abaixo do piso ou receba zero (teto = base).
--   * O congelamento precisa deixar isso auditavel: bonus_start com aplicado,
--     piso_ignorado, fatura_ordinal, regras_start e tipo_recompensa.
--
-- Casos:
--   0.  fn_regras_recompensa_uc devolve tipo_recompensa;
--   1.  plano 'start', fatura ELEGIVEL (2a paga): nivel 1 recebe o Start
--       (b2w 60 / ppe 20 / lider 20 = 100% da base), o fornecedor fica em ZERO
--       -- abaixo do piso de 50% -- e NADA e cortado;
--   2.  plano 'start', fatura NAO elegivel (1a paga): parceiro/lider/Conect
--       zerados, B2W com a gestao da matriz (10%) e fornecedor com o resto;
--   3.  plano 'start', fatura elegivel com parceiro no NIVEL 2: nao recebe
--       (o Start e so nivel 1, e o plano start nao paga recorrencia);
--   4.  plano 'hibrido', fatura elegivel: nivel 1 no Start (Conect L1 = 0) e
--       nivel 2 na recorrencia (ppe L2 = 2%), tudo isento do piso;
--   5.  plano 'hibrido', fatura elegivel com participante de nivel 1;
--   6.  plano 'hibrido', fatura FORA da janela: recorrencia cheia;
--   7.  plano 'recorrente': ignora start_config mesmo com a fatura no ordinal
--       elegivel -- recorrencia cheia e bonus_start.aplicado = false;
--   8.  congelamento: aplicado/piso_ignorado/fatura_ordinal/regras_start/
--       tipo_recompensa, e o teto registrado = base;
--   9.  residuo: valor_a_pagar com mais de duas casas na fatura do Start --
--       a transacao fecha EXATAMENTE em zero e quem absorve a fracao de
--       centavo e a conta a receber do assinante (1.1.2), porque desde a
--       Task 13 o fornecedor recebe o residual DA BASE, ja fechado em duas
--       casas pelo motor. Nos demais casos deste arquivo base e caixa sao o
--       mesmo numero (a fixture da Task 12 fez consumo_compensado = base),
--       1.1.2 nao recebe lancamento e nenhum numero mudou.
--
-- Em TODOS os casos a soma dos lancamentos da transacao tem de ser 0.
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
    v_acc_receber     uuid;  -- 1.1.2 (Task 13)

    -- matriz de recorrencia acordada pelo dono (identica a de producao)
    c_matriz constant jsonb := '{
      "b2w":   {"niveis": {"L1": "10", "L2": "10", "L3": "10", "L4": "10"}, "max_niveis": 4},
      "lider": {"niveis": {"L1": "1",  "L2": "1",  "L3": "1",  "L4": "0"},  "max_niveis": 3},
      "ppe":   {"niveis": {"L1": "5",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppp":   {"niveis": {"L1": "4",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "ppf":   {"niveis": {"L1": "2",  "L2": "2",  "L3": "0",  "L4": "0"},  "max_niveis": 2},
      "assinante_conect": {"niveis": {"L1": "2", "L2": "0", "L3": "0", "L4": "0"}, "max_niveis": 1}
    }'::jsonb;

    -- start_config REAL do Plano Premium (lido do banco em 29/09/2026): a 2a
    -- fatura e a elegivel e regras["2"] soma 100% da base (60 + 20 + 20).
    c_start constant jsonb := '{
      "faturas_elegiveis": [2],
      "regras": {
        "1": {"b2w": 0,  "ppe": 50, "ppf": 20, "ppp": 40, "lider": 50, "assinante_conect": 0},
        "2": {"b2w": 60, "ppe": 20, "ppf": 0,  "ppp": 0,  "lider": 20, "assinante_conect": 0},
        "3": {"b2w": 0,  "ppe": 0,  "ppf": 0,  "ppp": 0,  "lider": 0,  "assinante_conect": 0}
      }
    }'::jsonb;

    v_plano_start     uuid;
    v_plano_ambos     uuid;
    v_plano_rec       uuid;

    v_usina_start     uuid;
    v_usina_ambos     uuid;
    v_usina_rec       uuid;

    v_lider           uuid;
    v_ppe             uuid;
    v_ppe2            uuid;

    v_sub             uuid;
    v_sub_ref         uuid;
    v_uc              uuid;
    v_inv1            uuid;
    v_inv2            uuid;
    v_txn             uuid;

    v_gestao          numeric;
    v_com             numeric;
    v_conect          numeric;
    v_forn            numeric;
    v_total           numeric;
    v_bank            numeric;
    v_n               integer;

    v_rec             jsonb;
    v_regras_uc       jsonb;
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
       OR v_acc_investidor IS NULL OR v_acc_conect IS NULL OR v_acc_receber IS NULL THEN
        RAISE EXCEPTION 'FALHA: plano de contas incompleto para rodar o teste';
    END IF;

    -- ------------------------------------------------------------------
    -- fixture
    -- ------------------------------------------------------------------
    -- Task 12 (20260929e): a base virou consumo_compensado x (tarifa x
    -- (1 - desconto/100) - Fio B), com tarifa e Fio B do cadastro da
    -- concessionaria. O cadastro sandbox tem tarifa 1,20 e Fio B 0,20 e os
    -- planos nao tem desconto -> tarifa liquida 1,00/kWh, entao o
    -- consumo_compensado de cada fatura e exatamente a base que ela tinha
    -- antes e NENHUM numero esperado deste arquivo mudou.
    INSERT INTO public."Concessionaria"
        ("Cod. Ibge", "Município", "Concessionaria", "UF", "Tarifa Concessionaria", "Fio B")
    VALUES ('SBX11-C1', 'Sandbox Task11', 'SANDBOX Task11 conc', 'RN', 1.20, 0.20);

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX Task11 start', 'start', 10, 50,
            jsonb_build_object('regras_multinivel', c_matriz), c_start)
    RETURNING id INTO v_plano_start;

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX Task11 hibrido', 'hibrido', 10, 50,
            jsonb_build_object('regras_multinivel', c_matriz), c_start)
    RETURNING id INTO v_plano_ambos;

    INSERT INTO public.planos_assinatura_energia
        (nome, tipo_recompensa, gestao_percentual, piso_fornecedor_pct, recorrente_config, start_config)
    VALUES ('SANDBOX Task11 recorrente', 'recorrente', 10, 50,
            jsonb_build_object('regras_multinivel', c_matriz), c_start)
    RETURNING id INTO v_plano_rec;

    INSERT INTO public.originators_v2 (name, cargo, ativo)
    VALUES ('SANDBOX Task11 Lider', 'lider', true) RETURNING id INTO v_lider;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX Task11 PPE', 'ppe', true, v_lider) RETURNING id INTO v_ppe;

    INSERT INTO public.originators_v2 (name, cargo, ativo, lider_id)
    VALUES ('SANDBOX Task11 PPE sem lider', 'ppe', true, NULL) RETURNING id INTO v_ppe2;

    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_start) RETURNING id INTO v_usina_start;
    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_ambos) RETURNING id INTO v_usina_ambos;
    INSERT INTO public.usinas (plano_assinatura_id) VALUES (v_plano_rec)   RETURNING id INTO v_usina_rec;

    -- ==================================================================
    -- CASO 0 -- fn_regras_recompensa_uc precisa entregar tipo_recompensa,
    --   senao o gatilho nao tem como saber qual regra vale.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task11/c0') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_start, 'consumidora', 'ativo', 'SANDBOX Task11 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    v_regras_uc := public.fn_regras_recompensa_uc(v_uc);
    IF v_regras_uc IS NULL OR NOT (v_regras_uc ? 'tipo_recompensa') THEN
        RAISE EXCEPTION 'FALHA caso 0: fn_regras_recompensa_uc nao devolve tipo_recompensa: %', v_regras_uc;
    END IF;
    IF v_regras_uc->>'tipo_recompensa' IS DISTINCT FROM 'start' THEN
        RAISE EXCEPTION 'FALHA caso 0: tipo_recompensa veio %, esperado start', v_regras_uc->>'tipo_recompensa';
    END IF;

    -- ==================================================================
    -- CASO 2 (1a fatura da UC do caso 0) -- plano 'start', fatura NAO
    --   elegivel (ordinal 1, faturas_elegiveis = [2]):
    --   parceiro, lider e Conect NAO recebem nada; sobra a gestao da B2W
    --   (matriz, 10%) e o fornecedor com o resto.
    --   base 1000 -> 3.1.1 = -100 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -900
    -- ==================================================================
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv1;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv1;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv1 AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 2: a fatura paga nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-100::numeric, 0::numeric, 0::numeric, -900::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 2 (plano start, fatura fora da janela): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / 0 / 0 / -900 -- plano start nao paga recorrencia)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 2: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv1;
    IF (v_rec->'bonus_start'->>'aplicado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 2: bonus_start.aplicado = %, esperado false (ordinal 1 nao e elegivel)',
            v_rec->'bonus_start'->>'aplicado';
    END IF;
    IF (v_rec->'bonus_start'->>'elegivel')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 2: bonus_start.elegivel = %, esperado false', v_rec->'bonus_start'->>'elegivel';
    END IF;
    IF v_rec->'bonus_start'->>'tipo_recompensa' IS DISTINCT FROM 'start' THEN
        RAISE EXCEPTION 'FALHA caso 2: bonus_start.tipo_recompensa = %, esperado start',
            v_rec->'bonus_start'->>'tipo_recompensa';
    END IF;

    -- ==================================================================
    -- CASO 1 + CASO 8 -- plano 'start', fatura ELEGIVEL (ordinal 2), nivel 1.
    --   start_config.regras["2"] = b2w 60, ppe 20, lider 20 -> 100% da base.
    --   3.1.1 = -600 | 2.1.2 = -400 (ppe -200 + lider -200) | 2.1.1 = 0
    --   O fornecedor fica em ZERO, muito abaixo do piso de 50% (que desde a
    --   I1 de 30/09/2026 vale 600 em R$: 1000 kWh x 1,20 de tarifa bruta x
    --   50%), e NADA pode ser cortado: o Start e isento do piso (teto = base).
    -- ==================================================================
    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35, 1000) RETURNING id INTO v_inv2;

    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv2;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv2 AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 1: a fatura do Start nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-600::numeric, -400::numeric, 0::numeric, 0::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 1 (Start no nivel 1): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -600 / -400 / 0 / 0 -- b2w 60%%, ppe 20%%, lider 20%% de 1000, fornecedor zerado e sem corte)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 1: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_com
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes AND reference_id = v_ppe;
    IF v_com <> -200 THEN
        RAISE EXCEPTION 'FALHA caso 1: o parceiro recebeu % em 2.1.2, esperado -200 (20%% de 1000 pelo start_config)', v_com;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_com
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_comissoes AND reference_id = v_lider;
    IF v_com <> -200 THEN
        RAISE EXCEPTION 'FALHA caso 1: o lider recebeu % em 2.1.2, esperado -200 (20%% de 1000 pelo start_config)', v_com;
    END IF;

    -- congelamento (CASO 8)
    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv2;
    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 8: recompensas_aplicadas ficou NULL na fatura do Start';
    END IF;
    IF v_rec->>'motivo' IS DISTINCT FROM 'bonus_start' THEN
        RAISE EXCEPTION 'FALHA caso 8: recompensas_aplicadas.motivo = %, esperado bonus_start', v_rec->>'motivo';
    END IF;
    IF (v_rec->'bonus_start'->>'aplicado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.aplicado = %, esperado true', v_rec->'bonus_start'->>'aplicado';
    END IF;
    IF (v_rec->'bonus_start'->>'piso_ignorado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.piso_ignorado = %, esperado true (o investidor precisa poder auditar por que o piso nao valeu)',
            v_rec->'bonus_start'->>'piso_ignorado';
    END IF;
    IF (v_rec->'bonus_start'->>'fatura_ordinal')::int IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.fatura_ordinal = %, esperado 2', v_rec->'bonus_start'->>'fatura_ordinal';
    END IF;
    IF v_rec->'bonus_start'->>'tipo_recompensa' IS DISTINCT FROM 'start' THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.tipo_recompensa = %, esperado start', v_rec->'bonus_start'->>'tipo_recompensa';
    END IF;
    IF v_rec->'bonus_start'->'regras_start' IS DISTINCT FROM (c_start #> '{regras,2}') THEN
        RAISE EXCEPTION 'FALHA caso 8: bonus_start.regras_start = %, esperado as regras do ordinal 2 (%)',
            v_rec->'bonus_start'->'regras_start', c_start #> '{regras,2}';
    END IF;
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM 1000::numeric THEN
        RAISE EXCEPTION 'FALHA caso 8: teto_deducao = %, esperado 1000 (= base: o Start nao tem piso)', v_rec->>'teto_deducao';
    END IF;
    IF (v_rec->'resultado'->>'corte_aplicado')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 8: corte_aplicado = %, esperado 0 -- o Start nao pode ser cortado pelo piso',
            v_rec->'resultado'->>'corte_aplicado';
    END IF;
    IF (v_rec->'resultado'->>'fornecedor')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 8: resultado.fornecedor = %, esperado 0 (intencional: o Premium entrega 100%% da base na 2a fatura)',
            v_rec->'resultado'->>'fornecedor';
    END IF;

    -- ==================================================================
    -- CASO 3 -- plano 'start', fatura elegivel, parceiro no NIVEL 2.
    --   O percentual do Start vale so no nivel 1; no plano 'start' o nivel
    --   2+ nao tem recorrencia -> parceiro 0 e Conect 0 (o start_config da
    --   o assinante_conect como 0 no ordinal 2).
    --   ordinal 2: 3.1.1 = -600 | 2.1.2 = 0 | 2.1.6 = 0 | 2.1.1 = -400
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task11/c3-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe2, 'ativo', 'sandbox://task11/c3', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_start, 'consumidora', 'ativo', 'SANDBOX Task11 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv1;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv1;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35, 1000) RETURNING id INTO v_inv2;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv2;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv2 AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-600::numeric, 0::numeric, 0::numeric, -400::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 3 (Start com parceiro no nivel 2): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -600 / 0 / 0 / -400 -- o Start e so nivel 1 e o plano start nao paga recorrencia)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 3: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- ==================================================================
    -- CASO 6 + CASO 4 -- plano 'hibrido' com parceiro no NIVEL 2 + Conect.
    --   1a fatura (fora da janela): recorrencia cheia
    --     3.1.1 = -100 | 2.1.2 = -20 (ppe L2 2%) | 2.1.6 = -20 | 2.1.1 = -860
    --   2a fatura (elegivel): nivel 1 no Start (Conect 0) e nivel 2 na
    --   recorrencia (ppe 2%), tudo isento do piso
    --     3.1.1 = -600 | 2.1.2 = -20 | 2.1.6 = 0 | 2.1.1 = -380
    --   (com o piso de 50% sobre a tarifa bruta o teto seria 400 -- 1000 -
    --    1000 kWh x 1,20 x 50% -- e os 620 seriam cortados; a isencao vale
    --    para a fatura elegivel inteira)
    -- ==================================================================
    INSERT INTO public.subscribers (status, short_url)
    VALUES ('ativo', 'sandbox://task11/c4-ref') RETURNING id INTO v_sub_ref;

    INSERT INTO public.subscribers (originator_id, status, short_url, indicador_assinante_id)
    VALUES (v_ppe2, 'ativo', 'sandbox://task11/c4', v_sub_ref) RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_ambos, 'consumidora', 'ativo', 'SANDBOX Task11 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv1;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv1;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv1 AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-100::numeric, -20::numeric, -20::numeric, -860::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 6 (hibrido fora da janela): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -100 / -20 / -20 / -860 -- recorrencia cheia)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 6: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv1;
    IF (v_rec->'bonus_start'->>'aplicado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 6: bonus_start.aplicado = %, esperado false fora da janela', v_rec->'bonus_start'->>'aplicado';
    END IF;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35, 1000) RETURNING id INTO v_inv2;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv2;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv2 AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_conect), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_conect, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_conect, v_forn) IS DISTINCT FROM (-600::numeric, -20::numeric, 0::numeric, -380::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 4 (hibrido na fatura elegivel): 3.1.1=% 2.1.2=% 2.1.6=% 2.1.1=% (esperado -600 / -20 / 0 / -380 -- b2w e Conect pelo Start no nivel 1, parceiro nivel 2 pela recorrencia, tudo sem corte de piso)',
            v_gestao, v_com, v_conect, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 4: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv2;
    IF (v_rec->'bonus_start'->>'aplicado')::boolean IS DISTINCT FROM true
       OR (v_rec->'bonus_start'->>'piso_ignorado')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FALHA caso 4: bonus_start aplicado=% piso_ignorado=% (esperado true/true)',
            v_rec->'bonus_start'->>'aplicado', v_rec->'bonus_start'->>'piso_ignorado';
    END IF;
    IF v_rec->'bonus_start'->>'tipo_recompensa' IS DISTINCT FROM 'hibrido' THEN
        RAISE EXCEPTION 'FALHA caso 4: bonus_start.tipo_recompensa = %, esperado hibrido', v_rec->'bonus_start'->>'tipo_recompensa';
    END IF;
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM 1000::numeric THEN
        RAISE EXCEPTION 'FALHA caso 4: teto_deducao = %, esperado 1000 -- a isencao do piso vale para a fatura elegivel inteira, inclusive a parte de recorrencia do nivel 2',
            v_rec->>'teto_deducao';
    END IF;
    IF (v_rec->'resultado'->>'corte_aplicado')::numeric IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 4: corte_aplicado = %, esperado 0 (com o piso de 50%% os 620 seriam cortados)',
            v_rec->'resultado'->>'corte_aplicado';
    END IF;

    -- ==================================================================
    -- CASO 5 -- plano 'hibrido', fatura elegivel, participante de NIVEL 1:
    --   recebe o percentual do Start (igual ao plano 'start').
    --   3.1.1 = -600 | 2.1.2 = -400 | 2.1.1 = 0
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task11/c5') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_ambos, 'consumidora', 'ativo', 'SANDBOX Task11 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv1;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv1;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35, 1000) RETURNING id INTO v_inv2;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv2;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv2 AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-600::numeric, -400::numeric, 0::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 5 (hibrido, nivel 1 na fatura elegivel): 3.1.1=% 2.1.2=% 2.1.1=% (esperado -600 / -400 / 0)',
            v_gestao, v_com, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 5: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    -- ==================================================================
    -- CASO 7 -- plano 'recorrente': o Start NAO existe, mesmo com a fatura
    --   no ordinal elegivel. Recorrencia cheia nas duas faturas.
    --   3.1.1 = -100 | 2.1.2 = -60 (ppe 5% + lider 1%) | 2.1.1 = -840
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task11/c7') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_rec, 'consumidora', 'ativo', 'SANDBOX Task11 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 5, 1000) RETURNING id INTO v_inv1;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv1;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 1000, 0, CURRENT_DATE + 35, 1000) RETURNING id INTO v_inv2;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv2;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv2 AND account_id = v_acc_bank LIMIT 1;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF (v_gestao, v_com, v_forn) IS DISTINCT FROM (-100::numeric, -60::numeric, -840::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 7 (plano recorrente ignora o start_config): 3.1.1=% 2.1.2=% 2.1.1=% (esperado -100 / -60 / -840)',
            v_gestao, v_com, v_forn;
    END IF;
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 7: a transacao nao fecha em zero, soma = %', v_total;
    END IF;

    SELECT recompensas_aplicadas INTO v_rec FROM public.invoices WHERE id = v_inv2;
    IF (v_rec->'bonus_start'->>'aplicado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 7: bonus_start.aplicado = %, esperado false (plano recorrente)', v_rec->'bonus_start'->>'aplicado';
    END IF;
    IF (v_rec->'bonus_start'->>'piso_ignorado')::boolean IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'FALHA caso 7: bonus_start.piso_ignorado = %, esperado false (o piso vale normalmente)',
            v_rec->'bonus_start'->>'piso_ignorado';
    END IF;
    IF v_rec->'bonus_start'->>'tipo_recompensa' IS DISTINCT FROM 'recorrente' THEN
        RAISE EXCEPTION 'FALHA caso 7: bonus_start.tipo_recompensa = %, esperado recorrente', v_rec->'bonus_start'->>'tipo_recompensa';
    END IF;
    IF v_rec->'bonus_start'->>'motivo' IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 7: bonus_start precisa dizer POR QUE o Start nao foi aplicado';
    END IF;
    -- I1 (30/09/2026): o piso incide sobre a TARIFA BRUTA, nao sobre a base.
    --   piso em R$ = 1000 kWh x 1,20 (tarifa bruta) x 50/100 = 600,00
    --   teto       = GREATEST(round(1000, 2) - 600,00, 0) = 400,00
    -- Com a formula antiga (base x (1 - 50/100)) o teto era 500. O numero
    -- mudou porque a base ja vem liquida de desconto e de Fio B, e era ai que
    -- o teto saia mais que o dobro do contratual.
    IF (v_rec->>'teto_deducao')::numeric IS DISTINCT FROM 400::numeric THEN
        RAISE EXCEPTION 'FALHA caso 7: teto_deducao = %, esperado 400 (base 1000 - piso 600 = 1000 kWh x 1,20 x 50%%)', v_rec->>'teto_deducao';
    END IF;

    -- ==================================================================
    -- CASO 9 -- RESIDUO na fatura do Start.
    --   valor_a_pagar 371,36480000000006 e concessionaria 196,62 -> caixa
    --   174,74480000000006; 174,7448 kWh compensados x 1,00 -> base
    --   174,7448, arredondada pelo motor para 174,74:
    --     b2w 60% -> 104,84 | ppe 20% -> 34,95 | lider 20% -> 34,95
    --     fornecedor = residual DA BASE = 174,74 - 104,84 - 69,90 = 0,00
    --     1.1.2      = 174,74 - 174,74480000000006 = -0,00480000000006
    --   A transacao tem de fechar EXATAMENTE em zero. Task 13: o residuo
    --   deixou de ficar no fornecedor (que agora e o residual da base, fechado
    --   em duas casas pelo motor) e passou para a conta a receber do
    --   assinante -- nunca na gestao nem nas recompensas.
    -- ==================================================================
    INSERT INTO public.subscribers (originator_id, status, short_url)
    VALUES (v_ppe, 'ativo', 'sandbox://task11/c9') RETURNING id INTO v_sub;

    INSERT INTO public.consumer_units (subscriber_id, usina_id, tipo_unidade, status, concessionaria, address)
    VALUES (v_sub, v_usina_start, 'consumidora', 'ativo', 'SANDBOX Task11 conc', '{"uf": "RN"}'::jsonb) RETURNING id INTO v_uc;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 500, 0, CURRENT_DATE + 5, 500) RETURNING id INTO v_inv1;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv1;

    INSERT INTO public.invoices (uc_id, status, valor_a_pagar, valor_concessionaria, vencimento, consumo_compensado)
    VALUES (v_uc, 'a_vencer', 371.36480000000006, 196.62, CURRENT_DATE + 35, 174.7448) RETURNING id INTO v_inv2;
    UPDATE public.invoices SET status = 'pago' WHERE id = v_inv2;

    SELECT transaction_id INTO v_txn
      FROM public.ledger_entries WHERE reference_id = v_inv2 AND account_id = v_acc_bank LIMIT 1;
    IF v_txn IS NULL THEN
        RAISE EXCEPTION 'FALHA caso 9: a fatura com centavos quebrados nao gerou lancamento nenhum';
    END IF;

    SELECT COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_gestao), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_comissoes), 0),
           COALESCE(SUM(amount) FILTER (WHERE account_id = v_acc_investidor), 0),
           COALESCE(SUM(amount), 0)
      INTO v_gestao, v_com, v_forn, v_total
      FROM public.ledger_entries WHERE transaction_id = v_txn;

    IF v_total <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 9 (residuo no Start): a transacao nao fecha em zero, soma = %', v_total;
    END IF;
    IF (v_gestao, v_com) IS DISTINCT FROM (-104.84::numeric, -69.90::numeric) THEN
        RAISE EXCEPTION 'FALHA caso 9: 3.1.1=% 2.1.2=% (esperado -104.84 / -69.90 -- 60%% e 2x 20%% de 174,74)', v_gestao, v_com;
    END IF;

    SELECT amount INTO v_bank
      FROM public.ledger_entries
     WHERE transaction_id = v_txn AND account_id = v_acc_bank
       AND description = 'Recebimento Fatura ' || v_inv2;
    IF v_bank IS DISTINCT FROM 371.36480000000006::numeric THEN
        RAISE EXCEPTION 'FALHA caso 9: o recebimento no banco veio %, esperado 371.36480000000006', v_bank;
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries
     WHERE transaction_id = v_txn
       AND account_id IN (v_acc_gestao, v_acc_comissoes, v_acc_conect, v_acc_investidor)
       AND amount <> round(amount, 2);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FALHA caso 9: % lancamento(s) de gestao/recompensa/repasse com mais de duas casas', v_n;
    END IF;

    IF v_forn IS DISTINCT FROM 0::numeric THEN
        RAISE EXCEPTION 'FALHA caso 9: 2.1.1 = %, esperado 0 (o Premium entrega 100%% da base na 2a fatura, e o fornecedor e o residual DA BASE)', v_forn;
    END IF;

    SELECT COUNT(*) INTO v_n
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FALHA caso 9: a conta 1.1.2 recebeu % lancamento(s), esperado exatamente 1 (quem absorve o residuo e um lancamento so)', v_n;
    END IF;

    SELECT amount INTO v_forn
      FROM public.ledger_entries WHERE transaction_id = v_txn AND account_id = v_acc_receber;
    IF v_forn = round(v_forn, 2) THEN
        RAISE EXCEPTION 'FALHA caso 9: o saldo do assinante (%) nao carrega o residuo -- alguem tem de absorve-lo para a soma fechar em zero exato', v_forn;
    END IF;
    IF v_forn IS DISTINCT FROM (174.74::numeric - (371.36480000000006::numeric - 196.62::numeric)) THEN
        RAISE EXCEPTION 'FALHA caso 9: 1.1.2 = %, esperado base arredondada - caixa = 174.74 - 174.74480000000006', v_forn;
    END IF;

    RAISE EXCEPTION 'SANDBOX_OK';
END $$;
