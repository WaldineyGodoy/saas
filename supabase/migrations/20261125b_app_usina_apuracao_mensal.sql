-- =====================================================================
-- App: geração e receita da usina por mês, pela mesma apuração do CRM
-- Data: 25/11/2026
--
-- O app lia só generation_production, que fica vazia quando ninguém fecha
-- o mês no Faturamento: a usina aparecia com geração e receita zeradas
-- mesmo com a conta da UG lançada. Agora o mês é apurado como no extrato da
-- usina do CRM (PowerPlantModal, aba Lançamentos):
--   geração        = energia injetada da conta da UG no mês M;
--   UCs do período = leitura do dia seguinte à da UG até um mês depois, uma
--                    fatura por UC (src/lib/periodoRepasse.js);
--   saldo          = pago - contas de energia - retido
--                    - (gestão % + manutenção + arrendamento + serviços).
-- Fechamento salvo no Faturamento (saldo_receber preenchido) prevalece.
-- =====================================================================

-- Valor de service_values: número ou texto em reais ("R$ 1.234,56").
CREATE OR REPLACE FUNCTION public.fn_valor_servico(p jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
    select case jsonb_typeof(p)
        when 'number' then (p #>> '{}')::numeric
        when 'string' then nullif(replace(regexp_replace(p #>> '{}', '[^0-9,]', '', 'g'), ',', '.'), '')::numeric
        else 0 end;
$$;

CREATE OR REPLACE FUNCTION public.fn_usina_apuracao_mes(p_usina uuid, p_mes date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    u public.usinas%rowtype;
    v_mes date := date_trunc('month', p_mes)::date;
    v_ug public.consumer_units%rowtype;
    v_ug_inv record;
    v_prod public.generation_production%rowtype;
    v_injetada numeric := 0;
    v_ug_valor numeric := 0;
    v_ug_fim date;
    v_ini date; v_fim date;
    v_dia int;
    v_comp numeric := 0; v_fat numeric := 0; v_pago numeric := 0;
    v_retido numeric := 0; v_contas numeric := 0;
    v_manut numeric := 0; v_arrend numeric := 0; v_serv numeric := 0;
    v_detalhes jsonb := '{}'::jsonb;
    s text;
    v_subtotal numeric; v_gestao numeric; v_saldo numeric;
    v_prevista numeric;
BEGIN
    SELECT * INTO u FROM public.usinas WHERE id = p_usina;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- UG: a geradora vinculada; sem ela, pelo número da unidade geradora.
    SELECT * INTO v_ug FROM public.consumer_units
     WHERE usina_id = u.id AND tipo_unidade = 'geradora' LIMIT 1;
    IF v_ug.id IS NULL AND u.unidade_geradora IS NOT NULL THEN
        SELECT * INTO v_ug FROM public.consumer_units
         WHERE numero_uc = u.unidade_geradora
            OR numero_uc = regexp_replace(u.unidade_geradora, '\D', '', 'g')
         LIMIT 1;
    END IF;

    IF v_ug.id IS NOT NULL THEN
        SELECT i.energia_injetada, i.valor_concessionaria, i.data_leitura, i.data_leitura_anterior
          INTO v_ug_inv
          FROM public.invoices i
         WHERE i.uc_id = v_ug.id AND i.mes_referencia = v_mes
         ORDER BY i.created_at DESC LIMIT 1;
        IF FOUND THEN
            v_injetada := coalesce(v_ug_inv.energia_injetada, 0);
            IF NOT coalesce(v_ug.fatura_consumo_terceiro, false) THEN
                v_ug_valor := coalesce(v_ug_inv.valor_concessionaria, 0);
            END IF;
            IF v_ug_inv.data_leitura IS NOT NULL AND v_ug_inv.data_leitura_anterior IS NOT NULL THEN
                v_ug_fim := v_ug_inv.data_leitura;
            END IF;
        END IF;
    END IF;

    IF v_ug_fim IS NULL THEN
        v_dia := coalesce(u.dia_leitura, v_ug.dia_leitura);
        v_ug_fim := CASE WHEN v_dia IS NOT NULL
            THEN v_mes + (least(v_dia, extract(day from (v_mes + interval '1 month - 1 day'))::int) - 1)
            ELSE (v_mes + interval '1 month - 1 day')::date END;
    END IF;
    v_ini := v_ug_fim + 1;
    v_fim := (v_ug_fim + interval '1 month')::date;

    -- Beneficiárias: por UC, a fatura de leitura mais cedo no período; sem
    -- data de leitura, só pelo mês de referência.
    WITH fat AS (
        SELECT i.* FROM public.invoices i
          JOIN public.consumer_units c ON c.id = i.uc_id
         WHERE c.usina_id = u.id AND c.tipo_unidade <> 'geradora'
           AND i.status <> 'cancelado'
           AND i.mes_referencia BETWEEN (v_mes - interval '1 month')::date AND (v_mes + interval '2 month')::date
    ), com_leitura AS (
        SELECT DISTINCT ON (uc_id) * FROM fat
         WHERE data_leitura BETWEEN v_ini AND v_fim
         ORDER BY uc_id, data_leitura
    ), escolhidas AS (
        SELECT * FROM com_leitura
        UNION ALL
        SELECT DISTINCT ON (uc_id) f.* FROM fat f
         WHERE f.data_leitura IS NULL AND f.mes_referencia = v_mes
           AND NOT EXISTS (SELECT 1 FROM com_leitura c WHERE c.uc_id = f.uc_id)
    )
    SELECT coalesce(sum(consumo_compensado), 0),
           coalesce(sum(valor_a_pagar), 0),
           coalesce(sum(valor_a_pagar) FILTER (WHERE status = 'pago'), 0),
           coalesce(sum(valor_a_pagar - coalesce(valor_concessionaria, 0)) FILTER (
               WHERE status = 'pago' AND (recompensas_aplicadas #>> '{retencao_associacao,aplicado}')::boolean), 0),
           coalesce(sum(valor_concessionaria), 0)
      INTO v_comp, v_fat, v_pago, v_retido, v_contas
      FROM escolhidas;

    -- Lançamentos: do fechamento salvo do mês, ou dos valores do contrato.
    SELECT * INTO v_prod FROM public.generation_production
     WHERE usina_id = u.id AND mes_referencia = v_mes
     ORDER BY created_at DESC LIMIT 1;

    IF v_prod.id IS NOT NULL THEN
        v_manut := coalesce(v_prod.manutencao, 0);
        v_arrend := coalesce(v_prod.arrendamento, 0);
        v_detalhes := coalesce(v_prod.service_details, '{}'::jsonb);
        IF 'Energia' = ANY (coalesce(u.servicos_contratados, '{}')) THEN
            v_detalhes := v_detalhes || jsonb_build_object('Energia',
                CASE WHEN v_ug_valor > 0 THEN v_ug_valor
                     ELSE coalesce(public.fn_valor_servico(v_detalhes -> 'Energia'), 0) END);
        END IF;
        FOREACH s IN ARRAY coalesce(u.servicos_contratados, '{}') LOOP
            IF s NOT IN ('Gestão', 'Manutenção', 'Arrendamento') AND NOT v_detalhes ? s THEN
                v_detalhes := v_detalhes || jsonb_build_object(s, coalesce(public.fn_valor_servico(u.service_values -> s), 0));
            END IF;
        END LOOP;
    ELSE
        v_manut := coalesce(public.fn_valor_servico(u.service_values -> 'Manutenção'), 0);
        v_arrend := coalesce(public.fn_valor_servico(u.service_values -> 'Arrendamento'), 0);
        FOREACH s IN ARRAY coalesce(u.servicos_contratados, '{}') LOOP
            IF s NOT IN ('Gestão', 'Manutenção', 'Arrendamento') THEN
                v_detalhes := v_detalhes || jsonb_build_object(s,
                    CASE WHEN s = 'Energia' AND v_ug_valor > 0 THEN v_ug_valor
                         ELSE coalesce(public.fn_valor_servico(u.service_values -> s), 0) END);
            END IF;
        END LOOP;
    END IF;
    SELECT coalesce(sum(public.fn_valor_servico(value)), 0) INTO v_serv FROM jsonb_each(v_detalhes);

    v_subtotal := v_pago - v_contas - v_retido;
    v_gestao := v_subtotal * coalesce(u.gestao_percentual, 0) / 100;
    v_saldo := v_subtotal - (v_gestao + v_manut + v_arrend + v_serv);

    BEGIN
        v_prevista := (public.fn_geracao_estimada_mensal(u.id) ->> to_char(v_mes, 'MM'))::numeric;
    EXCEPTION WHEN others THEN
        v_prevista := NULL;
    END;

    RETURN jsonb_build_object(
        'id', coalesce(v_prod.id::text, to_char(v_mes, 'YYYY-MM')),
        'mes_referencia', v_mes,
        'geracao_mensal_kwh', CASE WHEN v_injetada > 0 THEN v_injetada ELSE coalesce(v_prod.geracao_mensal_kwh, 0) END,
        'geracao_prevista', coalesce(v_prevista, v_prod.geracao_prevista),
        'energia_compensada', v_comp,
        'faturamento_mensal', v_fat,
        'faturamento_pago', v_pago,
        'contas_energia', v_contas,
        'total_despesas', CASE WHEN v_prod.saldo_receber IS NOT NULL THEN v_prod.total_despesas
                               ELSE v_contas + v_retido + v_gestao + v_manut + v_arrend + v_serv END,
        'saldo_receber', coalesce(v_prod.saldo_receber, round(v_saldo, 2)),
        'status', v_prod.status,
        'repasse_status', v_prod.repasse_status,
        'periodo_ucs', jsonb_build_object('ini', v_ini, 'fim', v_fim)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_usina_apuracao_mes(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_valor_servico(jsonb) FROM PUBLIC, anon;

-- Meses da usina: os que têm conta da UG ou fechamento, os 12 mais recentes.
CREATE OR REPLACE FUNCTION public.fn_usina_meses(p_usina uuid)
RETURNS SETOF date
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select m from (
        select gp.mes_referencia as m from public.generation_production gp
         where gp.usina_id = p_usina and gp.mes_referencia is not null
        union
        select i.mes_referencia from public.invoices i
          join public.consumer_units c on c.id = i.uc_id
          join public.usinas u on u.id = p_usina
         where (c.usina_id = u.id and c.tipo_unidade = 'geradora')
            or (c.numero_uc = u.unidade_geradora)
    ) x
    where m is not null and m <= date_trunc('month', now())::date
    order by m desc
    limit 12;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_usina_meses(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_usina_detalhe(p_usina uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select jsonb_build_object(
        'usina', to_jsonb(u) - 'portal_credentials' - 'portal_password_secret_id'
                             - 'contract_terms' - 'cnpj_cpf',
        'producao', coalesce((
            select jsonb_agg(public.fn_usina_apuracao_mes(u.id, m) order by m desc)
              from public.fn_usina_meses(u.id) m), '[]'::jsonb)
    )
    from usinas u
    where u.id = p_usina and u.supplier_id = fn_app_supplier_id();
$$;

CREATE OR REPLACE FUNCTION public.app_minhas_usinas()
RETURNS TABLE(id uuid, name text, address jsonb, status text, potencia_kwp numeric, valor_investido numeric,
              geracao_estimada_kwh numeric, geracao_mes_kwh numeric, receita_mes numeric, mes_referencia date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
    select u.id, u.name, u.address, u.status::text, u.potencia_kwp,
           u.valor_investido, u.geracao_estimada_kwh,
           (a ->> 'geracao_mensal_kwh')::numeric, (a ->> 'saldo_receber')::numeric,
           (a ->> 'mes_referencia')::date
      from usinas u
      left join lateral (
            select public.fn_usina_apuracao_mes(u.id, m) a
              from public.fn_usina_meses(u.id) m
             limit 1) g on true
     where u.supplier_id = fn_app_supplier_id()
     order by u.name;
$$;
