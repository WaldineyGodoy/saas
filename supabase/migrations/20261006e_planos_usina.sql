-- Plano de Usina -- dados, travas e plano padrao.
-- Spec: docs/superpowers/specs/2026-10-06-plano-usina-design.md (secao 1).
--
-- Decisoes do dono (06/10/2026): o plano reune gestao B2W, termos do
-- contrato de compra e venda, plano de recompensas e a regra do originador
-- que trouxe a usina. Vinculo vivo, mas o plano nao muda numero depois que
-- tem usina: mudou valor, nasce uma versao nova e a antiga fica so para os
-- contratos que ja estao nela.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE public.planos_usina (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                         text NOT NULL CHECK (btrim(nome) <> ''),
    descricao                    text,
    percentual_recorrente        numeric NOT NULL DEFAULT 10  CHECK (percentual_recorrente BETWEEN 0 AND 100),
    taxa_admin_reais             numeric NOT NULL DEFAULT 10  CHECK (taxa_admin_reais >= 0),
    taxa_recuperacao_pct         numeric NOT NULL DEFAULT 8   CHECK (taxa_recuperacao_pct BETWEEN 0 AND 100),
    retencao_rescisao_pct        numeric NOT NULL DEFAULT 10  CHECK (retencao_rescisao_pct BETWEEN 0 AND 100),
    multa_atraso_mes_pct         numeric NOT NULL DEFAULT 0.5 CHECK (multa_atraso_mes_pct >= 0),
    multa_atraso_teto_pct        numeric NOT NULL DEFAULT 10  CHECK (multa_atraso_teto_pct >= 0),
    garantia_instalacao_meses    integer NOT NULL DEFAULT 12  CHECK (garantia_instalacao_meses >= 0),
    -- contrato de gestao de creditos (decisao 11, 07/10/2026): defaults de DEFAULTS_FORNECEDOR
    desconto_pct                 numeric NOT NULL DEFAULT 20  CHECK (desconto_pct BETWEEN 0 AND 100),
    dia_corte                    integer NOT NULL DEFAULT 5   CHECK (dia_corte BETWEEN 1 AND 31),
    dia_repasse                  integer NOT NULL DEFAULT 15  CHECK (dia_repasse BETWEEN 1 AND 31),
    prazo_transferencia_dias     integer NOT NULL DEFAULT 90  CHECK (prazo_transferencia_dias >= 0),
    prazo_honorarios_dias        integer NOT NULL DEFAULT 180 CHECK (prazo_honorarios_dias >= 0),
    originador_recorrente_pct    numeric NOT NULL DEFAULT 0   CHECK (originador_recorrente_pct BETWEEN 0 AND 100),
    originador_bonus_fechamentos integer[] NOT NULL DEFAULT '{}'
                                 CHECK (0 < ALL (originador_bonus_fechamentos)
                                        AND array_position(originador_bonus_fechamentos, NULL) IS NULL),
    plano_assinatura_id          uuid REFERENCES public.planos_assinatura_energia(id) ON DELETE RESTRICT,
    status                       text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'somente_contratos')),
    substitui_plano_id           uuid REFERENCES public.planos_usina(id) ON DELETE SET NULL,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planos_usina_plano_assinatura_id_idx ON public.planos_usina (plano_assinatura_id);

COMMENT ON TABLE public.planos_usina IS
  'Plano de Usina (spec 2026-10-06): gestao B2W (percentual_recorrente = clausula (b) do contrato = os 10% da B2W no split), taxas de administracao e recuperacao (cobradas pelo fechamento mensal), termos do contrato de compra e venda, plano de recompensas e a regra do originador que trouxe a usina. Com usina vinculada, numeros e plano de recompensas nao mudam (fn_planos_usina_trava): mudar = fn_planos_usina_nova_versao.';
COMMENT ON COLUMN public.planos_usina.desconto_pct IS
  'Desconto ao consumidor declarado no Contrato de Gestao de Creditos (Anexo I). Termo do contrato: o motor do split calcula a base com o desconto do plano de recompensas.';
COMMENT ON COLUMN public.planos_usina.originador_recorrente_pct IS
  'Percentual recorrente do originador que trouxe a usina (suppliers.originator_id do fornecedor dela), sobre a base de cada fatura paga das UCs dela. Sem originador ou com originador inativo, fica para a associacao (B2W).';
COMMENT ON COLUMN public.planos_usina.originador_bonus_fechamentos IS
  'Ordinais dos fechamentos COM SALDO POSITIVO da usina cujo saldo vai ao originador em vez do fornecedor (ex.: {2}); sem originador, vai para a associacao. Executado pelo fechamento mensal.';

-- ---------------------------------------------------------------------------
-- 2. RLS: leitura para logado, escrita so admin (padrao de planos_assinatura_energia)
-- ---------------------------------------------------------------------------
ALTER TABLE public.planos_usina ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planos_usina FROM anon;

CREATE POLICY planos_usina_leitura_logado ON public.planos_usina
    FOR SELECT TO authenticated USING (true);
CREATE POLICY planos_usina_insere_admin ON public.planos_usina
    FOR INSERT TO authenticated WITH CHECK (public.fn_eh_admin());
CREATE POLICY planos_usina_altera_admin ON public.planos_usina
    FOR UPDATE TO authenticated USING (public.fn_eh_admin()) WITH CHECK (public.fn_eh_admin());
CREATE POLICY planos_usina_apaga_admin ON public.planos_usina
    FOR DELETE TO authenticated USING (public.fn_eh_admin());

-- ---------------------------------------------------------------------------
-- 3. Usina: plano de usina e originador
-- ---------------------------------------------------------------------------
ALTER TABLE public.usinas
    ADD COLUMN plano_usina_id uuid REFERENCES public.planos_usina(id) ON DELETE RESTRICT;

CREATE INDEX usinas_plano_usina_id_idx ON public.usinas (plano_usina_id);

COMMENT ON COLUMN public.usinas.plano_usina_id IS
  'Plano de Usina. Liga a gestao B2W do split e o plano de recompensas padrao das UCs sem plano proprio.';

-- O originador mora no FORNECEDOR e a usina herda (decisao do dono, 07/10/2026).
ALTER TABLE public.suppliers
    ADD COLUMN originator_id uuid REFERENCES public.originators_v2(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.suppliers.originator_id IS
  'Originador que trouxe o fornecedor. As usinas dele herdam: recebe o que o plano de cada usina preve em originador_recorrente_pct e originador_bonus_fechamentos.';

-- Ponto de partida: o originador do lead que virou o fornecedor. Em
-- 07/10/2026 alcanca um fornecedor (Jose Gustavo Sosa Rivero -> Bennaya
-- Almeida); os demais nao tem lead e o dono preenche no cadastro.
UPDATE public.suppliers s
   SET originator_id = l.originator_id
  FROM public.leads l
 WHERE l.id = s.lead_id
   AND l.originator_id IS NOT NULL
   AND s.originator_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Trava de versao
-- ---------------------------------------------------------------------------
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
        NEW.originador_bonus_fechamentos, NEW.plano_assinatura_id)
       IS DISTINCT FROM
       (OLD.percentual_recorrente, OLD.taxa_admin_reais, OLD.taxa_recuperacao_pct,
        OLD.retencao_rescisao_pct, OLD.multa_atraso_mes_pct, OLD.multa_atraso_teto_pct,
        OLD.garantia_instalacao_meses, OLD.desconto_pct, OLD.dia_corte, OLD.dia_repasse,
        OLD.prazo_transferencia_dias, OLD.prazo_honorarios_dias, OLD.originador_recorrente_pct,
        OLD.originador_bonus_fechamentos, OLD.plano_assinatura_id)
       AND EXISTS (SELECT 1 FROM public.usinas u WHERE u.plano_usina_id = OLD.id)
    THEN
        RAISE EXCEPTION 'O plano de usina "%" ja tem usina vinculada: percentuais, valores e plano de recompensas nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_usina_trava() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_usina_trava() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_usina_trava
    BEFORE UPDATE ON public.planos_usina
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_usina_trava();

-- ---------------------------------------------------------------------------
-- 5. Regra de vinculo (e quem pode vincular)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_usinas_vinculo_plano_usina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_plano record;
BEGIN
    -- Ligar ou trocar o split de uma usina move dinheiro: so admin. auth.uid()
    -- nulo e service_role ou SQL direto (migracao, teste) -- passa.
    IF (TG_OP = 'INSERT' AND NEW.plano_usina_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        IF auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
            RAISE EXCEPTION 'So admin vincula usina a plano de usina.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- A regra olha so a TROCA de plano: usina que ja esta num plano que virou
    -- somente_contratos continua salvando as outras colunas.
    IF NEW.plano_usina_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.plano_usina_id IS DISTINCT FROM OLD.plano_usina_id) THEN
        SELECT nome, status, plano_assinatura_id INTO v_plano
          FROM public.planos_usina WHERE id = NEW.plano_usina_id;
        IF v_plano.status <> 'ativo' THEN
            RAISE EXCEPTION 'O plano de usina "%" esta somente para contratos: escolha um plano ativo.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_plano.plano_assinatura_id IS NULL THEN
            RAISE EXCEPTION 'O plano de usina "%" nao tem plano de recompensas: sem ele a usina ficaria sem gestao B2W no razao.', v_plano.nome
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_usinas_vinculo_plano_usina() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_usinas_vinculo_plano_usina() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_usinas_vinculo_plano_usina
    BEFORE INSERT OR UPDATE OF plano_usina_id ON public.usinas
    FOR EACH ROW EXECUTE FUNCTION public.fn_usinas_vinculo_plano_usina();

-- ---------------------------------------------------------------------------
-- 5b. Originador do fornecedor: so admin muda
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_suppliers_originador_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF ((TG_OP = 'INSERT' AND NEW.originator_id IS NOT NULL)
        OR (TG_OP = 'UPDATE' AND NEW.originator_id IS DISTINCT FROM OLD.originator_id))
       AND auth.uid() IS NOT NULL AND NOT public.fn_eh_admin() THEN
        RAISE EXCEPTION 'So admin define o originador do fornecedor.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_suppliers_originador_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_suppliers_originador_admin() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_suppliers_originador_admin
    BEFORE INSERT OR UPDATE OF originator_id ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_suppliers_originador_admin();

-- ---------------------------------------------------------------------------
-- 6. Nova versao (SECURITY INVOKER: a RLS de admin vale)
-- ---------------------------------------------------------------------------
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

    -- Chave ausente em p_dados herda do plano de origem.
    INSERT INTO public.planos_usina (
        nome, descricao, percentual_recorrente, taxa_admin_reais, taxa_recuperacao_pct,
        retencao_rescisao_pct, multa_atraso_mes_pct, multa_atraso_teto_pct,
        garantia_instalacao_meses, desconto_pct, dia_corte, dia_repasse,
        prazo_transferencia_dias, prazo_honorarios_dias,
        originador_recorrente_pct, originador_bonus_fechamentos,
        plano_assinatura_id, status, substitui_plano_id)
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
        CASE WHEN p_dados ? 'plano_assinatura_id'
             THEN NULLIF(p_dados ->> 'plano_assinatura_id', '')::uuid
             ELSE v_origem.plano_assinatura_id END,
        'ativo',
        p_origem)
    RETURNING id INTO v_novo;

    UPDATE public.planos_usina SET status = 'somente_contratos' WHERE id = p_origem;
    RETURN v_novo;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_planos_usina_nova_versao(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planos_usina_nova_versao(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_planos_usina_nova_versao(uuid, jsonb) IS
  'Cria a versao nova de um plano de usina a partir de p_origem (chave ausente em p_dados herda) e passa o antigo para somente_contratos. As usinas do antigo nao mudam.';

-- ---------------------------------------------------------------------------
-- 7. Plano padrao (decisao 5): valores de DEFAULTS_USINA, sem plano de
--    recompensas, sem originador, sem usina.
-- ---------------------------------------------------------------------------
INSERT INTO public.planos_usina (nome, descricao)
VALUES ('Plano Usina Padrão',
        'Valores do contrato de compra e venda v2 (24/08/2026). Sem plano de recompensas e sem regra de originador: preencha antes de vincular a primeira usina, enquanto o plano ainda é editável.');
