DO $$
DECLARE
    v_faltando text;
BEGIN
    SELECT string_agg(c, ', ')
      INTO v_faltando
      FROM unnest(ARRAY['te_apurado','tusd_apurado','tusd_consumo_unit',
                        'tusd_compensado_unit','fio_b_apurado']) AS c
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='invoices' AND column_name=c);

    IF v_faltando IS NOT NULL THEN
        RAISE EXCEPTION 'FALHOU: colunas ausentes em invoices: %', v_faltando;
    END IF;
    RAISE NOTICE 'OK: colunas de apuracao presentes';
END $$;
