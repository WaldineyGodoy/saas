-- Ajustes da trava de versao do plano de assinatura (fix round 1 da Task 12).
--   A. a trava compara o Start NORMALIZADO (a tela grava 10 chaves por fatura,
--      o motor le 6): salvar/renomear um plano travado nao pode mais recusar.
--   B. so admin cria versao, so a partir da versao ativa, sem empilhar o sufixo.
--   C. fn_plano_assinatura_vigente: a versao ativa que sucedeu um plano.
--   D. adesao: so lista plano ativo e resolve a versao vigente de um plano antigo.

-- ---------------------------------------------------------------------------
-- 0. Travas de md5 dos corpos vivos que serao patchados (12/10/2026)
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.app_planos_adesao(text)'::regprocedure))
       <> '0a39ae15aeee3f9c0d049df9e24be85b' THEN
        RAISE EXCEPTION 'app_planos_adesao mudou desde 12/10/2026: re-derivar o patch';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.app_planos_para_uc(text)'::regprocedure))
       <> '905979905302666352823cb1ec1495d4' THEN
        RAISE EXCEPTION 'app_planos_para_uc mudou desde 12/10/2026: re-derivar o patch';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_criar_uc_do_aditivo(uuid)'::regprocedure))
       <> 'bb1cf41f6cf9f173759760e70d10a125' THEN
        RAISE EXCEPTION 'fn_criar_uc_do_aditivo mudou desde 12/10/2026: re-derivar o patch';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_criar_assinante_publico(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, jsonb, integer, text, text, text, text)'::regprocedure))
       <> '6e10eaa9bfd5177876e99ac84b618536' THEN
        RAISE EXCEPTION 'fn_criar_assinante_publico mudou desde 12/10/2026: re-derivar o patch';
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- A. Start normalizado e trava
-- ---------------------------------------------------------------------------
-- O motor le, por fatura, exatamente b2w/lider/ppe/ppp/ppf/assinante_conect.
-- A tela grava tambem associacao/coordenador/embaixador/assinante (aliases
-- legados) e pode gravar numero como texto; nada disso muda o que se paga.
CREATE OR REPLACE FUNCTION public.fn_plano_start_normalizado(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
    SELECT jsonb_build_object(
        'faturas_elegiveis', p -> 'faturas_elegiveis',
        'regras', COALESCE(
            CASE WHEN jsonb_typeof(p -> 'regras') = 'object' THEN
                (SELECT jsonb_object_agg(e.key, jsonb_build_object(
                    'b2w',              CASE WHEN e.value ->> 'b2w'              ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.value ->> 'b2w')::numeric              ELSE 0 END,
                    'lider',            CASE WHEN e.value ->> 'lider'            ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.value ->> 'lider')::numeric            ELSE 0 END,
                    'ppe',              CASE WHEN e.value ->> 'ppe'              ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.value ->> 'ppe')::numeric              ELSE 0 END,
                    'ppp',              CASE WHEN e.value ->> 'ppp'              ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.value ->> 'ppp')::numeric              ELSE 0 END,
                    'ppf',              CASE WHEN e.value ->> 'ppf'              ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.value ->> 'ppf')::numeric              ELSE 0 END,
                    'assinante_conect', CASE WHEN e.value ->> 'assinante_conect' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e.value ->> 'assinante_conect')::numeric ELSE 0 END))
                   FROM jsonb_each(p -> 'regras') e)
            END,
            '{}'::jsonb))
$function$;

REVOKE ALL ON FUNCTION public.fn_plano_start_normalizado(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_start_normalizado(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF (NEW.desconto_assinante, NEW.tipo_recompensa,
        public.fn_plano_start_normalizado(NEW.start_config),
        NEW.recorrente_config -> 'regras_multinivel', NEW.gestao_percentual,
        NEW.piso_fornecedor_pct, NEW.modalidade, NEW.tarifa_motorista_kwh, NEW.recompensas_ativo)
       IS DISTINCT FROM
       (OLD.desconto_assinante, OLD.tipo_recompensa,
        public.fn_plano_start_normalizado(OLD.start_config),
        OLD.recorrente_config -> 'regras_multinivel', OLD.gestao_percentual,
        OLD.piso_fornecedor_pct, OLD.modalidade, OLD.tarifa_motorista_kwh, OLD.recompensas_ativo)
       AND (EXISTS (SELECT 1 FROM public.consumer_units c WHERE c.plano_assinatura_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.eletropostos e WHERE e.plano_id = OLD.id))
    THEN
        RAISE EXCEPTION 'O plano "%" ja tem UC ou eletroposto vinculado: desconto, piso, gestao, matriz, Start, tipo e modalidade nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_assinatura_trava() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_assinatura_trava() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. Nova versao: so admin, so da versao ativa, sufixo sem empilhar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_nova_versao(p_origem uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_origem public.planos_assinatura_energia;
    v_nova   public.planos_assinatura_energia;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin cria versao de plano.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_origem FROM public.planos_assinatura_energia WHERE id = p_origem FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_planos_assinatura_nova_versao: plano % nao existe', p_origem;
    END IF;
    IF v_origem.status <> 'ativo' THEN
        RAISE EXCEPTION 'O plano "%" ja foi substituido: crie a versao a partir da versao ativa.', v_origem.nome
            USING ERRCODE = 'check_violation';
    END IF;

    -- Chave ausente em p_dados herda do plano de origem.
    v_nova := jsonb_populate_record(v_origem,
                COALESCE(p_dados, '{}'::jsonb) - 'id' - 'status' - 'substitui_plano_id' - 'created_at' - 'updated_at');
    v_nova.id                 := gen_random_uuid();
    v_nova.status             := 'ativo';
    v_nova.substitui_plano_id := p_origem;
    v_nova.created_at         := now();
    v_nova.updated_at         := now();
    IF btrim(COALESCE(v_nova.nome, '')) = '' OR v_nova.nome = v_origem.nome THEN
        v_nova.nome := regexp_replace(v_origem.nome, '\s*\(nova versão\)$', '') || ' (nova versão)';
    END IF;

    INSERT INTO public.planos_assinatura_energia SELECT (v_nova).*;

    INSERT INTO public.planos_distribuidoras (plano_id, concessionaria)
    SELECT v_nova.id, d.concessionaria FROM public.planos_distribuidoras d WHERE d.plano_id = p_origem;

    UPDATE public.planos_assinatura_energia SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_nova.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- C. Versao vigente de um plano
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_assinatura_vigente(p_plano uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
    WITH RECURSIVE cadeia AS (
        SELECT p.id, p.status, 0 AS n
          FROM public.planos_assinatura_energia p
         WHERE p.id = p_plano
        UNION ALL
        SELECT s.id, s.status, c.n + 1
          FROM cadeia c
          JOIN public.planos_assinatura_energia s ON s.substitui_plano_id = c.id
         WHERE c.status <> 'ativo' AND c.n < 50
    )
    SELECT id FROM cadeia WHERE status = 'ativo' ORDER BY n LIMIT 1;
$function$;

ALTER FUNCTION public.fn_plano_assinatura_vigente(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_assinatura_vigente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_assinatura_vigente(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. Caminhos da adesao (patch com ancora unica sobre o corpo vivo)
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    v_par record;
    d     text;
    v_n   integer;
BEGIN
    FOR v_par IN
        SELECT * FROM (VALUES
            ('public.app_planos_adesao(text)',
             $de$WHERE p.ativo$de$,
             $para$WHERE p.ativo
     AND p.status = 'ativo'$para$),
            ('public.app_planos_para_uc(text)',
             $de$where p.ativo$de$,
             $para$where p.ativo
       and p.status = 'ativo'$para$),
            ('public.fn_criar_uc_do_aditivo(uuid)',
             $de$select * into v_plano from public.planos_assinatura_energia where id = v_lead.plano_id;$de$,
             $para$select * into v_plano from public.planos_assinatura_energia
     where id = coalesce(public.fn_plano_assinatura_vigente(v_lead.plano_id), v_lead.plano_id);$para$),
            ('public.fn_criar_assinante_publico(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, jsonb, integer, text, text, text, text)',
             $de$WHERE p.id = (v_uc->>'plano_assinatura_id')::uuid AND p.ativo$de$,
             $para$WHERE p.id = coalesce(public.fn_plano_assinatura_vigente((v_uc->>'plano_assinatura_id')::uuid),
                                 (v_uc->>'plano_assinatura_id')::uuid) AND p.ativo$para$)
        ) AS t(sig, de, para)
    LOOP
        d := pg_get_functiondef(v_par.sig::regprocedure);
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION '%: ancora achada % vezes (esperado 1): %', v_par.sig, v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
        EXECUTE d;
    END LOOP;
END
$patch$;

-- ---------------------------------------------------------------------------
-- E. Mover UCs aplica os termos da versao nova, inclusive o desconto cobrado
--    (decisao do dono, 12/10/2026). Resto igual a 20261010c.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_mover_ucs(p_de uuid, p_para uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_ucs int;
    v_ele int;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin move UCs de plano.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (SELECT status FROM public.planos_assinatura_energia WHERE id = p_para) IS DISTINCT FROM 'ativo' THEN
        RAISE EXCEPTION 'O plano de destino precisa estar ativo.' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.consumer_units
       SET plano_assinatura_id = p_para,
           desconto_assinante = (SELECT desconto_assinante FROM public.planos_assinatura_energia WHERE id = p_para)
     WHERE plano_assinatura_id = p_de;
    GET DIAGNOSTICS v_ucs = ROW_COUNT;
    UPDATE public.eletropostos SET plano_id = p_para WHERE plano_id = p_de;
    GET DIAGNOSTICS v_ele = ROW_COUNT;
    RETURN v_ucs + v_ele;
END;
$function$;
