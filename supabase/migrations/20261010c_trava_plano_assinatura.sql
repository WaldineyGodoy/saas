-- Trava de versao do plano de assinatura (spec 2026-10-06, secao 6, decisao 17).
-- Plano com UC ou eletroposto vinculado nao muda o que move dinheiro; mudar =
-- nova versao. A antiga fica somente para os contratos que ja estao nela.

ALTER TABLE public.planos_assinatura_energia
    ADD COLUMN status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'somente_contratos')),
    ADD COLUMN substitui_plano_id uuid REFERENCES public.planos_assinatura_energia(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.planos_assinatura_energia.status IS
  'ativo = recebe UC/eletroposto novo; somente_contratos = versao antiga, mantida para as UCs que ja estao nela (fn_planos_assinatura_nova_versao).';

-- 1. Trava
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF (NEW.desconto_assinante, NEW.tipo_recompensa,
        NEW.start_config -> 'faturas_elegiveis', NEW.start_config -> 'regras',
        NEW.recorrente_config -> 'regras_multinivel', NEW.gestao_percentual,
        NEW.piso_fornecedor_pct, NEW.modalidade, NEW.tarifa_motorista_kwh, NEW.recompensas_ativo)
       IS DISTINCT FROM
       (OLD.desconto_assinante, OLD.tipo_recompensa,
        OLD.start_config -> 'faturas_elegiveis', OLD.start_config -> 'regras',
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

CREATE TRIGGER tr_planos_assinatura_trava
    BEFORE UPDATE ON public.planos_assinatura_energia
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_assinatura_trava();

-- 2. Vinculo so a plano ativo (UC e eletroposto). Manter o plano atual numa
--    edicao sempre passa: a regra olha so a TROCA.
CREATE OR REPLACE FUNCTION public.fn_consumer_units_plano_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    IF NEW.plano_assinatura_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_assinatura_id IS DISTINCT FROM OLD.plano_assinatura_id) THEN
        SELECT nome, status INTO v_plano FROM public.planos_assinatura_energia WHERE id = NEW.plano_assinatura_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano "%" esta somente para contratos: escolha a versao ativa.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_consumer_units_plano_ativo() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_consumer_units_plano_ativo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_consumer_units_plano_ativo
    BEFORE INSERT OR UPDATE OF plano_assinatura_id ON public.consumer_units
    FOR EACH ROW EXECUTE FUNCTION public.fn_consumer_units_plano_ativo();

CREATE OR REPLACE FUNCTION public.fn_eletropostos_plano_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    IF NEW.plano_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_id IS DISTINCT FROM OLD.plano_id) THEN
        SELECT nome, status INTO v_plano FROM public.planos_assinatura_energia WHERE id = NEW.plano_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano "%" esta somente para contratos: escolha a versao ativa.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_eletropostos_plano_ativo() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_eletropostos_plano_ativo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_eletropostos_plano_ativo
    BEFORE INSERT OR UPDATE OF plano_id ON public.eletropostos
    FOR EACH ROW EXECUTE FUNCTION public.fn_eletropostos_plano_ativo();

-- 3. Nova versao (SECURITY INVOKER: a RLS de escrita de planos vale)
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_nova_versao(p_origem uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_origem public.planos_assinatura_energia;
    v_nova   public.planos_assinatura_energia;
BEGIN
    SELECT * INTO v_origem FROM public.planos_assinatura_energia WHERE id = p_origem FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_planos_assinatura_nova_versao: plano % nao existe', p_origem;
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
        v_nova.nome := v_origem.nome || ' (nova versão)';
    END IF;

    INSERT INTO public.planos_assinatura_energia SELECT (v_nova).*;

    INSERT INTO public.planos_distribuidoras (plano_id, concessionaria)
    SELECT v_nova.id, d.concessionaria FROM public.planos_distribuidoras d WHERE d.plano_id = p_origem;

    UPDATE public.planos_assinatura_energia SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_nova.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_planos_assinatura_nova_versao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planos_assinatura_nova_versao(uuid, jsonb) TO authenticated, service_role;

-- 4. Mover UCs e eletropostos de uma versao para outra (so admin)
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

    UPDATE public.consumer_units SET plano_assinatura_id = p_para WHERE plano_assinatura_id = p_de;
    GET DIAGNOSTICS v_ucs = ROW_COUNT;
    UPDATE public.eletropostos SET plano_id = p_para WHERE plano_id = p_de;
    GET DIAGNOSTICS v_ele = ROW_COUNT;
    RETURN v_ucs + v_ele;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_planos_assinatura_mover_ucs(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planos_assinatura_mover_ucs(uuid, uuid) TO authenticated, service_role;
