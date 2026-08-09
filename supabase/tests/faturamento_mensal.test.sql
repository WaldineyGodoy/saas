-- ATENCAO: esta assercao roda SOMENTE contra a base de producao.
-- Ela depende de dados reais: a usina 'UFV Bom Jesus', o mes 2026-05-01, e o
-- fechamento correspondente em generation_production. Em base vazia ou em CI
-- ela falha por ausencia de dado, nao por defeito de codigo.
-- A tolerancia de 2%% e' deliberada e NAO deve ser relaxada: ver o plano,
-- Task 6, Step 4.
DO $$
DECLARE
    v_usina uuid;
    v_calc  numeric;
    v_reg   numeric;
    v_desvio numeric;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus' LIMIT 1;
    IF v_usina IS NULL THEN
        RAISE EXCEPTION 'FALHOU: usina UFV Bom Jesus nao encontrada';
    END IF;

    v_calc := public.fn_faturamento_mensal_usina(v_usina, DATE '2026-05-01', 20);

    SELECT faturamento_mensal INTO v_reg
      FROM public.generation_production
     WHERE usina_id = v_usina AND mes_referencia = DATE '2026-05-01'
       AND faturamento_mensal > 0
     LIMIT 1;

    IF v_reg IS NULL THEN
        RAISE EXCEPTION 'FALHOU: fechamento de 05/2026 nao encontrado para comparacao';
    END IF;

    v_desvio := abs(v_calc - v_reg) / v_reg * 100;

    RAISE NOTICE 'calculado=% registrado=% desvio=%%%', round(v_calc,2), round(v_reg,2), round(v_desvio,2);

    -- Spec 5.3: a validacao manual deu 5.896,14 contra 5.833,18 registrado = 1,08%.
    -- Tolerancia de 2% cobre esse desvio conhecido (2 UCs com tarifa zerada, spec 5.5)
    -- sem aceitar erro de formula, que produziria desvio de ordem de grandeza.
    IF v_desvio > 2 THEN
        RAISE EXCEPTION 'FALHOU faturamento: desvio de %%%% excede 2%%%%. calculado=% registrado=%',
                        round(v_desvio,2), round(v_calc,2), round(v_reg,2);
    END IF;

    RAISE NOTICE 'OK: fn_faturamento_mensal_usina reconcilia com producao';
END $$;

-- Diagnostico: o SUM da agregacao ignora silenciosamente faturas sem insumo
-- tarifario completo (fn_tarifa_fornecedor devolve NULL). Este bloco nao
-- reprova o teste, apenas expoe quantas faturas pagas do mes ficaram de fora
-- do total por falta de insumo, ou entraram com tarifa zerada (spec 5.5:
-- duas UCs com te = tusd = fio_b = 0 e 1.631 kWh compensados).
DO $$
DECLARE
    v_usina uuid;
    v_nulas int;
    v_zeradas int;
    v_total int;
BEGIN
    SELECT id INTO v_usina FROM public.usinas WHERE name = 'UFV Bom Jesus' LIMIT 1;

    SELECT count(*),
           count(*) FILTER (WHERE public.fn_tarifa_fornecedor(
                COALESCE(i.te_apurado, cu.te), COALESCE(i.tusd_apurado, cu.tusd),
                20, COALESCE(i.fio_b_apurado, cu.fio_b)) IS NULL),
           count(*) FILTER (WHERE public.fn_tarifa_fornecedor(
                COALESCE(i.te_apurado, cu.te), COALESCE(i.tusd_apurado, cu.tusd),
                20, COALESCE(i.fio_b_apurado, cu.fio_b)) = 0)
      INTO v_total, v_nulas, v_zeradas
      FROM public.invoices i
      JOIN public.consumer_units cu ON cu.id = i.uc_id
     WHERE cu.usina_id = v_usina
       AND cu.tipo_unidade = 'beneficiaria'
       AND i.mes_referencia = DATE '2026-05-01'
       AND i.status::text = 'pago';

    RAISE NOTICE 'DIAGNOSTICO 05/2026: % faturas pagas, % com tarifa NULL, % com tarifa zero',
                 v_total, v_nulas, v_zeradas;

    IF v_nulas > 0 THEN
        RAISE NOTICE 'ATENCAO: % faturas nao entraram no faturamento por falta de insumo tarifario', v_nulas;
    END IF;
END $$;
