-- Task 6 (Split de Pagamentos): o gatilho de fatura paga passa a dividir o
-- dinheiro pela MATRIZ DO PLANO (Tasks 3/4/5) em vez de
-- originators_v2.split_commission.
-- Spec: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-6-brief.md
--
-- O que MUDA (blocos 3, 4 e 6 do corpo antigo):
--   * base continua sendo valor_a_pagar - valor_concessionaria (Task 1);
--   * plano resolvido por fn_regras_recompensa_uc (UC -> usina -> NULL);
--   * participantes por fn_participantes_recompensa;
--   * rateio por fn_calcular_split_recompensa (motor puro);
--   * B2W em 3.1.1, parceiro/lider em 2.1.2, Assinante Conect em 2.1.6,
--     fornecedor em 2.1.1;
--   * invoices.recompensas_aplicadas congela o retorno do motor.
--
-- O que NAO muda: a guarda de UC geradora, o recebimento em 1.1.1.01, a taxa
-- Asaas (4.1.1 + deducao em 1.1.1.01), a provisao da concessionaria em
-- 2.1.3.01, e o lancamento do fornecedor em 2.1.1 (sempre emitido, inclusive
-- zero ou negativo). Continua SECURITY DEFINER / dona postgres /
-- search_path fixo (20260922g) -- e isso que permite chamar
-- fn_participantes_recompensa, cujo EXECUTE e so de service_role.

-- ---------------------------------------------------------------------
-- 1. Conta nova: 2.1.6 -- Creditos de Indicacao a Assinantes
--    Obrigacao com o Assinante Conect (pessoa fisica assinante que indicou),
--    separada de 2.1.2 (Comissoes a Pagar), que continua sendo so de
--    parceiro/lider (originators_v2, reference_type = 'originator').
-- ---------------------------------------------------------------------
INSERT INTO public.ledger_accounts (code, name, type, parent_id)
SELECT '2.1.6', 'Créditos de Indicação a Assinantes', 'liability', p.id
  FROM public.ledger_accounts p
 WHERE p.code = '2.1.0'
   AND NOT EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.code = '2.1.6');

-- ---------------------------------------------------------------------
-- 2. invoices.recompensas_aplicadas -- o congelamento
-- ---------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS recompensas_aplicadas jsonb;

COMMENT ON COLUMN public.invoices.recompensas_aplicadas IS
  'Congelamento do rateio de recompensas desta fatura, gravado por handle_invoice_paid_ledger no momento do pagamento. Guarda plano_id, piso_pct, gestao_pct, a matriz (regras) usada, os participantes, o retorno integral de fn_calcular_split_recompensa (resultado), a base e o teto de deducao. MUDAR O PLANO DEPOIS NAO REESCREVE FATURA PAGA: e este JSON, e nao o plano de hoje, que explica o dinheiro ja lancado. NULL = fatura nunca paga, ou UC geradora (que nao entra no rateio). aplicado=false + motivo explicam por que nao houve recompensa (ex.: uc_sem_plano).';

-- ---------------------------------------------------------------------
-- 3. O gatilho
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_invoice_paid_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_usina_id            uuid;
    v_supplier_id         uuid;
    v_service_values      jsonb;
    v_tipo_unidade        text;
    v_fatura_terceiro     boolean;

    v_valor_total         numeric;
    v_valor_concessionaria numeric;
    v_base_calculo        numeric;

    -- plano / matriz / rateio
    v_plano               jsonb;
    v_matriz              jsonb;
    v_start_config        jsonb;
    v_participantes       jsonb;
    v_piso_pct            numeric;
    v_teto_deducao        numeric;
    v_split               jsonb;
    v_motivo              text;
    v_recompensas         jsonb;

    -- bonus Start (detectado e registrado; ver COMMENT ON FUNCTION)
    v_ordinal             integer;
    v_start_elegivel      boolean := false;
    v_start_regras        jsonb;
    v_bonus_start         jsonb;

    v_valor_b2w           numeric := 0;
    v_valor_fornecedor    numeric;
    v_taxa_asaas          numeric;

    -- calculados hoje e sem lancamento proprio no razao; mantidos como estavam
    -- para nao mudar nada fora do escopo desta task.
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
    -- Only proceed if status changed to 'pago' or 'liquidado'
    IF NEW.status::text IN ('pago', 'liquidado') AND OLD.status IS DISTINCT FROM NEW.status THEN

        -- 1. Metadata (Usina, Supplier, Tipo Unidade)
        --    usinas.gestao_percentual NAO e mais lido: a gestao vem do plano
        --    (decisao do dono, 27/09/2026). originators_v2.split_commission
        --    tambem nao e mais lido -- quem recebe vem de
        --    fn_participantes_recompensa.
        SELECT u.id, u.supplier_id, u.service_values,
               cu.tipo_unidade, cu.fatura_consumo_terceiro
        INTO v_usina_id, v_supplier_id, v_service_values,
             v_tipo_unidade, v_fatura_terceiro
        FROM public.consumer_units cu
        JOIN public.usinas u ON u.id = cu.usina_id
        WHERE cu.id = NEW.uc_id;

        -- GUARD CLAUSE: Do not process financial splits for 'geradora' units.
        -- Excecao: UG que abriga consumo de terceiro (telhado arrendado) tem
        -- assinante real sendo cobrado, entao o split roda normalmente.
        IF v_tipo_unidade = 'geradora' AND COALESCE(v_fatura_terceiro, false) = false THEN
            RETURN NEW;
        END IF;

        v_transaction_id := gen_random_uuid();
        v_valor_total := COALESCE(NEW.valor_a_pagar, 0);
        v_valor_concessionaria := COALESCE(NEW.valor_concessionaria, 0);
        -- BASE (Task 1, decisao do dono 27/09/2026): o que a fatura arrecadou
        -- de fato. lastro_tarifario do plano e referencia de simulador e nunca
        -- entra aqui.
        v_base_calculo := v_valor_total - v_valor_concessionaria;

        -- 2. Ordinal desta fatura entre as pagas da UC (1a, 2a, 3a ...).
        --    Conta 'pago' e 'liquidado', que sao os dois status que disparam
        --    este gatilho. Usado pelo bonus Start.
        SELECT COUNT(*) + 1 INTO v_ordinal
        FROM public.invoices
        WHERE uc_id = NEW.uc_id
          AND status::text IN ('pago', 'liquidado')
          AND id <> NEW.id;

        -- 3. Plano da UC -> matriz de recompensas
        v_plano        := public.fn_regras_recompensa_uc(NEW.uc_id);
        v_matriz       := v_plano -> 'regras_multinivel';
        v_start_config := v_plano -> 'start_config';

        IF v_plano IS NULL THEN
            -- Sem plano na UC nem na usina: NENHUM lancamento de recompensa
            -- (nem gestao B2W -- ela tambem vem do plano agora) e o fornecedor
            -- fica com o residual inteiro. O motivo vai para a fatura.
            v_motivo := 'uc_sem_plano';
        ELSIF v_matriz IS NULL
              OR jsonb_typeof(v_matriz) <> 'object'
              OR v_matriz #> '{b2w,niveis}' IS NULL THEN
            -- Plano existe mas nao tem matriz utilizavel. Mesmo tratamento:
            -- nao se inventa percentual sobre dinheiro real.
            v_motivo := 'plano_sem_matriz';
        END IF;

        -- 3b. Bonus Start: DETECTADO e registrado, nao aplicado.
        --     start_config.regras e indexado pelo ORDINAL da fatura (1a/2a/3a,
        --     como a tela PlanModal grava) e traz um percentual unico por
        --     papel, SEM dimensao de nivel -- ao contrario da recorrencia, que
        --     e uma matriz papel x nivel. Como o motor exige niveis/max_niveis
        --     por papel, aplicar o Start hoje exigiria inventar em qual nivel
        --     cada percentual vale. Ver task-6-report.md.
        IF v_start_config IS NOT NULL
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

        v_bonus_start := jsonb_build_object(
            'fatura_ordinal', v_ordinal,
            'elegivel', v_start_elegivel,
            'aplicado', false,
            'motivo', 'start_config.regras nao diz em que nivel cada percentual vale; aplicar exigiria inventar max_niveis (task-6-report.md). Ate o dono definir, vale a recorrencia.',
            'regras_start', v_start_regras
        );

        -- 4. Rateio
        IF v_motivo IS NULL THEN
            v_piso_pct := COALESCE((v_plano ->> 'piso_pct')::numeric, 0);

            -- TETO DE DEDUCAO: o fornecedor nao pode cair abaixo do piso do
            -- plano. Como o piso e um percentual da MESMA base que esta sendo
            -- dividida, o maximo deduzivel e:
            --     teto = round(base * (1 - piso_fornecedor_pct / 100), 2)
            -- Arredondado aqui de proposito: o motor arredonda a base, nao o
            -- teto, entao quem passa o teto e quem garante as 2 casas.
            v_teto_deducao := round(v_base_calculo * (1 - v_piso_pct / 100), 2);

            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);

            v_split := public.fn_calcular_split_recompensa(
                v_base_calculo, v_teto_deducao, v_matriz, v_participantes
            );

            -- b2w.valor ja e o TOTAL da B2W (nominal + absorvido dos
            -- suspensos); somar valor_absorvido de novo pagaria em dobro.
            v_valor_b2w        := COALESCE((v_split -> 'b2w' ->> 'valor')::numeric, 0);
            v_valor_fornecedor := COALESCE((v_split ->> 'fornecedor')::numeric, 0);

            -- Duas fontes de gestao dentro do mesmo plano (a coluna
            -- gestao_percentual e o b2w da matriz). Quem paga e a matriz, que
            -- e o que o motor le; divergencia e erro de cadastro e fica
            -- avisada no log e congelada nos dois campos da fatura.
            IF COALESCE((v_plano ->> 'gestao_pct')::numeric, -1)
               IS DISTINCT FROM COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, -1) THEN
                RAISE WARNING 'handle_invoice_paid_ledger: plano % tem gestao_percentual=% e matriz b2w.L1=%; valeu a matriz (fatura %)',
                    v_plano ->> 'plano_id', v_plano ->> 'gestao_pct',
                    v_matriz #>> '{b2w,niveis,L1}', NEW.id;
            END IF;
        ELSE
            v_participantes    := NULL;
            v_split            := NULL;
            v_teto_deducao     := NULL;
            v_valor_b2w        := 0;
            v_valor_fornecedor := v_base_calculo;
        END IF;

        -- 5. Service Values (sem lancamento proprio no razao hoje; mantido
        --    exatamente como estava antes desta task)
        IF v_service_values IS NOT NULL THEN
            v_valor_b2w_manutencao   := COALESCE((v_service_values->>'Manutenção')::numeric, 0);
            v_valor_b2w_arrendamento := COALESCE((v_service_values->>'Arrendamento')::numeric, 0);
        END IF;

        -- 6. Asaas Fee (0.99 ou 1.99) -- inalterado
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

        -- 8.1 recebimento, taxa e concessionaria: IDENTICOS aos de hoje
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

        -- 8.2 B2W (3.1.1): total que a B2W recebe, ja incluindo o que absorveu
        --     de participante suspenso (PPP com licenca vencida, originador
        --     inativo, Conect nao-ativo).
        IF v_valor_b2w <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_gestao, -v_valor_b2w, 'Receita Gestão B2W (Plano de Recompensas)', 'invoice', NEW.id);
        END IF;

        -- 8.3 Beneficiarios: parceiro/lider em 2.1.2 (originator), Assinante
        --     Conect em 2.1.6 (subscriber). Valor ja e o pos-corte.
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
                            'Crédito Indicação Assinante Conect (nível ' || v_ben_nivel || ')',
                            'subscriber', v_ben_id);
                ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider') THEN
                    v_ben_rotulo := CASE v_ben_papel
                                      WHEN 'ppe'   THEN 'Parceiro Power Elite'
                                      WHEN 'ppp'   THEN 'Parceiro Power Pro'
                                      WHEN 'ppf'   THEN 'Parceiro Power Free'
                                      WHEN 'lider' THEN 'Líder'
                                    END;
                    INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
                    VALUES (v_transaction_id, v_account_comissoes, -v_ben_valor,
                            'Recompensa ' || v_ben_rotulo || ' (nível ' || v_ben_nivel || ')',
                            'originator', v_ben_id);
                ELSE
                    -- papel novo sem conta definida: parar, nunca lancar no
                    -- lugar errado nem engolir o valor em silencio.
                    RAISE EXCEPTION 'handle_invoice_paid_ledger: papel "%" nao tem conta no razao (fatura %)', v_ben_papel, NEW.id;
                END IF;
            END LOOP;
        END IF;

        -- 8.4 Fornecedor (2.1.1): sempre lancado, inclusive zero (visibilidade)
        --     ou negativo (debito) -- como hoje.
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_investidor, -v_valor_fornecedor, 'Crédito Repasse Investidor', 'supplier', v_supplier_id);

        -- 9. Congelamento ---------------------------------------------------
        v_recompensas := jsonb_build_object(
            'versao',            '20260928i_gatilho_split',
            'calculado_em',      now(),
            'aplicado',          (v_motivo IS NULL),
            'motivo',            COALESCE(v_motivo, 'recorrencia'),
            'base',              v_base_calculo,
            'base_formula',      'valor_a_pagar - valor_concessionaria',
            'teto_deducao',      v_teto_deducao,
            'teto_formula',      'round(base * (1 - piso_fornecedor_pct / 100), 2)',
            'plano_id',          v_plano -> 'plano_id',
            'piso_pct',          v_plano -> 'piso_pct',
            'gestao_pct_plano',  v_plano -> 'gestao_pct',
            'gestao_pct_matriz', v_matriz #> '{b2w,niveis,L1}',
            'regras',            v_matriz,
            'participantes',     v_participantes,
            'resultado',         v_split,
            'bonus_start',       v_bonus_start
        );

        -- Este UPDATE re-dispara os gatilhos de invoices, mas nao recursa: a
        -- guarda la em cima exige OLD.status IS DISTINCT FROM NEW.status, e
        -- aqui o status nao muda. log_invoice_change tambem sai sem gravar
        -- (nenhum dos campos que ele observa mudou).
        UPDATE public.invoices
           SET recompensas_aplicadas = v_recompensas
         WHERE id = NEW.id;

    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_invoice_paid_ledger() IS
  'Gatilho AFTER UPDATE de invoices (tr_invoice_paid_ledger): quando a fatura vira pago/liquidado, lanca o rateio no razao. Base = valor_a_pagar - valor_concessionaria. Plano por fn_regras_recompensa_uc (UC -> usina -> NULL); participantes por fn_participantes_recompensa; rateio por fn_calcular_split_recompensa, com teto de deducao = round(base * (1 - piso_fornecedor_pct/100), 2), que e o quanto pode ser deduzido sem furar o piso do fornecedor. Contas: 1.1.1.01 recebimento e deducao da taxa, 4.1.1 taxa Asaas, 2.1.3.01 provisao da concessionaria, 3.1.1 B2W (total, ja com o que ela absorveu de participante suspenso), 2.1.2 parceiro/lider (reference_type=originator), 2.1.6 Assinante Conect (reference_type=subscriber), 2.1.1 fornecedor (sempre lancado, inclusive zero/negativo). UC geradora sem consumo de terceiro: nao lanca nada e nao escreve recompensas_aplicadas. UC sem plano (ou plano sem matriz): nenhuma recompensa, nem gestao B2W, e o fornecedor fica com o residual inteiro; o motivo vai para invoices.recompensas_aplicadas. usinas.gestao_percentual e originators_v2.split_commission NAO sao mais lidos. BONUS START: a elegibilidade da fatura (ordinal entre as pagas da UC x start_config.faturas_elegiveis) e detectada e registrada em recompensas_aplicadas.bonus_start, mas NAO e aplicada -- start_config.regras traz um percentual unico por papel, sem dimensao de nivel, e o motor exige niveis/max_niveis; aplicar hoje seria inventar. Enquanto isso, vale a recorrencia. Ver .superpowers/sdd/2026-09-27-split-de-pagamentos/task-6-report.md.';
