-- ===========================================================================
-- Plano do Originador: Start POR NIVEL e Hibrido SEQUENCIAL (dono, 12/11/2026)
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md,
--       secao final "Revisao de 12/11/2026" (prevalece).
-- Depende de 20261110a e 20261110b (ja aplicadas).
--
--   1. CONVERSAO dos planos existentes (antes do validador novo):
--      start_config.regras (por fatura, so L1) vira
--      start_config.regras_multinivel: o % da MENOR fatura elegivel vira o L1
--      do cargo (max_niveis 1, L2..L4 "0"); faturas_elegiveis vira
--      [1..quantidade]; a chave `regras` some. Os numeros do dono ficam.
--   2. VALIDADOR novo (fn_planos_originador_valida):
--      start_config = {"faturas_elegiveis":[ints>=1],
--                      "regras_multinivel":{cargo:{niveis:{L1..L4 0..100}, max_niveis 0..3}}}
--      so lider/ppe/ppp/ppf; a chave antiga `regras` e recusada.
--      recorrente_config.regras_multinivel: mesmo formato, max_niveis 0..3.
--   3. MOTOR (handle_invoice_paid_ledger), por participante-parceiro e pelo
--      plano efetivo DELE (fn_plano_originador_entrada):
--        start      dentro da janela -> matriz de Start inteira (todos os niveis)
--                   fora              -> nada
--        recorrente sempre recorrencia
--        ambos      dentro da janela -> matriz de Start
--                   fora              -> recorrencia SO se ordinal > max(janela)
--                                        ou o Start da UC foi encerrado pela
--                                        guarda de transicao (regra antiga);
--                                        senao nada. Nunca as duas na mesma fatura.
--      regra do beneficiario = start | recorrencia | nenhuma pela matriz usada
--      e nivel <= max_niveis. Qualquer parceiro em 'start' isenta o piso
--      (inalterado). Mesma tabela no preenchimento dos cargos sem
--      participante (4a''), pelo plano da UC. B2W e Conect: inalterados.
--      Fallback: plano sem start_config.regras_multinivel mas com
--      regras[ordinal] -> L1-only.
--      versao '20261112_plano_originador_niveis'.
--
-- Patch por ANCORA sobre a definicao viva: cada ancora exatamente 1 vez.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Conversao (o validador ANTIGO aceita o formato novo: ele so olha
--    faturas_elegiveis e `regras` ausente vale '{}').
-- ---------------------------------------------------------------------------
UPDATE public.planos_originador p
   SET start_config = c.novo
  FROM (
    SELECT p2.id,
           jsonb_build_object(
             'faturas_elegiveis', COALESCE((
                 SELECT jsonb_agg(g ORDER BY g)
                   FROM generate_series(1, (
                        SELECT count(*)::int
                          FROM jsonb_array_elements_text(
                               CASE WHEN jsonb_typeof(p2.start_config -> 'faturas_elegiveis') = 'array'
                                    THEN p2.start_config -> 'faturas_elegiveis' ELSE '[]'::jsonb END) f
                         WHERE f ~ '^[1-9][0-9]*$')) g), '[]'::jsonb),
             'regras_multinivel', (
                 SELECT jsonb_object_agg(cg, jsonb_build_object(
                          'niveis', jsonb_build_object(
                              'L1', COALESCE(CASE WHEN (m.r ->> cg) ~ '^[0-9]+(\.[0-9]+)?$'
                                                  THEN m.r ->> cg END, '0'),
                              'L2', '0', 'L3', '0', 'L4', '0'),
                          'max_niveis', 1))
                   FROM unnest(ARRAY['lider', 'ppe', 'ppp', 'ppf']) cg)
           ) AS novo
      FROM public.planos_originador p2
      -- regras da MENOR fatura elegivel; sem ela, a menor chave de `regras`
      LEFT JOIN LATERAL (
            SELECT p2.start_config -> 'regras' -> s.k AS r
              FROM (SELECT f AS k, 0 AS pri, f::int AS o
                      FROM jsonb_array_elements_text(
                           CASE WHEN jsonb_typeof(p2.start_config -> 'faturas_elegiveis') = 'array'
                                THEN p2.start_config -> 'faturas_elegiveis' ELSE '[]'::jsonb END) f
                     WHERE f ~ '^[1-9][0-9]*$'
                    UNION ALL
                    SELECT e.key, 1, e.key::int
                      FROM jsonb_each(CASE WHEN jsonb_typeof(p2.start_config -> 'regras') = 'object'
                                           THEN p2.start_config -> 'regras' ELSE '{}'::jsonb END) e
                     WHERE e.key ~ '^[1-9][0-9]*$') s
             WHERE jsonb_typeof(p2.start_config -> 'regras' -> s.k) = 'object'
             ORDER BY s.pri, s.o
             LIMIT 1) m ON true
     WHERE p2.start_config ? 'regras'
        OR jsonb_typeof(p2.start_config -> 'regras_multinivel') IS DISTINCT FROM 'object'
  ) c
 WHERE p.id = c.id;

-- recorrencia: teto de nivel 3 para os 4 cargos (nivel acima do maximo nao paga)
UPDATE public.planos_originador p
   SET recorrente_config = jsonb_set(p.recorrente_config, '{regras_multinivel}', (
         SELECT jsonb_object_agg(e.key,
                  CASE WHEN (e.value ->> 'max_niveis') ~ '^[0-9]+$' AND (e.value ->> 'max_niveis')::int > 3
                       THEN jsonb_set(e.value, '{max_niveis}', '3'::jsonb)
                       ELSE e.value END)
           FROM jsonb_each(p.recorrente_config -> 'regras_multinivel') e))
 WHERE jsonb_typeof(p.recorrente_config -> 'regras_multinivel') = 'object'
   AND EXISTS (SELECT 1 FROM jsonb_each(p.recorrente_config -> 'regras_multinivel') e
                WHERE (e.value ->> 'max_niveis') ~ '^[0-9]+$' AND (e.value ->> 'max_niveis')::int > 3);

DO $conf$
BEGIN
    IF EXISTS (SELECT 1 FROM public.planos_originador
                WHERE start_config ? 'regras'
                   OR jsonb_typeof(start_config -> 'regras_multinivel') IS DISTINCT FROM 'object') THEN
        RAISE EXCEPTION 'plano_originador_niveis: conversao incompleta do start_config';
    END IF;
END
$conf$;

ALTER TABLE public.planos_originador
    ALTER COLUMN start_config SET DEFAULT '{"faturas_elegiveis": [], "regras_multinivel": {}}'::jsonb;

COMMENT ON COLUMN public.planos_originador.start_config IS
  '{"faturas_elegiveis":[1..N], "regras_multinivel":{"<cargo>":{"niveis":{"L1".."L4"},"max_niveis":0..3}}} so lider/ppe/ppp/ppf. UMA matriz por nivel para as N primeiras faturas pagas COM energia compensada da UC (revisao do dono 12/11/2026).';
COMMENT ON COLUMN public.planos_originador.recorrente_config IS
  '{"regras_multinivel":{"<cargo>":{"niveis":{"L1".."L4"},"max_niveis":0..3}}} so para lider/ppe/ppp/ppf.';

-- ---------------------------------------------------------------------------
-- 2. Validador novo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planos_originador_valida()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    c_cargos constant text[] := ARRAY['lider', 'ppe', 'ppp', 'ppf'];
    m   record;
    c   record;
    n   record;
BEGIN
    IF jsonb_typeof(NEW.start_config) IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(NEW.start_config -> 'faturas_elegiveis', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(NEW.start_config -> 'regras_multinivel', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Plano do Originador "%": start_config precisa ser {"faturas_elegiveis":[...], "regras_multinivel":{...}}', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.start_config ? 'regras' THEN
        RAISE EXCEPTION 'Plano do Originador "%": start_config.regras (formato antigo, por fatura) nao e aceito; use regras_multinivel (uma matriz por nivel para as N faturas)', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NEW.start_config -> 'faturas_elegiveis', '[]'::jsonb)) f
                WHERE COALESCE(f, '') !~ '^[1-9][0-9]*$') THEN
        RAISE EXCEPTION 'Plano do Originador "%": faturas_elegiveis so aceita inteiros >= 1', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    IF jsonb_typeof(NEW.recorrente_config) IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(NEW.recorrente_config -> 'regras_multinivel', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Plano do Originador "%": recorrente_config precisa ser {"regras_multinivel":{...}}', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.recorrente_config ? 'regras' THEN
        RAISE EXCEPTION 'Plano do Originador "%": recorrente_config.regras (formato legado) nao e aceito; use regras_multinivel', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    FOR m IN SELECT * FROM (VALUES
                 ('Start',       COALESCE(NEW.start_config      -> 'regras_multinivel', '{}'::jsonb)),
                 ('recorrencia', COALESCE(NEW.recorrente_config -> 'regras_multinivel', '{}'::jsonb))) AS t(rotulo, matriz)
    LOOP
        FOR c IN SELECT key, value FROM jsonb_each(m.matriz) LOOP
            IF NOT (c.key = ANY (c_cargos)) THEN
                RAISE EXCEPTION 'Plano do Originador "%": a chave "%" nao pertence a um Plano do Originador (so lider, ppe, ppp, ppf)', NEW.nome, c.key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF jsonb_typeof(c.value) <> 'object'
               OR jsonb_typeof(c.value -> 'niveis') IS DISTINCT FROM 'object'
               OR COALESCE(c.value ->> 'max_niveis', '') !~ '^[0-3]$' THEN
                RAISE EXCEPTION 'Plano do Originador "%": % %: precisa de niveis (objeto) e max_niveis 0..3', NEW.nome, m.rotulo, c.key
                    USING ERRCODE = 'check_violation';
            END IF;
            FOR n IN SELECT key, value FROM jsonb_each(c.value -> 'niveis') LOOP
                IF n.key NOT IN ('L1', 'L2', 'L3', 'L4')
                   OR jsonb_typeof(n.value) NOT IN ('number', 'string')
                   OR (n.value #>> '{}') !~ '^[0-9]+(\.[0-9]+)?$'
                   OR (n.value #>> '{}')::numeric > 100 THEN
                    RAISE EXCEPTION 'Plano do Originador "%": % %.%: percentual entre 0 e 100', NEW.nome, m.rotulo, c.key, n.key
                        USING ERRCODE = 'check_violation';
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_originador_valida() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_originador_valida() FROM PUBLIC, anon, authenticated;

-- os planos convertidos passam pelo validador novo (estoura se algum nao passa)
UPDATE public.planos_originador SET start_config = start_config;

-- ---------------------------------------------------------------------------
-- 3a. Tabela da spec numa funcao pura (testavel e usada nos dois blocos)
--     Devolve {"matriz": "start"|"recorrencia", "entrada": {niveis, max_niveis}}
--     ou '{}' (nada). `entrada` ausente = o cargo nao entra na matriz.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_originador_entrada(
    p_po jsonb, p_papel text, p_ordinal int, p_bloqueio text, p_start_encerrado boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_tipo   text := COALESCE(p_po ->> 'tipo_recompensa', 'start');
    v_fats   jsonb := p_po #> '{start_config,faturas_elegiveis}';
    v_janela boolean;
    v_max    int;
    v_start  jsonb;
    v_legado jsonb;
    v_rec    jsonb;
    v_pct    text;
BEGIN
    IF p_po IS NULL OR p_papel IS NULL OR p_ordinal IS NULL THEN
        RETURN '{}'::jsonb;
    END IF;

    IF jsonb_typeof(v_fats) = 'array' THEN
        SELECT bool_or(f = p_ordinal::text), max(f::int) FILTER (WHERE f ~ '^[1-9][0-9]*$')
          INTO v_janela, v_max
          FROM jsonb_array_elements_text(v_fats) f;
    END IF;
    v_janela := COALESCE(v_janela, false);

    -- matriz de Start do cargo (todos os niveis)
    v_start := p_po #> ARRAY['start_config', 'regras_multinivel', p_papel];
    IF jsonb_typeof(v_start) IS DISTINCT FROM 'object' THEN
        v_start := NULL;
        -- fallback defensivo: formato antigo (regras por fatura) = L1-only
        IF jsonb_typeof(p_po #> '{start_config,regras_multinivel}') IS DISTINCT FROM 'object'
           AND jsonb_typeof(p_po #> ARRAY['start_config', 'regras', p_ordinal::text]) = 'object' THEN
            v_legado := p_po #> ARRAY['start_config', 'regras', p_ordinal::text];
            v_pct := CASE WHEN (v_legado ->> p_papel) ~ '^[0-9]+(\.[0-9]+)?$' THEN v_legado ->> p_papel ELSE '0' END;
            v_start := jsonb_build_object(
                'niveis', jsonb_build_object('L1', v_pct, 'L2', '0', 'L3', '0', 'L4', '0'),
                'max_niveis', 1);
        END IF;
    END IF;

    v_rec := p_po #> ARRAY['recorrente_config', 'regras_multinivel', p_papel];
    IF jsonb_typeof(v_rec) IS DISTINCT FROM 'object' THEN
        v_rec := NULL;
    END IF;

    IF v_tipo IN ('start', 'ambos') AND p_bloqueio IS NULL AND v_janela THEN
        RETURN jsonb_build_object('matriz', 'start')
            || CASE WHEN v_start IS NOT NULL THEN jsonb_build_object('entrada', v_start) ELSE '{}'::jsonb END;
    ELSIF v_tipo = 'recorrente'
          OR (v_tipo = 'ambos' AND (p_ordinal > COALESCE(v_max, 0) OR COALESCE(p_start_encerrado, false))) THEN
        RETURN jsonb_build_object('matriz', 'recorrencia')
            || CASE WHEN v_rec IS NOT NULL THEN jsonb_build_object('entrada', v_rec) ELSE '{}'::jsonb END;
    END IF;
    RETURN '{}'::jsonb;
END;
$function$;

ALTER FUNCTION public.fn_plano_originador_entrada(jsonb, text, int, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_originador_entrada(jsonb, text, int, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_originador_entrada(jsonb, text, int, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_plano_originador_entrada(jsonb, text, int, text, boolean) IS
  'Entrada da matriz de um cargo de parceiro pelo Plano do Originador (revisao do dono 12/11/2026): start na janela = matriz de Start por nivel; recorrente = recorrencia; ambos = Start na janela e recorrencia so depois dela (ordinal > max) ou com o Start da UC encerrado pela guarda de transicao.';

-- ---------------------------------------------------------------------------
-- 3b. Patch do motor
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        -- 1. variaveis
        ($de$    v_fill_pct            numeric;$de$,
         $para$    v_fill_pct            numeric;
    -- Plano do Originador por nivel (20261112a)
    v_po_res              jsonb;$para$),

        -- 2. participante: tabela da spec (fn_plano_originador_entrada)
        ($de$                v_po_regras  := NULL;

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
                END IF;$de$,
         $para$                v_po_regras  := NULL;

                -- 20261112a (revisao do dono 12/11/2026): Start POR NIVEL na
                -- janela; Hibrido sequencial (recorrencia so depois da janela);
                -- nunca Start e recorrencia na mesma fatura.
                v_po_res     := public.fn_plano_originador_entrada(
                                    v_po, v_ben_papel, v_ordinal, v_start_bloqueio, COALESCE(v_start_antigo, false));
                v_po_entrada := v_po_res -> 'entrada';
                v_part_regra := CASE
                    WHEN v_po_entrada IS NOT NULL AND v_part_nivel IS NOT NULL
                         AND v_part_nivel <= COALESCE((v_po_entrada ->> 'max_niveis')::int, 0)
                    THEN v_po_res ->> 'matriz' ELSE 'nenhuma' END;
                IF v_po_res ->> 'matriz' = 'start' THEN
                    v_po_regras := v_po_entrada;
                END IF;$para$),

        -- 3. cargos sem participante: mesma tabela, pelo plano da UC
        ($de$            v_fill_regras := NULL;
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
                END IF;$de$,
         $para$            v_fill_regras := NULL;

            FOR v_fill_papel IN SELECT unnest(ARRAY['lider', 'ppe', 'ppp', 'ppf'])
            LOOP
                CONTINUE WHEN v_matriz_efetiva ? v_fill_papel;

                -- 20261112a: mesma tabela por nivel dos participantes
                v_fill_entrada := public.fn_plano_originador_entrada(
                                      v_fill_po, v_fill_papel, v_ordinal, v_start_bloqueio, COALESCE(v_start_antigo, false)) -> 'entrada';$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    v_n := (length(d) - length(replace(d, '''20261110_plano_originador''', '')))
           / length('''20261110_plano_originador''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20261110_plano_originador''', '''20261112_plano_originador_niveis''');

    EXECUTE d;
END
$patch$;
