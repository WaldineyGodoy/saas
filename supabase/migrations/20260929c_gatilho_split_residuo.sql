-- Task 6, fix round 1: ajustes em handle_invoice_paid_ledger apontados na
-- revisao de 29/09/2026. CREATE OR REPLACE -- mantem SECURITY DEFINER, dona
-- postgres e search_path fixo (20260922g).
--
-- F1 (importante) -- BASE NEGATIVA mudou de dono em silencio na 20260928i.
--   O corpo anterior (20260922g) implementava, de proposito, a decisao do dono
--   de 18/08/2026: com base negativa a fatia da B2W tambem fica negativa
--   ("prejuizo compartilhado"), e a trava que zera a gestao era restrita a
--   base positiva. A 20260928i passou a delegar tudo ao motor puro, cujo
--   contrato e "base <= 0 -> tudo zero", e com isso a B2W saia ilesa e o
--   fornecedor absorvia o prejuizo inteiro. O dono RECONFIRMOU a regra de
--   18/08 em 28/09/2026: restaurada aqui, num ramo do GATILHO (o motor puro
--   continua com o contrato dele intacto).
--
-- F2 (importante) -- EXECUCAO DUPLA duplicava a transacao inteira.
--   pago -> ag_emissao_boleto -> pago gerava DUAS transacoes completas
--   (banco, gestao, comissoes e repasse pagos em dobro), cada uma fechando em
--   zero -- por isso a asserção "fecha em zero" nao pegava. Agora o gatilho se
--   recusa a lancar quando a fatura ja tem o recebimento dela no razao ou ja
--   tem recompensas_aplicadas.
--
-- F3 (menor) -- tres pontas:
--   a) 'plano_sem_matriz' nao pegava "niveis": null (jsonb null nao e SQL
--      NULL); passou a usar jsonb_typeof(...) <> 'object';
--   b) o ramo 'liquidado' era morto -- o enum fatura_status (conferido em
--      29/09/2026) tem ag_emissao_boleto, a_vencer, atrasado, pago, cancelado,
--      erro, confirmado, sem_faturamento, cancelada, e nenhum 'liquidado';
--   c) UC sem usina (ou UC inexistente) lancava 2.1.1 com reference_id NULL --
--      agora bloqueia e grava o motivo.

-- Task 6, fix round 2: dois achados importantes da re-revisao de 29/09/2026.
-- Substitui a 20260929b inteira (CREATE OR REPLACE; o comentario de la
-- descreve o restante do corpo, que nao mudou). Continua SECURITY DEFINER,
-- dona postgres e search_path fixo.
--
-- G1 (importante) -- RESIDUO DE ARREDONDAMENTO deixava o razao sem fechar.
--   invoices.valor_a_pagar e numeric SEM escala, e 38 das 96 faturas tem mais
--   de duas casas. O motor puro arredonda a base na entrada e devolve
--   fornecedor = round(base,2) - deduzido; o gatilho, porem, lanca no banco o
--   valor_a_pagar inteiro. Sobrava (base - round(base,2)) sem contrapartida:
--   com valor_a_pagar 371,36480000000006 e concessionaria 196,62 a transacao
--   fechava em +0,0048 -- lancamento orfao, exatamente o que o Global
--   Constraint "o razao de producao nao pode ganhar, perder ou alterar
--   lancamento" proibe. Nenhuma fatura chegou a ser postada pelo motor novo,
--   entao o defeito estava vivo e ainda nao tinha disparado.
--   Correcao: o FORNECEDOR absorve o residuo. E o mesmo principio que o motor
--   puro ja usa por dentro -- o fornecedor e o residual do rateio, e e ele que
--   garante a soma exata. B2W e beneficiarios continuam com duas casas.
--
-- G2 (importante) -- FATURA BLOQUEADA nunca mais podia ser lancada.
--   O ramo de uc_sem_usina/uc_inexistente grava recompensas_aplicadas com
--   lancado:false, e a trava F2 da 20260929b olhava so "recompensas_aplicadas
--   IS NOT NULL". Depois de alguem consertar o vinculo da UC, a fatura
--   passava por "pago" de novo e a trava recusava: dinheiro recebido e nunca
--   lancado (banco, gestao e repasse todos ausentes), sem saida a nao ser SQL
--   na mao. Agora a trava olha o campo 'lancado': bloqueia o que foi lancado
--   de fato e libera o que ficou congelado como nao lancado.
--
-- G3 (menor) -- v_start_config caia na mesma armadilha que o F3a da 20260929b
--   acabou de fechar: fn_regras_recompensa_uc devolve jsonb null quando o
--   plano nao tem start_config, e jsonb null nao e SQL NULL. Inofensivo hoje
--   (a segunda condicao salvava), mas a Task 11 constroi em cima desta linha.

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
    v_split               jsonb;
    v_motivo              text;      -- por que NAO houve recompensa (NULL = houve)
    v_caminho             text;      -- qual caminho pagou: recorrencia | base_negativa | <motivo>
    v_bloqueado           boolean := false;
    v_recompensas         jsonb;

    v_ordinal             integer;
    v_start_elegivel      boolean := false;
    v_start_regras        jsonb;
    v_bonus_start         jsonb;

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
    -- F3b: so 'pago'. O enum fatura_status NAO tem 'liquidado' (conferido em
    -- 29/09/2026), entao o ramo antigo era codigo morto fingindo cobertura.
    -- Se um dia entrar um status novo de liquidacao no enum, ele precisa ser
    -- adicionado AQUI e na contagem do ordinal (bloco 3) -- nos dois.
    IF NEW.status::text = 'pago' AND OLD.status IS DISTINCT FROM NEW.status THEN

        -- 1. Metadata. LEFT JOIN de proposito (F3c): UC sem usina precisa
        --    chegar viva ate a guarda abaixo em vez de sumir no JOIN e deixar
        --    v_supplier_id NULL virar lancamento orfao em 2.1.1.
        SELECT u.id, u.supplier_id, u.service_values,
               cu.tipo_unidade, cu.fatura_consumo_terceiro
        INTO v_usina_id, v_supplier_id, v_service_values,
             v_tipo_unidade, v_fatura_terceiro
        FROM public.consumer_units cu
        LEFT JOIN public.usinas u ON u.id = cu.usina_id
        WHERE cu.id = NEW.uc_id;

        v_uc_encontrada := FOUND;

        -- GUARD CLAUSE: Do not process financial splits for 'geradora' units.
        -- Excecao: UG que abriga consumo de terceiro (telhado arrendado) tem
        -- assinante real sendo cobrado, entao o split roda normalmente.
        IF v_tipo_unidade = 'geradora' AND COALESCE(v_fatura_terceiro, false) = false THEN
            RETURN NEW;
        END IF;

        -- F2: nao lancar duas vezes a mesma fatura. 'pago' -> outro status ->
        -- 'pago' voltava aqui e repetia a transacao inteira, cada copia
        -- fechando em zero. O recebimento e a assinatura deste gatilho (o
        -- pagamento da conta da UG vem por outro caminho e tem outra
        -- descricao), e recompensas_aplicadas so e escrita aqui -- as duas
        -- pontas cobrem tambem as faturas pagas antes desta task, que nao tem
        -- recompensas_aplicadas mas tem o recebimento.
        -- G2: 'lancado' em vez de "existe congelamento". O ramo bloqueado
        -- (uc_sem_usina) tambem grava recompensas_aplicadas, com lancado:false
        -- -- travar por ele prendia a fatura para sempre.
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
        -- BASE (Task 1, decisao do dono 27/09/2026): o que a fatura arrecadou
        -- de fato. lastro_tarifario do plano e referencia de simulador e nunca
        -- entra aqui.
        v_base_calculo := v_valor_total - v_valor_concessionaria;

        -- F3c: sem UC ou sem usina nao da para saber de quem e o repasse.
        -- Bloqueia a transacao inteira (meia transacao desbalanceia o razao) e
        -- grava o motivo na fatura. Quando alguem consertar o vinculo, a
        -- fatura PODE ser relancada: no razao nao ficou nada, e a trava G2
        -- acima solta o congelamento que tem lancado:false.
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
                     'versao',       '20260929c_gatilho_split_residuo',
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

        IF v_plano IS NULL THEN
            v_motivo := 'uc_sem_plano';
        ELSIF jsonb_typeof(v_matriz) <> 'object'
              -- F3a: jsonb_typeof de proposito -- "niveis": null e um jsonb
              -- null, que NAO e SQL NULL e passava batido pelo IS NULL antigo.
              OR jsonb_typeof(v_matriz #> '{b2w,niveis}') IS DISTINCT FROM 'object' THEN
            v_motivo := 'plano_sem_matriz';
        END IF;

        -- 3b. Bonus Start: DETECTADO e registrado, nao aplicado aqui.
        --     O dono definiu as regras em 28/09/2026 e a aplicacao virou a
        --     Task 11 (nivel 1 apenas, isento do piso, dirigido por
        --     planos_assinatura_energia.tipo_recompensa).
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

        v_bonus_start := jsonb_build_object(
            'fatura_ordinal', v_ordinal,
            'elegivel', v_start_elegivel,
            'aplicado', false,
            'motivo', 'regras definidas pelo dono em 28/09/2026; aplicacao e a Task 11 (nivel 1, isento do piso, por tipo_recompensa). Ate la vale a recorrencia.',
            'regras_start', v_start_regras
        );

        -- 4. Rateio
        IF v_motivo IS NOT NULL THEN
            -- Sem plano / sem matriz: NENHUM lancamento de recompensa (nem
            -- gestao B2W -- ela tambem vem do plano agora) e o fornecedor fica
            -- com o residual inteiro.
            v_caminho          := v_motivo;
            v_participantes    := NULL;
            v_split            := NULL;
            v_teto_deducao     := NULL;
            v_valor_b2w        := 0;
            v_valor_fornecedor := v_base_calculo;

        ELSIF v_base_calculo < 0 THEN
            -- F1 -- BASE NEGATIVA: PREJUIZO COMPARTILHADO.
            -- Decisao do dono de 18/08/2026, RECONFIRMADA em 28/09/2026: a
            -- B2W absorve a SUA fatia do prejuizo (a gestao fica negativa) e
            -- NAO sai ilesa deixando tudo com o fornecedor. Parceiro, lider e
            -- Conect nao recebem nada: percentual de base negativa nao e
            -- recompensa, e nao existe "comissao negativa" a cobrar deles.
            --
            -- Este ramo NAO chama fn_calcular_split_recompensa: o motor puro
            -- tem o contrato "base <= 0 -> tudo zero, fornecedor fica com a
            -- base", e ele continua valendo. Quem decide o que fazer com
            -- prejuizo e o gatilho, nao o motor.
            --
            -- SINAL (convencao do razao, inalterada desde 20260922g): a fatia
            -- da B2W e negativa (v_valor_b2w < 0) e o lancamento em 3.1.1 e
            -- feito com o sinal invertido, entao aparece POSITIVO no razao --
            -- receita revertida. Idem para o fornecedor em 2.1.1.
            v_caminho   := 'base_negativa';
            v_pct_b2w   := GREATEST(COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, 0), 0);
            v_valor_b2w := round(v_base_calculo * v_pct_b2w / 100, 2);   -- negativo
            -- G1: sem round -- o fornecedor fecha contra a base inteira.
            v_valor_fornecedor := v_base_calculo - v_valor_b2w;

            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);
            v_teto_deducao  := NULL;   -- piso nao se aplica a prejuizo

            -- Mesma forma de retorno do motor, para o congelamento nao mudar
            -- de formato conforme o caminho.
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
            v_caminho  := 'recorrencia';
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
            -- G1: o motor arredonda a base na entrada; o que sobra abaixo do
            -- centavo vai para o fornecedor, que e o residual do rateio. Sem
            -- isso a transacao nao fecha contra o valor recebido no banco.
            v_valor_fornecedor := COALESCE((v_split ->> 'fornecedor')::numeric, 0)
                                  + (v_base_calculo - round(v_base_calculo, 2));

            IF COALESCE((v_plano ->> 'gestao_pct')::numeric, -1)
               IS DISTINCT FROM COALESCE((v_matriz #>> '{b2w,niveis,L1}')::numeric, -1) THEN
                RAISE WARNING 'handle_invoice_paid_ledger: plano % tem gestao_percentual=% e matriz b2w.L1=%; valeu a matriz (fatura %)',
                    v_plano ->> 'plano_id', v_plano ->> 'gestao_pct',
                    v_matriz #>> '{b2w,niveis,L1}', NEW.id;
            END IF;
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

        -- 8.2 B2W (3.1.1). Base positiva: total que a B2W recebe, ja incluindo
        --     o que absorveu de participante suspenso. Base negativa: a fatia
        --     de prejuizo dela (v_valor_b2w < 0 -> lancamento positivo).
        IF v_valor_b2w <> 0 THEN
            INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
            VALUES (v_transaction_id, v_account_gestao, -v_valor_b2w,
                    CASE WHEN v_caminho = 'base_negativa'
                         THEN 'Gestão B2W — Prejuízo Compartilhado'
                         ELSE 'Receita Gestão B2W (Plano de Recompensas)' END,
                    'invoice', NEW.id);
        END IF;

        -- 8.3 Beneficiarios: parceiro/lider em 2.1.2 (originator), Assinante
        --     Conect em 2.1.6 (subscriber). Valor ja e o pos-corte. Com base
        --     negativa a lista vem toda zerada, entao nao lanca nada.
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
                                      WHEN 'ppe'   THEN 'Parceiro Power Embaixador'
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

        -- 8.4 Fornecedor (2.1.1): sempre lancado, inclusive zero ou negativo.
        INSERT INTO public.ledger_entries (transaction_id, account_id, amount, description, reference_type, reference_id)
        VALUES (v_transaction_id, v_account_investidor, -v_valor_fornecedor, 'Crédito Repasse Investidor', 'supplier', v_supplier_id);

        -- 9. Congelamento ---------------------------------------------------
        v_recompensas := jsonb_build_object(
            'versao',            '20260929c_gatilho_split_residuo',
            'calculado_em',      now(),
            'lancado',           true,
            'aplicado',          (v_motivo IS NULL),
            'motivo',            v_caminho,
            'base',              v_base_calculo,
            'base_formula',      'valor_a_pagar - valor_concessionaria',
            'teto_deducao',      v_teto_deducao,
            'teto_formula',      'round(base * (1 - piso_fornecedor_pct / 100), 2)',
            'residuo_fornecedor', v_base_calculo - round(v_base_calculo, 2),
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
        -- aqui o status nao muda. log_invoice_change sai sem gravar;
        -- trg_notify_invoice_status e AFTER UPDATE OF status e nem dispara;
        -- handle_invoice_status_change roda de novo (nao tem guarda de
        -- mudanca) e recalcula o status do assinante -- idempotente e sem
        -- efeito no razao.
        UPDATE public.invoices
           SET recompensas_aplicadas = v_recompensas
         WHERE id = NEW.id;

    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_invoice_paid_ledger() IS
  'Gatilho AFTER UPDATE de invoices (tr_invoice_paid_ledger): quando a fatura vira "pago", lanca o rateio no razao. Base = valor_a_pagar - valor_concessionaria. Plano por fn_regras_recompensa_uc (UC -> usina -> NULL); participantes por fn_participantes_recompensa; rateio por fn_calcular_split_recompensa, com teto de deducao = round(base * (1 - piso_fornecedor_pct/100), 2), que e o quanto pode ser deduzido sem furar o piso do fornecedor. Contas: 1.1.1.01 recebimento e deducao da taxa, 4.1.1 taxa Asaas, 2.1.3.01 provisao da concessionaria, 3.1.1 B2W, 2.1.2 parceiro/lider (reference_type=originator), 2.1.6 Assinante Conect (reference_type=subscriber), 2.1.1 fornecedor (sempre lancado, inclusive zero/negativo). NAO LANCA DUAS VEZES: se a fatura ja tem o recebimento dela no razao ou ja tem recompensas_aplicadas, uma segunda passagem por "pago" (pago -> ag_emissao_boleto -> pago) e ignorada com RAISE WARNING. UC geradora sem consumo de terceiro: nao lanca nada e nao escreve recompensas_aplicadas. UC inexistente ou UC sem usina: NAO lanca nada (meia transacao desbalancearia o razao, e o repasse ficaria sem dono) e grava lancado:false + motivo na fatura. UC sem plano (ou plano sem matriz utilizavel): nenhuma recompensa, nem gestao B2W, e o fornecedor fica com o residual inteiro; motivo na fatura. BASE NEGATIVA (decisao do dono de 18/08/2026, reconfirmada em 28/09/2026): prejuizo compartilhado -- a B2W absorve a sua fatia (gestao negativa, que no razao aparece positiva por causa da inversao de sinal das receitas) e parceiro/lider/Conect nao recebem nada; este ramo e do GATILHO, o motor puro mantem o contrato "base <= 0 -> tudo zero". usinas.gestao_percentual e originators_v2.split_commission NAO sao mais lidos. RESIDUO: valor_a_pagar pode ter mais de duas casas; o motor arredonda a base e o fornecedor absorve a diferenca, para a transacao fechar exatamente contra o valor recebido no banco. RELANCAMENTO: a trava de dupla execucao olha recompensas_aplicadas.lancado, entao a fatura bloqueada por uc_sem_usina volta a ser lancavel depois que alguem conserta o vinculo; a fatura ja lancada, nao. BONUS START: elegibilidade detectada e congelada em recompensas_aplicadas.bonus_start, mas nao aplicada aqui -- e a Task 11 (nivel 1, isento do piso, dirigido por planos_assinatura_energia.tipo_recompensa).';
