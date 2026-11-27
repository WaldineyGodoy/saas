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
