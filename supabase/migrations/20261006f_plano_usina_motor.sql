-- Plano de Usina -- o motor do split passa a enxergar o plano da usina.
-- Spec: docs/superpowers/specs/2026-10-06-plano-usina-design.md (secao 2).
--
--  * plano de recompensas = COALESCE(UC.plano_assinatura_id,
--    planos_usina.plano_assinatura_id): o plano contratado na UC manda
--    (ConsumerUnitModal grava desde 03/10/2026; 22 UCs no Plano Premium);
--  * gestao B2W = planos_usina.percentual_recorrente, igual em todos os
--    niveis, quando a usina tem plano de usina -- "mesma cobranca" dos 10% da
--    B2W no split (decisao do dono, 06/10/2026);
--  * usinas.plano_assinatura_id sai: nunca foi preenchida e nenhum codigo do
--    main grava nela. Ficar com ela seria a segunda fonte do mesmo vinculo.

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.usinas WHERE plano_assinatura_id IS NOT NULL) THEN
        RAISE EXCEPTION 'usinas.plano_assinatura_id tem valor: migrar para plano de usina antes de remover a coluna';
    END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_plano_usina_da_uc(p_uc uuid)
RETURNS public.planos_usina
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT pu.*
    FROM public.consumer_units cu
    JOIN public.usinas u        ON u.id = cu.usina_id
    JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
   WHERE cu.id = p_uc;
$function$;

ALTER FUNCTION public.fn_plano_usina_da_uc(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_plano_usina_da_uc(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_plano_usina_da_uc(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_plano_da_uc(p_uc uuid)
RETURNS planos_assinatura_energia
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.*
    FROM public.consumer_units cu
    LEFT JOIN public.usinas u        ON u.id = cu.usina_id
    LEFT JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
    LEFT JOIN public.planos_assinatura_energia p
      ON p.id = COALESCE(cu.plano_assinatura_id, pu.plano_assinatura_id)
   WHERE cu.id = p_uc;
$function$;

CREATE OR REPLACE FUNCTION public.fn_regras_recompensa_uc(p_uc uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plano  public.planos_assinatura_energia;
  v_pu     public.planos_usina;
  v_matriz jsonb;
  v_gestao numeric;
  v_pct    text;
BEGIN
  v_plano := public.fn_plano_da_uc(p_uc);

  IF v_plano.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_pu     := public.fn_plano_usina_da_uc(p_uc);
  v_matriz := v_plano.recorrente_config -> 'regras_multinivel';
  v_gestao := v_plano.gestao_percentual;

  -- Plano de Usina: a gestao B2W e o percentual_recorrente do plano da
  -- usina, igual em todos os niveis. So sobrescreve matriz VALIDA: sem
  -- b2w.niveis objeto, o gatilho tem de continuar caindo em plano_sem_matriz.
  -- Texto, como na matriz gravada pela tela ("10"), para o congelamento
  -- comparar igual.
  IF v_pu.id IS NOT NULL THEN
    v_gestao := v_pu.percentual_recorrente;
    IF jsonb_typeof(v_matriz #> '{b2w,niveis}') = 'object' THEN
      v_pct := v_pu.percentual_recorrente::text;
      v_matriz := jsonb_set(v_matriz, '{b2w}', jsonb_build_object(
        'niveis', jsonb_build_object('L1', v_pct, 'L2', v_pct, 'L3', v_pct, 'L4', v_pct),
        'max_niveis', 4));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'plano_id', v_plano.id,
    'plano_usina_id', v_pu.id,
    'percentual_recorrente', v_pu.percentual_recorrente,
    'tipo_recompensa', v_plano.tipo_recompensa,
    'gestao_pct', v_gestao,
    'piso_pct', v_plano.piso_fornecedor_pct,
    'desconto_pct', v_plano.desconto_assinante,
    'modalidade', v_plano.modalidade,
    'regras_multinivel', v_matriz,
    'start_config', v_plano.start_config
  );
END;
$function$;

ALTER TABLE public.usinas DROP COLUMN plano_assinatura_id;
