-- I1 da revisao final (decisao do dono, 30/09/2026): O PISO DO FORNECEDOR
-- INCIDE SOBRE A TARIFA BRUTA.
--
-- O COMMENT da coluna planos_assinatura_energia.piso_fornecedor_pct sempre
-- disse "percentual minimo da tarifa bruta que o fornecedor recebe", e a spec 1
-- idem. O codigo aplicava o percentual sobre a base, que a Task 12 passou a
-- entregar liquida de desconto e de Fio B -- com isso o teto de deducao ficava
-- mais que o dobro do contratual, e a trava anti-deficit estava calibrada para
-- deixar passar o que devia barrar.
--
--     piso em R$ = kWh compensado * tarifa bruta * piso_fornecedor_pct / 100
--     teto       = GREATEST(round(base,2) - piso em R$, 0)
--
-- CONSEQUENCIA, que o dono conhece: com a Neoenergia Cosern (tarifa 1,0347,
-- Fio B 0,213) e desconto de 20%, base/kWh = 0,61476 e piso/kWh = 0,51735,
-- entao o teto da 15,8% da base -- abaixo dos 16% de uma venda direta de PPE
-- (B2W 10 + PPE 5 + lider 1). A trava passa a CORTAR numa configuracao normal,
-- na ordem Conect -> Parceiro Power -> Lider. Com desconto de 15% (Plano Ultra)
-- o teto da 22,2%, que e o "22,3%" que a spec cita como folga.
--
-- A B2W continua fora do corte (10% fixo, decisao do dono), logo o teto pode
-- ser estourado por ela sozinha; o motor ja sinaliza isso em teto_estourado.
--
-- O Bonus Start segue ISENTO do piso (teto = round(base,2)), e os ramos sem
-- rateio (base negativa, sem plano, sem compensacao) nao mudam.

CREATE OR REPLACE FUNCTION public.handle_invoice_paid_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    c_base_formula constant text :=
        'consumo_compensado * (tarifa * (1 - desconto_pct / 100) - fio_b)';

    v_uc_encontrada       boolean;
    v_usina_id            uuid;
    v_supplier_id         uuid;
    v_subscriber_id       uuid;   -- Task 13: dono do saldo em 1.1.2
    v_service_values      jsonb;
    v_tipo_unidade        text;
    v_fatura_terceiro     boolean;

    v_valor_total         numeric;
    v_valor_concessionaria numeric;
    v_caixa_liquido       numeric;   -- valor_a_pagar - valor_concessionaria
    v_base_info           jsonb;     -- Task 12: fn_base_recompensa_fatura
    v_base_calculo        numeric;   -- Task 12: energia compensada, NAO o caixa

    v_plano               jsonb;
    v_matriz              jsonb;
    v_start_config        jsonb;
    v_participantes       jsonb;
    v_piso_pct            numeric;
    v_piso_reais          numeric;   -- I1: o piso em R$, sobre a tarifa BRUTA
    v_teto_piso           numeric;   -- quanto cabe deduzir sem furar o piso
    v_teto_deducao        numeric;
    v_teto_formula        text;
    v_split               jsonb;
    v_motivo              text;      -- por que NAO houve recompensa (NULL = houve)
    v_caminho             text;      -- recorrencia | bonus_start | start_sem_recorrencia | sem_compensacao | base_negativa | <motivo>
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
    v_total_beneficiarios numeric := 0;
    v_fornecedor_base     numeric;   -- residual DA BASE (o que o motor devolve)
    v_valor_fornecedor    numeric;   -- Task 13: o que vai ao razao = residual da BASE
    v_conta_receber       numeric;   -- Task 13: o que fecha a transacao (1.1.2)
    v_conta_receber_sinal text;
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
    v_account_receber     uuid;   -- Task 13: 1.1.2
    v_account_taxa_bancaria uuid;
BEGIN
    -- F3b: so 'pago'. O enum fatura_status NAO tem 'liquidado'. Status novo de
    -- liquidacao precisa entrar AQUI e na contagem do ordinal (bloco 2).
    IF NEW.status::text = 'pago' AND OLD.status IS DISTINCT FROM NEW.status THEN

        -- 1. Metadata. LEFT JOIN de proposito (F3c).
        SELECT u.id, u.supplier_id, u.service_values,
               cu.tipo_unidade, cu.fatura_consumo_terceiro, cu.subscriber_id
        INTO v_usina_id, v_supplier_id, v_service_values,
             v_tipo_unidade, v_fatura_terceiro, v_subscriber_id
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

        -- CAIXA: o dinheiro que entrou menos a obrigacao com a concessionaria.
        -- A partir da Task 12 isso NAO e a base da recompensa; a partir da
        -- Task 13 tambem nao e mais o que o fornecedor recebe -- e so o lado
        -- financeiro da transacao, contra o qual o saldo do assinante fecha.
        v_caixa_liquido := v_valor_total - v_valor_concessionaria;

        IF NOT v_uc_encontrada THEN
            v_motivo := 'uc_inexistente';
            v_bloqueado := true;
        ELSIF v_usina_id IS NULL THEN
            v_motivo := 'uc_sem_usina';
            v_bloqueado := true;
        ELSE
            -- Task 12: BASE = energia compensada x tarifa liquida do cadastro.
            v_base_info := public.fn_base_recompensa_fatura(NEW.id);

            IF COALESCE((v_base_info ->> 'ok')::boolean, false) THEN
                v_base_calculo := COALESCE((v_base_info ->> 'base')::numeric, 0);
            ELSE
                -- cadastro da concessionaria ausente, ambiguo ou incompleto:
                -- NAO calcular com zero em silencio (Fio B faltando vira
                -- comissao inflada). Bloqueia como uc_sem_usina.
                v_motivo := COALESCE(v_base_info ->> 'motivo', 'base_indisponivel');
                v_bloqueado := true;
            END IF;
        END IF;

        IF v_bloqueado THEN
            RAISE WARNING 'handle_invoice_paid_ledger: fatura % nao foi lancada (%); UC %', NEW.id, v_motivo, NEW.uc_id;

            UPDATE public.invoices
               SET recompensas_aplicadas = jsonb_build_object(
                     'versao',           '20260929f_conta_receber_assinante',
                     'calculado_em',     now(),
                     'lancado',          false,
                     'aplicado',         false,
                     'motivo',           v_motivo,
                     'base',             NULL,
                     'base_formula',     c_base_formula,
                     'base_componentes', v_base_info,
                     'caixa_liquido',    v_caixa_liquido,
                     'assinante_id',     v_subscriber_id
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

        ELSIF COALESCE((v_base_info ->> 'sem_compensacao')::boolean, false) THEN
            -- Task 12: nao houve energia compensada -> nao ha base. Ninguem
            -- recebe recompensa, e o fornecedor tambem nao repassa nada (o
            -- residual da base zero e zero). Task 13: o caixa inteiro vira
            -- saldo do assinante. Nao se inventa base a partir do cobrado.
            v_caminho       := 'sem_compensacao';
            v_start_motivo  := 'fatura sem energia compensada: nao ha base de recompensa, e o Start tambem nao se aplica';
            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);
            v_matriz_efetiva := v_matriz;
            v_teto_deducao  := 0;
            v_teto_formula  := 'zero -- sem energia compensada nao ha base a deduzir';
            v_split         := public.fn_calcular_split_recompensa(0, 0, v_matriz, v_participantes);
            v_valor_b2w     := 0;

        ELSIF v_base_calculo < 0 THEN
            -- F1 -- BASE NEGATIVA: PREJUIZO COMPARTILHADO (dono, 18/08/2026,
            -- reconfirmado 28/09/2026). O Start tambem nao se aplica.
            -- Com a base da Task 12 isso so acontece quando a tarifa liquida
            -- do cadastro fica negativa (Fio B maior que a tarifa com
            -- desconto) -- cadastro que precisa aparecer, nao ser zerado.
            v_caminho      := 'base_negativa';
            v_start_motivo := 'base negativa: prejuizo compartilhado nao paga bonus';
            v_pct_b2w   := GREATEST(COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, 0), 0);
            v_valor_b2w := round(v_base_calculo * v_pct_b2w / 100, 2);   -- negativo

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
                     'fornecedor', v_base_calculo - v_valor_b2w,
                     'teto_estourado', false,
                     'base_negativa', true
                   )
              INTO v_split
              FROM jsonb_array_elements(COALESCE(v_participantes, '[]'::jsonb)) elem;

        ELSE
            v_piso_pct := COALESCE((v_plano ->> 'piso_pct')::numeric, 0);

            -- I1 (decisao do dono, 30/09/2026): O PISO INCIDE SOBRE A TARIFA
            -- BRUTA, nao sobre a base. E o que o COMMENT da coluna
            -- piso_fornecedor_pct sempre disse ("percentual minimo da tarifa
            -- bruta que o fornecedor recebe") e o que a spec 1 diz; o codigo
            -- vinha aplicando o percentual sobre v_base_calculo, que ja vem
            -- liquida de desconto e de Fio B, e por isso o teto de deducao
            -- saia mais que o dobro do contratual.
            --
            --     piso em R$ = kWh compensado * tarifa bruta * piso_pct / 100
            --     teto       = base - piso em R$   (nunca negativo)
            --
            -- Consequencia que o dono conhece e aceitou: com a Cosern e
            -- desconto de 20% (base/kWh 0,61476 e piso/kWh 0,51735) o teto da
            -- 15,8% da base, abaixo dos 16% de uma venda direta de PPE -- ou
            -- seja, a trava passa a CORTAR numa configuracao normal, na ordem
            -- Conect -> Parceiro Power -> Lider. Com desconto de 15% (Plano
            -- Ultra) o teto da 22,2%, que e o "22,3%" citado na spec.
            --
            -- A B2W continua fora do corte (decisao do dono: 10% fixo), entao
            -- o teto pode ser estourado por ela sozinha -- o motor sinaliza
            -- isso em teto_estourado, e e la que o auditor tem de olhar.
            v_piso_reais := round(COALESCE((v_base_info ->> 'kwh_compensado')::numeric, 0)
                                  * COALESCE((v_base_info ->> 'tarifa')::numeric, 0)
                                  * v_piso_pct / 100, 2);
            v_teto_piso  := GREATEST(round(v_base_calculo, 2) - v_piso_reais, 0);

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
                v_teto_deducao := v_teto_piso;
                v_teto_formula := 'GREATEST(round(base,2) - round(kWh * tarifa_bruta * piso_fornecedor_pct/100, 2), 0)';

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
                v_teto_deducao := v_teto_piso;
                v_teto_formula := 'GREATEST(round(base,2) - round(kWh * tarifa_bruta * piso_fornecedor_pct/100, 2), 0)';
            END IF;

            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);

            v_split := public.fn_calcular_split_recompensa(
                v_base_calculo, v_teto_deducao, v_matriz_efetiva, v_participantes
            );

            v_valor_b2w := COALESCE((v_split -> 'b2w' ->> 'valor')::numeric, 0);

            IF v_caminho = 'recorrencia'
               AND COALESCE((v_plano ->> 'gestao_pct')::numeric, -1)
                   IS DISTINCT FROM COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, -1) THEN
                RAISE WARNING 'handle_invoice_paid_ledger: plano % tem gestao_percentual=% e matriz b2w.L1=%; valeu a matriz (fatura %)',
                    v_plano ->> 'plano_id', v_plano ->> 'gestao_pct',
                    v_matriz #>> '{b2w,niveis,L1}', NEW.id;
            END IF;
        END IF;

        -- 4b. Task 13 -- O FORNECEDOR VOLTA A SER O RESIDUAL DA BASE, e a
        -- diferenca para o caixa vira CONTA A RECEBER DO ASSINANTE (1.1.2).
        -- O round(...,2) existe para os ramos que nao passam pelo motor
        -- (uc_sem_plano, base_negativa) tambem lancarem duas casas exatas; nos
        -- que passam ele e no-op, porque o motor ja arredonda p_base.
        SELECT COALESCE(SUM((b ->> 'valor')::numeric), 0)
          INTO v_total_beneficiarios
          FROM jsonb_array_elements(COALESCE(v_split -> 'beneficiarios', '[]'::jsonb)) b;

        -- C1 (revisao final, 30/09/2026): o fallback era v_base_calculo, entao
        -- no caminho sem plano o fornecedor era creditado com a BASE em vez do
        -- CAIXA -- e a diferenca virava conta a receber contra um assinante que
        -- nao devia nada. O proprio COMMENT desta funcao ja dizia "UC sem
        -- plano: o fornecedor fica com o caixa inteiro"; o codigo contradizia a
        -- documentacao dele. Medido numa fatura real de 4.948 kWh compensados:
        -- 2.1.1 -4.065,77 e 1.1.2 +1.037,87, quando o certo era 2.1.1 -3.027,90
        -- e 1.1.2 so com o residuo de centavo. E o caminho de 100% da producao
        -- enquanto nenhuma usina estiver amarrada a um plano.
        -- Os ramos que montam v_split na mao (base_negativa) nao caem aqui.
        v_fornecedor_base  := COALESCE((v_split ->> 'fornecedor')::numeric, v_caixa_liquido);
        v_valor_fornecedor := round(COALESCE(v_fornecedor_base, 0), 2);

        -- X = b2w + beneficiarios + fornecedor - caixa, calculado a partir do
        -- que REALMENTE foi lancado. E o unico numero que faz a soma da
        -- transacao dar ZERO EXATO, e e ele que carrega a fracao de centavo.
        v_conta_receber := v_valor_b2w + v_total_beneficiarios
                           + v_valor_fornecedor - v_caixa_liquido;

        v_conta_receber_sinal := CASE
                                   WHEN v_conta_receber > 0 THEN 'assinante_deve'
                                   WHEN v_conta_receber < 0 THEN 'assinante_adiantado'
                                   ELSE 'sem_saldo'
                                 END;

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
        SELECT id INTO v_account_receber        FROM public.ledger_accounts WHERE code = '1.1.2';

        -- Sem a 1.1.2 a diferenca nao tem para onde ir e a transacao fecharia
        -- torta em silencio. Melhor estourar.
        IF v_account_receber IS NULL AND v_conta_receber <> 0 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: a conta 1.1.2 (Contas a Receber de Assinantes) nao existe no plano de contas; a fatura % teria % sem contrapartida', NEW.id, v_conta_receber;
        END IF;

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
        --     Task 13: e o residual DA BASE, nunca mais o residual do caixa.
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_investidor, -v_valor_fornecedor, 'Crédito Repasse Investidor', 'supplier', v_supplier_id);

        -- 8.5 Conta a Receber do Assinante (1.1.2): o saldo do ciclo. So
        --     lanca quando ha saldo -- saldo zero nao polui o razao.
        IF v_conta_receber <> 0 THEN
            IF v_subscriber_id IS NULL THEN
                RAISE WARNING 'handle_invoice_paid_ledger: fatura % gerou saldo de % em 1.1.2 mas a UC % nao tem assinante; saldo sem dono nao e cobravel', NEW.id, v_conta_receber, NEW.uc_id;
            END IF;

            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_receber, v_conta_receber,
                    CASE WHEN v_conta_receber > 0
                         THEN 'Conta a Receber do Assinante (saldo do ciclo)'
                         ELSE 'Conta a Receber do Assinante — Assinante Adiantado (saldo do ciclo)' END,
                    'subscriber', v_subscriber_id);
        END IF;

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
            'versao',            '20260929f_conta_receber_assinante',
            'calculado_em',      now(),
            'lancado',           true,
            'aplicado',          (v_motivo IS NULL),
            'motivo',            v_caminho,
            'base',              v_base_calculo,
            'base_formula',      c_base_formula,
            'base_componentes',  v_base_info,
            'caixa_liquido',     v_caixa_liquido,
            'teto_deducao',      v_teto_deducao,
            'teto_formula',      v_teto_formula,
            'fornecedor_base',   v_fornecedor_base,
            'fornecedor_caixa',  v_valor_fornecedor,
            'assinante_id',      v_subscriber_id,
            'conta_receber_assinante', v_conta_receber,
            'conta_receber_sinal',     v_conta_receber_sinal,
            'conta_receber_formula',   'gestao + beneficiarios + fornecedor - caixa_liquido',
            'residuo_caixa',           v_caixa_liquido - round(v_caixa_liquido, 2),
            'residuo_absorvido_por',   'conta_receber_assinante',
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

ALTER FUNCTION public.handle_invoice_paid_ledger() OWNER TO postgres;

COMMENT ON FUNCTION public.handle_invoice_paid_ledger() IS
  'Gatilho AFTER UPDATE de invoices (tr_invoice_paid_ledger), com as correcoes da revisao final de 30/09/2026: quando a fatura vira "pago", lanca o rateio no razao. BASE (Task 12, decisao do dono 29/09/2026): a recompensa incide sobre a ENERGIA COMPENSADA -- base = consumo_compensado * (tarifa * (1 - desconto_pct/100) - fio_b), calculada por fn_base_recompensa_fatura, com tarifa e Fio B do cadastro da concessionaria e desconto do plano. A conta da concessionaria NAO abate a base: ela continua lancada em 2.1.3.01 como obrigacao separada. Se houve compensada a comissao e devida, mesmo com a conta do assinante zerada ou negativa por parcelamento, iluminacao publica ou consumo excedente. FORNECEDOR = RESIDUAL DA BASE (Task 13, decisao do dono 29/09/2026): e exatamente o "fornecedor" que fn_calcular_split_recompensa devolve (congelado em fornecedor_base), arredondado a 2 casas; o investidor NAO e mais debitado da diferenca entre a base e o caixa. CONTA A RECEBER DO ASSINANTE (1.1.2, asset, filha de 1.1.0): o lancamento que FECHA a transacao e X = gestao B2W + beneficiarios + fornecedor - caixa_liquido, com reference_type=subscriber e reference_id = o assinante da UC. POSITIVO = o assinante ainda deve (tipico da fatura em que a conta da concessionaria supera a cobranca); NEGATIVO = o assinante esta adiantado. Saldo ZERO nao gera lancamento. E a 1.1.2 quem absorve a fracao de centavo de valor_a_pagar (numeric sem escala), porque o fornecedor virou numero fechado pelo motor e a fracao vem do dinheiro que o assinante pagou -- a soma da transacao fecha em ZERO EXATO, sem tolerancia. O congelamento guarda base, base_formula, base_componentes (kWh, tarifa, Fio B, desconto, classe e concessionaria usados naquele dia), caixa_liquido, fornecedor_base, fornecedor_caixa (o que foi lancado ao fornecedor, hoje igual ao fornecedor_base), assinante_id, conta_receber_assinante, conta_receber_sinal (assinante_deve | assinante_adiantado | sem_saldo), conta_receber_formula, residuo_caixa e residuo_absorvido_por. CADASTRO INCOMPLETO BLOQUEIA: concessionaria ausente, nao cadastrada, ambigua (mais de um valor de tarifa ou Fio B) ou com tarifa/Fio B nulos ou zero -> nada no razao e motivo gravado, como o ramo uc_sem_usina; Fio B faltando tratado como zero inflaria a comissao. SEM COMPENSACAO: base zero, ninguem recebe recompensa, fornecedor tambem nao repassa nada, motivo sem_compensacao, e o caixa inteiro vira saldo do assinante em 1.1.2. Plano por fn_regras_recompensa_uc (UC -> usina -> NULL); participantes por fn_participantes_recompensa; rateio por fn_calcular_split_recompensa, chamado UMA VEZ com a matriz efetiva do caminho. Contas: 1.1.1.01 recebimento e deducao da taxa, 4.1.1 taxa Asaas, 2.1.3.01 provisao da concessionaria, 3.1.1 B2W, 2.1.2 parceiro/lider (reference_type=originator), 2.1.6 Assinante Conect (reference_type=subscriber), 2.1.1 fornecedor (sempre lancado, inclusive zero ou negativo), 1.1.2 conta a receber do assinante (so quando ha saldo). BONUS START (Task 11, decisoes do dono 28-29/09/2026): planos_assinatura_energia.tipo_recompensa manda -- "recorrente" ignora start_config por inteiro; "start" paga SOMENTE o bonus (na fatura elegivel) e NENHUMA recorrencia nas demais faturas daquela UC; "hibrido" (sinonimo aceito: "ambos") paga o Start no nivel 1 da fatura elegivel MAIS a recorrencia do nivel 2+, e recorrencia cheia nas demais. Elegibilidade = ordinal da fatura paga da UC dentro de start_config.faturas_elegiveis. Os percentuais do Start saem de start_config.regras[<ordinal>], INCLUSIVE a chave b2w. O Start vale SO no nivel 1 e e ISENTO DO PISO DO FORNECEDOR: teto de deducao = round(base,2) (o motor recusa teto NULL). Nos demais caminhos o teto continua round(base * (1 - piso_fornecedor_pct/100), 2). NAO LANCA DUAS VEZES: a trava olha recompensas_aplicadas.lancado ou o recebimento ja no razao, entao a fatura bloqueada volta a ser lancavel depois que alguem conserta, e a ja lancada, nao. UC geradora sem consumo de terceiro: nao lanca nada e nao escreve recompensas_aplicadas. UC inexistente ou UC sem usina: NAO lanca nada e grava lancado:false + motivo. UC sem plano (ou plano sem matriz utilizavel): nenhuma recompensa, nem gestao B2W, o fornecedor fica com a base e a diferenca para o caixa vai para 1.1.2. BASE NEGATIVA (dono, 18/08/2026, reconfirmada 28/09/2026): prejuizo compartilhado -- a B2W absorve a fatia dela, parceiro/lider/Conect nao recebem nada e o Start nao se aplica. usinas.gestao_percentual e originators_v2.split_commission NAO sao lidos. CORRECAO 30/09: no caminho SEM PLANO o fornecedor fica com o CAIXA (era a BASE, o que creditava o investidor a mais e inventava conta a receber contra assinante em dia); e plano sem desconto_assinante passou a bloquear em fn_base_recompensa_fatura, porque desconto nulo virava zero e inflava a base sobre a qual as recompensas eram pagas. CORRECAO 30/09 (piso): o piso do fornecedor incide sobre a TARIFA BRUTA, nao sobre a base -- teto de deducao = GREATEST(round(base,2) - round(kWh * tarifa_bruta * piso_fornecedor_pct/100, 2), 0). Antes o percentual era aplicado sobre a base, que ja vem liquida de desconto e de Fio B, e o teto saia mais que o dobro do contratual. Com a Cosern a 20% de desconto o teto correto da 15,8% da base, abaixo dos 16% de uma venda direta de PPE: a trava passa a cortar numa configuracao normal. A B2W segue fora do corte, entao o teto pode ser estourado por ela sozinha e o motor sinaliza em teto_estourado.';
