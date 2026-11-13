-- ===========================================================================
-- LICENCA ANUAL DO ORIGINADOR (dono, 13/11/2026)
--
--   1. O preco da licenca anual fica NO PLANO DO ORIGINADOR, por cargo:
--        planos_originador.licenca_config = {"lider":N,"ppe":N,"ppp":N,"ppf":N}
--      0 (ou ausente) = cargo sem licenca naquele plano (isenta).
--   2. Vouchers por plano (originador_vouchers): isencao, % ou R$ de desconto,
--      validade, limite de usos e cargos aceitos. No modal do originador a
--      equipe so digita o codigo (fn_aplicar_voucher_licenca).
--   3. No originador: licenca_preco (do plano), licenca_valor (preco menos o
--      voucher), licenca_paga_em (informada no CRM, provisoriamente, ate a
--      cobranca pelo Asaas), licenca_vencimento = paga_em + 1 ano,
--      licenca_status isenta | pendente | ativa | vencida. Tudo derivado por
--      gatilho; voucher que zera o valor ativa a licenca na data em que entrou.
--      Trocar de cargo recomeca a licenca do cargo novo.
--   4. MOTOR: cargo com licenca pendente ou vencida recebe como PPF
--      ("como Free ate pagar", dono 13/11/2026). Antes o PPP vencido entrava
--      SUSPENSO e o PPP sem vencimento recebia como PPP. O Lider sem licenca
--      em dia recebe a propria venda como PPF e perde a cota de Lider da rede.
--
-- Sem mudanca de numero ao aplicar: todo plano nasce com licenca 0 para todos
-- os cargos, logo todo originador fica 'isenta' e o motor segue igual ate o
-- dono informar os precos.
-- ===========================================================================

-- --------------------------------------------------------------- 1. preco
ALTER TABLE public.planos_originador
  ADD COLUMN IF NOT EXISTS licenca_config jsonb NOT NULL
  DEFAULT '{"lider": 0, "ppe": 0, "ppp": 0, "ppf": 0}'::jsonb;

UPDATE public.planos_originador
   SET licenca_config = '{"lider": 0, "ppe": 0, "ppp": 0, "ppf": 0}'::jsonb || coalesce(licenca_config, '{}'::jsonb);

ALTER TABLE public.planos_originador DROP CONSTRAINT IF EXISTS ck_planos_originador_licenca_config;
ALTER TABLE public.planos_originador ADD CONSTRAINT ck_planos_originador_licenca_config CHECK (
  jsonb_typeof(licenca_config) = 'object'
  AND coalesce(jsonb_typeof(licenca_config -> 'lider'), 'number') = 'number'
  AND coalesce(jsonb_typeof(licenca_config -> 'ppe'), 'number') = 'number'
  AND coalesce(jsonb_typeof(licenca_config -> 'ppp'), 'number') = 'number'
  AND coalesce(jsonb_typeof(licenca_config -> 'ppf'), 'number') = 'number'
  AND coalesce((licenca_config ->> 'lider')::numeric, 0) >= 0
  AND coalesce((licenca_config ->> 'ppe')::numeric, 0) >= 0
  AND coalesce((licenca_config ->> 'ppp')::numeric, 0) >= 0
  AND coalesce((licenca_config ->> 'ppf')::numeric, 0) >= 0
);

COMMENT ON COLUMN public.planos_originador.licenca_config IS
  'Preco da licenca anual por cargo (R$). 0 = cargo isento neste plano. Dono, 13/11/2026.';

-- --------------------------------------------------------------- 2. vouchers
CREATE TABLE IF NOT EXISTS public.originador_vouchers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_originador_id uuid NOT NULL REFERENCES public.planos_originador(id) ON DELETE CASCADE,
  codigo              text NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('isencao', 'percentual', 'valor')),
  valor               numeric(12, 2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
  cargos              text[],            -- NULL = todos os cargos
  validade            date,              -- NULL = sem validade
  limite_usos         integer CHECK (limite_usos IS NULL OR limite_usos > 0),
  ativo               boolean NOT NULL DEFAULT true,
  descricao           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_voucher_codigo CHECK (btrim(codigo) <> ''),
  CONSTRAINT ck_voucher_percentual CHECK (tipo <> 'percentual' OR valor <= 100),
  CONSTRAINT ck_voucher_cargos CHECK (cargos IS NULL OR cargos <@ ARRAY['lider', 'ppe', 'ppp', 'ppf']::text[])
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_originador_vouchers_codigo
  ON public.originador_vouchers (upper(btrim(codigo)));

ALTER TABLE public.originador_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS originador_vouchers_leitura_interna ON public.originador_vouchers;
CREATE POLICY originador_vouchers_leitura_interna ON public.originador_vouchers
  FOR SELECT TO authenticated USING (public.fn_papel_interno());
DROP POLICY IF EXISTS originador_vouchers_insere_admin ON public.originador_vouchers;
CREATE POLICY originador_vouchers_insere_admin ON public.originador_vouchers
  FOR INSERT TO authenticated WITH CHECK (public.fn_eh_admin());
DROP POLICY IF EXISTS originador_vouchers_altera_admin ON public.originador_vouchers;
CREATE POLICY originador_vouchers_altera_admin ON public.originador_vouchers
  FOR UPDATE TO authenticated USING (public.fn_eh_admin()) WITH CHECK (public.fn_eh_admin());
DROP POLICY IF EXISTS originador_vouchers_apaga_admin ON public.originador_vouchers;
CREATE POLICY originador_vouchers_apaga_admin ON public.originador_vouchers
  FOR DELETE TO authenticated USING (public.fn_eh_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.originador_vouchers TO authenticated;

-- --------------------------------------------------------------- 3. originador
ALTER TABLE public.originators_v2
  ADD COLUMN IF NOT EXISTS licenca_preco numeric(12, 2),
  ADD COLUMN IF NOT EXISTS licenca_paga_em date,
  ADD COLUMN IF NOT EXISTS licenca_voucher_id uuid REFERENCES public.originador_vouchers(id) ON DELETE SET NULL;

ALTER TABLE public.originators_v2 DROP CONSTRAINT IF EXISTS originators_v2_licenca_status_check;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.originators_v2'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%licenca_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.originators_v2 DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.originators_v2 ADD CONSTRAINT originators_v2_licenca_status_check
  CHECK (licenca_status IN ('isenta', 'pendente', 'ativa', 'vencida'));

COMMENT ON COLUMN public.originators_v2.licenca_paga_em IS
  'Data do pagamento da licenca anual (informada no CRM). Vencimento = +1 ano. Dono, 13/11/2026.';

-- Em dia = cargo isento no plano ou licenca paga e nao vencida HOJE (o status
-- gravado so muda quando a linha e escrita; o motor confere pela data).
CREATE OR REPLACE FUNCTION public.fn_licenca_em_dia(p_status text, p_paga_em date, p_vencimento date)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(p_status, 'isenta') = 'isenta'
         OR (p_paga_em IS NOT NULL AND p_vencimento IS NOT NULL AND p_vencimento >= current_date)
$$;

CREATE OR REPLACE FUNCTION public.fn_originador_licenca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_preco numeric := 0;
  v_desc  numeric := 0;
  v_v     public.originador_vouchers%ROWTYPE;
  v_usos  integer;
  v_validar boolean;
BEGIN
  -- Cargo novo, licenca nova: o pagamento e o voucher do cargo anterior nao
  -- valem, salvo se vierem informados nesta mesma gravacao.
  IF TG_OP = 'UPDATE' AND NEW.cargo IS DISTINCT FROM OLD.cargo THEN
    IF NEW.licenca_paga_em IS NOT DISTINCT FROM OLD.licenca_paga_em THEN
      NEW.licenca_paga_em := NULL;
    END IF;
    IF NEW.licenca_voucher_id IS NOT DISTINCT FROM OLD.licenca_voucher_id THEN
      NEW.licenca_voucher_id := NULL;
    END IF;
  END IF;

  SELECT coalesce((p.licenca_config ->> NEW.cargo)::numeric, 0)
    INTO v_preco
    FROM public.planos_originador p
   WHERE p.id = NEW.plano_originador_id;
  v_preco := coalesce(v_preco, 0);

  IF NEW.licenca_voucher_id IS NOT NULL THEN
    SELECT * INTO v_v FROM public.originador_vouchers WHERE id = NEW.licenca_voucher_id;
    IF NOT FOUND THEN
      NEW.licenca_voucher_id := NULL;
    ELSE
      -- Validacao so quando o voucher entra (ou o plano/cargo muda): voucher
      -- ja aceito nao cai porque venceu ou esgotou depois.
      v_validar := TG_OP = 'INSERT';
      IF NOT v_validar THEN
        v_validar := NEW.licenca_voucher_id IS DISTINCT FROM OLD.licenca_voucher_id
                     OR NEW.plano_originador_id IS DISTINCT FROM OLD.plano_originador_id
                     OR NEW.cargo IS DISTINCT FROM OLD.cargo;
      END IF;
      IF v_validar THEN
        IF NOT v_v.ativo THEN
          RAISE EXCEPTION 'Voucher % esta inativo.', v_v.codigo USING ERRCODE = '22023';
        END IF;
        IF v_v.plano_originador_id IS DISTINCT FROM NEW.plano_originador_id THEN
          RAISE EXCEPTION 'Voucher % nao pertence ao Plano do Originador deste parceiro.', v_v.codigo USING ERRCODE = '22023';
        END IF;
        IF v_v.validade IS NOT NULL AND v_v.validade < current_date THEN
          RAISE EXCEPTION 'Voucher % venceu em %.', v_v.codigo, to_char(v_v.validade, 'DD/MM/YYYY') USING ERRCODE = '22023';
        END IF;
        IF v_v.cargos IS NOT NULL AND NOT (NEW.cargo = ANY (v_v.cargos)) THEN
          RAISE EXCEPTION 'Voucher % nao vale para este cargo.', v_v.codigo USING ERRCODE = '22023';
        END IF;
        IF v_v.limite_usos IS NOT NULL THEN
          SELECT count(*) INTO v_usos FROM public.originators_v2 o
           WHERE o.licenca_voucher_id = v_v.id AND o.id <> NEW.id;
          IF v_usos >= v_v.limite_usos THEN
            RAISE EXCEPTION 'Voucher % ja atingiu o limite de % uso(s).', v_v.codigo, v_v.limite_usos USING ERRCODE = '22023';
          END IF;
        END IF;
      END IF;
      v_desc := CASE v_v.tipo
                  WHEN 'isencao'    THEN v_preco
                  WHEN 'percentual' THEN round(v_preco * v_v.valor / 100, 2)
                  ELSE v_v.valor
                END;
    END IF;
  END IF;

  NEW.licenca_preco := v_preco;

  IF v_preco <= 0 THEN
    NEW.licenca_valor := 0;
    NEW.licenca_vencimento := CASE WHEN NEW.licenca_paga_em IS NULL THEN NULL
                                   ELSE (NEW.licenca_paga_em + interval '1 year')::date END;
    NEW.licenca_status := 'isenta';
    RETURN NEW;
  END IF;

  NEW.licenca_valor := greatest(v_preco - v_desc, 0);

  -- Voucher que zera o valor: a licenca comeca no dia em que ele entrou.
  IF NEW.licenca_valor = 0 AND NEW.licenca_paga_em IS NULL THEN
    NEW.licenca_paga_em := current_date;
  END IF;

  IF NEW.licenca_paga_em IS NULL THEN
    NEW.licenca_vencimento := NULL;
    NEW.licenca_status := 'pendente';
  ELSE
    NEW.licenca_vencimento := (NEW.licenca_paga_em + interval '1 year')::date;
    NEW.licenca_status := CASE WHEN NEW.licenca_vencimento < current_date THEN 'vencida' ELSE 'ativa' END;
  END IF;
  RETURN NEW;
END;
$function$;

-- O gatilho antigo derivava o status so do vencimento digitado. Sai; o novo
-- roda DEPOIS do que preenche o plano padrao (ordem alfabetica dos BEFORE).
DROP TRIGGER IF EXISTS trg_originador_licenca_status ON public.originators_v2;
DROP FUNCTION IF EXISTS public.fn_originador_licenca_status();
DROP TRIGGER IF EXISTS trg_originador_w_licenca ON public.originators_v2;
CREATE TRIGGER trg_originador_w_licenca
  BEFORE INSERT OR UPDATE ON public.originators_v2
  FOR EACH ROW EXECUTE FUNCTION public.fn_originador_licenca();

-- Preco do plano mudou: recalcula os originadores dele.
CREATE OR REPLACE FUNCTION public.fn_planos_originador_licenca_propaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.licenca_config IS DISTINCT FROM OLD.licenca_config THEN
    UPDATE public.originators_v2 SET licenca_preco = licenca_preco
     WHERE plano_originador_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tr_planos_originador_licenca_propaga ON public.planos_originador;
CREATE TRIGGER tr_planos_originador_licenca_propaga
  AFTER UPDATE OF licenca_config ON public.planos_originador
  FOR EACH ROW EXECUTE FUNCTION public.fn_planos_originador_licenca_propaga();

-- Aplicar / tirar voucher pelo codigo (modal do originador). Codigo vazio tira.
CREATE OR REPLACE FUNCTION public.fn_aplicar_voucher_licenca(p_originador uuid, p_codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id  uuid;
  v_o   public.originators_v2%ROWTYPE;
BEGIN
  IF NOT public.fn_papel_interno() THEN
    RAISE EXCEPTION 'Somente a equipe B2W aplica voucher de licenca.' USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(coalesce(p_codigo, '')), '') IS NOT NULL THEN
    SELECT id INTO v_id FROM public.originador_vouchers
     WHERE upper(btrim(codigo)) = upper(btrim(p_codigo));
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Voucher % nao encontrado.', upper(btrim(p_codigo)) USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.originators_v2 SET licenca_voucher_id = v_id
   WHERE id = p_originador
  RETURNING * INTO v_o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Originador nao encontrado.' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'licenca_preco', v_o.licenca_preco, 'licenca_valor', v_o.licenca_valor,
    'licenca_paga_em', v_o.licenca_paga_em, 'licenca_vencimento', v_o.licenca_vencimento,
    'licenca_status', v_o.licenca_status, 'licenca_voucher_id', v_o.licenca_voucher_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_aplicar_voucher_licenca(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aplicar_voucher_licenca(uuid, text) TO authenticated;

-- Guarda: o proprio parceiro nao mexe no pagamento nem no voucher.
CREATE OR REPLACE FUNCTION public.fn_originador_guarda_campos_sensiveis()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claim text := coalesce(auth.role(), '');
  v_guc   text := coalesce(current_setting('role', true), '');
BEGIN
  -- Confiavel: papel interno, ou service role / postgres (migracao, cron).
  -- `auth.uid() IS NULL` NAO e evidencia de service role: o anon tambem nao
  -- tem uid.
  IF public.fn_papel_interno()
     OR (v_claim IN ('', 'service_role')
         AND v_guc IN ('none', '', 'postgres', 'service_role', 'supabase_admin')) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.split_commission := '{"start": 0, "recurrent": 0}'::jsonb;
    NEW.short_url := NULL;
    NEW.cargo := 'ppf';
    NEW.lider_id := NULL;
    NEW.licenca_valor := NULL;
    NEW.licenca_vencimento := NULL;
    NEW.licenca_paga_em := NULL;
    NEW.licenca_voucher_id := NULL;
    NEW.ativo := true;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Nao e possivel trocar o id do embaixador. Fale com a equipe da B2W.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.split_commission IS DISTINCT FROM OLD.split_commission THEN
    RAISE EXCEPTION 'A comissao (split_commission) e definida pela B2W e nao pode ser alterada pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.short_url IS DISTINCT FROM OLD.short_url THEN
    RAISE EXCEPTION 'O link de indicacao encurtado (short_url) e gerado pela B2W e nao pode ser alterado aqui.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.cpf_cnpj IS DISTINCT FROM OLD.cpf_cnpj THEN
    RAISE EXCEPTION 'O CPF/CNPJ do embaixador so pode ser corrigido pela equipe da B2W.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.cargo IS DISTINCT FROM OLD.cargo THEN
    RAISE EXCEPTION 'O cargo do embaixador e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.lider_id IS DISTINCT FROM OLD.lider_id THEN
    RAISE EXCEPTION 'O lider do embaixador e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_valor IS DISTINCT FROM OLD.licenca_valor THEN
    RAISE EXCEPTION 'O valor da licenca e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_vencimento IS DISTINCT FROM OLD.licenca_vencimento THEN
    RAISE EXCEPTION 'O vencimento da licenca e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_paga_em IS DISTINCT FROM OLD.licenca_paga_em THEN
    RAISE EXCEPTION 'O pagamento da licenca e registrado pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_voucher_id IS DISTINCT FROM OLD.licenca_voucher_id THEN
    RAISE EXCEPTION 'O voucher da licenca e aplicado pela B2W.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'A situacao (ativo) do embaixador e definida pela B2W e nao pode ser alterada pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

-- Recalcula os 13 originadores de hoje (todos isentos: preco 0).
UPDATE public.originators_v2 SET licenca_preco = licenca_preco;

-- --------------------------------------------------------------- 4. motor
CREATE OR REPLACE FUNCTION public.fn_participantes_recompensa(p_uc uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ou        record;
  v_uc        record;
  v_orig      record;
  v_lider     record;
  v_ref       record;
  v_ref_sub   uuid;
  v_saltos    integer := 0;
  v_nivel     integer;
  v_em_dia    boolean;
  v_res       jsonb := '[]'::jsonb;
  -- F2: status de assinante que RECEBEM recorrencia. Lista explicita para o
  -- proximo leitor estender (decisao do dono, 28/09/2026: ativo_inadimplente
  -- NAO recebe enquanto estiver em atraso; o valor e absorvido pela B2W).
  c_status_recebe constant text[] := ARRAY['ativo'];
BEGIN
  IF p_uc IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT cu.id, cu.tipo_unidade, cu.indicado_por_uc_id,
         s.id AS subscriber_id, s.originator_id,
         s.indicador_assinante_id
    INTO v_uc
    FROM public.consumer_units cu
    JOIN public.subscribers s ON s.id = cu.subscriber_id
   WHERE cu.id = p_uc;

  IF NOT FOUND OR v_uc.tipo_unidade IS NOT DISTINCT FROM 'geradora' THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_uc.indicador_assinante_id IS NOT NULL THEN
    IF v_uc.indicador_assinante_id = v_uc.subscriber_id THEN
      RAISE WARNING 'fn_participantes_recompensa: assinante % indica a si mesmo (UC %); ignorando a indicacao', v_uc.subscriber_id, p_uc;
    ELSE
      v_ref_sub := v_uc.indicador_assinante_id;

      WITH RECURSIVE cadeia(sub_id, saltos) AS (
        SELECT s.indicador_assinante_id, 1
          FROM public.subscribers s
         WHERE s.id = v_uc.subscriber_id AND s.indicador_assinante_id IS NOT NULL
        UNION ALL
        SELECT s.indicador_assinante_id, cadeia.saltos + 1
          FROM cadeia
          JOIN public.subscribers s ON s.id = cadeia.sub_id
         WHERE s.indicador_assinante_id IS NOT NULL
           AND cadeia.saltos < 50
      )
      SELECT COALESCE(max(saltos), 0) INTO v_saltos FROM cadeia;
    END IF;
  ELSIF v_uc.indicado_por_uc_id IS NOT NULL THEN
    SELECT cu2.subscriber_id INTO v_ref_sub
      FROM public.consumer_units cu2
     WHERE cu2.id = v_uc.indicado_por_uc_id;

    IF v_ref_sub IS NOT NULL AND v_ref_sub = v_uc.subscriber_id THEN
      v_ref_sub := NULL;
    END IF;

    IF v_ref_sub IS NOT NULL THEN
      WITH RECURSIVE cadeia(uc_id, saltos) AS (
        SELECT c.indicado_por_uc_id, 1
          FROM public.consumer_units c
         WHERE c.id = p_uc AND c.indicado_por_uc_id IS NOT NULL
        UNION ALL
        SELECT c.indicado_por_uc_id, cadeia.saltos + 1
          FROM cadeia
          JOIN public.consumer_units c ON c.id = cadeia.uc_id
         WHERE c.indicado_por_uc_id IS NOT NULL
           AND cadeia.saltos < 50
      )
      SELECT COALESCE(max(saltos), 0) INTO v_saltos FROM cadeia;
    END IF;
  END IF;

  IF v_saltos >= 50 THEN
    RAISE WARNING 'fn_participantes_recompensa: cadeia de indicacao da UC % atingiu o teto de 50 saltos (ciclo em dado legado?)', p_uc;
  END IF;

  v_nivel := 1 + v_saltos;

  IF v_uc.originator_id IS NOT NULL THEN
    SELECT o.id, o.cargo, o.lider_id, o.ativo,
           o.licenca_status, o.licenca_paga_em, o.licenca_vencimento
      INTO v_orig
      FROM public.originators_v2 o
     WHERE o.id = v_uc.originator_id;

    IF FOUND THEN
      -- Licenca pendente ou vencida: recebe como PPF (dono, 13/11/2026).
      v_em_dia := public.fn_licenca_em_dia(v_orig.licenca_status, v_orig.licenca_paga_em, v_orig.licenca_vencimento);

      IF v_orig.cargo = 'lider' AND v_em_dia THEN
        v_res := v_res || jsonb_build_object(
          'papel', 'lider', 'id', v_orig.id, 'nivel', v_nivel,
          'suspenso', NOT v_orig.ativo
        );
      ELSE
        v_res := v_res || jsonb_build_object(
          'papel', CASE WHEN v_em_dia THEN v_orig.cargo ELSE 'ppf' END,
          'id', v_orig.id, 'nivel', v_nivel,
          'suspenso', NOT v_orig.ativo
        );

        IF v_orig.cargo <> 'lider' AND v_orig.lider_id IS NOT NULL AND v_orig.lider_id <> v_orig.id THEN
          SELECT l.id, l.ativo, l.licenca_status, l.licenca_paga_em, l.licenca_vencimento INTO v_lider
            FROM public.originators_v2 l
           WHERE l.id = v_orig.lider_id AND l.cargo = 'lider';

          IF FOUND THEN
            v_res := v_res || jsonb_build_object(
              'papel', 'lider', 'id', v_lider.id, 'nivel', v_nivel,
              'suspenso', (NOT v_lider.ativo)
                          OR NOT public.fn_licenca_em_dia(v_lider.licenca_status, v_lider.licenca_paga_em, v_lider.licenca_vencimento)
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ref_sub IS NOT NULL THEN
    SELECT s2.id, s2.status INTO v_ref
      FROM public.subscribers s2
     WHERE s2.id = v_ref_sub;

    IF FOUND THEN
      v_res := v_res || jsonb_build_object(
        'papel', 'assinante_conect', 'id', v_ref.id, 'nivel', 1,
        'suspenso', NOT (v_ref.status::text = ANY (c_status_recebe))
      );
    END IF;
  END IF;

  -- Plano de Usina (spec 2026-10-06 secao 2): quem trouxe a USINA -- o
  -- originador do FORNECEDOR dela (decisao 6b). Entra sempre que o plano da
  -- usina preve percentual; sem originador, com ele inativo ou com a usina
  -- sem fornecedor, entra suspenso e o motor manda o valor para a B2W
  -- (associacao), como em toda supressao.
  SELECT s.originator_id AS originador_id, pu.originador_recorrente_pct, o.ativo,
         pu.originador_lider_recorrente_pct, o.lider_id, ol.cargo AS lider_cargo, ol.ativo AS lider_ativo,
         ol.licenca_status AS lider_lic_status, ol.licenca_paga_em AS lider_lic_paga_em,
         ol.licenca_vencimento AS lider_lic_vencimento
    INTO v_ou
    FROM public.consumer_units cu
    JOIN public.usinas u        ON u.id = cu.usina_id
    JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
    LEFT JOIN public.suppliers s      ON s.id = u.supplier_id
    LEFT JOIN public.originators_v2 o ON o.id = s.originator_id
    LEFT JOIN public.originators_v2 ol ON ol.id = o.lider_id
   WHERE cu.id = p_uc;

  IF FOUND AND COALESCE(v_ou.originador_recorrente_pct, 0) > 0 THEN
    v_res := v_res || jsonb_build_object(
      'papel', 'originador_usina', 'id', v_ou.originador_id, 'nivel', 1,
      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;

  -- Adendo 10/10/2026 (decisao 13): o Lider do originador do fornecedor.
  -- So vale lider_id com cargo 'lider' (regra F3 do assinante); sem Lider
  -- valido e ativo -- e, desde 13/11/2026, com a licenca em dia -- entra
  -- suspenso e o motor trata como cota sem dono (decisao 12: so vai a B2W se
  -- couber).
  IF FOUND AND COALESCE(v_ou.originador_lider_recorrente_pct, 0) > 0 THEN
    v_res := v_res || jsonb_build_object(
      'papel', 'lider_originador_usina',
      'id', CASE WHEN v_ou.lider_cargo = 'lider' AND v_ou.lider_id IS DISTINCT FROM v_ou.originador_id THEN v_ou.lider_id END,
      'nivel', 1,
      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
                  OR v_ou.lider_id IS NULL OR v_ou.lider_id = v_ou.originador_id OR v_ou.lider_cargo IS DISTINCT FROM 'lider'
                  OR NOT COALESCE(v_ou.lider_ativo, false)
                  OR NOT public.fn_licenca_em_dia(v_ou.lider_lic_status, v_ou.lider_lic_paga_em, v_ou.lider_lic_vencimento)
    );
  END IF;

  RETURN v_res;
END;
$function$;
