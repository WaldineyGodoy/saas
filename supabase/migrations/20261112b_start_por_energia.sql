-- ===========================================================================
-- Plano do Originador: START POR ENERGIA e base BRUTA (dono, 12/11/2026, 2a revisao)
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md, secoes
--       "Revisao de 12/11/2026 (2a, dono)", "Complemento do dono" e
--       "Contrato comum (nomes fixos)". Substitui a 20261112a (Start em N
--       faturas), que NUNCA foi aplicada: o que ela fazia (matriz de Start por
--       nivel L1..L3, validador, patch por ancora) esta incorporado aqui.
-- Depende de 20261110a e 20261110b (ja aplicadas).
--
--   1. PERFIL DE CONSUMO DA UC (consumer_units):
--        historico_consumo   {"01":{"kwh":980,"ref":"2026-01","origem":"cadastro"},...,"12":{...}}
--                            origem: cadastro | conta | mediana | franquia
--        consumo_mediano_kwh mediana atual do perfil (recalculada)
--        start_base_kwh      mediana CONGELADA (teto do Start = multiplicador x start_base_kwh);
--        start_base_em       nunca reescrita depois de preenchida, salvo
--                            fn_redefinir_start_base_kwh (so admin).
--      fn_mediana_kwh, fn_gravar_historico_consumo (RPC do leitor da conta),
--      autoatualizacao por gatilho em invoices.consumo_kwh (consumo MEDIDO da
--      conta: sobrescreve o mes do perfil, recalcula a mediana, nao mexe no
--      teto) e fn_geracao_estimada_mensal (geracao da usina mes a mes pela
--      irradiancia da cidade).
--   2. BACKFILL: perfil das UCs a partir das contas ja lidas (ultimos 12 meses,
--      a mais recente por mes do calendario); sem conta, 12 x franquia.
--      start_base_kwh = mediana desse perfil, congelada agora.
--   3. planos_originador.start_config vira
--        {"multiplicador": N, "regras_multinivel": {cargo: {niveis, max_niveis 0..3}}}
--      Conversao SEM mudar numeros: multiplicador = quantidade de faturas
--      elegiveis de hoje; o % da menor fatura elegivel vira o L1 do cargo
--      (max_niveis 1). Somem faturas_elegiveis e regras.
--   4. BASE BRUTA: fn_base_recompensa_fatura devolve tambem base_bruta
--      (consumo_compensado x tarifa, sem desconto nem Fio B). Todos os
--      percentuais (parceiros, gestao B2W, Conect, Start da B2W) incidem sobre
--      ela; o fornecedor fica com a base LIQUIDA menos o deduzido. Piso como
--      antes (sobre a tarifa bruta, teto = base liquida - piso; Start isenta).
--      fn_calcular_split_recompensa aceita base propria por participante
--      (chave "base"), usada no Start por energia.
--   5. MOTOR (handle_invoice_paid_ledger), por participante-parceiro e pelo
--      plano efetivo DELE (fn_plano_originador_start_energia):
--        kwh_start = min(consumo_compensado, start_base_kwh, teto - kwh_start_pago_antes)
--                    (teto por fatura = 1 x mediana: exemplo do dono, F2 1.200 -> 1.000)
--        start      Start (todos os niveis) enquanto houver saldo; depois nada
--        recorrente recorrencia sempre
--        ambos      Start enquanto houver saldo; a recorrencia comeca na fatura
--                   SEGUINTE a que zerou o saldo (nunca os dois na mesma fatura)
--        UC sem start_base_kwh -> Start nao paga (uc_sem_consumo_base);
--        recorrencia segue (inclusive no Hibrido).
--      TRANSICAO: fatura paga ANTES desta migracao (sem a marca
--      start_por_energia) consome o saldo do Start com a energia compensada
--      dela -- a janela antiga ja correu; sem isso toda UC antiga pagaria um
--      Start novo na proxima fatura. A guarda de 20261110b (Start pago pela
--      regra antiga encerra o Start da UC) continua.
--      Congela por beneficiario: kwh_start, kwh_start_pago_antes,
--      teto_start_kwh, multiplicador, start_base_kwh, base, tarifa, regra.
--      versao '20261112_start_por_energia'.
--
-- Patch por ANCORA sobre a definicao viva: cada ancora exatamente 1 vez.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas do perfil de consumo
-- ---------------------------------------------------------------------------
ALTER TABLE public.consumer_units
    ADD COLUMN IF NOT EXISTS historico_consumo   jsonb,
    ADD COLUMN IF NOT EXISTS consumo_mediano_kwh numeric,
    ADD COLUMN IF NOT EXISTS start_base_kwh      numeric,
    ADD COLUMN IF NOT EXISTS start_base_em       timestamptz;

ALTER TABLE public.consumer_units
    ADD CONSTRAINT consumer_units_historico_consumo_objeto
        CHECK (historico_consumo IS NULL OR jsonb_typeof(historico_consumo) = 'object'),
    ADD CONSTRAINT consumer_units_start_base_kwh_positivo
        CHECK (start_base_kwh IS NULL OR start_base_kwh > 0);

COMMENT ON COLUMN public.consumer_units.historico_consumo IS
  'Perfil de consumo por MES DO CALENDARIO: {"01":{"kwh":980,"ref":"2026-01","origem":"cadastro"},...,"12":{...}}. origem: cadastro (leitor no upload) | conta (sobrescrito por conta nova) | mediana (mes zerado/ausente preenchido) | franquia (backfill sem dado). Gravar por fn_gravar_historico_consumo.';
COMMENT ON COLUMN public.consumer_units.consumo_mediano_kwh IS
  'Mediana atual de historico_consumo (meses com kwh > 0, sem os preenchidos). Recalculada a cada gravacao.';
COMMENT ON COLUMN public.consumer_units.start_base_kwh IS
  'Mediana CONGELADA no cadastro: teto do Start dos parceiros = multiplicador do Plano do Originador x start_base_kwh. Nunca reescrita depois de preenchida (so fn_redefinir_start_base_kwh, admin).';
COMMENT ON COLUMN public.consumer_units.start_base_em IS
  'Quando start_base_kwh foi congelado.';

-- ---------------------------------------------------------------------------
-- 1a. Funcoes puras do perfil
-- ---------------------------------------------------------------------------
-- Mediana em kWh. Aceita o array do leitor ([{"mes","kwh"}]) ou o perfil
-- (objeto por mes). Mesma regra da tela (src/lib/historicoConsumo.js,
-- montarPerfil/medianaKwh): a mediana sai dos meses que FICAM no perfil --
-- no array, so a leitura mais recente de cada mes do calendario (a Cosern
-- traz 13 meses) --, so kwh > 0, e no perfil ignora os meses preenchidos
-- (origem 'mediana'), senao a propria mediana puxaria a mediana.
CREATE OR REPLACE FUNCTION public.fn_mediana_kwh(p_historico jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
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
                   AND COALESCE(m.value ->> 'origem', '') <> 'mediana'
                   AND (m.value ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$') x
         WHERE x.kwh > 0
    ), o AS (
        SELECT kwh, row_number() OVER (ORDER BY kwh) AS rn, count(*) OVER () AS n FROM v
    )
    SELECT round(avg(kwh), 2) FROM o WHERE rn IN ((n + 1) / 2, (n + 2) / 2);
$function$;

-- Grava UM mes no perfil. O mes do calendario guarda a leitura mais recente:
-- so sobrescreve entrada ausente, preenchida (mediana/franquia) ou de
-- referencia mais antiga. Mesma referencia: conta ganha de cadastro.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_aplicar(
    p_historico jsonb, p_ref text, p_kwh numeric, p_origem text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
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
       AND COALESCE(v_cur ->> 'origem', '') NOT IN ('mediana', 'franquia')
       AND (v_cur ->> 'ref') IS NOT NULL
       AND ((v_cur ->> 'ref') > p_ref
            OR ((v_cur ->> 'ref') = p_ref AND v_cur ->> 'origem' = 'conta' AND p_origem <> 'conta')) THEN
        RETURN v_h;
    END IF;
    RETURN v_h || jsonb_build_object(v_k, jsonb_build_object('kwh', p_kwh, 'ref', p_ref, 'origem', p_origem));
END;
$function$;

-- Completa os 12 meses: mes ausente, zerado ou ja preenchido recebe a
-- mediana (origem 'mediana'). Sem nenhum mes com consumo, nada muda.
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_normalizar(p_historico jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_h   jsonb := CASE WHEN jsonb_typeof(p_historico) = 'object' THEN p_historico ELSE '{}'::jsonb END;
    v_med numeric := public.fn_mediana_kwh(v_h);
    v_k   text;
    v_e   jsonb;
BEGIN
    IF v_med IS NULL THEN
        RETURN v_h;
    END IF;
    FOR v_k IN SELECT to_char(g, 'FM00') FROM generate_series(1, 12) g LOOP
        v_e := v_h -> v_k;
        CONTINUE WHEN jsonb_typeof(v_e) = 'object'
                  AND COALESCE(v_e ->> 'origem', '') <> 'mediana'
                  AND (v_e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$'
                  AND (v_e ->> 'kwh')::numeric > 0;
        v_h := v_h || jsonb_build_object(v_k, jsonb_build_object(
                   'kwh', v_med,
                   'ref', CASE WHEN jsonb_typeof(v_e) = 'object' THEN v_e -> 'ref' ELSE 'null'::jsonb END,
                   'origem', 'mediana'));
    END LOOP;
    RETURN v_h;
END;
$function$;

ALTER FUNCTION public.fn_mediana_kwh(jsonb) OWNER TO postgres;
ALTER FUNCTION public.fn_historico_consumo_aplicar(jsonb, text, numeric, text) OWNER TO postgres;
ALTER FUNCTION public.fn_historico_consumo_normalizar(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_mediana_kwh(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_aplicar(jsonb, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_normalizar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mediana_kwh(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_historico_consumo_aplicar(jsonb, text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_historico_consumo_normalizar(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. RPC do leitor + guarda do teto + redefinicao por admin
-- ---------------------------------------------------------------------------
-- Logica interna (sem portao; sem GRANT): usada pela RPC abaixo e pelos
-- cadastros SECURITY DEFINER (adesao publica, termo aditivo).
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_gravar_uc(
    p_uc uuid, p_historico jsonb, p_origem text DEFAULT 'cadastro')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_cu   record;
    v_h    jsonb;
    v_e    jsonb;
    v_med  numeric;
    v_base numeric;
BEGIN
    IF p_origem IS NULL OR p_origem NOT IN ('cadastro', 'conta') THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: origem "%" invalida (cadastro | conta)', p_origem
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_historico) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: p_historico precisa ser o array do leitor [{"mes":"AAAA-MM","kwh":N}]'
            USING ERRCODE = '22023';
    END IF;

    SELECT cu.id, cu.historico_consumo, cu.start_base_kwh INTO v_cu
      FROM public.consumer_units cu WHERE cu.id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;

    v_h := COALESCE(v_cu.historico_consumo, '{}'::jsonb);
    -- historico real chegou: o preenchimento por franquia (backfill sem dado)
    -- sai, para a mediana ser a dos meses lidos (mesma regra da tela)
    IF public.fn_mediana_kwh(p_historico) IS NOT NULL THEN
        SELECT COALESCE(jsonb_object_agg(m.key, m.value), '{}'::jsonb) INTO v_h
          FROM jsonb_each(v_h) m
         WHERE COALESCE(m.value ->> 'origem', '') <> 'franquia';
    END IF;
    -- kwh ilegivel conta como 0 (o mes fica e recebe a mediana), como na tela
    FOR v_e IN SELECT e FROM jsonb_array_elements(p_historico) e
                WHERE jsonb_typeof(e) = 'object'
                  AND (e ->> 'mes') ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
                ORDER BY e ->> 'mes' LOOP
        v_h := public.fn_historico_consumo_aplicar(v_h, v_e ->> 'mes',
                   CASE WHEN (v_e ->> 'kwh') ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_e ->> 'kwh')::numeric ELSE 0 END,
                   p_origem);
    END LOOP;
    v_h   := public.fn_historico_consumo_normalizar(v_h);
    v_med := public.fn_mediana_kwh(v_h);
    IF v_h = '{}'::jsonb THEN
        v_h := v_cu.historico_consumo;
    END IF;

    v_base := v_cu.start_base_kwh;
    IF v_base IS NULL AND v_med > 0 THEN
        v_base := v_med;
        UPDATE public.consumer_units
           SET historico_consumo = v_h, consumo_mediano_kwh = v_med,
               start_base_kwh = v_base, start_base_em = now()
         WHERE id = p_uc;
    ELSE
        UPDATE public.consumer_units
           SET historico_consumo = v_h, consumo_mediano_kwh = v_med
         WHERE id = p_uc;
    END IF;

    RETURN jsonb_build_object('historico', v_h, 'mediana', v_med, 'start_base_kwh', v_base);
END;
$function$;

ALTER FUNCTION public.fn_historico_consumo_gravar_uc(uuid, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_gravar_uc(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_gravar_historico_consumo(
    p_uc uuid, p_historico jsonb, p_origem text DEFAULT 'cadastro')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    -- mesmo portao do UPDATE de consumer_units (RLS consumer_units_update_interno)
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR COALESCE(public.fn_papel_interno(), false)
            OR session_user = 'postgres') THEN
        RAISE EXCEPTION 'fn_gravar_historico_consumo: sem permissao para gravar o historico de consumo da UC'
            USING ERRCODE = '42501';
    END IF;
    RETURN public.fn_historico_consumo_gravar_uc(p_uc, p_historico, p_origem);
END;
$function$;

ALTER FUNCTION public.fn_gravar_historico_consumo(uuid, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_gravar_historico_consumo(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_gravar_historico_consumo(uuid, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_gravar_historico_consumo(uuid, jsonb, text) IS
  'Grava o historico do leitor da conta ([{"mes":"AAAA-MM","kwh":N,"dias":N}]) no perfil da UC: a leitura mais recente por mes do calendario, mediana sobre kwh > 0, meses zerados/ausentes preenchidos com a mediana, consumo_mediano_kwh recalculado e start_base_kwh congelado se nulo. Nao mexe em franquia. Devolve {historico, mediana, start_base_kwh}.';

-- teto do Start fixo: start_base_kwh preenchido nao muda por UPDATE comum
CREATE OR REPLACE FUNCTION public.fn_consumer_units_start_base_fixo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF OLD.start_base_kwh IS NOT NULL
       AND NEW.start_base_kwh IS DISTINCT FROM OLD.start_base_kwh
       AND COALESCE(current_setting('b2w.start_base_redefinir', true), '') <> 'on' THEN
        RAISE EXCEPTION 'start_base_kwh da UC % e o teto congelado do Start (% kWh): so muda por fn_redefinir_start_base_kwh (admin)',
            OLD.id, OLD.start_base_kwh USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;
ALTER FUNCTION public.fn_consumer_units_start_base_fixo() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_consumer_units_start_base_fixo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_consumer_units_start_base_fixo ON public.consumer_units;
CREATE TRIGGER tr_consumer_units_start_base_fixo
    BEFORE UPDATE OF start_base_kwh ON public.consumer_units
    FOR EACH ROW EXECUTE FUNCTION public.fn_consumer_units_start_base_fixo();

CREATE OR REPLACE FUNCTION public.fn_redefinir_start_base_kwh(p_uc uuid, p_kwh numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_ant  numeric;
    v_novo numeric;
BEGIN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR COALESCE(public.fn_eh_admin(), false)
            OR session_user = 'postgres') THEN
        RAISE EXCEPTION 'fn_redefinir_start_base_kwh: so admin redefine o teto do Start' USING ERRCODE = '42501';
    END IF;
    SELECT cu.start_base_kwh, COALESCE(p_kwh, cu.consumo_mediano_kwh) INTO v_ant, v_novo
      FROM public.consumer_units cu WHERE cu.id = p_uc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_redefinir_start_base_kwh: UC % inexistente', p_uc USING ERRCODE = 'P0002';
    END IF;
    IF v_novo IS NULL OR v_novo <= 0 THEN
        RAISE EXCEPTION 'fn_redefinir_start_base_kwh: base % invalida (> 0)', v_novo USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('b2w.start_base_redefinir', 'on', true);
    UPDATE public.consumer_units SET start_base_kwh = v_novo, start_base_em = now() WHERE id = p_uc;
    PERFORM set_config('b2w.start_base_redefinir', '', true);
    RETURN jsonb_build_object('start_base_kwh_anterior', v_ant, 'start_base_kwh', v_novo);
END;
$function$;
ALTER FUNCTION public.fn_redefinir_start_base_kwh(uuid, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_redefinir_start_base_kwh(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_redefinir_start_base_kwh(uuid, numeric) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1c. Autoatualizacao: a conta lida (invoices.consumo_kwh = consumo MEDIDO)
--     sobrescreve o mes do perfil. Nunca a energia compensada (limitada pela
--     usina, esconderia o overbook). consumo_kwh 0 nao entra: o leitor grava
--     0 quando nao acha o campo. Conta cancelada/erro nao entra. O teto do
--     Start (start_base_kwh) NAO muda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_historico_consumo_da_conta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_h    jsonb;
    v_novo jsonb;
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

    SELECT cu.historico_consumo INTO v_h FROM public.consumer_units cu WHERE cu.id = NEW.uc_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    v_novo := public.fn_historico_consumo_normalizar(public.fn_historico_consumo_aplicar(
                  COALESCE(v_h, '{}'::jsonb), to_char(NEW.mes_referencia, 'YYYY-MM'), NEW.consumo_kwh, 'conta'));
    IF v_novo IS DISTINCT FROM v_h THEN
        UPDATE public.consumer_units
           SET historico_consumo = v_novo, consumo_mediano_kwh = public.fn_mediana_kwh(v_novo)
         WHERE id = NEW.uc_id;
    END IF;
    RETURN NEW;
END;
$function$;
ALTER FUNCTION public.fn_historico_consumo_da_conta() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_historico_consumo_da_conta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_invoice_historico_consumo ON public.invoices;
CREATE TRIGGER tr_invoice_historico_consumo
    AFTER INSERT OR UPDATE OF consumo_kwh, mes_referencia, status, uc_id ON public.invoices
    FOR EACH ROW
    WHEN (NEW.consumo_kwh > 0 AND NEW.mes_referencia IS NOT NULL)
    EXECUTE FUNCTION public.fn_historico_consumo_da_conta();

-- ---------------------------------------------------------------------------
-- 1d. Geracao estimada da usina mes a mes (overbook pela franquia mensal)
--     = geracao_estimada_kwh x 12 x (kWh/kWp do mes / soma dos 12) da cidade
--     (irradiancia."cod.ibge" = usinas.ibge_code); sem casamento, plano.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_geracao_estimada_mensal(p_usina uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_ger  numeric;
    v_ibge text;
    v_m    numeric[];
    v_soma numeric;
    v_out  jsonb := '{}'::jsonb;
    i      int;
BEGIN
    SELECT u.geracao_estimada_kwh, NULLIF(btrim(COALESCE(u.ibge_code, '')), '')
      INTO v_ger, v_ibge
      FROM public.usinas u WHERE u.id = p_usina;
    IF NOT FOUND OR v_ger IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT ARRAY(
             SELECT CASE WHEN replace(btrim(COALESCE(x, '')), ',', '.') ~ '^[0-9]+(\.[0-9]+)?$'
                         THEN replace(btrim(x), ',', '.')::numeric END
               FROM unnest(ARRAY[r."jan.khw", r."fev.khw", r."mar.kwh", r."abr.kwh", r."mai.kwh", r."jun.kwh",
                                 r."jul.kwh", r."ago.kwh", r."set.kwh", r."out.kwh", r."nov.kwh", r."dez.khw"])
                    WITH ORDINALITY AS t(x, o)
              ORDER BY o)
      INTO v_m
      FROM public.irradiancia r
     WHERE v_ibge IS NOT NULL AND r."cod.ibge"::text = v_ibge
     LIMIT 1;

    SELECT sum(x) INTO v_soma FROM unnest(v_m) x;
    IF v_m IS NULL OR array_length(v_m, 1) <> 12 OR array_position(v_m, NULL) IS NOT NULL
       OR COALESCE(v_soma, 0) <= 0 THEN
        FOR i IN 1..12 LOOP
            v_out := v_out || jsonb_build_object(to_char(i, 'FM00'), v_ger);
        END LOOP;
        RETURN v_out;
    END IF;

    FOR i IN 1..12 LOOP
        v_out := v_out || jsonb_build_object(to_char(i, 'FM00'), round(v_ger * 12 * v_m[i] / v_soma, 2));
    END LOOP;
    RETURN v_out;
END;
$function$;
ALTER FUNCTION public.fn_geracao_estimada_mensal(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_geracao_estimada_mensal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_geracao_estimada_mensal(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_geracao_estimada_mensal(uuid) IS
  '{"01":kWh,...,"12":kWh} = geracao_estimada_kwh x 12 x fator do mes (kWh/kWp do mes / soma dos 12 em irradiancia, pela usinas.ibge_code). Sem cidade casada: plano (geracao_estimada_kwh em todos os meses). NULL sem geracao_estimada_kwh.';

-- ---------------------------------------------------------------------------
-- 2. Backfill do perfil e do teto congelado
-- ---------------------------------------------------------------------------
WITH conta AS (
    SELECT i.uc_id, to_char(i.mes_referencia, 'MM') AS k, to_char(i.mes_referencia, 'YYYY-MM') AS ref,
           i.consumo_kwh AS kwh, i.mes_referencia,
           row_number() OVER (PARTITION BY i.uc_id, to_char(i.mes_referencia, 'MM')
                              ORDER BY i.mes_referencia DESC, i.id) AS rn,
           max(i.mes_referencia) OVER (PARTITION BY i.uc_id) AS ult
      FROM public.invoices i
     WHERE i.uc_id IS NOT NULL AND i.mes_referencia IS NOT NULL AND COALESCE(i.consumo_kwh, 0) > 0
       AND i.status::text NOT IN ('cancelado', 'cancelada', 'erro')
), perfil AS (
    SELECT uc_id, jsonb_object_agg(k, jsonb_build_object('kwh', kwh, 'ref', ref, 'origem', 'conta')) AS h
      FROM conta
     WHERE rn = 1 AND mes_referencia > ult - interval '12 months'
     GROUP BY uc_id
)
UPDATE public.consumer_units cu
   SET historico_consumo = public.fn_historico_consumo_normalizar(p.h)
  FROM perfil p
 WHERE cu.id = p.uc_id AND cu.historico_consumo IS NULL;

UPDATE public.consumer_units cu
   SET historico_consumo = (SELECT jsonb_object_agg(to_char(g, 'FM00'),
                                   jsonb_build_object('kwh', cu.franquia, 'ref', NULL, 'origem', 'franquia'))
                              FROM generate_series(1, 12) g)
 WHERE cu.historico_consumo IS NULL AND COALESCE(cu.franquia, 0) > 0;

UPDATE public.consumer_units cu
   SET consumo_mediano_kwh = public.fn_mediana_kwh(cu.historico_consumo)
 WHERE cu.historico_consumo IS NOT NULL;

UPDATE public.consumer_units cu
   SET start_base_kwh = cu.consumo_mediano_kwh, start_base_em = now()
 WHERE cu.start_base_kwh IS NULL AND cu.consumo_mediano_kwh > 0;

-- ---------------------------------------------------------------------------
-- 3. start_config novo: {"multiplicador", "regras_multinivel"}
--    Conversao (o validador ANTIGO aceita: ele so olha faturas_elegiveis e
--    `regras`, ausentes valem vazio). multiplicador = quantidade de faturas
--    elegiveis de hoje (1 fatura -> 1x); matriz: a do formato 20261112a se
--    ja existir, senao o % da MENOR fatura elegivel vira L1 (max_niveis 1).
--    Sem fatura elegivel o multiplicador fica ausente e o validador novo
--    estoura num plano start/ambos (nada muda em silencio).
-- ---------------------------------------------------------------------------
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> CONVERSAO DOS PLANOS (bloco isolado) >>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- O dono decidiu (12/11/2026) manter a tarifa cheia como base e REDUZIR os % dos
-- planos; os valores novos ainda virao dele. Ate la esta conversao so muda o
-- FORMATO, sem mudar numeros. Para gravar os % novos, troque/complemente AQUI
-- (ex.: UPDATE public.planos_originador SET start_config = ..., recorrente_config = ...
--  WHERE id = ...), mantendo o formato {"multiplicador", "regras_multinivel"}. O
-- validador novo (3a) roda sobre todos os planos logo depois.
UPDATE public.planos_originador p
   SET start_config = c.novo
  FROM (
    SELECT p2.id,
           jsonb_strip_nulls(jsonb_build_object(
             'multiplicador', NULLIF((
                 SELECT count(*)::int
                   FROM jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(p2.start_config -> 'faturas_elegiveis') = 'array'
                             THEN p2.start_config -> 'faturas_elegiveis' ELSE '[]'::jsonb END) f
                  WHERE f ~ '^[1-9][0-9]*$'), 0)))
           || jsonb_build_object('regras_multinivel',
                CASE WHEN jsonb_typeof(p2.start_config -> 'regras_multinivel') = 'object'
                     THEN p2.start_config -> 'regras_multinivel'
                     ELSE (SELECT jsonb_object_agg(cg, jsonb_build_object(
                                    'niveis', jsonb_build_object(
                                        'L1', COALESCE(CASE WHEN (m.r ->> cg) ~ '^[0-9]+(\.[0-9]+)?$'
                                                            THEN m.r ->> cg END, '0'),
                                        'L2', '0', 'L3', '0', 'L4', '0'),
                                    'max_niveis', 1))
                             FROM unnest(ARRAY['lider', 'ppe', 'ppp', 'ppf']) cg) END) AS novo
      FROM public.planos_originador p2
      -- regras da MENOR fatura elegivel; sem ela, a menor chave de `regras`
      LEFT JOIN LATERAL (
            SELECT p2.start_config -> 'regras' -> s.k AS r
              FROM (SELECT f AS k, 0 AS pri, f::int AS o
                      FROM jsonb_array_elements_text(
                           CASE WHEN jsonb_typeof(p2.start_config -> 'faturas_elegiveis') = 'array'
                                THEN p2.start_config -> 'faturas_elegiveis' ELSE '[]'::jsonb END) f
                     WHERE f ~ '^[1-9][0-9]*$'
                    UNION ALL
                    SELECT e.key, 1, e.key::int
                      FROM jsonb_each(CASE WHEN jsonb_typeof(p2.start_config -> 'regras') = 'object'
                                           THEN p2.start_config -> 'regras' ELSE '{}'::jsonb END) e
                     WHERE e.key ~ '^[1-9][0-9]*$') s
             WHERE jsonb_typeof(p2.start_config -> 'regras' -> s.k) = 'object'
             ORDER BY s.pri, s.o
             LIMIT 1) m ON true
     WHERE p2.start_config ? 'regras'
        OR p2.start_config ? 'faturas_elegiveis'
        OR jsonb_typeof(p2.start_config -> 'regras_multinivel') IS DISTINCT FROM 'object'
  ) c
 WHERE p.id = c.id;
-- % NOVOS DO DONO (12/11/2026): com a base passando a tarifa cheia, os % caem
-- no MESMO instante (sem janela pagando a mais). Atualiza por NOME e confere o
-- valor vivo esperado de hoje: plano ausente/duplicado ou valor diferente do
-- esperado (o dono pode ter editado) -> a migracao PARA, nada e sobrescrito.
-- Planos de assinatura: a trava "crie uma nova versao" (tr_planos_assinatura_trava)
-- e desligada SO durante este bloco, porque a decisao do dono e mudar o plano
-- vigente no lugar. Planos de Usina: gestao 10/12/14 -> 6/7/8 e originador 2 -> 1.2
-- (dono, 12/11/2026), com tr_planos_usina_trava desligada so durante o laco deles;
-- contratos novos do fornecedor saem com a cl. 5.4 sem o desconto. recorrente_config.regras (formato legado, sem uso no motor)
-- nao e tocado.
DO $pct$
DECLARE
    r       record;
    v_n     int;
    v_atual jsonb;
BEGIN
    EXECUTE 'ALTER TABLE public.planos_assinatura_energia DISABLE TRIGGER tr_planos_assinatura_trava';

    FOR r IN SELECT * FROM (VALUES
        -- tabela, plano, coluna, caminho, antes, depois
        ('pa', 'Plano Premium',       'recorrente_config', '{regras_multinivel,b2w,niveis,L1}', '"10"', '"6"'),
        ('pa', 'Plano Premium',       'recorrente_config', '{regras_multinivel,b2w,niveis,L2}', '"10"', '"6"'),
        ('pa', 'Plano Premium',       'recorrente_config', '{regras_multinivel,b2w,niveis,L3}', '"10"', '"6"'),
        ('pa', 'Plano Premium',       'recorrente_config', '{regras_multinivel,b2w,niveis,L4}', '"10"', '"6"'),
        ('pa', 'Plano Premium',       'recorrente_config', '{regras_multinivel,assinante_conect,niveis,L1}', '"2"', '"1.2"'),
        ('pa', 'Plano Premium',       'start_config',      '{regras,2,b2w}', '60', '36'),
        ('pa', 'Plano Ultra Connect', 'recorrente_config', '{regras_multinivel,b2w,niveis,L1}', '"10"', '"6"'),
        ('pa', 'Plano Ultra Connect', 'recorrente_config', '{regras_multinivel,b2w,niveis,L2}', '"10"', '"6"'),
        ('pa', 'Plano Ultra Connect', 'recorrente_config', '{regras_multinivel,b2w,niveis,L3}', '"10"', '"6"'),
        ('pa', 'Plano Ultra Connect', 'recorrente_config', '{regras_multinivel,b2w,niveis,L4}', '"10"', '"6"'),
        ('pa', 'Plano Ultra Connect', 'recorrente_config', '{regras_multinivel,assinante_conect,niveis,L1}', '"2"', '"1.2"'),
        -- Plano Padrao
        ('po', 'Plano Padrão', 'start_config',      '{regras_multinivel,lider,niveis,L1}', '"50"', '"30"'),
        ('po', 'Plano Padrão', 'start_config',      '{regras_multinivel,ppp,niveis,L1}',   '"40"', '"24"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,lider,niveis,L1}', '"1"', '"0.6"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,lider,niveis,L2}', '"1"', '"0.6"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,lider,niveis,L3}', '"1"', '"0.6"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,ppe,niveis,L1}',   '"5"', '"3"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,ppe,niveis,L2}',   '"2"', '"1.2"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,ppp,niveis,L1}',   '"4"', '"2.4"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,ppp,niveis,L2}',   '"2"', '"1.2"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,ppf,niveis,L1}',   '"2"', '"1.2"'),
        ('po', 'Plano Padrão', 'recorrente_config', '{regras_multinivel,ppf,niveis,L2}',   '"2"', '"1.2"'),
        -- Plano Hibrido
        ('po', 'Plano Hibrido', 'start_config',      '{regras_multinivel,lider,niveis,L1}', '"50"', '"30"'),
        ('po', 'Plano Hibrido', 'start_config',      '{regras_multinivel,ppp,niveis,L1}',   '"40"', '"24"'),
        ('po', 'Plano Hibrido', 'recorrente_config', '{regras_multinivel,lider,niveis,L1}', '"4"', '"2.4"'),
        ('po', 'Plano Hibrido', 'recorrente_config', '{regras_multinivel,lider,niveis,L2}', '"2"', '"1.2"'),
        ('po', 'Plano Hibrido', 'recorrente_config', '{regras_multinivel,lider,niveis,L3}', '"1"', '"0.6"'),
        ('po', 'Plano Hibrido', 'recorrente_config', '{regras_multinivel,ppp,niveis,L1}',   '"2"', '"1.2"'),
        ('po', 'Plano Hibrido', 'recorrente_config', '{regras_multinivel,ppp,niveis,L2}',   '"2"', '"1.2"'),
        -- Plano Recorrente (o Start nao e usado: tipo recorrente)
        ('po', 'Plano Recorrente', 'recorrente_config', '{regras_multinivel,lider,niveis,L1}', '"4"', '"2.4"'),
        ('po', 'Plano Recorrente', 'recorrente_config', '{regras_multinivel,lider,niveis,L2}', '"2"', '"1.2"'),
        ('po', 'Plano Recorrente', 'recorrente_config', '{regras_multinivel,lider,niveis,L3}', '"1"', '"0.6"'),
        ('po', 'Plano Recorrente', 'recorrente_config', '{regras_multinivel,ppp,niveis,L1}',   '"2"', '"1.2"'),
        ('po', 'Plano Recorrente', 'recorrente_config', '{regras_multinivel,ppp,niveis,L2}',   '"2"', '"1.2"'),
        ('po', 'Plano Recorrente', 'start_config',      '{regras_multinivel,lider,niveis,L1}', '"50"', '"30"'),
        ('po', 'Plano Recorrente', 'start_config',      '{regras_multinivel,ppe,niveis,L1}',   '"50"', '"30"'),
        ('po', 'Plano Recorrente', 'start_config',      '{regras_multinivel,ppp,niveis,L1}',   '"40"', '"24"'),
        ('po', 'Plano Recorrente', 'start_config',      '{regras_multinivel,ppf,niveis,L1}',   '"20"', '"12"')
    ) AS t(tab, plano, col, caminho, antes, depois)
    LOOP
        EXECUTE format('SELECT count(*), max((%I #> %L)::text)::jsonb FROM public.%s WHERE nome = %L',
                       r.col, r.caminho, CASE r.tab WHEN 'pa' THEN 'planos_assinatura_energia' ELSE 'planos_originador' END, r.plano)
           INTO v_n, v_atual;
        IF v_n <> 1 THEN
            RAISE EXCEPTION '%% novos: plano "%" achado % vezes (esperado 1)', r.plano, v_n;
        END IF;
        IF v_atual IS DISTINCT FROM r.antes::jsonb THEN
            RAISE EXCEPTION '%% novos: "%" %.% vale % hoje, esperado % -- o plano foi editado; nada sobrescrito',
                r.plano, r.col, r.caminho, COALESCE(v_atual::text, 'NULL'), r.antes;
        END IF;
        EXECUTE format('UPDATE public.%s SET %I = jsonb_set(%I, %L, %L::jsonb) WHERE nome = %L',
                       CASE r.tab WHEN 'pa' THEN 'planos_assinatura_energia' ELSE 'planos_originador' END,
                       r.col, r.col, r.caminho, r.depois, r.plano);
    END LOOP;

    -- gestao_percentual dos planos de assinatura: 10 -> 6
    SELECT count(*) INTO v_n FROM public.planos_assinatura_energia
     WHERE nome IN ('Plano Premium', 'Plano Ultra Connect') AND gestao_percentual = 10;
    IF v_n <> 2 THEN
        RAISE EXCEPTION '%% novos: gestao_percentual do Premium/Ultra Connect nao e 10 hoje (% de 2); nada sobrescrito', v_n;
    END IF;
    UPDATE public.planos_assinatura_energia SET gestao_percentual = 6
     WHERE nome IN ('Plano Premium', 'Plano Ultra Connect');

    -- Planos de Usina (dono, 12/11/2026): gestao B2W na tarifa cheia com 6/7/8%
    -- e originador da usina 2 -> 1.2. Contratos novos do fornecedor saem com a
    -- clausula 5.4 sem o desconto (src/lib/contratoFornecedor.js).
    -- Os planos de usina tem trava propria (tr_planos_usina_trava: plano com usina
    -- vinculada nao muda percentual). A decisao do dono e mudar o plano vigente no
    -- lugar, como nos planos de assinatura; a trava volta ligada logo abaixo.
    EXECUTE 'ALTER TABLE public.planos_usina DISABLE TRIGGER tr_planos_usina_trava';
    FOR r IN SELECT * FROM (VALUES
        ('Plano Usina Padrão',                 10::numeric, 6::numeric,  0::numeric,   0::numeric),
        ('Plano Usina - Recorrencia Corretor', 12,          7,           2,            1.2),
        ('Plano Usina - Ultra Connect',        14,          8,           2,            1.2)
    ) AS t(plano, antes, depois, orig_antes, orig_depois)
    LOOP
        SELECT count(*) INTO v_n FROM public.planos_usina
         WHERE nome = r.plano AND percentual_recorrente = r.antes
           AND COALESCE(originador_recorrente_pct, 0) = r.orig_antes;
        IF v_n <> 1 THEN
            RAISE EXCEPTION '%% novos: plano de usina "%" nao esta com %/% hoje (achado % vezes); nada sobrescrito',
                r.plano, r.antes, r.orig_antes, v_n;
        END IF;
        UPDATE public.planos_usina
           SET percentual_recorrente = r.depois, originador_recorrente_pct = r.orig_depois
         WHERE nome = r.plano;
    END LOOP;

    EXECUTE 'ALTER TABLE public.planos_usina ENABLE TRIGGER tr_planos_usina_trava';
    EXECUTE 'ALTER TABLE public.planos_assinatura_energia ENABLE TRIGGER tr_planos_assinatura_trava';
END
$pct$;
-- Default de plano de usina novo acompanha a tarifa cheia (src/lib/planoUsina.js PLANO_USINA_VAZIO).
ALTER TABLE public.planos_usina ALTER COLUMN percentual_recorrente SET DEFAULT 6;
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<< FIM DA CONVERSAO DOS PLANOS <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- recorrencia: teto de nivel 3 para os 4 cargos (nivel acima do maximo nao paga)
UPDATE public.planos_originador p
   SET recorrente_config = jsonb_set(p.recorrente_config, '{regras_multinivel}', (
         SELECT jsonb_object_agg(e.key,
                  CASE WHEN (e.value ->> 'max_niveis') ~ '^[0-9]+$' AND (e.value ->> 'max_niveis')::int > 3
                       THEN jsonb_set(e.value, '{max_niveis}', '3'::jsonb)
                       ELSE e.value END)
           FROM jsonb_each(p.recorrente_config -> 'regras_multinivel') e))
 WHERE jsonb_typeof(p.recorrente_config -> 'regras_multinivel') = 'object'
   AND EXISTS (SELECT 1 FROM jsonb_each(p.recorrente_config -> 'regras_multinivel') e
                WHERE (e.value ->> 'max_niveis') ~ '^[0-9]+$' AND (e.value ->> 'max_niveis')::int > 3);

DO $conf$
BEGIN
    IF EXISTS (SELECT 1 FROM public.planos_originador
                WHERE start_config ? 'regras' OR start_config ? 'faturas_elegiveis'
                   OR jsonb_typeof(start_config -> 'regras_multinivel') IS DISTINCT FROM 'object') THEN
        RAISE EXCEPTION 'start_por_energia: conversao incompleta do start_config';
    END IF;
END
$conf$;

ALTER TABLE public.planos_originador
    ALTER COLUMN start_config SET DEFAULT '{"multiplicador": 1, "regras_multinivel": {}}'::jsonb;

COMMENT ON COLUMN public.planos_originador.start_config IS
  '{"multiplicador": N, "regras_multinivel":{"<cargo>":{"niveis":{"L1".."L4"},"max_niveis":0..3}}} so lider/ppe/ppp/ppf. Start por ENERGIA: o parceiro recebe sobre os kWh compensados da UC ate multiplicador x consumer_units.start_base_kwh (revisao do dono 12/11/2026, 2a). multiplicador > 0 obrigatorio em plano start/ambos; aceita decimal.';
COMMENT ON COLUMN public.planos_originador.recorrente_config IS
  '{"regras_multinivel":{"<cargo>":{"niveis":{"L1".."L4"},"max_niveis":0..3}}} so para lider/ppe/ppp/ppf.';

-- ---------------------------------------------------------------------------
-- 3a. Validador novo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planos_originador_valida()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    c_cargos constant text[] := ARRAY['lider', 'ppe', 'ppp', 'ppf'];
    m   record;
    c   record;
    n   record;
    v_k text;
    v_mult jsonb;
BEGIN
    IF jsonb_typeof(NEW.start_config) IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(NEW.start_config -> 'regras_multinivel', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Plano do Originador "%": start_config precisa ser {"multiplicador": N, "regras_multinivel":{...}}', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.start_config ? 'regras' OR NEW.start_config ? 'faturas_elegiveis' THEN
        RAISE EXCEPTION 'Plano do Originador "%": start_config.faturas_elegiveis/regras (Start por fatura) nao e mais aceito; o Start conta energia: use multiplicador (x a mediana de consumo da UC) e regras_multinivel', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    FOR v_k IN SELECT jsonb_object_keys(NEW.start_config) LOOP
        IF v_k NOT IN ('multiplicador', 'regras_multinivel') THEN
            RAISE EXCEPTION 'Plano do Originador "%": start_config.% nao existe (so multiplicador e regras_multinivel)', NEW.nome, v_k
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    v_mult := NEW.start_config -> 'multiplicador';
    IF v_mult IS NOT NULL
       AND (jsonb_typeof(v_mult) NOT IN ('number', 'string')
            OR (v_mult #>> '{}') !~ '^[0-9]+(\.[0-9]+)?$'
            OR (v_mult #>> '{}')::numeric <= 0) THEN
        RAISE EXCEPTION 'Plano do Originador "%": multiplicador do Start precisa ser numero > 0 (ex.: 2 ou 1.5)', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_mult IS NULL AND COALESCE(NEW.tipo_recompensa, 'start') IN ('start', 'ambos') THEN
        RAISE EXCEPTION 'Plano do Originador "%": plano % precisa de start_config.multiplicador > 0', NEW.nome, NEW.tipo_recompensa
            USING ERRCODE = 'check_violation';
    END IF;

    IF jsonb_typeof(NEW.recorrente_config) IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(NEW.recorrente_config -> 'regras_multinivel', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Plano do Originador "%": recorrente_config precisa ser {"regras_multinivel":{...}}', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.recorrente_config ? 'regras' THEN
        RAISE EXCEPTION 'Plano do Originador "%": recorrente_config.regras (formato legado) nao e aceito; use regras_multinivel', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    FOR m IN SELECT * FROM (VALUES
                 ('Start',       COALESCE(NEW.start_config      -> 'regras_multinivel', '{}'::jsonb)),
                 ('recorrencia', COALESCE(NEW.recorrente_config -> 'regras_multinivel', '{}'::jsonb))) AS t(rotulo, matriz)
    LOOP
        FOR c IN SELECT key, value FROM jsonb_each(m.matriz) LOOP
            IF NOT (c.key = ANY (c_cargos)) THEN
                RAISE EXCEPTION 'Plano do Originador "%": a chave "%" nao pertence a um Plano do Originador (so lider, ppe, ppp, ppf)', NEW.nome, c.key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF jsonb_typeof(c.value) <> 'object'
               OR jsonb_typeof(c.value -> 'niveis') IS DISTINCT FROM 'object'
               OR COALESCE(c.value ->> 'max_niveis', '') !~ '^[0-3]$' THEN
                RAISE EXCEPTION 'Plano do Originador "%": % %: precisa de niveis (objeto) e max_niveis 0..3', NEW.nome, m.rotulo, c.key
                    USING ERRCODE = 'check_violation';
            END IF;
            FOR n IN SELECT key, value FROM jsonb_each(c.value -> 'niveis') LOOP
                IF n.key NOT IN ('L1', 'L2', 'L3', 'L4')
                   OR jsonb_typeof(n.value) NOT IN ('number', 'string')
                   OR (n.value #>> '{}') !~ '^[0-9]+(\.[0-9]+)?$'
                   OR (n.value #>> '{}')::numeric > 100 THEN
                    RAISE EXCEPTION 'Plano do Originador "%": % %.%: percentual entre 0 e 100', NEW.nome, m.rotulo, c.key, n.key
                        USING ERRCODE = 'check_violation';
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_originador_valida() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_originador_valida() FROM PUBLIC, anon, authenticated;

-- os planos convertidos passam pelo validador novo (estoura se algum nao passa)
UPDATE public.planos_originador SET start_config = start_config;

-- ---------------------------------------------------------------------------
-- 3b. Regra do Start por energia numa funcao pura (testavel; usada no motor)
--     Devolve {matriz: start|recorrencia (ausente = nada), entrada: {niveis,
--     max_niveis}, kwh_start, kwh_start_pago_antes, teto_start_kwh,
--     multiplicador, start_base_kwh, saldo_antes, motivo}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_originador_start_energia(
    p_po jsonb, p_papel text, p_kwh numeric, p_start_base numeric,
    p_pago_antes numeric, p_start_encerrado boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_tipo   text := COALESCE(p_po ->> 'tipo_recompensa', 'start');
    v_mult   numeric;
    v_teto   numeric;
    v_pago   numeric := GREATEST(COALESCE(p_pago_antes, 0), 0);
    v_kwh    numeric := GREATEST(COALESCE(p_kwh, 0), 0);
    v_saldo  numeric;
    v_start  jsonb;
    v_rec    jsonb;
    v_motivo text;
    v_kwh_st numeric;
    v_out    jsonb;
BEGIN
    IF p_po IS NULL OR p_papel IS NULL THEN
        RETURN '{}'::jsonb;
    END IF;

    IF (p_po #>> '{start_config,multiplicador}') ~ '^[0-9]+(\.[0-9]+)?$' THEN
        v_mult := (p_po #>> '{start_config,multiplicador}')::numeric;
    END IF;
    IF v_mult > 0 AND p_start_base > 0 THEN
        v_teto  := v_mult * p_start_base;
        v_saldo := GREATEST(v_teto - v_pago, 0);
    END IF;

    v_start := p_po #> ARRAY['start_config', 'regras_multinivel', p_papel];
    IF jsonb_typeof(v_start) IS DISTINCT FROM 'object' THEN
        v_start := NULL;
    END IF;
    v_rec := p_po #> ARRAY['recorrente_config', 'regras_multinivel', p_papel];
    IF jsonb_typeof(v_rec) IS DISTINCT FROM 'object' THEN
        v_rec := NULL;
    END IF;

    v_out := jsonb_build_object(
        'tipo_recompensa',      v_tipo,
        'multiplicador',        v_mult,
        'start_base_kwh',       p_start_base,
        'teto_start_kwh',       v_teto,
        'kwh_start_pago_antes', v_pago,
        'saldo_antes',          v_saldo,
        'kwh_start',            0);

    IF v_tipo IN ('start', 'ambos') THEN
        v_motivo := CASE
            WHEN COALESCE(p_start_encerrado, false) THEN 'start_encerrado_regra_antiga'
            WHEN v_mult IS NULL OR v_mult <= 0      THEN 'plano_sem_multiplicador'
            WHEN p_start_base IS NULL OR p_start_base <= 0 THEN 'uc_sem_consumo_base'
            WHEN v_saldo <= 0                       THEN 'start_esgotado'
            WHEN v_kwh <= 0                         THEN 'sem_compensacao'
        END;
        IF v_motivo IS NULL THEN
            -- teto POR FATURA = 1 x start_base_kwh (exemplo do dono: mediana
            -- 1.000, 2x; F2 de 1.200 kWh paga Start sobre 1.000): "2x" sao
            -- dois meses de consumo mediano, nunca mais de um por fatura.
            v_kwh_st := LEAST(v_kwh, p_start_base, v_saldo);
            RETURN v_out || jsonb_build_object(
                       'matriz', 'start', 'kwh_start', v_kwh_st,
                       'motivo', CASE WHEN v_kwh_st >= v_saldo THEN 'start_completo_nesta_fatura'
                                      ELSE 'start_em_andamento' END)
                   || CASE WHEN v_start IS NOT NULL THEN jsonb_build_object('entrada', v_start) ELSE '{}'::jsonb END;
        END IF;
    ELSE
        v_motivo := 'plano_recorrente';
    END IF;

    -- recorrencia: plano recorrente sempre; Hibrido so quando o Start nao
    -- esta em curso (saldo zerado ANTES desta fatura, ou Start inaplicavel)
    IF v_tipo = 'recorrente'
       OR (v_tipo = 'ambos' AND v_motivo IN ('start_encerrado_regra_antiga', 'plano_sem_multiplicador',
                                             'uc_sem_consumo_base', 'start_esgotado')) THEN
        RETURN v_out || jsonb_build_object('matriz', 'recorrencia', 'motivo', v_motivo)
               || CASE WHEN v_rec IS NOT NULL THEN jsonb_build_object('entrada', v_rec) ELSE '{}'::jsonb END;
    END IF;
    RETURN v_out || jsonb_build_object('motivo', v_motivo);
END;
$function$;

ALTER FUNCTION public.fn_plano_originador_start_energia(jsonb, text, numeric, numeric, numeric, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_originador_start_energia(jsonb, text, numeric, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_originador_start_energia(jsonb, text, numeric, numeric, numeric, boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_plano_originador_start_energia(jsonb, text, numeric, numeric, numeric, boolean) IS
  'Start por energia de um cargo de parceiro pelo Plano do Originador (dono, 12/11/2026): kwh_start = min(kWh compensado, start_base_kwh (teto por fatura), multiplicador x start_base_kwh - kWh de Start ja pago). start = Start enquanto houver saldo; recorrente = recorrencia; ambos = Start enquanto houver saldo e recorrencia so a partir da fatura seguinte a que zerou o saldo.';

-- ---------------------------------------------------------------------------
-- 4. Patches por ancora: base bruta, base por participante, motor
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_fn  record;
    v_par record;
    v_n   int;
BEGIN
    FOR v_fn IN SELECT * FROM (VALUES
        -- 4a. fn_base_recompensa_fatura: tambem a base BRUTA
        ('public.fn_base_recompensa_fatura(uuid)'::regprocedure, ARRAY[
          $de$        'base', v_base,
        'formula', c_formula,
$de$,
          $para$        'base', v_base,
        -- 20261112b (dono, 12/11/2026): base de TODOS os percentuais = kWh
        -- compensado x tarifa cheia, sem desconto nem Fio B
        'base_bruta', CASE WHEN v_sem_comp THEN 0 ELSE v_kwh * v_tarifa END,
        'formula_bruta', 'consumo_compensado * tarifa',
        'formula', c_formula,
$para$]),

        -- 4b. fn_calcular_split_recompensa: base propria por participante
        ('public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure, ARRAY[
          $de$  v_pct_resto        numeric;
BEGIN
$de$,
          $para$  v_pct_resto        numeric;
  v_base_item        numeric;   -- 20261112b: base propria do participante
BEGIN
$para$,
          $de$  v_valor_b2w := round(p_base * v_pct_b2w / 100, 2);
$de$,
          $para$  -- 20261112b: a B2W pode trazer base propria em p_regras.b2w.base
  -- (gestao do Plano de Usina; ver c_base_gestao_pu no motor). Nunca maior que a base.
  v_valor_b2w := round(LEAST(COALESCE(CASE WHEN jsonb_typeof(p_regras #> '{b2w,base}') = 'number'
                                           THEN (p_regras #>> '{b2w,base}')::numeric END, p_base), p_base)
                       * v_pct_b2w / 100, 2);
$para$,
          $de$    v_valor := round(p_base * v_pct / 100, 2);
$de$,
          $para$    -- 20261112b: o participante pode trazer a base dele (Start de
    -- parceiro por energia: so os kWh dentro do teto). Nunca maior que a base.
    v_base_item := p_base;
    IF jsonb_typeof(v_item -> 'base') = 'number' THEN
      v_base_item := round((v_item ->> 'base')::numeric, 2);
      IF v_base_item < 0 OR v_base_item > p_base THEN
        RAISE EXCEPTION 'fn_calcular_split_recompensa: base do participante % (%) fora de 0..p_base (%)', v_papel, v_base_item, p_base;
      END IF;
    END IF;
    v_valor := round(v_base_item * v_pct / 100, 2);
$para$]),

        -- 4c. adesao publica (anonima): cada item de p_ucs pode trazer
        --     "historico" (array do leitor); grava pela logica interna, sem
        --     abrir a RPC authenticated ao anon. Falha no historico nao
        --     derruba a adesao. Assinatura e retorno inalterados.
        ('public.fn_criar_assinante_publico(text,text,text,text,text,text,text,text,text,text,text,text,text,uuid,jsonb,integer,text,text,text,text)'::regprocedure, ARRAY[
          $de$  v_plano_id uuid; v_plano_desc numeric;
BEGIN
$de$,
          $para$  v_plano_id uuid; v_plano_desc numeric;
  v_uc_id uuid;   -- 20261112b: historico de consumo do leitor
BEGIN
$para$,
          $de$      v_uc_indicadora, v_plano_id);
    v_n := v_n + 1;
$de$,
          $para$      v_uc_indicadora, v_plano_id)
    RETURNING id INTO v_uc_id;
    -- 20261112b: perfil de consumo e teto do Start a partir do historico lido
    IF jsonb_typeof(v_uc -> 'historico') = 'array' THEN
      BEGIN
        PERFORM public.fn_historico_consumo_gravar_uc(v_uc_id, v_uc -> 'historico', 'cadastro');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_criar_assinante_publico: historico de consumo da UC % nao gravado: %', v_uc_num, SQLERRM;
      END;
    END IF;
    v_n := v_n + 1;
$para$]),

        -- 4d. UC do termo aditivo: conta_lida.historico tambem vira o perfil
        ('public.fn_criar_uc_do_aditivo(uuid)'::regprocedure, ARRAY[
          $de$    returning id into v_uc;

    update public.leads set status = 'ativacao', updated_at = now() where id = v_lead.id;
$de$,
          $para$    returning id into v_uc;

    -- 20261112b: perfil de consumo e teto do Start a partir do historico lido
    if jsonb_typeof(v_conta -> 'historico') = 'array' then
        begin
            perform public.fn_historico_consumo_gravar_uc(v_uc, v_conta -> 'historico', 'cadastro');
        exception when others then
            raise warning 'fn_criar_uc_do_aditivo: historico de consumo da UC % nao gravado: %', v_num, sqlerrm;
        end;
    end if;

    update public.leads set status = 'ativacao', updated_at = now() where id = v_lead.id;
$para$])
    ) AS t(fn, pares)
    LOOP
        d := pg_get_functiondef(v_fn.fn);
        FOR v_n IN 1 .. array_length(v_fn.pares, 1) / 2 LOOP
            IF (length(d) - length(replace(d, v_fn.pares[2 * v_n - 1], ''))) / length(v_fn.pares[2 * v_n - 1]) <> 1 THEN
                RAISE EXCEPTION '%: ancora achada % vezes (esperado 1): %', v_fn.fn,
                    (length(d) - length(replace(d, v_fn.pares[2 * v_n - 1], ''))) / length(v_fn.pares[2 * v_n - 1]),
                    left(v_fn.pares[2 * v_n - 1], 80);
            END IF;
            d := replace(d, v_fn.pares[2 * v_n - 1], v_fn.pares[2 * v_n]);
        END LOOP;
        EXECUTE d;
    END LOOP;

    -- 4c. motor
    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        -- 1. variaveis
        ($de$    v_fill_pct            numeric;
$de$,
         $para$    v_fill_pct            numeric;
    -- Start por energia e base bruta (20261112b)
    v_base_bruta          numeric;   -- consumo_compensado x tarifa cheia
    v_tarifa_cheia        numeric;
    v_kwh_comp            numeric;
    v_start_base_kwh      numeric;   -- consumer_units.start_base_kwh (congelado)
    v_kwh_legado          numeric := 0;  -- kWh compensado pago antes do Start por energia
    v_kwh_pago_antes      numeric;
    v_po_res              jsonb;
    v_part_base           numeric;
    v_bases_part          jsonb := '{}'::jsonb;  -- papel -> base R$ do Start do parceiro
    -- PONTO DE TROCA da base da gestao B2W que vem do PLANO DE USINA:
    --   'bruta'               kWh compensado x tarifa cheia (decisao do dono 12/11/2026)
    --   'tarifa_com_desconto' kWh compensado x tarifa x (1 - desconto) (contrato do
    --                         fornecedor, cl. 5.4). So esta linha muda.
    c_base_gestao_pu      constant text := 'bruta';
$para$),

        -- 2. base bruta e tarifa cheia
        ($de$                v_base_calculo := COALESCE((v_base_info ->> 'base')::numeric, 0);
$de$,
         $para$                v_base_calculo := COALESCE((v_base_info ->> 'base')::numeric, 0);
                -- 20261112b: percentuais sobre a base BRUTA
                v_base_bruta   := COALESCE((v_base_info ->> 'base_bruta')::numeric, 0);
                v_tarifa_cheia := (v_base_info ->> 'tarifa')::numeric;
                v_kwh_comp     := COALESCE((v_base_info ->> 'kwh_compensado')::numeric, 0);
$para$),

        -- 3. teto do Start da UC e energia da regra antiga
        ($de$        -- 3. Plano da UC -> matriz de recompensas
$de$,
         $para$        -- 2c. Start por energia (20261112b): teto congelado da UC e a energia
        --     compensada das faturas pagas ANTES do Start por energia (sem a
        --     marca start_por_energia): a janela antiga ja correu e consome o saldo.
        SELECT cu.start_base_kwh INTO v_start_base_kwh
          FROM public.consumer_units cu WHERE cu.id = NEW.uc_id;
        SELECT COALESCE(sum(i.consumo_compensado), 0) INTO v_kwh_legado
          FROM public.invoices i
         WHERE i.uc_id = NEW.uc_id
           AND i.id <> NEW.id
           AND i.status::text = 'pago'
           AND COALESCE(i.consumo_compensado, 0) > 0
           AND NOT COALESCE(i.recompensas_aplicadas ? 'start_por_energia', false);

        -- 3. Plano da UC -> matriz de recompensas
$para$),

        -- 4. participante: Start por energia (fn_plano_originador_start_energia)
        ($de$                v_po_regras  := NULL;

                IF v_start_bloqueio IS NULL
                   AND v_po_tipo IN ('start', 'ambos')
                   AND jsonb_typeof(v_po #> '{start_config,faturas_elegiveis}') = 'array'
                   AND EXISTS (SELECT 1
                                 FROM jsonb_array_elements_text(v_po #> '{start_config,faturas_elegiveis}') f
                                WHERE f = v_ordinal::text)
                   AND jsonb_typeof(v_po #> ARRAY['start_config', 'regras', v_ordinal::text]) = 'object' THEN
                    v_po_regras := v_po #> ARRAY['start_config', 'regras', v_ordinal::text];
                END IF;

                IF v_po_regras IS NOT NULL THEN
                    -- fatura do Start deste parceiro: L1 = Start; L2..L4 =
                    -- recorrencia (ambos) ou zero (start). Mesma conta de antes.
                    v_pct_start := COALESCE(NULLIF(v_po_regras ->> v_ben_papel, '')::numeric, 0);
                    IF v_po_tipo = 'ambos' THEN
                        v_niveis_papel := COALESCE(v_po #> ARRAY['recorrente_config', 'regras_multinivel', v_ben_papel, 'niveis'], '{}'::jsonb);
                        IF jsonb_typeof(v_niveis_papel) <> 'object' THEN
                            v_niveis_papel := '{}'::jsonb;
                        END IF;
                        v_niveis_papel := jsonb_set(v_niveis_papel, '{L1}', to_jsonb(v_pct_start));
                        v_max_papel := GREATEST(COALESCE((v_po #>> ARRAY['recorrente_config', 'regras_multinivel', v_ben_papel, 'max_niveis'])::int, 0), 1);
                    ELSE
                        v_niveis_papel := jsonb_build_object('L1', v_pct_start, 'L2', 0, 'L3', 0, 'L4', 0);
                        v_max_papel := 1;
                    END IF;
                    v_po_entrada := jsonb_build_object('niveis', v_niveis_papel, 'max_niveis', v_max_papel);
                    v_part_regra := CASE
                        WHEN v_part_nivel = 1 THEN 'start'
                        WHEN v_part_nivel IS NOT NULL AND v_part_nivel <= v_max_papel THEN 'recorrencia'
                        ELSE 'nenhuma' END;
                ELSIF v_po_tipo IN ('recorrente', 'ambos') THEN
                    v_po_entrada := v_po #> ARRAY['recorrente_config', 'regras_multinivel', v_ben_papel];
                    IF jsonb_typeof(v_po_entrada) IS DISTINCT FROM 'object' THEN
                        v_po_entrada := NULL;
                    END IF;
                    v_part_regra := CASE
                        WHEN v_po_entrada IS NOT NULL AND v_part_nivel IS NOT NULL
                             AND v_part_nivel <= COALESCE((v_po_entrada ->> 'max_niveis')::int, 0)
                        THEN 'recorrencia' ELSE 'nenhuma' END;
                ELSE
                    -- plano so de Start, fora da janela: nada
                    v_po_entrada := NULL;
                    v_part_regra := 'nenhuma';
                END IF;$de$,
         $para$                v_po_regras  := NULL;

                -- 20261112b (dono, 12/11/2026): Start por ENERGIA. Saldo do
                -- beneficiario = multiplicador x start_base_kwh - kWh de Start
                -- ja pagos a ELE nesta UC (por id, em qualquer cargo) - kWh das
                -- faturas pagas antes da regra (v_kwh_legado).
                SELECT COALESCE(sum(CASE WHEN (e.value ->> 'kwh_start') ~ '^[0-9]+(\.[0-9]+)?$'
                                         THEN (e.value ->> 'kwh_start')::numeric ELSE 0 END), 0)
                  INTO v_kwh_pago_antes
                  FROM public.invoices i
                  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.recompensas_aplicadas -> 'plano_originador') = 'object'
                                                     THEN i.recompensas_aplicadas -> 'plano_originador' ELSE '{}'::jsonb END) e
                 WHERE i.uc_id = NEW.uc_id
                   AND i.id <> NEW.id
                   AND i.status::text = 'pago'
                   AND i.recompensas_aplicadas ? 'start_por_energia'
                   AND COALESCE(i.recompensas_aplicadas ->> 'lancado', 'true') <> 'false'
                   AND e.value ->> 'id' = v_part ->> 'id';
                v_kwh_pago_antes := v_kwh_pago_antes + v_kwh_legado;

                v_po_res := public.fn_plano_originador_start_energia(
                                v_po, v_ben_papel, v_kwh_comp, v_start_base_kwh,
                                v_kwh_pago_antes, COALESCE(v_start_antigo, false));
                v_po_entrada := v_po_res -> 'entrada';
                v_part_regra := CASE
                    WHEN v_po_entrada IS NOT NULL AND v_part_nivel IS NOT NULL
                         AND v_part_nivel <= COALESCE((v_po_entrada ->> 'max_niveis')::int, 0)
                    THEN v_po_res ->> 'matriz' ELSE 'nenhuma' END;
                v_part_base := NULL;
                IF v_part_regra = 'start' THEN
                    v_po_regras := v_po_entrada;
                    v_part_base := round(COALESCE((v_po_res ->> 'kwh_start')::numeric, 0) * COALESCE(v_tarifa_cheia, 0), 2);
                    v_bases_part := v_bases_part || jsonb_build_object(v_ben_papel, v_part_base);
                ELSE
                    -- quem nao recebeu Start nao consome o saldo
                    v_po_res := v_po_res || jsonb_build_object('kwh_start', 0);
                    IF v_part_regra = 'recorrencia' THEN
                        v_part_base := round(v_base_bruta, 2);
                    END IF;
                END IF;$para$),

        -- 5. congelamento por beneficiario-parceiro
        ($de$                    'regra',               v_part_regra,
                    'regras_start',        v_po_regras));
$de$,
         $para$                    'regra',               v_part_regra,
                    'regras_start',        v_po_regras,
                    -- 20261112b
                    'kwh_start',            COALESCE((v_po_res ->> 'kwh_start')::numeric, 0),
                    'kwh_start_pago_antes', v_po_res -> 'kwh_start_pago_antes',
                    'teto_start_kwh',       v_po_res -> 'teto_start_kwh',
                    'multiplicador',        v_po_res -> 'multiplicador',
                    'start_base_kwh',       v_start_base_kwh,
                    'motivo_start',         v_po_res -> 'motivo',
                    'base',                 v_part_base,
                    'tarifa',               v_tarifa_cheia));
$para$),

        -- 6. cargos sem participante: mesma regra, pelo plano da UC
        ($de$            v_fill_regras := NULL;
            IF v_start_bloqueio IS NULL
               AND v_fill_tipo IN ('start', 'ambos')
               AND jsonb_typeof(v_fill_po #> '{start_config,faturas_elegiveis}') = 'array'
               AND EXISTS (SELECT 1
                             FROM jsonb_array_elements_text(v_fill_po #> '{start_config,faturas_elegiveis}') f
                            WHERE f = v_ordinal::text)
               AND jsonb_typeof(v_fill_po #> ARRAY['start_config', 'regras', v_ordinal::text]) = 'object' THEN
                v_fill_regras := v_fill_po #> ARRAY['start_config', 'regras', v_ordinal::text];
            END IF;

            FOR v_fill_papel IN SELECT unnest(ARRAY['lider', 'ppe', 'ppp', 'ppf'])
            LOOP
                CONTINUE WHEN v_matriz_efetiva ? v_fill_papel;

                IF v_fill_regras IS NOT NULL THEN
                    v_fill_pct := COALESCE(NULLIF(v_fill_regras ->> v_fill_papel, '')::numeric, 0);
                    IF v_fill_tipo = 'ambos' THEN
                        v_fill_niveis := COALESCE(v_fill_po #> ARRAY['recorrente_config', 'regras_multinivel', v_fill_papel, 'niveis'], '{}'::jsonb);
                        IF jsonb_typeof(v_fill_niveis) <> 'object' THEN
                            v_fill_niveis := '{}'::jsonb;
                        END IF;
                        v_fill_niveis := jsonb_set(v_fill_niveis, '{L1}', to_jsonb(v_fill_pct));
                        v_fill_max := GREATEST(COALESCE((v_fill_po #>> ARRAY['recorrente_config', 'regras_multinivel', v_fill_papel, 'max_niveis'])::int, 0), 1);
                    ELSE
                        v_fill_niveis := jsonb_build_object('L1', v_fill_pct, 'L2', 0, 'L3', 0, 'L4', 0);
                        v_fill_max := 1;
                    END IF;
                    v_fill_entrada := jsonb_build_object('niveis', v_fill_niveis, 'max_niveis', v_fill_max);
                ELSIF v_fill_tipo IN ('recorrente', 'ambos') THEN
                    v_fill_entrada := v_fill_po #> ARRAY['recorrente_config', 'regras_multinivel', v_fill_papel];
                    IF jsonb_typeof(v_fill_entrada) IS DISTINCT FROM 'object' THEN
                        v_fill_entrada := NULL;
                    END IF;
                ELSE
                    v_fill_entrada := NULL;
                END IF;$de$,
         $para$            v_fill_regras := NULL;

            FOR v_fill_papel IN SELECT unnest(ARRAY['lider', 'ppe', 'ppp', 'ppf'])
            LOOP
                -- 20261112b: cargo COM participante ja foi decidido acima (mesmo
                -- que sem matriz: Start esgotado nao pode voltar pelo plano da UC)
                CONTINUE WHEN v_matriz_efetiva ? v_fill_papel OR v_regras_parceiros ? v_fill_papel;

                -- mesma regra dos participantes (saldo so com a energia da
                -- regra antiga: nao ha beneficiario)
                v_fill_entrada := public.fn_plano_originador_start_energia(
                                      v_fill_po, v_fill_papel, v_kwh_comp, v_start_base_kwh,
                                      v_kwh_legado, COALESCE(v_start_antigo, false)) -> 'entrada';$para$),

        -- 7. rateio sobre a base BRUTA; fornecedor = base LIQUIDA - deduzido
        ($de$            v_split := public.fn_calcular_split_recompensa(
                v_base_calculo, v_teto_deducao, v_matriz_efetiva, v_participantes
            );
$de$,
         $para$            -- 20261112b (dono, 12/11/2026): TODOS os percentuais sobre a base
            -- BRUTA (kWh compensado x tarifa cheia); o Start de parceiro sobre
            -- os kWh dentro do teto dele (base propria); o fornecedor fica com a
            -- base LIQUIDA menos o deduzido. Teto/piso como antes (base liquida).
            IF v_bases_part <> '{}'::jsonb THEN
                SELECT COALESCE(jsonb_agg(CASE WHEN v_bases_part ? (t.p ->> 'papel')
                                               THEN t.p || jsonb_build_object('base', v_bases_part -> (t.p ->> 'papel'))
                                               ELSE t.p END ORDER BY t.ord), '[]'::jsonb)
                  INTO v_participantes
                  FROM jsonb_array_elements(v_participantes) WITH ORDINALITY AS t(p, ord);
            END IF;

            IF c_base_gestao_pu = 'tarifa_com_desconto'
               AND v_plano ->> 'plano_usina_id' IS NOT NULL
               AND v_caminho IS DISTINCT FROM 'bonus_start'
               AND jsonb_typeof(v_matriz_efetiva -> 'b2w') = 'object' THEN
                v_matriz_efetiva := jsonb_set(v_matriz_efetiva, '{b2w,base}', to_jsonb(round(
                    v_kwh_comp * COALESCE(v_tarifa_cheia, 0)
                    * (1 - COALESCE((v_base_info ->> 'desconto_pct')::numeric, 0) / 100), 2)));
            END IF;

            v_split := public.fn_calcular_split_recompensa(
                v_base_bruta, v_teto_deducao, v_matriz_efetiva, v_participantes
            );
            v_split := v_split || jsonb_build_object(
                'fornecedor',         round(v_base_calculo, 2) - COALESCE((v_split ->> 'total_deduzido')::numeric, 0),
                'fornecedor_formula', 'round(base_liquida, 2) - total_deduzido',
                'base_percentuais',   round(v_base_bruta, 2));
$para$),

        -- 8. ramos sem rateio: beneficiario sem Start
        ($de$                'regra',               'nenhuma',
                'regras_start',        NULL));
$de$,
         $para$                'regra',               'nenhuma',
                'regras_start',        NULL,
                'kwh_start',           0,
                'start_base_kwh',      v_start_base_kwh));
$para$),

        -- 9. beneficiarios do resultado: kWh e base do Start
        ($de$                               'regra',               v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'regra'])
$de$,
         $para$                               'regra',               v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'regra'],
                               'kwh_start',           v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'kwh_start'],
                               'base',                v_regras_parceiros #> ARRAY[t.b ->> 'papel', 'base'])
$para$),

        -- 10. fatura bloqueada tambem leva a marca (nao conta como regra antiga)
        ($de$                     'assinante_id',     v_subscriber_id
$de$,
         $para$                     'assinante_id',     v_subscriber_id,
                     'start_por_energia', true
$para$),

        -- 11. congelamento da fatura
        ($de$            'bonus_start',       v_bonus_start
        );
$de$,
         $para$            'bonus_start',       v_bonus_start,
            -- 20261112b
            'start_por_energia', true,
            'base_bruta',        v_base_bruta,
            'tarifa',            v_tarifa_cheia,
            'base_percentuais_formula', 'consumo_compensado * tarifa (sem desconto, sem Fio B)',
            'start_base_kwh',    v_start_base_kwh,
            'kwh_start_legado',  v_kwh_legado
        );
$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    v_n := (length(d) - length(replace(d, '''20261110_plano_originador''', '')))
           / length('''20261110_plano_originador''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20261110_plano_originador''', '''20261112_start_por_energia''');

    EXECUTE d;
END
$patch$;
