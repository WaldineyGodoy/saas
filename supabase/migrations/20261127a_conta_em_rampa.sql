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
  'Regime do consumo (fn_regime_consumo): insuficiente | em_rampa | em_queda | estavel. Recalculado a cada gravacao do historico e a cada conta lida (gatilho tr_invoice_historico_consumo), por fn_historico_consumo_recalcular.';
COMMENT ON COLUMN public.consumer_units.franquia_sugerida IS
  'Franquia sugerida pelo regime. Nao altera franquia sozinha, exceto na primeira carga do historico em rampa (fn_historico_consumo_gravar_uc), e nunca na UC criada por termo aditivo assinado.';

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

-- fn_historico_consumo_recalcular: bloco UNICO de regime, franquia sugerida,
-- franquia e base do Start. Chamado pela gravacao do historico (cadastro,
-- importacao, adesao, aditivo) e pela conta mensal (gatilho em invoices), para
-- que o regime e o perfil nunca saiam de sincronia.
--   p_h               perfil ja mesclado (antes do preenchimento)
--   p_aplicar_franquia troca a franquia pela de rampa quando em rampa
--   p_congelar_base    congela start_base_kwh se ainda nulo (a conta mensal nao congela)
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_recalcular(
    p_uc uuid, p_h jsonb, p_aplicar_franquia boolean, p_congelar_base boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_cu      record;
    v_h       jsonb;
    v_med     numeric;
    v_base    numeric;
    v_reg     jsonb;
    v_regime  text;
    v_franq   numeric;
    v_sug     numeric;
BEGIN
    SELECT cu.historico_consumo, cu.start_base_kwh, cu.franquia, cu.regime_consumo, cu.franquia_sugerida INTO v_cu
      FROM public.consumer_units cu WHERE cu.id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_historico_consumo_recalcular: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;

    v_reg    := public.fn_regime_consumo(p_h);
    v_regime := v_reg ->> 'regime';
    v_h      := public.fn_historico_consumo_normalizar(p_h);
    v_med    := public.fn_mediana_kwh(v_h);
    IF v_h = '{}'::jsonb THEN
        v_h := v_cu.historico_consumo;
    END IF;

    -- franquia sugerida. A sugestao de saida da rampa fica pendente ate a equipe
    -- aplicar; a de queda some quando o consumo volta ao estavel.
    v_sug := CASE
        WHEN v_regime = 'em_rampa' THEN (v_reg ->> 'franquia_rampa')::numeric
        WHEN v_regime = 'em_queda' THEN (v_reg ->> 'franquia_janela')::numeric
        WHEN v_regime = 'estavel' AND v_cu.regime_consumo = 'em_rampa' THEN (v_reg ->> 'franquia_janela')::numeric
        WHEN v_regime = 'estavel' AND v_cu.regime_consumo = 'em_queda' THEN NULL
        ELSE v_cu.franquia_sugerida END;

    v_franq := v_cu.franquia;
    IF p_aplicar_franquia AND v_regime = 'em_rampa' THEN
        v_franq := v_sug;
    END IF;

    -- base do Start: congelada uma unica vez; em rampa, com a franquia de rampa (opcao C)
    v_base := v_cu.start_base_kwh;
    IF p_congelar_base AND v_base IS NULL AND v_med > 0 THEN
        v_base := CASE WHEN v_regime = 'em_rampa' THEN (v_reg ->> 'franquia_rampa')::numeric ELSE v_med END;
    END IF;

    UPDATE public.consumer_units
       SET historico_consumo   = v_h,
           consumo_mediano_kwh = v_med,
           start_base_kwh      = v_base,
           start_base_em       = CASE WHEN v_base IS DISTINCT FROM v_cu.start_base_kwh THEN now() ELSE start_base_em END,
           franquia            = v_franq,
           franquia_sugerida   = v_sug,
           regime_consumo      = v_regime,
           regime_desde        = CASE WHEN v_cu.regime_consumo IS DISTINCT FROM v_regime THEN now() ELSE regime_desde END
     WHERE id = p_uc
       AND (historico_consumo, consumo_mediano_kwh, start_base_kwh, franquia, franquia_sugerida, regime_consumo)
           IS DISTINCT FROM (v_h, v_med, v_base, v_franq, v_sug, v_regime);

    RETURN jsonb_build_object('historico', v_h, 'mediana', v_med, 'start_base_kwh', v_base,
                              'regime', v_regime, 'franquia_sugerida', v_sug, 'franquia', v_franq);
END;
$function$;

ALTER FUNCTION public.fn_historico_consumo_recalcular(uuid, jsonb, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_recalcular(uuid, jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_historico_consumo_recalcular(uuid, jsonb, boolean, boolean) TO service_role;

-- fn_historico_consumo_gravar_uc (4 argumentos): mescla o array do leitor no
-- perfil (com dias por mes) e delega ao bloco unico.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_gravar_uc(
    p_uc uuid, p_historico jsonb, p_origem text, p_aplicar_franquia boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_cu      record;
    v_h       jsonb;
    v_e       jsonb;
    v_mes     text;
    v_k       text;
    v_primeira boolean;
BEGIN
    IF p_origem IS NULL OR p_origem NOT IN ('cadastro', 'conta') THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: origem "%" invalida (cadastro | conta)', p_origem
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_historico) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: p_historico precisa ser o array do leitor [{"mes":"AAAA-MM","kwh":N}]'
            USING ERRCODE = '22023';
    END IF;

    SELECT cu.id, cu.historico_consumo, cu.start_base_kwh, cu.franquia, cu.regime_consumo, cu.regime_desde, cu.franquia_sugerida INTO v_cu
      FROM public.consumer_units cu WHERE cu.id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;

    v_primeira := v_cu.historico_consumo IS NULL OR v_cu.historico_consumo = '{}'::jsonb;
    v_h := COALESCE(v_cu.historico_consumo, '{}'::jsonb);
    -- historico real chegou: o preenchimento por franquia (backfill sem dado) sai
    IF public.fn_mediana_kwh(p_historico) IS NOT NULL THEN
        SELECT COALESCE(jsonb_object_agg(m.key, m.value), '{}'::jsonb) INTO v_h
          FROM jsonb_each(v_h) m
         WHERE COALESCE(m.value ->> 'origem', '') <> 'franquia';
    END IF;
    -- kwh ilegivel conta como 0 (o mes fica e recebe o preenchimento)
    FOR v_e IN SELECT e FROM jsonb_array_elements(p_historico) e
                WHERE jsonb_typeof(e) = 'object'
                  AND (e ->> 'mes') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
                ORDER BY e ->> 'mes' LOOP
        v_mes := v_e ->> 'mes';
        v_h := public.fn_historico_consumo_aplicar(v_h, v_mes,
                   CASE WHEN (v_e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_e ->> 'kwh')::numeric ELSE 0 END,
                   p_origem);
        -- dias do ciclo: so quando a leitura entrou no perfil (ref igual)
        v_k := right(v_mes, 2);
        IF (v_e ->> 'dias') ~ '^[0-9]+(\.[0-9]+)?$' AND (v_e ->> 'dias')::numeric > 0
           AND (v_h -> v_k ->> 'ref') = v_mes THEN
            v_h := jsonb_set(v_h, ARRAY[v_k, 'dias'], to_jsonb((v_e ->> 'dias')::numeric));
        END IF;
    END LOOP;

    -- primeira carga em rampa: a franquia do cadastro e trocada, exceto quando o
    -- chamador ja tem contrato assinado com ela (termo aditivo: p_aplicar_franquia = false)
    RETURN public.fn_historico_consumo_recalcular(p_uc, v_h, p_aplicar_franquia AND v_primeira, true);
END;
$function$;

ALTER FUNCTION public.fn_historico_consumo_gravar_uc(uuid, jsonb, text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_gravar_uc(uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_historico_consumo_gravar_uc(uuid, jsonb, text, boolean) TO service_role;

-- Assinatura antiga (3 argumentos) mantida para os chamadores existentes
-- (fn_gravar_historico_consumo, fn_criar_assinante_publico): aplica a franquia
-- na primeira carga em rampa.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_gravar_uc(
    p_uc uuid, p_historico jsonb, p_origem text DEFAULT 'cadastro')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN public.fn_historico_consumo_gravar_uc(p_uc, p_historico, p_origem, true);
END;
$function$;

-- Equipe aplica a franquia sugerida (botao Aplicar). Nao mexe na base do Start.
CREATE OR REPLACE FUNCTION public.fn_aplicar_franquia_sugerida(p_uc uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_sug numeric;
BEGIN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR COALESCE(public.fn_papel_interno(), false)
            OR session_user = 'postgres') THEN
        RAISE EXCEPTION 'fn_aplicar_franquia_sugerida: sem permissao' USING ERRCODE = '42501';
    END IF;
    SELECT franquia_sugerida INTO v_sug FROM public.consumer_units WHERE id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_aplicar_franquia_sugerida: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;
    IF v_sug IS NULL THEN
        RAISE EXCEPTION 'fn_aplicar_franquia_sugerida: UC sem franquia sugerida' USING ERRCODE = '22023';
    END IF;
    UPDATE public.consumer_units SET franquia = v_sug, franquia_sugerida = NULL WHERE id = p_uc;
    RETURN v_sug;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_aplicar_franquia_sugerida(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_franquia_sugerida(uuid) TO authenticated, service_role;

-- Conta mensal (gatilho tr_invoice_historico_consumo, inalterado): a conta lida
-- sobrescreve o mes do perfil e passa pelo MESMO bloco de regime da gravacao do
-- historico. Nao troca a franquia (so sugere) e nao congela a base do Start.
-- Dias do ciclo = data_leitura - data_leitura_anterior, quando ambas vieram.
-- Uma falha aqui nao derruba a gravacao da conta (aviso no log).
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_da_conta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_h    jsonb;
    v_novo jsonb;
    v_ref  text;
    v_k    text;
    v_dias int;
BEGIN
    IF NEW.uc_id IS NULL OR NEW.mes_referencia IS NULL OR COALESCE(NEW.consumo_kwh, 0) <= 0
       OR NEW.status::text IN ('cancelado', 'cancelada', 'erro') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.consumo_kwh IS NOT DISTINCT FROM OLD.consumo_kwh
       AND NEW.mes_referencia IS NOT DISTINCT FROM OLD.mes_referencia
       AND NEW.uc_id IS NOT DISTINCT FROM OLD.uc_id
       AND OLD.status::text NOT IN ('cancelado', 'cancelada', 'erro') THEN
        RETURN NEW;
    END IF;

    BEGIN
        SELECT cu.historico_consumo INTO v_h FROM public.consumer_units cu WHERE cu.id = NEW.uc_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;
        v_ref  := to_char(NEW.mes_referencia, 'YYYY-MM');
        v_k    := right(v_ref, 2);
        v_novo := public.fn_historico_consumo_aplicar(COALESCE(v_h, '{}'::jsonb), v_ref, NEW.consumo_kwh, 'conta');
        v_dias := NEW.data_leitura - NEW.data_leitura_anterior;
        IF v_dias BETWEEN 1 AND 90
           AND (v_novo -> v_k ->> 'ref') = v_ref AND (v_novo -> v_k ->> 'origem') = 'conta' THEN
            v_novo := jsonb_set(v_novo, ARRAY[v_k, 'dias'], to_jsonb(v_dias));
        END IF;
        PERFORM public.fn_historico_consumo_recalcular(NEW.uc_id, v_novo, false, false);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_historico_consumo_da_conta: perfil da UC % nao atualizado pela conta %: %', NEW.uc_id, NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$function$;
ALTER FUNCTION public.fn_historico_consumo_da_conta() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_da_conta() FROM PUBLIC, anon, authenticated;

-- Termo aditivo: a UC nasce com o contrato ja assinado (franquia = media lida).
-- Decisao do dono (28/11/2026): em rampa a franquia NAO muda, so a sugestao.
-- Copia da definicao de producao; unica mudanca: p_aplicar_franquia = false.
CREATE OR REPLACE FUNCTION public.fn_criar_uc_do_aditivo(p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_lead public.leads%rowtype;
    v_sub public.subscribers%rowtype;
    v_plano public.planos_assinatura_energia%rowtype;
    v_conta jsonb;
    v_end jsonb;
    v_num text;
    v_uc uuid;
    v_partes text[];
    v_dia int;
    v_media text;
begin
    select * into v_lead from public.leads where id = p_lead for update;
    if not found or v_lead.solicitante_assinante_id is null or v_lead.conta_lida is null then
        return jsonb_build_object('ok', false, 'motivo', 'pedido_invalido');
    end if;
    select * into v_sub from public.subscribers where id = v_lead.solicitante_assinante_id;
    select * into v_plano from public.planos_assinatura_energia
     where id = coalesce(public.fn_plano_assinatura_vigente(v_lead.plano_id), v_lead.plano_id);

    v_conta := v_lead.conta_lida;
    v_num := btrim(coalesce(v_conta ->> 'numeroUc', ''));
    if v_num = '' then
        return jsonb_build_object('ok', false, 'motivo', 'sem_numero_uc');
    end if;

    select c.id into v_uc from public.consumer_units c
     where c.subscriber_id = v_sub.id
       and public.fn_uc_normalizada(c.numero_uc) = public.fn_uc_normalizada(v_num)
     limit 1;
    if v_uc is not null then
        return jsonb_build_object('ok', true, 'uc_id', v_uc, 'ja_existia', true);
    end if;

    if public.fn_uc_ja_cadastrada(v_num) then
        insert into public.crm_history (entity_type, entity_id, content, metadata)
        values ('lead', v_lead.id,
                format('Termo aditivo assinado, mas a UC %s ja esta em outro cadastro ativo. UC nao criada.', v_num),
                jsonb_build_object('origem', 'fn_criar_uc_do_aditivo'));
        return jsonb_build_object('ok', false, 'motivo', 'uc_em_outro_cadastro');
    end if;

    v_end := case when jsonb_typeof(v_conta -> 'endereco') = 'object' then v_conta -> 'endereco' else '{}'::jsonb end;
    v_partes := regexp_match(btrim(coalesce(v_end ->> 'logradouro', '')), '^(.*\D)[\s,]+(\d+[A-Z]?)$');
    v_dia := coalesce(
        v_sub.consolidated_due_day,
        (select c.dia_vencimento from public.consumer_units c
          where c.subscriber_id = v_sub.id and c.dia_vencimento is not null
          order by c.created_at limit 1));
    v_media := v_conta ->> 'mediaKwh';

    insert into public.consumer_units (
        subscriber_id, numero_uc, titular_conta, titular_fatura_id, tipo_ligacao, concessionaria,
        status, modalidade, franquia, plano_assinatura_id, desconto_assinante, dia_vencimento, address
    ) values (
        v_sub.id, v_num,
        nullif(btrim(coalesce(v_conta ->> 'titular', '')), ''),
        case when public.fn_nome_comparavel(v_conta ->> 'titular') = public.fn_nome_comparavel(v_sub.name) then v_sub.id end,
        case when v_conta ->> 'ligacao' in ('monofasico', 'bifasico', 'trifasico')
             then (v_conta ->> 'ligacao')::public.uc_tipo_ligacao end,
        coalesce(nullif(v_conta ->> 'concessionaria', ''), 'Neoenergia Cosern'),
        'em_ativacao',
        case when v_plano.modalidade in ('auto_consumo_remoto', 'geracao_compartilhada')
             then v_plano.modalidade::public.uc_modalidade else 'geracao_compartilhada' end,
        case when v_media ~ '^\d+(\.\d+)?$' then v_media::numeric end,
        v_plano.id, v_plano.desconto_assinante, v_dia,
        jsonb_build_object(
            'cep', public.fn_so_digitos(v_end ->> 'cep'),
            'rua', coalesce(v_partes[1], v_end ->> 'logradouro'),
            'numero', v_partes[2],
            'complemento', v_end ->> 'complemento',
            'bairro', v_end ->> 'bairro',
            'cidade', v_end ->> 'cidade',
            'uf', upper(v_end ->> 'uf'))
    )
    returning id into v_uc;

    -- 20261112b: perfil de consumo e teto do Start a partir do historico lido
    -- 20261127a: contrato ja assinado -> em rampa a franquia nao muda, so a sugestao
    if jsonb_typeof(v_conta -> 'historico') = 'array' then
        begin
            perform public.fn_historico_consumo_gravar_uc(v_uc, v_conta -> 'historico', 'cadastro', false);
        exception when others then
            raise warning 'fn_criar_uc_do_aditivo: historico de consumo da UC % nao gravado: %', v_num, sqlerrm;
        end;
    end if;

    update public.leads set status = 'ativacao', updated_at = now() where id = v_lead.id;

    insert into public.crm_history (entity_type, entity_id, content, metadata)
    values ('subscriber', v_sub.id,
            format('Termo aditivo assinado: UC %s incluida em ativacao (plano %s).', v_num, coalesce(v_plano.nome, '-')),
            jsonb_build_object('origem', 'fn_criar_uc_do_aditivo', 'lead_id', v_lead.id, 'uc_id', v_uc));

    return jsonb_build_object('ok', true, 'uc_id', v_uc, 'ja_existia', false);
end;
$function$;
