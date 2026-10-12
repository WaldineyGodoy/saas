-- Achados da revisao final do adendo (spec 2026-10-06, secao 6).
-- (Os antigos 20261010f/g viraram 20261012a/b: dependem de 20261011d_app_adesao,
--  que veio do main, e no replay por nome precisam rodar depois dele. Em producao
--  ja estavam aplicados nessa ordem.)
--   A. originador do lead: copia so no INSERT. No UPDATE, nao admin nao mexe no
--      originador (nem limpar, nem trocar via lead_id), e a retirada feita por
--      admin nao volta no proximo salvar.
--   B. plano de assinatura: excluir uma versao nova devolve a anterior para ativo
--      (senao ela fica presa em somente_contratos); plano com UC ou eletroposto
--      nao se exclui (o FK poria o plano da UC em NULL).
--   C. mover UCs so para a versao vigente que sucede o plano de origem.
--   D. adesao publica: plano antigo sem versao vigente cai na mensagem amigavel.

-- ---------------------------------------------------------------------------
-- A. Originador do fornecedor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_suppliers_originador_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_do_lead uuid;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.lead_id IS NOT NULL THEN
        SELECT l.originator_id INTO v_do_lead FROM public.leads l WHERE l.id = NEW.lead_id;
        IF NEW.originator_id IS NULL THEN
            NEW.originator_id := v_do_lead;
        END IF;
    END IF;

    -- no INSERT, o originador do proprio lead passa; fora isso, so admin
    IF ((TG_OP = 'INSERT' AND NEW.originator_id IS NOT NULL
         AND NEW.originator_id IS DISTINCT FROM v_do_lead)
        OR (TG_OP = 'UPDATE' AND NEW.originator_id IS DISTINCT FROM OLD.originator_id))
       AND auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin define o originador do fornecedor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- B. Exclusao de plano de assinatura
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_exclusao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM public.consumer_units c WHERE c.plano_assinatura_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.eletropostos e WHERE e.plano_id = OLD.id) THEN
        RAISE EXCEPTION 'O plano "%" tem UC ou eletroposto vinculado e nao pode ser excluido.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;

    -- desfazer a versao nova: a anterior volta a valer, se nenhuma outra a sucede
    IF OLD.status = 'ativo' AND OLD.substitui_plano_id IS NOT NULL THEN
        UPDATE public.planos_assinatura_energia p
           SET status = 'ativo'
         WHERE p.id = OLD.substitui_plano_id
           AND p.status = 'somente_contratos'
           AND NOT EXISTS (SELECT 1 FROM public.planos_assinatura_energia o
                            WHERE o.substitui_plano_id = p.id AND o.id <> OLD.id);
    END IF;
    RETURN OLD;
END;
$function$;

ALTER FUNCTION public.fn_planos_assinatura_exclusao() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_assinatura_exclusao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_assinatura_exclusao
    BEFORE DELETE ON public.planos_assinatura_energia
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_assinatura_exclusao();

-- ---------------------------------------------------------------------------
-- C. Mover UCs: destino e a versao vigente que sucede a origem
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
    IF p_de = p_para OR public.fn_plano_assinatura_vigente(p_de) IS DISTINCT FROM p_para THEN
        RAISE EXCEPTION 'O destino precisa ser a versao vigente que substitui o plano de origem.'
            USING ERRCODE = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- D. Adesao publica: so plano com status ativo (patch com ancora unica)
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    c_sig constant text := 'public.fn_criar_assinante_publico(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, jsonb, integer, text, text, text, text)';
    c_de  constant text := $de$(v_uc->>'plano_assinatura_id')::uuid) AND p.ativo$de$;
    c_para constant text := $para$(v_uc->>'plano_assinatura_id')::uuid) AND p.ativo AND p.status = 'ativo'$para$;
    d   text;
    v_n integer;
BEGIN
    d := pg_get_functiondef(c_sig::regprocedure);
    v_n := (length(d) - length(replace(d, c_de, ''))) / length(c_de);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'fn_criar_assinante_publico: ancora achada % vezes (esperado 1)', v_n;
    END IF;
    EXECUTE replace(d, c_de, c_para);
END
$patch$;
