-- ===========================================================================
-- Plano do Originador (dono, 10/11/2026)
-- Spec: docs/superpowers/specs/2026-11-10-plano-originador-design.md
--
-- A remuneracao dos parceiros (lider, ppe, ppp, ppf) sai do plano de
-- assinatura e passa a morar em public.planos_originador. O plano de
-- assinatura e o originador APONTAM para um Plano do Originador; sem escolha
-- vale o Padrao. A precedencia ("excecao do originador vence") e resolvida
-- por fn_plano_originador_efetivo, que o motor (20261110b) chama por
-- beneficiario.
--
-- Este arquivo:
--   1. tabela planos_originador + validacao do formato + guardas do Padrao;
--   2. RLS igual a planos_usina (leitura logado; escrita so fn_eh_admin());
--   3. seed dos 2 planos LIDO DO BANCO (Premium -> Padrao, Ultra -> Recorrente);
--   4. plano_originador_id em planos_assinatura_energia e originators_v2
--      (NOT NULL, FK ON DELETE RESTRICT, gatilho que poe o Padrao no INSERT);
--   5. a trava de versao do plano de assinatura passa a ignorar as chaves de
--      parceiro (o vinculo com o Plano do Originador e editavel com UC);
--   6. limpeza das chaves de parceiro dos planos de assinatura;
--   7. fn_plano_originador_efetivo(p_originator, p_uc).
--
-- Planos de eletroposto (mesma tabela, tarifa_motorista_kwh preenchida ou
-- eletroposto vinculado) ficam FORA: nao sao limpos e a trava continua
-- inteira para eles.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Pre-condicoes: os planos-fonte do seed existem e ainda tem as regras.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
    v_premium public.planos_assinatura_energia;
    v_ultra   public.planos_assinatura_energia;
BEGIN
    SELECT * INTO v_premium FROM public.planos_assinatura_energia WHERE id = 'b0298e43-9f01-4104-b77a-c01d3f30310c';
    SELECT * INTO v_ultra   FROM public.planos_assinatura_energia WHERE id = '29c46292-363d-46d2-87f5-7cae59c8ee69';

    IF v_premium.id IS NULL OR v_ultra.id IS NULL THEN
        RAISE EXCEPTION 'plano_originador: Plano Premium (b0298e43) ou Plano Ultra Connect (29c46292) nao existe; o seed copia deles';
    END IF;
    IF jsonb_typeof(v_premium.start_config -> 'faturas_elegiveis') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_ultra.start_config -> 'faturas_elegiveis') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'plano_originador: start_config.faturas_elegiveis do Premium/Ultra nao e array; seed abortado';
    END IF;
    IF jsonb_typeof(v_premium.recorrente_config #> '{regras_multinivel,ppe}') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_ultra.recorrente_config #> '{regras_multinivel,ppe}') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'plano_originador: regras_multinivel do Premium/Ultra sem as linhas de parceiro; ja foi limpo? seed abortado';
    END IF;
    IF to_regclass('public.planos_originador') IS NOT NULL THEN
        RAISE EXCEPTION 'plano_originador: public.planos_originador ja existe';
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE public.planos_originador (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome              text NOT NULL,
    descricao         text,
    status            text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
    padrao            boolean NOT NULL DEFAULT false,
    tipo_recompensa   text NOT NULL DEFAULT 'start' CHECK (tipo_recompensa IN ('start', 'recorrente', 'ambos')),
    start_config      jsonb NOT NULL DEFAULT '{"faturas_elegiveis": [], "regras": {}}'::jsonb,
    recorrente_config jsonb NOT NULL DEFAULT '{"regras_multinivel": {}}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT planos_originador_nome_preenchido CHECK (btrim(nome) <> ''),
    CONSTRAINT planos_originador_padrao_ativo CHECK (NOT padrao OR status = 'ativo')
);

-- exatamente um Padrao (o seed cria; as guardas impedem tirar)
CREATE UNIQUE INDEX planos_originador_um_padrao ON public.planos_originador ((true)) WHERE padrao;

COMMENT ON TABLE public.planos_originador IS
  'Plano do Originador (spec 2026-11-10): remuneracao de lider/ppe/ppp/ppf (Bonus Start e recorrencia). Apontado por planos_assinatura_energia.plano_originador_id e originators_v2.plano_originador_id; precedencia em fn_plano_originador_efetivo. Nunca guarda b2w, assinante_conect nem chaves legadas.';
COMMENT ON COLUMN public.planos_originador.start_config IS
  '{"faturas_elegiveis":[ordinais], "regras":{"<ordinal>":{"lider":n,"ppe":n,"ppp":n,"ppf":n}}}. Ordinal 1 = 1a fatura paga COM energia compensada da UC.';
COMMENT ON COLUMN public.planos_originador.recorrente_config IS
  '{"regras_multinivel":{"<cargo>":{"niveis":{"L1".."L4"},"max_niveis":n}}} so para lider/ppe/ppp/ppf.';

-- formato: so os 4 cargos, percentuais 0..100, ordinais inteiros >= 1
CREATE OR REPLACE FUNCTION public.fn_planos_originador_valida()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    c_cargos constant text[] := ARRAY['lider', 'ppe', 'ppp', 'ppf'];
    r   record;
    c   record;
    n   record;
BEGIN
    IF jsonb_typeof(NEW.start_config) IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(NEW.start_config -> 'faturas_elegiveis', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(NEW.start_config -> 'regras', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Plano do Originador "%": start_config precisa ser {"faturas_elegiveis":[...], "regras":{...}}', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(NEW.start_config -> 'faturas_elegiveis', '[]'::jsonb)) f
                WHERE COALESCE(f, '') !~ '^[1-9][0-9]*$') THEN
        RAISE EXCEPTION 'Plano do Originador "%": faturas_elegiveis so aceita inteiros >= 1', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    FOR r IN SELECT key, value FROM jsonb_each(COALESCE(NEW.start_config -> 'regras', '{}'::jsonb)) LOOP
        IF r.key !~ '^[1-9][0-9]*$' OR jsonb_typeof(r.value) <> 'object' THEN
            RAISE EXCEPTION 'Plano do Originador "%": start_config.regras["%"] invalido', NEW.nome, r.key
                USING ERRCODE = 'check_violation';
        END IF;
        FOR c IN SELECT key, value FROM jsonb_each(r.value) LOOP
            IF NOT (c.key = ANY (c_cargos)) THEN
                RAISE EXCEPTION 'Plano do Originador "%": a chave "%" nao pertence a um Plano do Originador (so lider, ppe, ppp, ppf)', NEW.nome, c.key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF jsonb_typeof(c.value) NOT IN ('number', 'string')
               OR (c.value #>> '{}') !~ '^[0-9]+(\.[0-9]+)?$'
               OR (c.value #>> '{}')::numeric > 100 THEN
                RAISE EXCEPTION 'Plano do Originador "%": Start fatura %, %: percentual entre 0 e 100', NEW.nome, r.key, c.key
                    USING ERRCODE = 'check_violation';
            END IF;
        END LOOP;
    END LOOP;

    IF jsonb_typeof(NEW.recorrente_config) IS DISTINCT FROM 'object'
       OR jsonb_typeof(COALESCE(NEW.recorrente_config -> 'regras_multinivel', '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'Plano do Originador "%": recorrente_config precisa ser {"regras_multinivel":{...}}', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.recorrente_config ? 'regras' THEN
        RAISE EXCEPTION 'Plano do Originador "%": recorrente_config.regras (formato legado) nao e aceito; use regras_multinivel', NEW.nome
            USING ERRCODE = 'check_violation';
    END IF;

    FOR c IN SELECT key, value FROM jsonb_each(COALESCE(NEW.recorrente_config -> 'regras_multinivel', '{}'::jsonb)) LOOP
        IF NOT (c.key = ANY (c_cargos)) THEN
            RAISE EXCEPTION 'Plano do Originador "%": a chave "%" nao pertence a um Plano do Originador (so lider, ppe, ppp, ppf)', NEW.nome, c.key
                USING ERRCODE = 'check_violation';
        END IF;
        IF jsonb_typeof(c.value) <> 'object'
           OR jsonb_typeof(c.value -> 'niveis') IS DISTINCT FROM 'object'
           OR COALESCE(c.value ->> 'max_niveis', '') !~ '^[0-4]$' THEN
            RAISE EXCEPTION 'Plano do Originador "%": regras_multinivel.% precisa de niveis (objeto) e max_niveis 0..4', NEW.nome, c.key
                USING ERRCODE = 'check_violation';
        END IF;
        FOR n IN SELECT key, value FROM jsonb_each(c.value -> 'niveis') LOOP
            IF n.key NOT IN ('L1', 'L2', 'L3', 'L4')
               OR jsonb_typeof(n.value) NOT IN ('number', 'string')
               OR (n.value #>> '{}') !~ '^[0-9]+(\.[0-9]+)?$'
               OR (n.value #>> '{}')::numeric > 100 THEN
                RAISE EXCEPTION 'Plano do Originador "%": recorrencia %.%: percentual entre 0 e 100', NEW.nome, c.key, n.key
                    USING ERRCODE = 'check_violation';
            END IF;
        END LOOP;
    END LOOP;

    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_originador_valida() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_originador_valida() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_originador_valida
    BEFORE INSERT OR UPDATE ON public.planos_originador
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_originador_valida();

-- guardas do Padrao: nao exclui, nao inativa, nao perde padrao; e ninguem
-- vira Padrao por UPDATE (o indice unico ja barraria, a mensagem e melhor).
CREATE OR REPLACE FUNCTION public.fn_planos_originador_guarda_padrao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.padrao THEN
            RAISE EXCEPTION 'O Plano Padrao do Originador nao pode ser excluido.'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.padrao AND NOT NEW.padrao THEN
        RAISE EXCEPTION 'O Plano Padrao do Originador nao pode deixar de ser o Padrao.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.padrao AND NEW.status <> 'ativo' THEN
        RAISE EXCEPTION 'O Plano Padrao do Originador nao pode ser inativado.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.padrao AND NOT OLD.padrao THEN
        RAISE EXCEPTION 'Ja existe um Plano Padrao do Originador; o Padrao nao muda de plano.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_originador_guarda_padrao() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_originador_guarda_padrao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_originador_guarda_padrao
    BEFORE UPDATE OR DELETE ON public.planos_originador
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_originador_guarda_padrao();

-- ---------------------------------------------------------------------------
-- 2. RLS (igual a planos_usina)
-- ---------------------------------------------------------------------------
ALTER TABLE public.planos_originador ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planos_originador FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planos_originador TO authenticated;
GRANT ALL ON public.planos_originador TO service_role;

CREATE POLICY planos_originador_leitura_logado ON public.planos_originador
    FOR SELECT TO authenticated USING (true);
CREATE POLICY planos_originador_insere_admin ON public.planos_originador
    FOR INSERT TO authenticated WITH CHECK (public.fn_eh_admin());
CREATE POLICY planos_originador_altera_admin ON public.planos_originador
    FOR UPDATE TO authenticated USING (public.fn_eh_admin()) WITH CHECK (public.fn_eh_admin());
CREATE POLICY planos_originador_apaga_admin ON public.planos_originador
    FOR DELETE TO authenticated USING (public.fn_eh_admin());

-- ---------------------------------------------------------------------------
-- 3. Seed -- copia das regras de parceiro LIDAS DO BANCO.
--    start_config.regras so dos ordinais elegiveis e so dos 4 cargos;
--    regras_multinivel so das linhas lider/ppe/ppp/ppf. 'hibrido' vira 'ambos'.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.fn_copia_regras_parceiro(p_plano uuid, p_nome text, p_descricao text, p_padrao boolean)
RETURNS uuid
LANGUAGE sql
AS $f$
    INSERT INTO public.planos_originador (nome, descricao, status, padrao, tipo_recompensa, start_config, recorrente_config)
    SELECT p_nome, p_descricao, 'ativo', p_padrao,
           CASE p.tipo_recompensa WHEN 'hibrido' THEN 'ambos' ELSE p.tipo_recompensa END,
           jsonb_build_object(
               'faturas_elegiveis', p.start_config -> 'faturas_elegiveis',
               'regras', COALESCE((
                   SELECT jsonb_object_agg(f.ord, (
                              SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                                FROM jsonb_each(p.start_config -> 'regras' -> f.ord) e
                               WHERE e.key IN ('lider', 'ppe', 'ppp', 'ppf')))
                     FROM jsonb_array_elements_text(p.start_config -> 'faturas_elegiveis') f(ord)
                    WHERE jsonb_typeof(p.start_config -> 'regras' -> f.ord) = 'object'),
                   '{}'::jsonb)),
           jsonb_build_object(
               'regras_multinivel', COALESCE((
                   SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(p.recorrente_config -> 'regras_multinivel') e
                    WHERE e.key IN ('lider', 'ppe', 'ppp', 'ppf')),
                   '{}'::jsonb))
      FROM public.planos_assinatura_energia p
     WHERE p.id = p_plano
    RETURNING id
$f$;

DO $seed$
DECLARE
    v_padrao     uuid;
    v_recorrente uuid;
BEGIN
    v_padrao := pg_temp.fn_copia_regras_parceiro(
        'b0298e43-9f01-4104-b77a-c01d3f30310c', 'Plano Padrão',
        'Regras de parceiro copiadas do Plano Premium em 10/11/2026. Vale para todo originador sem plano próprio.', true);
    v_recorrente := pg_temp.fn_copia_regras_parceiro(
        '29c46292-363d-46d2-87f5-7cae59c8ee69', 'Plano Recorrente',
        'Regras de parceiro copiadas do Plano Ultra Connect em 10/11/2026.', false);

    IF v_padrao IS NULL OR v_recorrente IS NULL THEN
        RAISE EXCEPTION 'plano_originador: seed nao criou os 2 planos';
    END IF;

    -- 4a. plano de assinatura -> Plano do Originador. A coluna nasce com o
    --     Padrao como DEFAULT constante (nao dispara gatilho de UPDATE nas
    --     linhas existentes); o Ultra vai para o Recorrente; o DEFAULT sai e
    --     o gatilho de INSERT assume.
    EXECUTE format(
        'ALTER TABLE public.planos_assinatura_energia ADD COLUMN plano_originador_id uuid NOT NULL DEFAULT %L REFERENCES public.planos_originador(id) ON DELETE RESTRICT',
        v_padrao);
    UPDATE public.planos_assinatura_energia
       SET plano_originador_id = v_recorrente
     WHERE id = '29c46292-363d-46d2-87f5-7cae59c8ee69';

    -- 4b. originador -> Padrao (todos).
    EXECUTE format(
        'ALTER TABLE public.originators_v2 ADD COLUMN plano_originador_id uuid NOT NULL DEFAULT %L REFERENCES public.planos_originador(id) ON DELETE RESTRICT',
        v_padrao);
END
$seed$;

ALTER TABLE public.planos_assinatura_energia ALTER COLUMN plano_originador_id DROP DEFAULT;
ALTER TABLE public.originators_v2 ALTER COLUMN plano_originador_id DROP DEFAULT;

CREATE INDEX planos_assinatura_energia_plano_originador_idx ON public.planos_assinatura_energia (plano_originador_id);
CREATE INDEX originators_v2_plano_originador_idx ON public.originators_v2 (plano_originador_id);

COMMENT ON COLUMN public.planos_assinatura_energia.plano_originador_id IS
  'Plano do Originador que remunera lider/ppe/ppp/ppf das UCs deste plano (default: o Padrao). Editavel mesmo com UC vinculada.';
COMMENT ON COLUMN public.originators_v2.plano_originador_id IS
  'Plano do Originador deste parceiro. Diferente do Padrao = excecao, vence o plano de assinatura da UC (fn_plano_originador_efetivo). So equipe interna altera.';

-- ---------------------------------------------------------------------------
-- 4c. Gatilhos de default (e de guarda, no originador)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_originador_padrao_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
    SELECT id FROM public.planos_originador WHERE padrao LIMIT 1;
$function$;

ALTER FUNCTION public.fn_plano_originador_padrao_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_originador_padrao_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_originador_padrao_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_plano_originador_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF NEW.plano_originador_id IS NULL THEN
        NEW.plano_originador_id := public.fn_plano_originador_padrao_id();
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_planos_assinatura_plano_originador_default() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_planos_assinatura_plano_originador_default() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_planos_assinatura_plano_originador_default
    BEFORE INSERT ON public.planos_assinatura_energia
    FOR EACH ROW EXECUTE FUNCTION public.fn_planos_assinatura_plano_originador_default();

-- Originador: o proprio parceiro pode editar a propria linha (RLS
-- originators_v2_update_propria_ou_interno), entao o plano e campo sensivel,
-- como split_commission e cargo -- mesmo criterio de confianca de
-- fn_originador_guarda_campos_sensiveis.
CREATE OR REPLACE FUNCTION public.fn_originador_plano_originador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_claim     text := coalesce(auth.role(), '');
    v_guc       text := coalesce(current_setting('role', true), '');
    v_confiavel boolean;
BEGIN
    v_confiavel := public.fn_papel_interno()
                   OR (v_claim IN ('', 'service_role')
                       AND v_guc IN ('none', '', 'postgres', 'service_role', 'supabase_admin'));

    IF TG_OP = 'INSERT' THEN
        IF NEW.plano_originador_id IS NULL OR NOT v_confiavel THEN
            NEW.plano_originador_id := public.fn_plano_originador_padrao_id();
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.plano_originador_id IS NULL THEN
        NEW.plano_originador_id := public.fn_plano_originador_padrao_id();
    END IF;
    IF NEW.plano_originador_id IS DISTINCT FROM OLD.plano_originador_id AND NOT v_confiavel THEN
        RAISE EXCEPTION 'O Plano do Originador e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.fn_originador_plano_originador() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_originador_plano_originador() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_originador_plano_originador
    BEFORE INSERT OR UPDATE ON public.originators_v2
    FOR EACH ROW EXECUTE FUNCTION public.fn_originador_plano_originador();

-- ---------------------------------------------------------------------------
-- 5. Trava de versao do plano de assinatura: as chaves de parceiro sairam
--    do plano (decisao 2), entao nao contam mais para a trava -- remove-las
--    ou trocar plano_originador_id com UC vinculada e permitido. Tudo o mais
--    (desconto, tipo, b2w/assinante_conect do Start e da matriz, gestao, piso,
--    modalidade, tarifa, recompensas_ativo) continua travado. Plano de
--    eletroposto continua com a trava INTEIRA (ele ainda usa os cargos).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_assinatura_sem_parceiros(p_start jsonb, p_multinivel jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
    SELECT jsonb_build_object(
        'start', (SELECT jsonb_set(n, '{regras}', COALESCE((
                     SELECT jsonb_object_agg(e.key,
                              CASE WHEN jsonb_typeof(e.value) = 'object'
                                   THEN e.value - ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante']
                                   ELSE e.value END)
                       FROM jsonb_each(n -> 'regras') e), '{}'::jsonb))
                    FROM (SELECT public.fn_plano_start_normalizado(p_start) AS n) s),
        'multinivel', CASE WHEN jsonb_typeof(p_multinivel) = 'object'
                           THEN p_multinivel - ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante']
                           ELSE p_multinivel END)
$function$;

ALTER FUNCTION public.fn_plano_assinatura_sem_parceiros(jsonb, jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.fn_planos_assinatura_trava()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_eletroposto boolean;
    v_mudou       boolean;
BEGIN
    v_eletroposto := OLD.tarifa_motorista_kwh IS NOT NULL
                     OR NEW.tarifa_motorista_kwh IS NOT NULL
                     OR EXISTS (SELECT 1 FROM public.eletropostos e WHERE e.plano_id = OLD.id);

    IF v_eletroposto THEN
        -- eletroposto: regra de antes, com todos os cargos
        v_mudou := (NEW.desconto_assinante, NEW.tipo_recompensa,
                    public.fn_plano_start_normalizado(NEW.start_config),
                    NEW.recorrente_config -> 'regras_multinivel', NEW.gestao_percentual,
                    NEW.piso_fornecedor_pct, NEW.modalidade, NEW.tarifa_motorista_kwh, NEW.recompensas_ativo)
                   IS DISTINCT FROM
                   (OLD.desconto_assinante, OLD.tipo_recompensa,
                    public.fn_plano_start_normalizado(OLD.start_config),
                    OLD.recorrente_config -> 'regras_multinivel', OLD.gestao_percentual,
                    OLD.piso_fornecedor_pct, OLD.modalidade, OLD.tarifa_motorista_kwh, OLD.recompensas_ativo);
    ELSE
        -- 20261110a: as chaves de parceiro (e plano_originador_id) ficam de fora
        v_mudou := (NEW.desconto_assinante, NEW.tipo_recompensa,
                    public.fn_plano_assinatura_sem_parceiros(NEW.start_config, NEW.recorrente_config -> 'regras_multinivel'),
                    NEW.gestao_percentual,
                    NEW.piso_fornecedor_pct, NEW.modalidade, NEW.tarifa_motorista_kwh, NEW.recompensas_ativo)
                   IS DISTINCT FROM
                   (OLD.desconto_assinante, OLD.tipo_recompensa,
                    public.fn_plano_assinatura_sem_parceiros(OLD.start_config, OLD.recorrente_config -> 'regras_multinivel'),
                    OLD.gestao_percentual,
                    OLD.piso_fornecedor_pct, OLD.modalidade, OLD.tarifa_motorista_kwh, OLD.recompensas_ativo);
    END IF;

    IF v_mudou
       AND (EXISTS (SELECT 1 FROM public.consumer_units c WHERE c.plano_assinatura_id = OLD.id)
            OR EXISTS (SELECT 1 FROM public.eletropostos e WHERE e.plano_id = OLD.id))
    THEN
        RAISE EXCEPTION 'O plano "%" ja tem UC ou eletroposto vinculado: desconto, piso, gestao, matriz, Start, tipo e modalidade nao mudam mais. Crie uma nova versao.', OLD.nome
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Limpeza: o plano de assinatura nao guarda mais remuneracao de parceiro.
--    Ficam b2w e assinante_conect. Eletroposto fica de fora.
-- ---------------------------------------------------------------------------
UPDATE public.planos_assinatura_energia p
   SET start_config = CASE
           WHEN jsonb_typeof(p.start_config -> 'regras') = 'object' THEN
               jsonb_set(p.start_config, '{regras}', (
                   SELECT COALESCE(jsonb_object_agg(e.key,
                            CASE WHEN jsonb_typeof(e.value) = 'object'
                                 THEN e.value - ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante']
                                 ELSE e.value END), '{}'::jsonb)
                     FROM jsonb_each(p.start_config -> 'regras') e))
           ELSE p.start_config END,
       recorrente_config = CASE
           WHEN jsonb_typeof(p.recorrente_config) = 'object' THEN
               p.recorrente_config
               || CASE WHEN jsonb_typeof(p.recorrente_config -> 'regras_multinivel') = 'object'
                       THEN jsonb_build_object('regras_multinivel', (p.recorrente_config -> 'regras_multinivel')
                            - ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante'])
                       ELSE '{}'::jsonb END
               || CASE WHEN jsonb_typeof(p.recorrente_config -> 'regras') = 'object'
                       THEN jsonb_build_object('regras', (p.recorrente_config -> 'regras')
                            - ARRAY['lider', 'ppe', 'ppp', 'ppf', 'associacao', 'embaixador', 'coordenador', 'assinante'])
                       ELSE '{}'::jsonb END
           ELSE p.recorrente_config END
 WHERE p.tarifa_motorista_kwh IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.eletropostos e WHERE e.plano_id = p.id);

-- ---------------------------------------------------------------------------
-- 7. Plano efetivo de um participante ("excecao do originador vence")
--    1. originador com plano diferente do Padrao -> esse ('originador');
--    2. senao, o plano ligado ao plano de assinatura da UC ('plano_assinatura');
--    3. senao, o Padrao ('padrao').
--    Status 'inativo' NAO desliga um vinculo existente: inativo so some das
--    listas de escolha da tela.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_plano_originador_efetivo(p_originator uuid, p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_po public.planos_originador;
BEGIN
    IF p_originator IS NOT NULL THEN
        SELECT po.* INTO v_po
          FROM public.originators_v2 o
          JOIN public.planos_originador po ON po.id = o.plano_originador_id
         WHERE o.id = p_originator
           AND NOT po.padrao;
        IF FOUND THEN
            RETURN to_jsonb(v_po) || jsonb_build_object('origem', 'originador');
        END IF;
    END IF;

    IF p_uc IS NOT NULL THEN
        SELECT po.* INTO v_po
          FROM public.consumer_units cu
          JOIN public.planos_assinatura_energia pa ON pa.id = cu.plano_assinatura_id
          JOIN public.planos_originador po ON po.id = pa.plano_originador_id
         WHERE cu.id = p_uc;
        IF FOUND THEN
            RETURN to_jsonb(v_po) || jsonb_build_object('origem', 'plano_assinatura');
        END IF;
    END IF;

    SELECT po.* INTO v_po FROM public.planos_originador po WHERE po.padrao;
    IF FOUND THEN
        RETURN to_jsonb(v_po) || jsonb_build_object('origem', 'padrao');
    END IF;
    RETURN NULL;
END;
$function$;

ALTER FUNCTION public.fn_plano_originador_efetivo(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_originador_efetivo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_originador_efetivo(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_plano_originador_efetivo(uuid, uuid) IS
  'Plano do Originador que vale para o participante p_originator na UC p_uc: excecao do originador (plano <> Padrao) > plano ligado ao plano de assinatura da UC > Padrao. Devolve a linha em jsonb + "origem" (originador|plano_assinatura|padrao).';
