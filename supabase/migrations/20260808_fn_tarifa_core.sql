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
