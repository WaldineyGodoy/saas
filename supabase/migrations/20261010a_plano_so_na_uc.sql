-- Plano de Usina -- adendo de 10/10/2026, decisao 16 (spec secao 6).
-- O plano de assinatura (matriz PPE/PPP/PPF/Lider/Conect) mora SO na UC e e
-- obrigatorio nela; o plano de usina deixa de apontar para um plano de
-- assinatura -- a recompensa dele e a do originador do FORNECEDOR (e do Lider
-- desse originador, decisao 13: coluna nova aqui, motor na 20261010b).

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.planos_usina WHERE plano_assinatura_id IS NOT NULL) THEN
        RAISE EXCEPTION 'planos_usina.plano_assinatura_id tem valor: decidir o destino antes de remover a coluna';
    END IF;
    IF EXISTS (SELECT 1 FROM public.consumer_units
                WHERE plano_assinatura_id IS NULL
                  AND tipo_unidade IS DISTINCT FROM 'geradora'
                  AND status::text IN ('ativo', 'em_atraso', 'em_transf_titularidade')) THEN
        RAISE EXCEPTION 'ha UC em operacao sem plano de assinatura: vincular antes de ligar a obrigatoriedade';
    END IF;
END
$guard$;

ALTER TABLE public.planos_usina
    ADD COLUMN originador_lider_recorrente_pct numeric NOT NULL DEFAULT 0
        CHECK (originador_lider_recorrente_pct BETWEEN 0 AND 100);

COMMENT ON COLUMN public.planos_usina.originador_lider_recorrente_pct IS
  'Percentual recorrente do Lider do originador do fornecedor da usina (originators_v2.lider_id com cargo lider), sobre a base de cada fatura paga das UCs dela. Sem Lider valido e ativo, a cota so vai a B2W se couber no teto (decisao 12).';

-- 1. Plano de recompensas da UC: so a UC (sem fallback do plano de usina).
CREATE OR REPLACE FUNCTION public.fn_plano_da_uc(p_uc uuid)
RETURNS planos_assinatura_energia
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
    FROM public.consumer_units cu
    JOIN public.planos_assinatura_energia p ON p.id = cu.plano_assinatura_id
   WHERE cu.id = p_uc;
$function$;

-- 2. Trava do plano de usina: sai plano_assinatura_id, entra o % do Lider.
CREATE OR REPLACE FUNCTION public.fn_planos_usina_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF (NEW.percentual_recorrente, NEW.taxa_admin_reais, NEW.taxa_recuperacao_pct,
        NEW.retencao_rescisao_pct, NEW.multa_atraso_mes_pct, NEW.multa_atraso_teto_pct,
        NEW.garantia_instalacao_meses, NEW.desconto_pct, NEW.dia_corte, NEW.dia_repasse,
        NEW.prazo_transferencia_dias, NEW.prazo_honorarios_dias, NEW.originador_recorrente_pct,
        NEW.originador_bonus_fechamentos, NEW.originador_lider_recorrente_pct)
       IS DISTINCT FROM
       (OLD.percentual_recorrente, OLD.taxa_admin_reais, OLD.taxa_recuperacao_pct,
        OLD.retencao_rescisao_pct, OLD.multa_atraso_mes_pct, OLD.multa_atraso_teto_pct,
        OLD.garantia_instalacao_meses, OLD.desconto_pct, OLD.dia_corte, OLD.dia_repasse,
        OLD.prazo_transferencia_dias, OLD.prazo_honorarios_dias, OLD.originador_recorrente_pct,
        OLD.originador_bonus_fechamentos, OLD.originador_lider_recorrente_pct)
       AND EXISTS (SELECT 1 FROM public.usinas u WHERE u.plano_usina_id = OLD.id)
    THEN
        RAISE EXCEPTION 'O plano de usina "%" ja tem usina vinculada: percentuais e valores nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

-- 3. Vinculo: plano de usina so precisa estar ativo.
CREATE OR REPLACE FUNCTION public.fn_usinas_vinculo_plano_usina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.plano_usina_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
            RAISE EXCEPTION 'So admin vincula usina a plano de usina.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF NEW.plano_usina_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        SELECT nome, status INTO v_plano
          FROM public.planos_usina WHERE id = NEW.plano_usina_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano de usina "%" esta somente para contratos: escolha um plano ativo.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

-- 4. Nova versao do plano de usina: sem plano_assinatura_id, com o % do Lider.
CREATE OR REPLACE FUNCTION public.fn_planos_usina_nova_versao(p_origem uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_origem public.planos_usina;
    v_novo   uuid;
BEGIN
    SELECT * INTO v_origem FROM public.planos_usina WHERE id = p_origem FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'fn_planos_usina_nova_versao: plano de usina % nao existe', p_origem;
    END IF;

    INSERT INTO public.planos_usina (
        nome, descricao, percentual_recorrente, taxa_admin_reais, taxa_recuperacao_pct,
        retencao_rescisao_pct, multa_atraso_mes_pct, multa_atraso_teto_pct,
        garantia_instalacao_meses, desconto_pct, dia_corte, dia_repasse,
        prazo_transferencia_dias, prazo_honorarios_dias,
        originador_recorrente_pct, originador_bonus_fechamentos,
        originador_lider_recorrente_pct, status, substitui_plano_id)
    VALUES (
        COALESCE(NULLIF(btrim(p_dados ->> 'nome'), ''), v_origem.nome || ' (nova versao)'),
        CASE WHEN p_dados ? 'descricao' THEN p_dados ->> 'descricao' ELSE v_origem.descricao END,
        COALESCE((p_dados ->> 'percentual_recorrente')::numeric,     v_origem.percentual_recorrente),
        COALESCE((p_dados ->> 'taxa_admin_reais')::numeric,          v_origem.taxa_admin_reais),
        COALESCE((p_dados ->> 'taxa_recuperacao_pct')::numeric,      v_origem.taxa_recuperacao_pct),
        COALESCE((p_dados ->> 'retencao_rescisao_pct')::numeric,     v_origem.retencao_rescisao_pct),
        COALESCE((p_dados ->> 'multa_atraso_mes_pct')::numeric,      v_origem.multa_atraso_mes_pct),
        COALESCE((p_dados ->> 'multa_atraso_teto_pct')::numeric,     v_origem.multa_atraso_teto_pct),
        COALESCE((p_dados ->> 'garantia_instalacao_meses')::integer, v_origem.garantia_instalacao_meses),
        COALESCE((p_dados ->> 'desconto_pct')::numeric,              v_origem.desconto_pct),
        COALESCE((p_dados ->> 'dia_corte')::integer,                 v_origem.dia_corte),
        COALESCE((p_dados ->> 'dia_repasse')::integer,               v_origem.dia_repasse),
        COALESCE((p_dados ->> 'prazo_transferencia_dias')::integer,  v_origem.prazo_transferencia_dias),
        COALESCE((p_dados ->> 'prazo_honorarios_dias')::integer,     v_origem.prazo_honorarios_dias),
        COALESCE((p_dados ->> 'originador_recorrente_pct')::numeric, v_origem.originador_recorrente_pct),
        CASE WHEN p_dados ? 'originador_bonus_fechamentos'
             THEN COALESCE((SELECT array_agg(x::integer ORDER BY x::integer)
                              FROM jsonb_array_elements_text(p_dados -> 'originador_bonus_fechamentos') x), '{}')
             ELSE v_origem.originador_bonus_fechamentos END,
        COALESCE((p_dados ->> 'originador_lider_recorrente_pct')::numeric, v_origem.originador_lider_recorrente_pct),
        'ativo',
        p_origem)
    RETURNING id INTO v_novo;

    UPDATE public.planos_usina SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_novo;
END;
$function$;

-- 5. Sai a coluna (depois das funcoes que a liam).
ALTER TABLE public.planos_usina DROP COLUMN plano_assinatura_id;

COMMENT ON COLUMN public.usinas.plano_usina_id IS
  'Plano de Usina. Liga a gestao B2W do split e a recompensa do originador do fornecedor (e do Lider dele). O plano de assinatura de cada UC continua vindo da UC.';

COMMENT ON TABLE public.planos_usina IS
  'Plano de Usina (spec 2026-10-06, secao 6): gestao B2W (percentual_recorrente = os 10% da B2W no split), taxas cobradas pelo fechamento mensal, termos dos contratos de compra e venda e de gestao, e a recompensa de quem esta ligado ao FORNECEDOR (originador e Lider dele). A recompensa de quem esta ligado ao ASSINANTE vem do plano de assinatura da UC. Com usina vinculada, numeros nao mudam (fn_planos_usina_trava): mudar = fn_planos_usina_nova_versao.';

-- 6. Plano de assinatura obrigatorio na UC em operacao (decisao 16).
CREATE OR REPLACE FUNCTION public.fn_consumer_units_plano_obrigatorio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF NEW.plano_assinatura_id IS NULL
       AND NEW.tipo_unidade IS DISTINCT FROM 'geradora'
       AND NEW.status::text IN ('ativo', 'em_atraso', 'em_transf_titularidade') THEN
        -- Cascata de outro gatilho (usina virou 'gerando', fatura venceu):
        -- barrar travaria a usina inteira. Passa e avisa; a fatura dessa UC
        -- cai em uc_sem_plano ate alguem escolher o plano.
        IF pg_trigger_depth() > 1 THEN
            RAISE WARNING 'UC % entrou em % sem plano de assinatura (mudanca automatica): as faturas dela nao lancam recompensas nem gestao ate o plano ser escolhido', NEW.id, NEW.status;
        ELSE
            RAISE EXCEPTION 'Escolha o plano de assinatura da UC antes de coloca-la em %.', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_consumer_units_plano_obrigatorio() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_consumer_units_plano_obrigatorio() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_consumer_units_plano_obrigatorio
    BEFORE INSERT OR UPDATE OF status, plano_assinatura_id, tipo_unidade ON public.consumer_units
    FOR EACH ROW EXECUTE FUNCTION public.fn_consumer_units_plano_obrigatorio();
