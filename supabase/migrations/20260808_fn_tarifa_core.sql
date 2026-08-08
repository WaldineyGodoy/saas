CREATE OR REPLACE FUNCTION public.fn_fio_b_apurado(
    p_tusd_consumo_unit    numeric,
    p_tusd_compensado_unit numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    SELECT CASE
        WHEN p_tusd_consumo_unit IS NULL OR p_tusd_compensado_unit IS NULL THEN NULL
        ELSE GREATEST(p_tusd_consumo_unit - p_tusd_compensado_unit, 0)
    END;
$$;

COMMENT ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) IS
    'Fio B (R$/kWh) apurado na conta = TUSD do consumo - TUSD compensado. Spec 5.3, decisao 10. Devolve NULL se faltar insumo. "Sem compensacao" deve ser gravado como 0, nao NULL.';

REVOKE EXECUTE ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_tarifa_fornecedor(
    p_te           numeric,
    p_tusd         numeric,
    p_desconto_pct numeric,
    p_fio_b        numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    SELECT CASE
        WHEN p_te IS NULL OR p_tusd IS NULL
          OR p_desconto_pct IS NULL OR p_fio_b IS NULL THEN NULL
        ELSE GREATEST(
            (p_te + p_tusd) * (1 - p_desconto_pct / 100.0) - p_fio_b,
            0
        )
    END;
$$;

COMMENT ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) IS
    'Tarifa Fornecedor (R$/kWh) = (TE+TUSD) - desconto% - Fio B. Base da reparticao. Spec 5.3. Devolve NULL se faltar qualquer insumo.';

REVOKE EXECUTE ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_split_tarifa(
    p_tarifa_fornecedor  numeric,
    p_energia_compensada numeric,
    p_pct_crm            numeric,
    p_pct_gestora        numeric,
    p_pct_originador     numeric
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    WITH base AS (
        SELECT p_tarifa_fornecedor * p_energia_compensada AS total
         WHERE p_tarifa_fornecedor  IS NOT NULL
           AND p_energia_compensada IS NOT NULL
           AND p_pct_crm            IS NOT NULL
           AND p_pct_gestora        IS NOT NULL
           AND p_pct_originador     IS NOT NULL
    ), partes AS (
        SELECT total,
               total * p_pct_crm        / 100.0 AS crm,
               total * p_pct_gestora    / 100.0 AS gestora,
               total * p_pct_originador / 100.0 AS originador
          FROM base
    )
    SELECT jsonb_build_object(
        'total',      total,
        'crm',        crm,
        'gestora',    gestora,
        'originador', originador,
        'fornecedor', total - crm - gestora - originador
    ) FROM partes;
$$;

COMMENT ON FUNCTION public.fn_split_tarifa(numeric, numeric, numeric, numeric, numeric) IS
    'Reparte Tarifa Fornecedor x energia compensada. Percentuais sao parametros: o modelo de pagamento sera revisado. O fornecedor recebe o residual, garantindo que as partes fechem com o total.';

REVOKE EXECUTE ON FUNCTION public.fn_split_tarifa(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_split_tarifa(numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_auditar_tarifa(
    p_ibge           text,
    p_te             numeric,
    p_tusd           numeric,
    p_fio_b          numeric,
    p_tolerancia_pct numeric DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
    v_ref    record;
    v_campos text[] := ARRAY[]::text[];
BEGIN
    SELECT "TE" AS te, "TUSD" AS tusd, "Fio B" AS fio_b
      INTO v_ref
      FROM public."Concessionaria"
     WHERE "Cod. Ibge" = p_ibge
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'divergente', false,
            'campos',     '[]'::jsonb,
            'referencia', NULL
        );
    END IF;

    IF p_te IS NOT NULL AND v_ref.te IS NOT NULL AND v_ref.te <> 0
       AND abs(p_te - v_ref.te) / v_ref.te * 100 > p_tolerancia_pct THEN
        v_campos := v_campos || 'te'::text;
    END IF;

    IF p_tusd IS NOT NULL AND v_ref.tusd IS NOT NULL AND v_ref.tusd <> 0
       AND abs(p_tusd - v_ref.tusd) / v_ref.tusd * 100 > p_tolerancia_pct THEN
        v_campos := v_campos || 'tusd'::text;
    END IF;

    IF p_fio_b IS NOT NULL AND v_ref.fio_b IS NOT NULL AND v_ref.fio_b <> 0
       AND abs(p_fio_b - v_ref.fio_b) / v_ref.fio_b * 100 > p_tolerancia_pct THEN
        v_campos := v_campos || 'fio_b'::text;
    END IF;

    RETURN jsonb_build_object(
        'divergente', array_length(v_campos, 1) IS NOT NULL,
        'campos',     to_jsonb(v_campos),
        'referencia', jsonb_build_object('te', v_ref.te, 'tusd', v_ref.tusd, 'fio_b', v_ref.fio_b)
    );
END;
$$;

COMMENT ON FUNCTION public.fn_auditar_tarifa(text, numeric, numeric, numeric, numeric) IS
    'Compara a tarifa apurada na conta com a referencia de Concessionaria. NUNCA substitui o valor da conta: apenas sinaliza distorcao. Spec 5.6.';

REVOKE EXECUTE ON FUNCTION public.fn_auditar_tarifa(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_auditar_tarifa(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;
