CREATE OR REPLACE FUNCTION public.fn_faturamento_mensal_usina(
    p_usina_id     uuid,
    p_mes          date,
    p_desconto_pct numeric DEFAULT 20
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    SELECT COALESCE(SUM(
        public.fn_tarifa_fornecedor(
            COALESCE(i.te_apurado,     cu.te),
            COALESCE(i.tusd_apurado,   cu.tusd),
            p_desconto_pct,
            COALESCE(i.fio_b_apurado,  cu.fio_b)
        ) * COALESCE(i.consumo_compensado, 0)
    ), 0)
    FROM public.invoices i
    JOIN public.consumer_units cu ON cu.id = i.uc_id
    WHERE cu.usina_id       = p_usina_id
      AND cu.tipo_unidade   = 'beneficiaria'
      AND i.mes_referencia  = p_mes
      AND i.status::text    = 'pago';
$$;

COMMENT ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) IS
    'Faturamento do mes da usina: soma de tarifa_fornecedor x energia compensada, apenas faturas pagas (decisao 8). Valor apurado na conta prevalece sobre o cadastro da UC.';

REVOKE EXECUTE ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_faturamento_mensal_usina(uuid, date, numeric) TO authenticated, service_role;
