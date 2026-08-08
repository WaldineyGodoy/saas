CREATE OR REPLACE FUNCTION public.fn_fio_b_apurado(
    p_tusd_consumo_unit    numeric,
    p_tusd_compensado_unit numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
    SELECT CASE
        WHEN p_tusd_consumo_unit IS NULL OR p_tusd_compensado_unit IS NULL THEN 0
        ELSE GREATEST(p_tusd_consumo_unit - p_tusd_compensado_unit, 0)
    END;
$$;

COMMENT ON FUNCTION public.fn_fio_b_apurado(numeric, numeric) IS
    'Fio B (R$/kWh) apurado na conta = TUSD do consumo - TUSD compensado. Spec 5.3, decisao 10.';

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
    SELECT GREATEST(
        (COALESCE(p_te, 0) + COALESCE(p_tusd, 0))
        * (1 - COALESCE(p_desconto_pct, 0) / 100.0)
        - COALESCE(p_fio_b, 0),
        0
    );
$$;

COMMENT ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) IS
    'Tarifa Fornecedor (R$/kWh) = (TE+TUSD) - desconto% - Fio B. Base da reparticao. Spec 5.3.';

REVOKE EXECUTE ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_tarifa_fornecedor(numeric, numeric, numeric, numeric) TO authenticated, service_role;
