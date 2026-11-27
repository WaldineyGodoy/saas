-- Conta em rampa (spec 2026-11-26-conta-em-rampa-design.md): consumo curto e
-- crescente nao e bem descrito pela mediana. Regime por UC, franquia sugerida
-- e perfil/base do Start com o consumo recente.

ALTER TABLE public.consumer_units
    ADD COLUMN IF NOT EXISTS regime_consumo    text,
    ADD COLUMN IF NOT EXISTS regime_desde      timestamptz,
    ADD COLUMN IF NOT EXISTS franquia_sugerida numeric;

ALTER TABLE public.consumer_units
    DROP CONSTRAINT IF EXISTS consumer_units_regime_consumo_valido,
    ADD CONSTRAINT consumer_units_regime_consumo_valido
        CHECK (regime_consumo IS NULL OR regime_consumo IN ('insuficiente', 'em_rampa', 'em_queda', 'estavel'));

COMMENT ON COLUMN public.consumer_units.regime_consumo IS
  'Regime do consumo (fn_regime_consumo): insuficiente | em_rampa | em_queda | estavel. Recalculado a cada conta gravada.';
COMMENT ON COLUMN public.consumer_units.franquia_sugerida IS
  'Franquia sugerida pelo regime. Nao altera franquia sozinha, exceto na primeira carga do historico em rampa (fn_historico_consumo_gravar_uc).';

CREATE OR REPLACE FUNCTION public.fn_regime_consumo(
    p_perfil jsonb,
    p_prudencia numeric DEFAULT 0.8,
    p_razao numeric DEFAULT 2,
    p_janela int DEFAULT 6,
    p_queda numeric DEFAULT 0.5)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_c       numeric[];
    v_kwh     numeric[];
    v_n       int;
    v_ult     numeric;
    v_pen     numeric;
    v_med_ant numeric;
    v_med_per numeric;
    v_regime  text := 'estavel';
BEGIN
    SELECT array_agg(s.c ORDER BY s.ref), array_agg(s.kwh ORDER BY s.ref)
      INTO v_c, v_kwh
      FROM (
        SELECT m.value ->> 'ref' AS ref,
               (m.value ->> 'kwh')::numeric AS kwh,
               CASE WHEN (m.value ->> 'dias') ~ '^[0-9]+(\.[0-9]+)?$' AND (m.value ->> 'dias')::numeric > 0
                    THEN (m.value ->> 'kwh')::numeric / (m.value ->> 'dias')::numeric * 30
                    ELSE (m.value ->> 'kwh')::numeric END AS c
          FROM jsonb_each(CASE WHEN jsonb_typeof(p_perfil) = 'object' THEN p_perfil ELSE '{}'::jsonb END) m
         WHERE jsonb_typeof(m.value) = 'object'
           AND COALESCE(m.value ->> 'origem', '') IN ('cadastro', 'conta')
           AND (m.value ->> 'ref') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           AND (m.value ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$'
           AND (m.value ->> 'kwh')::numeric > 0) s;

    v_n := COALESCE(array_length(v_c, 1), 0);
    IF v_n < 2 THEN
        RETURN jsonb_build_object('regime', 'insuficiente', 'n', v_n, 'c_ult', NULL,
                                  'mediana_anteriores', NULL, 'franquia_rampa', NULL, 'franquia_janela', NULL);
    END IF;

    v_ult := v_c[v_n];
    v_pen := v_c[v_n - 1];
    -- percentile_cont devolve double precision; o cast para numeric faz o round()
    -- seguinte arredondar meio-para-cima, igual ao Math.round do espelho em JS.
    SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY x))::numeric INTO v_med_ant FROM unnest(v_c[1:v_n - 1]) x;
    SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY x))::numeric INTO v_med_per FROM unnest(v_kwh) x;

    IF v_n <= p_janela AND v_ult >= p_razao * v_med_ant AND v_ult > 1.25 * v_pen THEN
        v_regime := 'em_rampa';
    ELSIF v_n >= 3 AND v_ult <= p_queda * v_med_ant THEN
        v_regime := 'em_queda';
    END IF;

    RETURN jsonb_build_object(
        'regime', v_regime,
        'n', v_n,
        'c_ult', round(v_ult, 2),
        'mediana_anteriores', round(v_med_ant, 2),
        'franquia_rampa', round(GREATEST(p_prudencia * v_ult, v_med_per)),
        'franquia_janela', CASE WHEN v_n >= 3
                                THEN (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x))::numeric) FROM unnest(v_c[v_n - 2:v_n]) x)
                           END);
END;
$function$;

ALTER FUNCTION public.fn_regime_consumo(jsonb, numeric, numeric, int, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_regime_consumo(jsonb, numeric, numeric, int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_regime_consumo(jsonb, numeric, numeric, int, numeric) TO authenticated, service_role;

-- fn_mediana_kwh: 'rampa' e preenchimento, como 'mediana' (nao entra na mediana).
CREATE OR REPLACE FUNCTION public.fn_mediana_kwh(p_historico jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH v AS (
        SELECT x.kwh
          FROM (SELECT a.kwh
                  FROM (SELECT CASE WHEN (e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$' THEN (e ->> 'kwh')::numeric END AS kwh,
                               row_number() OVER (PARTITION BY right(e ->> 'mes', 2) ORDER BY e ->> 'mes' DESC) AS rn
                          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_historico) = 'array'
                                                         THEN p_historico ELSE '[]'::jsonb END) e
                         WHERE jsonb_typeof(e) = 'object'
                           AND (e ->> 'mes') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') a
                 WHERE a.rn = 1
                UNION ALL
                SELECT (m.value ->> 'kwh')::numeric
                  FROM jsonb_each(CASE WHEN jsonb_typeof(p_historico) = 'object'
                                       THEN p_historico ELSE '{}'::jsonb END) m
                 WHERE jsonb_typeof(m.value) = 'object'
                   AND COALESCE(m.value ->> 'origem', '') NOT IN ('mediana', 'rampa')
                   AND (m.value ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$') x
         WHERE x.kwh > 0
    ), o AS (
        SELECT kwh, row_number() OVER (ORDER BY kwh) AS rn, count(*) OVER () AS n FROM v
    )
    SELECT round(avg(kwh), 2) FROM o WHERE rn IN ((n + 1) / 2, (n + 2) / 2);
$function$;

-- fn_historico_consumo_aplicar: leitura nova sobrescreve mes preenchido por 'rampa'.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_aplicar(
    p_historico jsonb, p_ref text, p_kwh numeric, p_origem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_h   jsonb := CASE WHEN jsonb_typeof(p_historico) = 'object' THEN p_historico ELSE '{}'::jsonb END;
    v_k   text;
    v_cur jsonb;
BEGIN
    IF p_ref IS NULL OR p_ref !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR p_kwh IS NULL OR p_kwh < 0 THEN
        RETURN v_h;
    END IF;
    v_k   := right(p_ref, 2);
    v_cur := v_h -> v_k;
    IF jsonb_typeof(v_cur) = 'object'
       AND COALESCE(v_cur ->> 'origem', '') NOT IN ('mediana', 'franquia', 'rampa')
       AND (v_cur ->> 'ref') IS NOT NULL
       AND ((v_cur ->> 'ref') > p_ref
            OR ((v_cur ->> 'ref') = p_ref AND v_cur ->> 'origem' = 'conta' AND p_origem <> 'conta')) THEN
        RETURN v_h;
    END IF;
    RETURN v_h || jsonb_build_object(v_k, jsonb_build_object('kwh', p_kwh, 'ref', p_ref, 'origem', p_origem));
END;
$function$;

-- fn_historico_consumo_normalizar: preenche meses ausentes/zerados com a
-- franquia de rampa (origem 'rampa') quando o perfil esta em rampa; senao, com
-- a mediana (origem 'mediana'). O regime e calculado ANTES do preenchimento.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_normalizar(p_historico jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_h      jsonb := CASE WHEN jsonb_typeof(p_historico) = 'object' THEN p_historico ELSE '{}'::jsonb END;
    v_med    numeric := public.fn_mediana_kwh(v_h);
    v_reg    jsonb := public.fn_regime_consumo(v_h);
    v_fill   numeric;
    v_origem text := 'mediana';
    v_k      text;
    v_e      jsonb;
BEGIN
    IF v_med IS NULL THEN
        RETURN v_h;
    END IF;
    v_fill := v_med;
    IF v_reg ->> 'regime' = 'em_rampa' THEN
        v_fill   := (v_reg ->> 'franquia_rampa')::numeric;
        v_origem := 'rampa';
    END IF;
    FOR v_k IN SELECT to_char(g, 'FM00') FROM generate_series(1, 12) g LOOP
        v_e := v_h -> v_k;
        CONTINUE WHEN jsonb_typeof(v_e) = 'object'
                  AND COALESCE(v_e ->> 'origem', '') NOT IN ('mediana', 'rampa')
                  AND (v_e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$'
                  AND (v_e ->> 'kwh')::numeric > 0;
        v_h := v_h || jsonb_build_object(v_k, jsonb_build_object(
                   'kwh', v_fill,
                   'ref', CASE WHEN jsonb_typeof(v_e) = 'object' THEN v_e -> 'ref' ELSE 'null'::jsonb END,
                   'origem', v_origem));
    END LOOP;
    RETURN v_h;
END;
$function$;
