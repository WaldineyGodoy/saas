-- Task 5 (Split de Pagamentos): resolve QUEM recebe numa fatura, olhando a
-- arvore de indicacao entre UCs. Alimenta fn_calcular_split_recompensa.
--
-- 1) originators_v2.ativo -- o originador NAO tinha nenhuma coluna de estado
--    (so cargo/lider_id/licenca_*), entao "originador inativo" nao era
--    representavel. Default true: os 8 existentes seguem ativos. Protegida
--    pela mesma guarda de campos sensiveis (embaixador nao se reativa).
-- 2) fn_participantes_recompensa(p_uc) -> [{papel, id, nivel, suspenso}]

-- ---------------------------------------------------------------------
-- 1. originators_v2.ativo
-- ---------------------------------------------------------------------
ALTER TABLE public.originators_v2
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.originators_v2.ativo IS
  'false = originador (parceiro ou lider) desligado da rede: continua na arvore, mas fn_participantes_recompensa o devolve com suspenso:true e o percentual dele vai para a B2W. Definido so pela B2W (guarda de campos sensiveis).';

CREATE OR REPLACE FUNCTION public.fn_originador_guarda_campos_sensiveis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- Cadastro publico legitimo nao manda cargo/lider_id/licenca/ativo; quem
    -- mandar (tentando se auto-promover) e normalizado em silencio, como
    -- ja acontece com split_commission/short_url acima.
    NEW.cargo := 'ppf';
    NEW.lider_id := NULL;
    NEW.licenca_valor := NULL;
    NEW.licenca_vencimento := NULL;
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
    RAISE EXCEPTION 'O valor da licenca do PPP e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.licenca_vencimento IS DISTINCT FROM OLD.licenca_vencimento THEN
    RAISE EXCEPTION 'O vencimento da licenca do PPP e definido pela B2W e nao pode ser alterado pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    RAISE EXCEPTION 'A situacao (ativo) do embaixador e definida pela B2W e nao pode ser alterada pelo proprio embaixador.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. fn_participantes_recompensa
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_participantes_recompensa(p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uc      record;
  v_orig    record;
  v_lider   record;
  v_ref     record;
  v_saltos  integer := 0;
  v_nivel   integer;
  v_res     jsonb := '[]'::jsonb;
BEGIN
  IF p_uc IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT cu.id, cu.tipo_unidade, cu.indicado_por_uc_id,
         s.id AS subscriber_id, s.originator_id
    INTO v_uc
    FROM public.consumer_units cu
    JOIN public.subscribers s ON s.id = cu.subscriber_id
   WHERE cu.id = p_uc;

  -- UC inexistente, sem assinante ou geradora: ninguem recebe.
  IF NOT FOUND OR v_uc.tipo_unidade IS NOT DISTINCT FROM 'geradora' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Saltos ate a raiz da cadeia de indicacao (teto de 50; o gatilho
  -- fn_uc_sem_ciclo ja recusa ciclo, o teto so protege de dado antigo ruim).
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

  -- Nivel RELATIVO a quem recebe: 1 sem indicacao, 2 com um salto, ...
  v_nivel := 1 + v_saltos;

  -- ---- Parceiro e Lider (originador do assinante) ----------------------
  IF v_uc.originator_id IS NOT NULL THEN
    SELECT o.id, o.cargo, o.lider_id, o.ativo, o.licenca_vencimento
      INTO v_orig
      FROM public.originators_v2 o
     WHERE o.id = v_uc.originator_id;

    IF FOUND THEN
      IF v_orig.cargo = 'lider' THEN
        -- Lider vendendo direto: recebe como lider (uma vez so), sem
        -- parceiro e sem procurar lider acima dele.
        v_res := v_res || jsonb_build_object(
          'papel', 'lider', 'id', v_orig.id, 'nivel', v_nivel,
          'suspenso', NOT v_orig.ativo
        );
      ELSE
        -- PPP com licenca vencida: suspenso. Compara o vencimento com hoje,
        -- nunca o licenca_status gravado (so reflete a ultima escrita da
        -- linha e envelhece).
        v_res := v_res || jsonb_build_object(
          'papel', v_orig.cargo, 'id', v_orig.id, 'nivel', v_nivel,
          'suspenso', (NOT v_orig.ativo)
                      OR (v_orig.cargo = 'ppp'
                          AND v_orig.licenca_vencimento IS NOT NULL
                          AND v_orig.licenca_vencimento < current_date)
        );

        IF v_orig.lider_id IS NOT NULL AND v_orig.lider_id <> v_orig.id THEN
          SELECT l.id, l.ativo INTO v_lider
            FROM public.originators_v2 l
           WHERE l.id = v_orig.lider_id;

          IF FOUND THEN
            v_res := v_res || jsonb_build_object(
              'papel', 'lider', 'id', v_lider.id, 'nivel', v_nivel,
              'suspenso', NOT v_lider.ativo
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ---- Assinante Conect (dono da UC indicadora) -------------------------
  -- Independe do originador. Sempre nivel 1.
  IF v_uc.indicado_por_uc_id IS NOT NULL THEN
    SELECT s2.id, s2.status
      INTO v_ref
      FROM public.consumer_units cu2
      JOIN public.subscribers s2 ON s2.id = cu2.subscriber_id
     WHERE cu2.id = v_uc.indicado_por_uc_id;

    IF FOUND AND v_ref.id <> v_uc.subscriber_id THEN
      v_res := v_res || jsonb_build_object(
        'papel', 'assinante_conect', 'id', v_ref.id, 'nivel', 1,
        'suspenso', v_ref.status IS DISTINCT FROM 'ativo'
      );
    END IF;
  END IF;

  RETURN v_res;
END;
$fn$;

COMMENT ON FUNCTION public.fn_participantes_recompensa(uuid) IS
  'Quem recebe na fatura desta UC: [{papel,id,nivel,suspenso}], no maximo um por categoria (parceiro ppe|ppp|ppf, lider, assinante_conect), pronto para fn_calcular_split_recompensa. Nivel do parceiro/lider = 1 + saltos em indicado_por_uc_id (teto 50); assinante_conect sempre nivel 1 e dono da UC indicadora. suspenso:true (entra, nao some; o motor manda o percentual para a B2W): originador/lider com ativo=false, PPP com licenca_vencimento < current_date, assinante do Conect com status <> ativo. UC geradora, sem assinante ou inexistente: []. Sem originador: sem parceiro nem lider (o Conect continua). Originador de cargo lider vendendo direto entra como lider. id do assinante_conect = subscribers.id; dos demais = originators_v2.id.';

REVOKE EXECUTE ON FUNCTION public.fn_participantes_recompensa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_participantes_recompensa(uuid) TO service_role;
