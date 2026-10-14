-- Task 5, fix round 1: fn_participantes_recompensa passa a ler a indicacao de
-- subscribers.indicador_assinante_id (fonte da verdade, definida pela sessao do
-- link do Assinante Conect), com consumer_units.indicado_por_uc_id so como
-- fallback legado. Mesma assinatura, CREATE OR REPLACE.
--
-- F1: fonte = subscribers.indicador_assinante_id.
-- F2: lista explicita de status que recebem (so 'ativo').
-- F3: lider_id so vira participante 'lider' se o alvo tem cargo = 'lider'.
-- minors: RAISE WARNING no teto de 50 saltos; autoindicacao ignorada.

CREATE OR REPLACE FUNCTION public.fn_participantes_recompensa(p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uc        record;
  v_orig      record;
  v_lider     record;
  v_ref       record;
  v_ref_sub   uuid;                       -- assinante indicador imediato (Conect)
  v_saltos    integer := 0;
  v_nivel     integer;
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

  -- UC inexistente, sem assinante ou geradora: ninguem recebe.
  IF NOT FOUND OR v_uc.tipo_unidade IS NOT DISTINCT FROM 'geradora' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- ---- Indicacao: fonte = assinante; fallback = UC (legado/manual) ------
  IF v_uc.indicador_assinante_id IS NOT NULL THEN
    IF v_uc.indicador_assinante_id = v_uc.subscriber_id THEN
      -- autoindicacao (o gatilho recusa; dado antigo): trata como sem indicacao
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
    -- fallback: cadeia de UCs
    SELECT cu2.subscriber_id INTO v_ref_sub
      FROM public.consumer_units cu2
     WHERE cu2.id = v_uc.indicado_por_uc_id;

    IF v_ref_sub IS NOT NULL AND v_ref_sub = v_uc.subscriber_id THEN
      v_ref_sub := NULL;                  -- UC indicada por UC do mesmo assinante
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
        -- nunca o licenca_status gravado. Sem vencimento = isenta = paga.
        v_res := v_res || jsonb_build_object(
          'papel', v_orig.cargo, 'id', v_orig.id, 'nivel', v_nivel,
          'suspenso', (NOT v_orig.ativo)
                      OR (v_orig.cargo = 'ppp'
                          AND v_orig.licenca_vencimento IS NOT NULL
                          AND v_orig.licenca_vencimento < current_date)
        );

        -- F3: so vira 'lider' quem tem cargo = 'lider'.
        IF v_orig.lider_id IS NOT NULL AND v_orig.lider_id <> v_orig.id THEN
          SELECT l.id, l.ativo INTO v_lider
            FROM public.originators_v2 l
           WHERE l.id = v_orig.lider_id AND l.cargo = 'lider';

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

  -- ---- Assinante Conect (indicador imediato) ----------------------------
  -- Independe do originador. Sempre nivel 1.
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

  RETURN v_res;
END;
$fn$;

COMMENT ON FUNCTION public.fn_participantes_recompensa(uuid) IS
  'Quem recebe na fatura desta UC: [{papel,id,nivel,suspenso}], no maximo um por categoria (parceiro ppe|ppp|ppf, lider, assinante_conect), pronto para fn_calcular_split_recompensa. FONTE DA INDICACAO: subscribers.indicador_assinante_id do assinante da UC (Conect = esse indicador imediato; nivel do parceiro/lider = 1 + saltos na cadeia de assinantes, teto 50); FALLBACK LEGADO: so quando o assinante nao tem indicador, usa consumer_units.indicado_por_uc_id (dono da UC indicadora e cadeia de UCs). Autoindicacao e ignorada; teto de 50 saltos emite RAISE WARNING. assinante_conect sempre nivel 1. suspenso:true (entra, nao some; o motor manda o percentual para a B2W): originador/lider com ativo=false, PPP com licenca_vencimento < current_date (sem vencimento = isenta, paga), assinante do Conect com status fora de c_status_recebe (hoje so ativo; ativo_inadimplente NAO recebe). So gera participante lider quem tem cargo=lider (lider_id apontando para outro cargo e ignorado). UC geradora, sem assinante ou inexistente: []. Sem originador: sem parceiro nem lider (o Conect continua). Originador de cargo lider vendendo direto entra como lider. id do assinante_conect = subscribers.id; dos demais = originators_v2.id.';

REVOKE EXECUTE ON FUNCTION public.fn_participantes_recompensa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_participantes_recompensa(uuid) TO service_role;
