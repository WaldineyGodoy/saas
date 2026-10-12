-- Task 11 (Split de Pagamentos): BONUS START aplicado de verdade.
--
-- Ate aqui (20260929c) o gatilho DETECTAVA a fatura elegivel e congelava
-- bonus_start com aplicado:false, mas pagava sempre a recorrencia. As regras
-- foram decididas pelo dono em 28-29/09/2026 e nao tem margem:
--
--   planos_assinatura_energia.tipo_recompensa manda.
--
--   * 'recorrente' -> o Start NAO existe. start_config e ignorado por inteiro.
--       E o comportamento de antes desta migracao, e nao muda nada.
--   * 'start'      -> SOMENTE bonus, NUNCA recorrencia. Na fatura elegivel
--       paga o Start; em TODAS as outras faturas daquela UC parceiro, lider e
--       Conect nao recebem nada -- sobra a gestao da B2W (matriz b2w, fixa e
--       nunca cortada) e o fornecedor com o residual.
--   * 'hibrido' (a grafia que o CHECK da tabela aceita; 'ambos' e tratado como
--       sinonimo) -> Start MAIS recorrencia: na fatura elegivel o nivel 1
--       recebe o percentual do Start e o nivel 2+ segue a recorrencia normal;
--       nas demais faturas, recorrencia normal.
--
-- Sobre a fatura elegivel (em 'start' e em 'hibrido'):
--   - Elegibilidade: o ordinal da fatura paga daquela UC (1a, 2a, 3a) esta em
--     start_config.faturas_elegiveis.
--   - O percentual do Start vale SO no nivel 1. Quem esta no nivel 2+ recebe
--     recorrencia (hibrido) ou nada (start).
--   - Os percentuais vem de start_config.regras[<ordinal>], que tem uma chave
--     por papel INCLUSIVE 'b2w' -- na fatura do Start e o b2w do start_config
--     que vale, nao o da matriz de recorrencia. Exemplo real do Plano Premium,
--     regras["2"]: {"b2w":60,"ppe":20,"ppf":0,"ppp":0,"lider":20,
--     "assinante_conect":0}.
--   - ISENTO DO PISO DO FORNECEDOR: nao ha corte, mesmo que o fornecedor fique
--     abaixo do piso ou receba zero. Com o Premium a soma da 100% da base e o
--     fornecedor fica sem nada na 2a fatura -- e intencional. Como o motor puro
--     RECUSA teto NULL (contrato de entrada, 20260928c), a isencao e feita
--     passando p_teto_deducao = round(base, 2): teto igual a base, que na
--     pratica nunca corta. A isencao vale para a fatura elegivel INTEIRA,
--     inclusive a parte de recorrencia do nivel 2+ no plano hibrido.
--   - Congelamento: recompensas_aplicadas.bonus_start passa a trazer
--     aplicado:true, piso_ignorado:true, o ordinal, as regras usadas e o
--     tipo_recompensa do plano -- o investidor precisa poder auditar por que o
--     piso nao valeu naquela fatura. motivo/caminho da fatura vira
--     'bonus_start'.
--
-- DESENHO: em vez de dois caminhos paralelos de calculo, o gatilho monta uma
-- MATRIZ SINTETICA e chama o motor puro UMA VEZ SO, como sempre:
--   * fatura elegivel: por papel, niveis.L1 = percentual do Start e
--     niveis.L2..L4 = os da matriz de recorrencia (hibrido) ou zero (start),
--     com max_niveis coerente (hibrido: o da matriz; start: 1, para o motor
--     zerar sozinho quem esta no nivel 2+); b2w em L1..L4 = o b2w do
--     start_config; teto = base;
--   * fora da fatura elegivel, plano 'start': matriz so com 'b2w' (a chave que
--     o motor exige) -- todo o resto fica sem regra e o motor devolve zero;
--     teto = o normal do piso;
--   * qualquer outro caso: a matriz do plano, exatamente como antes.
-- O MOTOR PURO NAO MUDA (fn_calcular_split_recompensa continua com a mesma
-- assinatura, as mesmas guardas e o mesmo contrato).
--
-- Tambem nesta migracao: fn_regras_recompensa_uc passa a devolver
-- 'tipo_recompensa' (a coluna ja existia, com default 'start' e CHECK em
-- start|recorrente|hibrido) -- sem isso o gatilho nao tem como saber qual
-- regra vale.
--
-- ATENCAO (efeito de producao, registrado de proposito): o default da coluna e
-- 'start'. Em 29/09/2026 o Plano Premium esta como 'start' e o Plano Ultra como
-- 'recorrente'. A partir daqui, as UCs do Premium so pagam parceiro/lider/
-- Conect na fatura elegivel (a 2a); nas demais sobra gestao B2W + fornecedor.
-- E exatamente a regra que o dono escreveu, mas e uma mudanca de dinheiro:
-- qualquer plano novo nasce 'start' e, sem start_config util, nunca paga
-- recompensa nenhuma alem da gestao.

-- Task 11 (Split de Pagamentos): BONUS START aplicado de verdade.
-- Ver supabase/migrations/20260929d_bonus_start.sql para o cabecalho completo.
-- tipo_recompensa manda: 'recorrente' ignora start_config; 'start' paga
-- SOMENTE o bonus (na fatura elegivel) e nenhuma recorrencia nas demais;
-- 'hibrido'/'ambos' paga o Start no nivel 1 da fatura elegivel + recorrencia
-- no nivel 2+. O Start vale so no nivel 1 e e isento do piso do fornecedor
-- (teto = round(base,2), porque o motor puro recusa teto NULL). O motor puro
-- NAO muda: o gatilho monta uma matriz sintetica e chama o motor uma vez so.

CREATE OR REPLACE FUNCTION public.fn_regras_recompensa_uc(p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_plano public.planos_assinatura_energia;
BEGIN
  v_plano := public.fn_plano_da_uc(p_uc);

  IF v_plano.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'plano_id', v_plano.id,
    'tipo_recompensa', v_plano.tipo_recompensa,
    'gestao_pct', v_plano.gestao_percentual,
    'piso_pct', v_plano.piso_fornecedor_pct,
    'desconto_pct', v_plano.desconto_assinante,
    'modalidade', v_plano.modalidade,
    'regras_multinivel', v_plano.recorrente_config->'regras_multinivel',
    'start_config', v_plano.start_config
  );
END;
$fn$;

COMMENT ON FUNCTION public.fn_regras_recompensa_uc(uuid) IS
  'Devolve {plano_id, tipo_recompensa, gestao_pct, piso_pct, desconto_pct, modalidade, regras_multinivel, start_config} do plano resolvido por fn_plano_da_uc para a UC, ou NULL quando nao ha plano (nem na UC, nem na usina). tipo_recompensa (start | recorrente | hibrido, default start) e quem manda no bonus Start a partir da Task 11: start = somente bonus na fatura elegivel e NENHUMA recorrencia nas demais; recorrente = start_config ignorado; hibrido (sinonimo aceito: ambos) = Start no nivel 1 da fatura elegivel + recorrencia no nivel 2+ e nas demais faturas.';

CREATE OR REPLACE FUNCTION public.handle_invoice_paid_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_uc_encontrada       boolean;
    v_usina_id            uuid;
    v_supplier_id         uuid;
    v_service_values      jsonb;
    v_tipo_unidade        text;
    v_fatura_terceiro     boolean;

    v_valor_total         numeric;
    v_valor_concessionaria numeric;
    v_base_calculo        numeric;

    v_plano               jsonb;
    v_matriz              jsonb;
    v_start_config        jsonb;
    v_participantes       jsonb;
    v_piso_pct            numeric;
    v_teto_deducao        numeric;
    v_teto_formula        text;
    v_split               jsonb;
    v_motivo              text;      -- por que NAO houve recompensa (NULL = houve)
    v_caminho             text;      -- recorrencia | bonus_start | start_sem_recorrencia | base_negativa | <motivo>
    v_bloqueado           boolean := false;
    v_recompensas         jsonb;

    v_ordinal             integer;
    v_start_elegivel      boolean := false;
    v_start_regras        jsonb;
    v_bonus_start         jsonb;

    -- Task 11
    v_tipo_recompensa     text;
    v_start_hibrido       boolean := false;
    v_start_aplicado      boolean := false;
    v_start_motivo        text;
    v_matriz_efetiva      jsonb;
    v_papel_key           text;
    v_pct_start           numeric;
    v_niveis_papel        jsonb;
    v_max_papel           int;

    v_pct_b2w             numeric;
    v_valor_b2w           numeric := 0;
    v_valor_fornecedor    numeric;
    v_taxa_asaas          numeric;

    v_valor_b2w_manutencao   numeric := 0;
    v_valor_b2w_arrendamento numeric := 0;

    v_ben                 jsonb;
    v_ben_valor           numeric;
    v_ben_papel           text;
    v_ben_id              uuid;
    v_ben_nivel           text;
    v_ben_rotulo          text;

    v_transaction_id      uuid;
    v_account_bank        uuid;
    v_account_gestao      uuid;
    v_account_manutencao  uuid;
    v_account_arrendamento uuid;
    v_account_investidor  uuid;
    v_account_concessionaria uuid;
    v_account_comissoes   uuid;
    v_account_conect      uuid;
    v_account_taxa_bancaria uuid;
BEGIN
    -- F3b: so 'pago'. O enum fatura_status NAO tem 'liquidado'. Status novo de
    -- liquidacao precisa entrar AQUI e na contagem do ordinal (bloco 2).
    IF NEW.status::text = 'pago' AND OLD.status IS DISTINCT FROM NEW.status THEN

        -- 1. Metadata. LEFT JOIN de proposito (F3c).
        SELECT u.id, u.supplier_id, u.service_values,
               cu.tipo_unidade, cu.fatura_consumo_terceiro
        INTO v_usina_id, v_supplier_id, v_service_values,
             v_tipo_unidade, v_fatura_terceiro
        FROM public.consumer_units cu
        LEFT JOIN public.usinas u ON u.id = cu.usina_id
        WHERE cu.id = NEW.uc_id;

        v_uc_encontrada := FOUND;

        -- UG sem consumo de terceiro nao tem split.
        IF v_tipo_unidade = 'geradora' AND COALESCE(v_fatura_terceiro, false) = false THEN
            RETURN NEW;
        END IF;

        -- F2/G2: nao lancar duas vezes a mesma fatura.
        IF (NEW.recompensas_aplicadas IS NOT NULL
            AND COALESCE((NEW.recompensas_aplicadas ->> 'lancado')::boolean, true))
           OR EXISTS (
                SELECT 1 FROM public.ledger_entries le
                 WHERE le.reference_type = 'invoice'
                   AND le.reference_id = NEW.id
                   AND le.description = 'Recebimento Fatura ' || NEW.id
              ) THEN
            RAISE WARNING 'handle_invoice_paid_ledger: fatura % ja foi lancada no razao; segunda passagem por "pago" ignorada (nada duplicado)', NEW.id;
            RETURN NEW;
        END IF;

        v_valor_total := COALESCE(NEW.valor_a_pagar, 0);
        v_valor_concessionaria := COALESCE(NEW.valor_concessionaria, 0);
        v_base_calculo := v_valor_total - v_valor_concessionaria;

        IF NOT v_uc_encontrada THEN
            v_motivo := 'uc_inexistente';
            v_bloqueado := true;
        ELSIF v_usina_id IS NULL THEN
            v_motivo := 'uc_sem_usina';
            v_bloqueado := true;
        END IF;

        IF v_bloqueado THEN
            RAISE WARNING 'handle_invoice_paid_ledger: fatura % nao foi lancada (%); UC %', NEW.id, v_motivo, NEW.uc_id;

            UPDATE public.invoices
               SET recompensas_aplicadas = jsonb_build_object(
                     'versao',       '20260929d_bonus_start',
                     'calculado_em', now(),
                     'lancado',      false,
                     'aplicado',     false,
                     'motivo',       v_motivo,
                     'base',         v_base_calculo,
                     'base_formula', 'valor_a_pagar - valor_concessionaria'
                   )
             WHERE id = NEW.id;

            RETURN NEW;
        END IF;

        v_transaction_id := gen_random_uuid();

        -- 2. Ordinal desta fatura entre as pagas da UC (1a, 2a, 3a ...).
        SELECT COUNT(*) + 1 INTO v_ordinal
        FROM public.invoices
        WHERE uc_id = NEW.uc_id
          AND status::text = 'pago'
          AND id <> NEW.id;

        -- 3. Plano da UC -> matriz de recompensas
        v_plano        := public.fn_regras_recompensa_uc(NEW.uc_id);
        v_matriz       := v_plano -> 'regras_multinivel';
        v_start_config := v_plano -> 'start_config';

        -- Task 11: tipo_recompensa manda. 'ambos' e sinonimo de 'hibrido'.
        v_tipo_recompensa := COALESCE(v_plano ->> 'tipo_recompensa', 'start');
        v_start_hibrido   := v_tipo_recompensa IN ('hibrido', 'ambos');

        IF v_plano IS NULL THEN
            v_motivo := 'uc_sem_plano';
        ELSIF jsonb_typeof(v_matriz) <> 'object'
              OR jsonb_typeof(v_matriz #> '{b2w,niveis}') IS DISTINCT FROM 'object' THEN
            v_motivo := 'plano_sem_matriz';
        END IF;

        -- 3b. Elegibilidade do bonus Start (elegibilidade de CALENDARIO: o
        --     ordinal caiu na janela). Quem decide se o Start VALE e o
        --     tipo_recompensa, logo abaixo.
        IF jsonb_typeof(v_start_config) = 'object'
           AND jsonb_typeof(v_start_config -> 'faturas_elegiveis') = 'array' THEN
            SELECT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(v_start_config -> 'faturas_elegiveis') f
                WHERE f = v_ordinal::text
            ) INTO v_start_elegivel;
        END IF;

        IF v_start_elegivel THEN
            v_start_regras := v_start_config #> ARRAY['regras', v_ordinal::text];
        ELSE
            v_start_regras := NULL;
        END IF;

        -- 4. Rateio
        IF v_motivo IS NOT NULL THEN
            v_caminho          := v_motivo;
            v_start_motivo     := 'plano indisponivel (' || v_motivo || '): nao ha como aplicar o Start';
            v_participantes    := NULL;
            v_split            := NULL;
            v_teto_deducao     := NULL;
            v_valor_b2w        := 0;
            v_valor_fornecedor := v_base_calculo;

        ELSIF v_base_calculo < 0 THEN
            -- F1 -- BASE NEGATIVA: PREJUIZO COMPARTILHADO (dono, 18/08/2026,
            -- reconfirmado 28/09/2026). O Start tambem nao se aplica.
            v_caminho      := 'base_negativa';
            v_start_motivo := 'base negativa: prejuizo compartilhado nao paga bonus';
            v_pct_b2w   := GREATEST(COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, 0), 0);
            v_valor_b2w := round(v_base_calculo * v_pct_b2w / 100, 2);   -- negativo
            v_valor_fornecedor := v_base_calculo - v_valor_b2w;

            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);
            v_teto_deducao  := NULL;   -- piso nao se aplica a prejuizo

            SELECT jsonb_build_object(
                     'b2w', jsonb_build_object(
                       'pct', v_pct_b2w, 'valor', v_valor_b2w,
                       'pct_absorvido', 0, 'valor_absorvido', 0),
                     'beneficiarios', COALESCE(jsonb_agg(
                       jsonb_build_object(
                         'papel', elem->>'papel', 'id', elem->'id',
                         'nivel', (elem->>'nivel')::int,
                         'pct', 0, 'valor', 0, 'cortado', 0)), '[]'::jsonb),
                     'total_deduzido', v_valor_b2w,
                     'corte_aplicado', 0,
                     'fornecedor', v_valor_fornecedor,
                     'teto_estourado', false,
                     'base_negativa', true
                   )
              INTO v_split
              FROM jsonb_array_elements(COALESCE(v_participantes, '[]'::jsonb)) elem;

        ELSE
            v_piso_pct := COALESCE((v_plano ->> 'piso_pct')::numeric, 0);

            IF v_start_elegivel
               AND (v_tipo_recompensa = 'start' OR v_start_hibrido)
               AND jsonb_typeof(v_start_regras) = 'object' THEN

                -- FATURA DO START. Matriz sintetica: L1 = percentual do Start
                -- (venda direta, so nivel 1); L2..L4 = recorrencia (hibrido)
                -- ou zero (start). b2w vem do start_config, nao da matriz.
                v_caminho        := 'bonus_start';
                v_start_aplicado := true;
                v_matriz_efetiva := '{}'::jsonb;

                FOR v_papel_key IN
                    SELECT k FROM jsonb_object_keys(v_matriz) k
                    UNION
                    SELECT k FROM jsonb_object_keys(v_start_regras) k
                LOOP
                    IF v_papel_key = 'b2w' THEN
                        v_pct_start := COALESCE(
                            NULLIF(v_start_regras ->> 'b2w', '')::numeric,
                            (v_matriz #>> '{b2w,niveis,L1}')::numeric,
                            0);
                        v_matriz_efetiva := v_matriz_efetiva || jsonb_build_object(
                            'b2w', jsonb_build_object(
                                'niveis', jsonb_build_object(
                                    'L1', v_pct_start, 'L2', v_pct_start,
                                    'L3', v_pct_start, 'L4', v_pct_start),
                                'max_niveis', 4));
                    ELSE
                        v_pct_start := COALESCE(NULLIF(v_start_regras ->> v_papel_key, '')::numeric, 0);

                        IF v_start_hibrido THEN
                            v_niveis_papel := COALESCE(v_matriz #> ARRAY[v_papel_key, 'niveis'], '{}'::jsonb);
                            IF jsonb_typeof(v_niveis_papel) <> 'object' THEN
                                v_niveis_papel := '{}'::jsonb;
                            END IF;
                            v_niveis_papel := jsonb_set(v_niveis_papel, '{L1}', to_jsonb(v_pct_start));
                            v_max_papel := GREATEST(COALESCE((v_matriz #>> ARRAY[v_papel_key, 'max_niveis'])::int, 0), 1);
                        ELSE
                            v_niveis_papel := jsonb_build_object('L1', v_pct_start, 'L2', 0, 'L3', 0, 'L4', 0);
                            v_max_papel := 1;
                        END IF;

                        v_matriz_efetiva := v_matriz_efetiva || jsonb_build_object(
                            v_papel_key, jsonb_build_object(
                                'niveis', v_niveis_papel,
                                'max_niveis', v_max_papel));
                    END IF;
                END LOOP;

                -- ISENCAO DO PISO: o motor recusa teto NULL, entao teto = base.
                v_teto_deducao := round(v_base_calculo, 2);
                v_teto_formula := 'round(base, 2) -- bonus Start: isento do piso do fornecedor';

            ELSIF v_tipo_recompensa = 'start' THEN
                -- Plano so de bonus, fatura fora da janela: parceiro, lider e
                -- Conect nao recebem NADA. Matriz so com 'b2w'.
                v_caminho      := 'start_sem_recorrencia';
                v_start_motivo := CASE
                    WHEN v_start_elegivel
                      THEN 'plano tipo_recompensa=start e start_config.regras nao tem entrada para o ordinal ' || v_ordinal || ': nada a pagar alem da gestao'
                    ELSE 'plano tipo_recompensa=start: fatura ordinal ' || v_ordinal || ' fora de start_config.faturas_elegiveis, e plano start nao paga recorrencia'
                END;
                v_matriz_efetiva := jsonb_build_object('b2w', v_matriz -> 'b2w');
                v_teto_deducao := round(v_base_calculo * (1 - v_piso_pct / 100), 2);
                v_teto_formula := 'round(base * (1 - piso_fornecedor_pct / 100), 2)';

            ELSE
                -- Recorrencia normal: plano 'recorrente' (sempre) e plano
                -- hibrido fora da fatura elegivel.
                v_caminho        := 'recorrencia';
                v_matriz_efetiva := v_matriz;
                v_start_motivo   := CASE
                    WHEN v_tipo_recompensa = 'recorrente'
                      THEN 'plano tipo_recompensa=recorrente: o bonus Start nao existe neste plano (start_config ignorado)'
                    WHEN v_start_elegivel
                      THEN 'start_config.regras nao tem entrada para o ordinal ' || v_ordinal || ': vale a recorrencia'
                    ELSE 'fatura ordinal ' || v_ordinal || ' fora de start_config.faturas_elegiveis: vale a recorrencia'
                END;
                v_teto_deducao := round(v_base_calculo * (1 - v_piso_pct / 100), 2);
                v_teto_formula := 'round(base * (1 - piso_fornecedor_pct / 100), 2)';
            END IF;

            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);

            v_split := public.fn_calcular_split_recompensa(
                v_base_calculo, v_teto_deducao, v_matriz_efetiva, v_participantes
            );

            v_valor_b2w        := COALESCE((v_split -> 'b2w' ->> 'valor')::numeric, 0);
            -- G1: o fornecedor absorve o residuo abaixo do centavo.
            v_valor_fornecedor := COALESCE((v_split ->> 'fornecedor')::numeric, 0)
                                  + (v_base_calculo - round(v_base_calculo, 2));

            IF v_caminho = 'recorrencia'
               AND COALESCE((v_plano ->> 'gestao_pct')::numeric, -1)
                   IS DISTINCT FROM COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, -1) THEN
                RAISE WARNING 'handle_invoice_paid_ledger: plano % tem gestao_percentual=% e matriz b2w.L1=%; valeu a matriz (fatura %)',
                    v_plano ->> 'plano_id', v_plano ->> 'gestao_pct',
                    v_matriz #>> '{b2w,niveis,L1}', NEW.id;
            END IF;
        END IF;

        -- 5. Service Values (sem lancamento proprio no razao hoje)
        IF v_service_values IS NOT NULL THEN
            v_valor_b2w_manutencao   := COALESCE((v_service_values->>'Manutenção')::numeric, 0);
            v_valor_b2w_arrendamento := COALESCE((v_service_values->>'Arrendamento')::numeric, 0);
        END IF;

        -- 6. Asaas Fee
        IF NOW() < '2026-04-19'::timestamp THEN
            v_taxa_asaas := 0.99;
        ELSE
            v_taxa_asaas := 1.99;
        END IF;

        -- 7. Contas
        SELECT id INTO v_account_bank           FROM public.ledger_accounts WHERE code = '1.1.1.01';
        SELECT id INTO v_account_taxa_bancaria  FROM public.ledger_accounts WHERE code = '4.1.1';
        SELECT id INTO v_account_gestao         FROM public.ledger_accounts WHERE code = '3.1.1';
        SELECT id INTO v_account_manutencao     FROM public.ledger_accounts WHERE code = '3.1.3';
        SELECT id INTO v_account_arrendamento   FROM public.ledger_accounts WHERE code = '3.1.4';
        SELECT id INTO v_account_investidor     FROM public.ledger_accounts WHERE code = '2.1.1';
        SELECT id INTO v_account_concessionaria FROM public.ledger_accounts WHERE code = '2.1.3.01';
        SELECT id INTO v_account_comissoes      FROM public.ledger_accounts WHERE code = '2.1.2';
        SELECT id INTO v_account_conect         FROM public.ledger_accounts WHERE code = '2.1.6';

        -- 8. Lancamentos ---------------------------------------------------
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id, external_id)
        VALUES (v_transaction_id, v_account_bank, v_valor_total, 'Recebimento Fatura ' || NEW.id, 'invoice', NEW.id, CASE WHEN NEW.asaas_payment_id IS NULL THEN NULL ELSE NEW.asaas_payment_id || ':' || NEW.id END);

        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_taxa_bancaria, v_taxa_asaas, 'Taxa Boleto Asaas', 'invoice', NEW.id);
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_bank, -v_taxa_asaas, 'Dedução Taxa Asaas', 'invoice', NEW.id);

        IF v_valor_concessionaria <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_concessionaria, -v_valor_concessionaria, 'Provisão Conta Energia', 'invoice', NEW.id);
        END IF;

        IF v_valor_b2w <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_gestao, -v_valor_b2w,
                    CASE WHEN v_caminho = 'base_negativa'
                         THEN 'Gestão B2W — Prejuízo Compartilhado'
                         WHEN v_caminho = 'bonus_start'
                         THEN 'Receita Gestão B2W (Bônus Start)'
                         ELSE 'Receita Gestão B2W (Plano de Recompensas)' END,
                    'invoice', NEW.id);
        END IF;

        IF v_split IS NOT NULL THEN
            FOR v_ben IN SELECT * FROM jsonb_array_elements(COALESCE(v_split -> 'beneficiarios', '[]'::jsonb))
            LOOP
                v_ben_valor := COALESCE((v_ben ->> 'valor')::numeric, 0);
                CONTINUE WHEN v_ben_valor = 0;

                v_ben_papel := v_ben ->> 'papel';
                v_ben_id    := NULLIF(v_ben ->> 'id', '')::uuid;
                v_ben_nivel := COALESCE(v_ben ->> 'nivel', '?');

                IF v_ben_papel = 'assinante_conect' THEN
                    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                    VALUES (v_transaction_id, v_account_conect, -v_ben_valor,
                            CASE WHEN v_caminho = 'bonus_start'
                                 THEN 'Bônus Start Assinante Conect (nível ' || v_ben_nivel || ')'
                                 ELSE 'Crédito Indicação Assinante Conect (nível ' || v_ben_nivel || ')' END,
                            'subscriber', v_ben_id);
                ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider') THEN
                    v_ben_rotulo := CASE v_ben_papel
                                      WHEN 'ppe'   THEN 'Parceiro Power Embaixador'
                                      WHEN 'ppp'   THEN 'Parceiro Power Pro'
                                      WHEN 'ppf'   THEN 'Parceiro Power Free'
                                      WHEN 'lider' THEN 'Líder'
                                    END;
                    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                    VALUES (v_transaction_id, v_account_comissoes, -v_ben_valor,
                            CASE WHEN v_caminho = 'bonus_start' AND v_ben_nivel = '1'
                                 THEN 'Bônus Start ' || v_ben_rotulo || ' (nível ' || v_ben_nivel || ')'
                                 ELSE 'Recompensa ' || v_ben_rotulo || ' (nível ' || v_ben_nivel || ')' END,
                            'originator', v_ben_id);
                ELSE
                    RAISE EXCEPTION 'handle_invoice_paid_ledger: papel "%" nao tem conta no razao (fatura %)', v_ben_papel, NEW.id;
                END IF;
            END LOOP;
        END IF;

        -- 8.4 Fornecedor (2.1.1): sempre lancado, inclusive zero ou negativo.
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_investidor, -v_valor_fornecedor, 'Crédito Repasse Investidor', 'supplier', v_supplier_id);

        -- 9. Congelamento ---------------------------------------------------
        v_bonus_start := jsonb_build_object(
            'fatura_ordinal',   v_ordinal,
            'tipo_recompensa',  v_tipo_recompensa,
            'elegivel',         v_start_elegivel,
            'aplicado',         v_start_aplicado,
            'piso_ignorado',    v_start_aplicado,
            'regras_start',     v_start_regras,
            'motivo',           v_start_motivo
        );

        v_recompensas := jsonb_build_object(
            'versao',            '20260929d_bonus_start',
            'calculado_em',      now(),
            'lancado',           true,
            'aplicado',          (v_motivo IS NULL),
            'motivo',            v_caminho,
            'base',              v_base_calculo,
            'base_formula',      'valor_a_pagar - valor_concessionaria',
            'teto_deducao',      v_teto_deducao,
            'teto_formula',      v_teto_formula,
            'residuo_fornecedor', v_base_calculo - round(v_base_calculo, 2),
            'plano_id',          v_plano -> 'plano_id',
            'tipo_recompensa',   v_tipo_recompensa,
            'piso_pct',          v_plano -> 'piso_pct',
            'gestao_pct_plano',  v_plano -> 'gestao_pct',
            'gestao_pct_matriz', v_matriz #> '{b2w,niveis,L1}',
            'regras',            COALESCE(v_matriz_efetiva, v_matriz),
            'regras_plano',      v_matriz,
            'participantes',     v_participantes,
            'resultado',         v_split,
            'bonus_start',       v_bonus_start
        );

        UPDATE public.invoices
           SET recompensas_aplicadas = v_recompensas
         WHERE id = NEW.id;

    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_invoice_paid_ledger() IS
  'Gatilho AFTER UPDATE de invoices (tr_invoice_paid_ledger): quando a fatura vira "pago", lanca o rateio no razao. Base = valor_a_pagar - valor_concessionaria. Plano por fn_regras_recompensa_uc (UC -> usina -> NULL); participantes por fn_participantes_recompensa; rateio por fn_calcular_split_recompensa, chamado UMA VEZ com a matriz efetiva do caminho. Contas: 1.1.1.01 recebimento e deducao da taxa, 4.1.1 taxa Asaas, 2.1.3.01 provisao da concessionaria, 3.1.1 B2W, 2.1.2 parceiro/lider (reference_type=originator), 2.1.6 Assinante Conect (reference_type=subscriber), 2.1.1 fornecedor (sempre lancado, inclusive zero/negativo). BONUS START (Task 11, decisoes do dono 28-29/09/2026): planos_assinatura_energia.tipo_recompensa manda -- "recorrente" ignora start_config por inteiro; "start" paga SOMENTE o bonus (na fatura elegivel) e NENHUMA recorrencia nas demais faturas daquela UC (sobra gestao B2W + fornecedor); "hibrido" (sinonimo aceito: "ambos") paga o Start no nivel 1 da fatura elegivel MAIS a recorrencia do nivel 2+, e recorrencia cheia nas demais. Elegibilidade = ordinal da fatura paga da UC dentro de start_config.faturas_elegiveis. Os percentuais do Start saem de start_config.regras[<ordinal>], INCLUSIVE a chave b2w, que na fatura do Start ganha da matriz de recorrencia. O Start vale SO no nivel 1 e e ISENTO DO PISO DO FORNECEDOR: teto de deducao = round(base,2) (o motor recusa teto NULL), entao nao ha corte mesmo que o fornecedor fique abaixo do piso ou em zero -- a isencao cobre a fatura elegivel inteira, inclusive a parte de recorrencia do nivel 2+ no hibrido. Nos demais caminhos o teto continua round(base * (1 - piso_fornecedor_pct/100), 2). CONGELAMENTO: recompensas_aplicadas.bonus_start traz fatura_ordinal, tipo_recompensa, elegivel (elegibilidade de calendario), aplicado, piso_ignorado, regras_start e motivo; "regras" e a matriz efetiva que foi ao motor e "regras_plano" e a matriz de recorrencia do plano. NAO LANCA DUAS VEZES: a trava olha recompensas_aplicadas.lancado ou o recebimento ja no razao, entao a fatura bloqueada por uc_sem_usina volta a ser lancavel depois que alguem conserta o vinculo e a ja lancada, nao. UC geradora sem consumo de terceiro: nao lanca nada e nao escreve recompensas_aplicadas. UC inexistente ou UC sem usina: NAO lanca nada e grava lancado:false + motivo. UC sem plano (ou plano sem matriz utilizavel): nenhuma recompensa, nem gestao B2W, e o fornecedor fica com o residual inteiro. BASE NEGATIVA (decisao do dono de 18/08/2026, reconfirmada em 28/09/2026): prejuizo compartilhado -- a B2W absorve a sua fatia (gestao negativa, que no razao aparece positiva pela inversao de sinal das receitas), parceiro/lider/Conect nao recebem nada e o Start nao se aplica. RESIDUO: valor_a_pagar pode ter mais de duas casas; o motor arredonda a base e o fornecedor absorve a diferenca, para a transacao fechar exatamente contra o valor recebido no banco. usinas.gestao_percentual e originators_v2.split_commission NAO sao lidos.';
