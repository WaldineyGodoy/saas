ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS te_apurado            numeric,
    ADD COLUMN IF NOT EXISTS tusd_apurado          numeric,
    ADD COLUMN IF NOT EXISTS tusd_consumo_unit     numeric,
    ADD COLUMN IF NOT EXISTS tusd_compensado_unit  numeric,
    ADD COLUMN IF NOT EXISTS fio_b_apurado         numeric;

COMMENT ON COLUMN public.invoices.te_apurado IS
    'TE (R$/kWh) lido da conta de energia. Prevalece sobre consumer_units.te.';
COMMENT ON COLUMN public.invoices.tusd_apurado IS
    'TUSD (R$/kWh) lido da conta de energia. Prevalece sobre consumer_units.tusd.';
COMMENT ON COLUMN public.invoices.tusd_consumo_unit IS
    'TUSD unitario do lancamento de consumo (Consumo-TUSD). Insumo do Fio B.';
COMMENT ON COLUMN public.invoices.tusd_compensado_unit IS
    'TUSD unitario do lancamento compensado (G_Comp...-TUSD). Insumo do Fio B.';
COMMENT ON COLUMN public.invoices.fio_b_apurado IS
    'Fio B (R$/kWh) = tusd_consumo_unit - tusd_compensado_unit. Calculado por conta.';
