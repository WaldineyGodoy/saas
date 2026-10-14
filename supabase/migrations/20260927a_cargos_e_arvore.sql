-- Task 2 (Split de Pagamentos): cargos do embaixador, licenca do PPP e
-- arvore de indicacao entre UCs.
-- Spec: .superpowers/sdd/2026-09-27-split-de-pagamentos/task-2-brief.md
--
-- Decisao do dono, 27/09/2026: cargos sao lider|ppe|ppp|ppf, default ppf; os
-- 8 originadores existentes ficam em ppf; a suspensao por licenca vencida
-- (0% e o valor vai para a B2W) fica para o motor de pagamento (task futura)
-- — aqui so entram os dados e o `licenca_status` derivado.

-- ---------------------------------------------------------------------
-- 1. originators_v2: cargo, lider_id e licenca do PPP
-- ---------------------------------------------------------------------

-- `cargo` com DEFAULT constante: o ADD COLUMN preenche os 8 registros
-- existentes com 'ppf' sem disparar trigger por linha (fast path do
-- Postgres 11+ para default constante) — e exatamente o backfill pedido.
ALTER TABLE public.originators_v2
  ADD COLUMN IF NOT EXISTS cargo text NOT NULL DEFAULT 'ppf',
  ADD COLUMN IF NOT EXISTS lider_id uuid REFERENCES public.originators_v2(id),
  ADD COLUMN IF NOT EXISTS licenca_valor numeric,
  ADD COLUMN IF NOT EXISTS licenca_vencimento date,
  -- 'isenta' e o mesmo valor que o gatilho abaixo calcularia para quem nao
  -- tem licenca_vencimento (todo mundo, hoje) — os 8 existentes nascem
  -- coerentes com a regra sem precisar disparar o gatilho no backfill.
  ADD COLUMN IF NOT EXISTS licenca_status text NOT NULL DEFAULT 'isenta';

ALTER TABLE public.originators_v2 DROP CONSTRAINT IF EXISTS originators_v2_cargo_check;
ALTER TABLE public.originators_v2
  ADD CONSTRAINT originators_v2_cargo_check
  CHECK (cargo IN ('lider', 'ppe', 'ppp', 'ppf'));

ALTER TABLE public.originators_v2 DROP CONSTRAINT IF EXISTS originators_v2_licenca_status_check;
ALTER TABLE public.originators_v2
  ADD CONSTRAINT originators_v2_licenca_status_check
  CHECK (licenca_status IN ('ativa', 'vencida', 'isenta'));

CREATE INDEX IF NOT EXISTS idx_originators_v2_lider_id ON public.originators_v2 (lider_id);

COMMENT ON COLUMN public.originators_v2.cargo IS
  'Cargo no Plano de Recompensas: lider, ppe, ppp ou ppf (default). Promocao PPE->PPP e automatica por regra de negocio (motor de pagamento); rebaixamento nunca e automatico. So papel interno altera (fn_originador_guarda_campos_sensiveis).';
COMMENT ON COLUMN public.originators_v2.lider_id IS
  'Lider da rede deste originador (auto-FK em originators_v2). So papel interno altera.';
COMMENT ON COLUMN public.originators_v2.licenca_valor IS
  'Valor da licenca anual do PPP. So papel interno altera.';
COMMENT ON COLUMN public.originators_v2.licenca_vencimento IS
  'Vencimento da licenca anual do PPP. So papel interno altera; licenca_status e recalculado a partir daqui pelo gatilho trg_originador_licenca_status.';
COMMENT ON COLUMN public.originators_v2.licenca_status IS
  'Derivado por gatilho a partir de licenca_vencimento: NULL = isenta, vencimento >= hoje = ativa, vencimento < hoje = vencida. PPP com licenca vencida tem a recorrencia suspensa pelo motor de pagamento (decisao do dono, 27/09/2026) — esta coluna so guarda o dado, a suspensao fica para a task do motor.';

-- ---------------------------------------------------------------------
-- 2. Gatilho: deriva licenca_status a partir de licenca_vencimento
--
-- Roda em toda INSERT/UPDATE, ignorando o que foi submetido para a coluna
-- — nao precisa de guarda propria porque o valor final e sempre recalculado
-- aqui, por cima de qualquer coisa que tenha chegado em NEW.licenca_status.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_originador_licenca_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.licenca_vencimento IS NULL THEN
    NEW.licenca_status := 'isenta';
  ELSIF NEW.licenca_vencimento < current_date THEN
    NEW.licenca_status := 'vencida';
  ELSE
    NEW.licenca_status := 'ativa';
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_originador_licenca_status() IS
  'Recalcula originators_v2.licenca_status a partir de licenca_vencimento em toda INSERT/UPDATE: NULL = isenta, vencido = vencida, senao ativa.';

REVOKE EXECUTE ON FUNCTION public.fn_originador_licenca_status() FROM PUBLIC, anon, authenticated;

-- Nome depois de "trg_originador_guarda_campos" na ordem alfabetica: os
-- gatilhos BEFORE do Postgres disparam em ordem de nome, entao a guarda
-- (que pode barrar a troca de licenca_vencimento por quem nao e interno)
-- roda primeiro, e so depois este recalcula o status a partir do valor que
-- sobrou em NEW.
DROP TRIGGER IF EXISTS trg_originador_licenca_status ON public.originators_v2;
CREATE TRIGGER trg_originador_licenca_status
  BEFORE INSERT OR UPDATE ON public.originators_v2
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_originador_licenca_status();

-- ---------------------------------------------------------------------
-- 3. Estende a guarda existente (Task 15, 20260922f) — mesma funcao, sem
--    criar um segundo gatilho. cargo, lider_id e os campos de licenca
--    passam a seguir a mesma regra de split_commission/short_url/cpf_cnpj:
--    silenciosamente normalizados no INSERT, barrados com erro no UPDATE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_originador_guarda_campos_sensiveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Sem usuario na sessao = service role (Edge Functions), cron ou migracao.
  IF auth.uid() IS NULL OR public.fn_papel_interno() THEN
    RETURN NEW;
  END IF;

  -- OLD nao existe no INSERT; por isso o desvio por TG_OP antes de qualquer
  -- comparacao com OLD.
  IF TG_OP = 'INSERT' THEN
    NEW.split_commission := '{"start": 0, "recurrent": 0}'::jsonb;
    NEW.short_url := NULL;
    -- Cadastro publico legitimo nao manda cargo/lider_id/licenca; quem
    -- mandar (tentando se auto-promover) e normalizado em silencio, como
    -- ja acontece com split_commission/short_url acima.
    NEW.cargo := 'ppf';
    NEW.lider_id := NULL;
    NEW.licenca_valor := NULL;
    NEW.licenca_vencimento := NULL;
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
    RAISE EXCEPTION 'O valor da licenca do PPP e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_vencimento IS DISTINCT FROM OLD.licenca_vencimento THEN
    RAISE EXCEPTION 'O vencimento da licenca do PPP e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_originador_guarda_campos_sensiveis() IS
  'Quem nao e papel interno nem service role: no INSERT tem split_commission, short_url, cargo, lider_id e os campos de licenca normalizados em silencio; no UPDATE nao altera nenhum desses (nem id nem cpf_cnpj) — erro insufficient_privilege, inclusive na propria linha.';

-- O gatilho ja existe (BEFORE INSERT OR UPDATE, 20260922f); so a funcao mudou.

-- ---------------------------------------------------------------------
-- 4. Historico de troca de cargo
--
-- Vazia por enquanto: quem grava e a task do motor de promocao (PPE->PPP
-- automatico com 1000 assinantes ativos na rede). Aqui so a estrutura.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.originator_cargo_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  originator_id       uuid NOT NULL REFERENCES public.originators_v2(id) ON DELETE CASCADE,
  cargo_anterior      text,
  cargo_novo          text NOT NULL,
  motivo              text,
  assinantes_na_rede  integer,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  criado_por          uuid
);

CREATE INDEX IF NOT EXISTS idx_originator_cargo_history_originator_id
  ON public.originator_cargo_history (originator_id);

COMMENT ON TABLE public.originator_cargo_history IS
  'Trilha de troca de cargo do embaixador (lider/ppe/ppp/ppf). Gravada pelo motor de promocao/pela equipe interna, nunca pela tela do proprio embaixador.';

ALTER TABLE public.originator_cargo_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS originator_cargo_history_select_propria_ou_interno ON public.originator_cargo_history;
CREATE POLICY originator_cargo_history_select_propria_ou_interno
  ON public.originator_cargo_history FOR SELECT TO authenticated
  USING (originator_id = auth.uid() OR public.fn_papel_interno());

-- Sem policy de INSERT/UPDATE/DELETE para authenticated/anon: por enquanto
-- so service role (ou funcao SECURITY DEFINER de uma task futura) escreve.

-- ---------------------------------------------------------------------
-- 5. consumer_units: arvore de indicacao entre UCs
-- ---------------------------------------------------------------------
ALTER TABLE public.consumer_units
  ADD COLUMN IF NOT EXISTS indicado_por_uc_id uuid REFERENCES public.consumer_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_consumer_units_indicado_por_uc_id
  ON public.consumer_units (indicado_por_uc_id);

COMMENT ON COLUMN public.consumer_units.indicado_por_uc_id IS
  'UC que indicou esta UC (arvore de indicacao do Plano de Recompensas). ON DELETE SET NULL: apagar a UC indicadora nao apaga quem ela indicou. Guardado por fn_uc_sem_ciclo contra ciclos.';

-- ---------------------------------------------------------------------
-- 6. Gatilho: recusa ciclo na arvore de indicacao
--
-- Tres formas recusadas: UC apontando para ela mesma, UC apontando para
-- outra UC do mesmo assinante, e a cadeia (subindo indicado_por_uc_id)
-- reencontrando a propria UC — teto de 50 saltos para nao rodar para
-- sempre se algum dado antigo ja tiver um ciclo (nao deveria, mas o teto
-- e barato e evita depender disso).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_uc_sem_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cursor uuid;
  v_subscriber_indicadora uuid;
  v_hops integer := 0;
BEGIN
  IF NEW.indicado_por_uc_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.indicado_por_uc_id = NEW.id THEN
    RAISE EXCEPTION 'A UC % nao pode ser indicada por ela mesma.', NEW.id
      USING ERRCODE = '22023';
  END IF;

  SELECT subscriber_id INTO v_subscriber_indicadora
    FROM public.consumer_units WHERE id = NEW.indicado_por_uc_id;

  IF NEW.subscriber_id IS NOT NULL
     AND v_subscriber_indicadora IS NOT NULL
     AND v_subscriber_indicadora = NEW.subscriber_id THEN
    RAISE EXCEPTION 'A UC % nao pode ser indicada por outra UC do mesmo assinante.', NEW.id
      USING ERRCODE = '22023';
  END IF;

  -- Sobe a cadeia de indicado_por_uc_id procurando a propria UC de volta.
  v_cursor := NEW.indicado_por_uc_id;
  WHILE v_cursor IS NOT NULL AND v_hops < 50 LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'A cadeia de indicacao a partir da UC % formaria um ciclo.', NEW.id
        USING ERRCODE = '22023';
    END IF;
    SELECT indicado_por_uc_id INTO v_cursor FROM public.consumer_units WHERE id = v_cursor;
    v_hops := v_hops + 1;
  END LOOP;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.fn_uc_sem_ciclo() IS
  'Recusa (ERRCODE 22023) indicado_por_uc_id que aponte para a propria UC, para UC do mesmo assinante, ou que feche um ciclo subindo a cadeia (teto de 50 saltos).';

REVOKE EXECUTE ON FUNCTION public.fn_uc_sem_ciclo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_uc_sem_ciclo ON public.consumer_units;
CREATE TRIGGER trg_uc_sem_ciclo
  BEFORE INSERT OR UPDATE ON public.consumer_units
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_uc_sem_ciclo();
