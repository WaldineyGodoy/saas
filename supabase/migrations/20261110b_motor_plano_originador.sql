-- ===========================================================================
-- Motor do split com o Plano do Originador (dono, 10/11/2026)
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md
-- Depende de 20261110a_plano_originador.sql.
--
-- handle_invoice_paid_ledger muda em quatro pontos:
--
--   1. ORDINAL = 1 + faturas pagas da UC COM energia compensada
--      (consumo_compensado > 0). Fatura sem compensacao nao consome o
--      ordinal. Vale para o Start (B2W e parceiros) e para as faturas retidas
--      do fornecedor (2.1.7), que por decisao de 05/11 usam o mesmo ordinal.
--   2. TRANSICAO SEM START EM DOBRO: se outra fatura da UC ja pagou Start pela
--      regra antiga (bonus_start.aplicado sem ordinal_regra, ou 'todas_pagas'),
--      o Start da UC esta encerrado (B2W e parceiros). Pela regra nova, um
--      ordinal que ja pagou Start nunca paga de novo na mesma UC.
--   3. MATRIZ POR PAPEL: b2w e assinante_conect continuam vindo do plano de
--      assinatura, como antes. lider/ppe/ppp/ppf vem do plano efetivo DE CADA
--      PARTICIPANTE (fn_plano_originador_efetivo): Start se o tipo desse plano
--      e start/ambos, o ordinal esta em faturas_elegiveis e o participante e
--      nivel 1; senao recorrencia se o tipo e recorrente/ambos; senao zero.
--      'ambos' = nivel 1 no Start e nivel 2+ na recorrencia (como antes).
--      Qualquer Start aplicado (B2W ou parceiro) isenta a fatura do piso.
--   4. CONGELAMENTO: versao '20261110_plano_originador';
--      bonus_start.ordinal_regra = 'compensadas'; por beneficiario-parceiro
--      plano_originador_id, plano_origem e regra (start|recorrencia|nenhuma).
--
-- A producao e a fonte da verdade: o patch e por ANCORA de texto sobre a
-- definicao viva (pg_get_functiondef) e cada ancora tem de aparecer
-- exatamente uma vez -- se o texto em producao mudou, a migracao estoura.
-- ===========================================================================

DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF to_regclass('public.planos_originador') IS NULL
       OR to_regprocedure('public.fn_plano_originador_efetivo(uuid, uuid)') IS NULL THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: rode 20261110a_plano_originador.sql antes';
    END IF;

    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        -- 1. variaveis
        ($de$    v_account_retencao    uuid;   -- 2.1.7$de$,
         $para$    v_account_retencao    uuid;   -- 2.1.7

    -- Plano do Originador (20261110b)
    v_start_antigo        boolean;   -- outra fatura da UC pagou Start pela regra antiga
    v_start_repetido      boolean;   -- este ordinal ja pagou Start nesta UC
    v_start_bloqueio      text;      -- por que o Start desta fatura nao pode ser pago
    v_start_calendario    boolean := false;  -- elegivel pelo plano de assinatura, antes da guarda
    v_start_parceiro      boolean := false;  -- algum parceiro recebeu Start nesta fatura
    v_part                jsonb;
    v_part_nivel          int;
    v_part_regra          text;
    v_po                  jsonb;
    v_po_tipo             text;
    v_po_regras           jsonb;
    v_po_entrada          jsonb;
    v_regras_parceiros    jsonb := '{}'::jsonb;  -- papel -> plano/regra do parceiro
    v_benef_marcados      jsonb;
    -- cargo sem participante: so completa a matriz congelada (nao paga ninguem)
    v_fill_po             jsonb;
    v_fill_tipo           text;
    v_fill_regras         jsonb;
    v_fill_papel          text;
    v_fill_entrada        jsonb;
    v_fill_niveis         jsonb;
    v_fill_max            int;
    v_fill_pct            numeric;$para$),

        -- 2. ordinal so com compensacao + guarda de transicao
        ($de$        -- 2. Ordinal desta fatura entre as pagas da UC (1a, 2a, 3a ...).
        SELECT COUNT(*) + 1 INTO v_ordinal
        FROM public.invoices
        WHERE uc_id = NEW.uc_id
          AND status::text = 'pago'
          AND id <> NEW.id;$de$,
         $para$        -- 2. Ordinal desta fatura entre as pagas da UC COM energia compensada
        --    (20261110b, resolucao 3 do dono): fatura sem compensacao nao conta.
        --    Vale para o Start (B2W e parceiros) e para as faturas retidas.
        SELECT COUNT(*) + 1 INTO v_ordinal
        FROM public.invoices
        WHERE uc_id = NEW.uc_id
          AND status::text = 'pago'
          AND id <> NEW.id
          AND COALESCE(consumo_compensado, 0) > 0;

        -- 2b. Transicao sem Start em dobro (20261110b). Olha toda fatura da UC
        --     cujo Start foi lancado, paga ou nao hoje: o dinheiro ja saiu.
        SELECT bool_or(COALESCE(i.recompensas_aplicadas #>> '{bonus_start,ordinal_regra}', 'todas_pagas') = 'todas_pagas'),
               bool_or(i.recompensas_aplicadas #>> '{bonus_start,ordinal_regra}' = 'compensadas'
                       AND i.recompensas_aplicadas #>> '{bonus_start,fatura_ordinal}' = v_ordinal::text)
          INTO v_start_antigo, v_start_repetido
          FROM public.invoices i
         WHERE i.uc_id = NEW.uc_id
           AND i.id <> NEW.id
           AND i.recompensas_aplicadas #>> '{bonus_start,aplicado}' = 'true'
           AND COALESCE(i.recompensas_aplicadas ->> 'lancado', 'true') <> 'false';

        v_start_bloqueio := CASE
            WHEN COALESCE(v_start_antigo, false)
              THEN 'Start da UC encerrado: ja foi pago pela regra antiga (ordinal contando todas as faturas pagas)'
            WHEN COALESCE(v_start_repetido, false)
              THEN 'o ordinal ' || v_ordinal || ' ja pagou Start nesta UC: o mesmo ordinal nunca paga Start duas vezes'
        END;$para$),

        -- 3. a guarda desliga o Start do plano de assinatura (B2W)
        ($de$        IF v_start_elegivel THEN
            v_start_regras := v_start_config #> ARRAY['regras', v_ordinal::text];
        ELSE
            v_start_regras := NULL;
        END IF;$de$,
         $para$        IF v_start_elegivel THEN
            v_start_regras := v_start_config #> ARRAY['regras', v_ordinal::text];
        ELSE
            v_start_regras := NULL;
        END IF;

        v_start_calendario := v_start_elegivel;
        IF v_start_bloqueio IS NOT NULL THEN
            v_start_elegivel := false;
            v_start_regras   := NULL;
        END IF;$para$),

        -- 4. parceiros pelo Plano do Originador de cada um
        ($de$            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);

            v_split := public.fn_calcular_split_recompensa(
                v_base_calculo, v_teto_deducao, v_matriz_efetiva, v_participantes
            );$de$,
         $para$            v_participantes := public.fn_participantes_recompensa(NEW.uc_id);

            -- 4a. PLANO DO ORIGINADOR (20261110b): lider/ppe/ppp/ppf nao vem
            -- mais do plano de assinatura; cada participante recebe pelo plano
            -- efetivo DELE. b2w e assinante_conect ficam como montados acima.
            v_matriz_efetiva := COALESCE(v_matriz_efetiva, '{}'::jsonb)
                - ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante'];

            FOR v_part IN SELECT * FROM jsonb_array_elements(COALESCE(v_participantes, '[]'::jsonb))
            LOOP
                v_ben_papel := v_part ->> 'papel';
                CONTINUE WHEN COALESCE(v_ben_papel, '') NOT IN ('lider', 'ppe', 'ppp', 'ppf');

                v_part_nivel := NULLIF(v_part ->> 'nivel', '')::int;
                v_po         := public.fn_plano_originador_efetivo(NULLIF(v_part ->> 'id', '')::uuid, NEW.uc_id);
                v_po_tipo    := COALESCE(v_po ->> 'tipo_recompensa', 'start');
                v_po_regras  := NULL;

                IF v_start_bloqueio IS NULL
                   AND v_po_tipo IN ('start', 'ambos')
                   AND jsonb_typeof(v_po #> '{start_config,faturas_elegiveis}') = 'array'
                   AND EXISTS (SELECT 1
                                 FROM jsonb_array_elements_text(v_po #> '{start_config,faturas_elegiveis}') f
                                WHERE f = v_ordinal::text)
                   AND jsonb_typeof(v_po #> ARRAY['start_config', 'regras', v_ordinal::text]) = 'object' THEN
                    v_po_regras := v_po #> ARRAY['start_config', 'regras', v_ordinal::text];
                END IF;

                IF v_po_regras IS NOT NULL THEN
                    -- fatura do Start deste parceiro: L1 = Start; L2..L4 =
                    -- recorrencia (ambos) ou zero (start). Mesma conta de antes.
                    v_pct_start := COALESCE(NULLIF(v_po_regras ->> v_ben_papel, '')::numeric, 0);
                    IF v_po_tipo = 'ambos' THEN
                        v_niveis_papel := COALESCE(v_po #> ARRAY['recorrente_config', 'regras_multinivel', v_ben_papel, 'niveis'], '{}'::jsonb);
                        IF jsonb_typeof(v_niveis_papel) <> 'object' THEN
                            v_niveis_papel := '{}'::jsonb;
                        END IF;
                        v_niveis_papel := jsonb_set(v_niveis_papel, '{L1}', to_jsonb(v_pct_start));
                        v_max_papel := GREATEST(COALESCE((v_po #>> ARRAY['recorrente_config', 'regras_multinivel', v_ben_papel, 'max_niveis'])::int, 0), 1);
                    ELSE
                        v_niveis_papel := jsonb_build_object('L1', v_pct_start, 'L2', 0, 'L3', 0, 'L4', 0);
                        v_max_papel := 1;
                    END IF;
                    v_po_entrada := jsonb_build_object('niveis', v_niveis_papel, 'max_niveis', v_max_papel);
                    v_part_regra := CASE
                        WHEN v_part_nivel = 1 THEN 'start'
                        WHEN v_part_nivel IS NOT NULL AND v_part_nivel <= v_max_papel THEN 'recorrencia'
                        ELSE 'nenhuma' END;
                ELSIF v_po_tipo IN ('recorrente', 'ambos') THEN
                    v_po_entrada := v_po #> ARRAY['recorrente_config', 'regras_multinivel', v_ben_papel];
                    IF jsonb_typeof(v_po_entrada) IS DISTINCT FROM 'object' THEN
                        v_po_entrada := NULL;
                    END IF;
                    v_part_regra := CASE
                        WHEN v_po_entrada IS NOT NULL AND v_part_nivel IS NOT NULL
                             AND v_part_nivel <= COALESCE((v_po_entrada ->> 'max_niveis')::int, 0)
                        THEN 'recorrencia' ELSE 'nenhuma' END;
                ELSE
                    -- plano so de Start, fora da janela: nada
                    v_po_entrada := NULL;
                    v_part_regra := 'nenhuma';
                END IF;

                IF v_po_entrada IS NOT NULL THEN
                    v_matriz_efetiva := v_matriz_efetiva || jsonb_build_object(v_ben_papel, v_po_entrada);
                END IF;
                IF v_part_regra = 'start' THEN
                    v_start_parceiro := true;
                END IF;

                v_regras_parceiros := v_regras_parceiros || jsonb_build_object(v_ben_papel, jsonb_build_object(
                    'id',                  v_part -> 'id',
                    'nivel',               v_part_nivel,
                    'plano_originador_id', v_po -> 'id',
                    'plano_origem',        v_po -> 'origem',
                    'tipo_recompensa',     v_po_tipo,
                    'regra',               v_part_regra,
                    'regras_start',        v_po_regras));
            END LOOP;

            -- 4a''. MATRIZ COMPLETA: cargo de parceiro SEM participante nesta
            -- fatura entra na matriz pelo plano da UC (ligado ao plano de
            -- assinatura, ou o Padrao), com a mesma regra de janela. Nao paga
            -- ninguem -- fn_calcular_split_recompensa so paga quem participa --,
            -- mas mantem `regras` congelado com os mesmos cargos de antes da
            -- 20261110a, que e o que auditor e testes leem.
            v_fill_po     := public.fn_plano_originador_efetivo(NULL, NEW.uc_id);
            v_fill_tipo   := COALESCE(v_fill_po ->> 'tipo_recompensa', 'start');
            v_fill_regras := NULL;
            IF v_start_bloqueio IS NULL
               AND v_fill_tipo IN ('start', 'ambos')
               AND jsonb_typeof(v_fill_po #> '{start_config,faturas_elegiveis}') = 'array'
               AND EXISTS (SELECT 1
                             FROM jsonb_array_elements_text(v_fill_po #> '{start_config,faturas_elegiveis}') f
                            WHERE f = v_ordinal::text)
               AND jsonb_typeof(v_fill_po #> ARRAY['start_config', 'regras', v_ordinal::text]) = 'object' THEN
                v_fill_regras := v_fill_po #> ARRAY['start_config', 'regras', v_ordinal::text];
            END IF;

            FOR v_fill_papel IN SELECT unnest(ARRAY['lider', 'ppe', 'ppp', 'ppf'])
            LOOP
                CONTINUE WHEN v_matriz_efetiva ? v_fill_papel;

                IF v_fill_regras IS NOT NULL THEN
                    v_fill_pct := COALESCE(NULLIF(v_fill_regras ->> v_fill_papel, '')::numeric, 0);
                    IF v_fill_tipo = 'ambos' THEN
                        v_fill_niveis := COALESCE(v_fill_po #> ARRAY['recorrente_config', 'regras_multinivel', v_fill_papel, 'niveis'], '{}'::jsonb);
                        IF jsonb_typeof(v_fill_niveis) <> 'object' THEN
                            v_fill_niveis := '{}'::jsonb;
                        END IF;
                        v_fill_niveis := jsonb_set(v_fill_niveis, '{L1}', to_jsonb(v_fill_pct));
                        v_fill_max := GREATEST(COALESCE((v_fill_po #>> ARRAY['recorrente_config', 'regras_multinivel', v_fill_papel, 'max_niveis'])::int, 0), 1);
                    ELSE
                        v_fill_niveis := jsonb_build_object('L1', v_fill_pct, 'L2', 0, 'L3', 0, 'L4', 0);
                        v_fill_max := 1;
                    END IF;
                    v_fill_entrada := jsonb_build_object('niveis', v_fill_niveis, 'max_niveis', v_fill_max);
                ELSIF v_fill_tipo IN ('recorrente', 'ambos') THEN
                    v_fill_entrada := v_fill_po #> ARRAY['recorrente_config', 'regras_multinivel', v_fill_papel];
                    IF jsonb_typeof(v_fill_entrada) IS DISTINCT FROM 'object' THEN
                        v_fill_entrada := NULL;
                    END IF;
                ELSE
                    v_fill_entrada := NULL;
                END IF;

                IF v_fill_entrada IS NOT NULL THEN
                    v_matriz_efetiva := v_matriz_efetiva || jsonb_build_object(v_fill_papel, v_fill_entrada);
                END IF;
            END LOOP;

            -- ISENCAO DO PISO: qualquer Start (B2W ou parceiro) isenta a fatura.
            IF v_start_parceiro AND NOT v_start_aplicado THEN
                v_teto_deducao := round(v_base_calculo, 2);
                v_teto_formula := 'round(base, 2) -- bonus Start de parceiro (Plano do Originador): isento do piso do fornecedor';
            END IF;

            v_split := public.fn_calcular_split_recompensa(
                v_base_calculo, v_teto_deducao, v_matriz_efetiva, v_participantes
            );$para$),

        -- 5. motivo da guarda + congelamento por beneficiario
        ($de$        -- 4b. Task 13 -- O FORNECEDOR VOLTA A SER O RESIDUAL DA BASE, e a$de$,
         $para$        -- 4a'. Plano do Originador (20261110b): motivo da guarda de transicao
        --      e, por beneficiario-parceiro, o plano e a regra que valeram.
        IF v_start_bloqueio IS NOT NULL THEN
            v_start_motivo := v_start_bloqueio || COALESCE(' | ' || v_start_motivo, '');
        END IF;

        FOR v_part IN SELECT * FROM jsonb_array_elements(COALESCE(v_participantes, '[]'::jsonb))
        LOOP
            v_ben_papel := v_part ->> 'papel';
            CONTINUE WHEN COALESCE(v_ben_papel, '') NOT IN ('lider', 'ppe', 'ppp', 'ppf')
                       OR v_regras_parceiros ? v_ben_papel;
            -- ramos sem rateio (sem compensacao, base negativa): ninguem recebe
            v_po := public.fn_plano_originador_efetivo(NULLIF(v_part ->> 'id', '')::uuid, NEW.uc_id);
            v_regras_parceiros := v_regras_parceiros || jsonb_build_object(v_ben_papel, jsonb_build_object(
                'id',                  v_part -> 'id',
                'nivel',               NULLIF(v_part ->> 'nivel', '')::int,
                'plano_originador_id', v_po -> 'id',
                'plano_origem',        v_po -> 'origem',
                'tipo_recompensa',     v_po -> 'tipo_recompensa',
                'regra',               'nenhuma',
                'regras_start',        NULL));
        END LOOP;

        IF v_split IS NOT NULL AND jsonb_typeof(v_split -> 'beneficiarios') = 'array' THEN
            SELECT COALESCE(jsonb_agg(
                       CASE WHEN v_regras_parceiros ? (t.b ->> 'papel') THEN
                           t.b || jsonb_build_object(
                               'plano_originador_id', v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'plano_originador_id'],
                               'plano_origem',        v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'plano_origem'],
                               'regra',               v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'regra'])
                       ELSE t.b END
                       ORDER BY t.ord), '[]'::jsonb)
              INTO v_benef_marcados
              FROM jsonb_array_elements(v_split -> 'beneficiarios') WITH ORDINALITY AS t(b, ord);
            v_split := jsonb_set(v_split, '{beneficiarios}', v_benef_marcados);
        END IF;

        -- 4b. Task 13 -- O FORNECEDOR VOLTA A SER O RESIDUAL DA BASE, e a$para$),

        -- 6. descricao do lancamento do parceiro pela regra DELE
        ($de$CASE WHEN v_caminho = 'bonus_start' AND v_ben_nivel = '1' AND v_ben_papel NOT IN ('originador_usina', 'lider_originador_usina')$de$,
         $para$CASE WHEN v_ben ->> 'regra' = 'start'$para$),

        -- 7. congelamento do Start
        ($de$            'aplicado',         v_start_aplicado,
            'piso_ignorado',    v_start_aplicado,$de$,
         $para$            'aplicado',         v_start_aplicado OR v_start_parceiro,
            'aplicado_b2w',     v_start_aplicado,
            'aplicado_parceiros', v_start_parceiro,
            'piso_ignorado',    v_start_aplicado OR v_start_parceiro,
            'ordinal_regra',    'compensadas',
            'elegivel_calendario', v_start_calendario,
            'bloqueio',         v_start_bloqueio,$para$),
        ($de$            'fatura_ordinal',  v_ordinal,$de$,
         $para$            'fatura_ordinal',  v_ordinal,
            'ordinal_regra',   'compensadas',$para$),
        ($de$            'bonus_start',       v_bonus_start$de$,
         $para$            'plano_originador',  v_regras_parceiros,
            'bonus_start',       v_bonus_start$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    v_n := (length(d) - length(replace(d, '''20261105_faturas_retidas''', '')))
           / length('''20261105_faturas_retidas''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20261105_faturas_retidas''', '''20261110_plano_originador''');

    EXECUTE d;
END
$patch$;
