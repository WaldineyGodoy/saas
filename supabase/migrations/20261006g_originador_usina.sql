-- Plano de Usina -- o originador que trouxe a usina vira o papel
-- originador_usina no split. Spec: docs/superpowers/specs/2026-10-06-plano-usina-design.md (secao 2).
--
--  * percentual em planos_usina.originador_recorrente_pct (decisao do dono,
--    06/10/2026: a regra mora no plano da usina); QUEM e o originador mora no
--    fornecedor (suppliers.originator_id, decisao de 07/10/2026);
--  * sem originador vinculado ou com originador inativo: entra suspenso e a
--    parte fica para a associacao (B2W), como em toda supressao;
--  * recebe em toda fatura paga, inclusive em plano start e na fatura do Start;
--  * e o PRIMEIRO da ordem de corte; a B2W continua nunca cortada.
--
-- As tres funcoes sao PATCHADAS sobre o corpo vivo (pg_get_functiondef +
-- replace + EXECUTE), cada uma atras de uma trava de md5: o gatilho foi
-- alterado direto no banco em 06/10/2026 por 20261006a_abatimento_credito_indicacao
-- (branch app-v1.3) e nao e mais o do arquivo 20260930b.

-- ---------------------------------------------------------------------------
-- 0. fn_regras_recompensa_uc: injeta originador_usina na matriz
-- ---------------------------------------------------------------------------
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

      -- originador_usina: so nivel 1, nao e multinivel.
      IF v_pu.originador_recorrente_pct > 0 THEN
        v_matriz := v_matriz || jsonb_build_object('originador_usina', jsonb_build_object(
          'niveis', jsonb_build_object('L1', v_pu.originador_recorrente_pct::text,
                                       'L2', '0', 'L3', '0', 'L4', '0'),
          'max_niveis', 1));
      END IF;
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

-- ---------------------------------------------------------------------------
-- 1. fn_participantes_recompensa: o participante originador_usina
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_participantes_recompensa(uuid)'::regprocedure))
       <> 'da355ffe5bd41a5e9a017a7f345a333b' THEN
        RAISE EXCEPTION 'fn_participantes_recompensa mudou desde 06/10/2026: re-derivar o patch antes de aplicar';
    END IF;

    d := pg_get_functiondef('public.fn_participantes_recompensa(uuid)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$DECLARE
$de$, $para$DECLARE
  v_ou        record;
$para$),
        ($de$  RETURN v_res;
END;$de$, $para$  -- Plano de Usina (spec 2026-10-06 secao 2): quem trouxe a USINA -- o
  -- originador do FORNECEDOR dela (decisao 6b). Entra sempre que o plano da
  -- usina preve percentual; sem originador, com ele inativo ou com a usina
  -- sem fornecedor, entra suspenso e o motor manda o valor para a B2W
  -- (associacao), como em toda supressao.
  SELECT s.originator_id AS originador_id, pu.originador_recorrente_pct, o.ativo
    INTO v_ou
    FROM public.consumer_units cu
    JOIN public.usinas u        ON u.id = cu.usina_id
    JOIN public.planos_usina pu ON pu.id = u.plano_usina_id
    LEFT JOIN public.suppliers s      ON s.id = u.supplier_id
    LEFT JOIN public.originators_v2 o ON o.id = s.originator_id
   WHERE cu.id = p_uc;

  IF FOUND AND COALESCE(v_ou.originador_recorrente_pct, 0) > 0 THEN
    v_res := v_res || jsonb_build_object(
      'papel', 'originador_usina', 'id', v_ou.originador_id, 'nivel', 1,
      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;

  RETURN v_res;
END;$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'fn_participantes_recompensa: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    EXECUTE d;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 2. fn_calcular_split_recompensa: guarda de um por pagamento e ordem de corte
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF md5((SELECT prosrc FROM pg_proc
             WHERE oid = 'public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure))
       <> 'e7890b3e191d2921801afcfc5e3d51c9' THEN
        RAISE EXCEPTION 'fn_calcular_split_recompensa mudou desde 06/10/2026: re-derivar o patch antes de aplicar';
    END IF;

    d := pg_get_functiondef('public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$DECLARE
$de$, $para$DECLARE
  v_n_orig_usina     int;
$para$),
        ($de$    INTO v_n_parceiro, v_n_lider, v_n_conect$de$,
         $para$    ,count(*) FILTER (WHERE elem->>'papel' = 'originador_usina')
    INTO v_n_parceiro, v_n_lider, v_n_conect, v_n_orig_usina$para$),
        ($de$', v_n_conect;
  END IF;$de$, $para$', v_n_conect;
  END IF;

  -- Plano de Usina: uma usina tem um so originador.
  IF v_n_orig_usina > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "originador_usina" -- uma usina tem um so originador, isso e bug de quem montou a lista, nao um caso de negocio', v_n_orig_usina;
  END IF;$para$),
        ($de$unnest(ARRAY['assinante_conect', 'parceiro', 'lider'])$de$,
         $para$unnest(ARRAY['originador_usina', 'assinante_conect', 'parceiro', 'lider'])$para$),
        ($de$(v_cat = 'assinante_conect' AND v_papel = 'assinante_conect') OR$de$,
         $para$(v_cat = 'originador_usina' AND v_papel = 'originador_usina') OR
          (v_cat = 'assinante_conect' AND v_papel = 'assinante_conect') OR$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'fn_calcular_split_recompensa: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    EXECUTE d;
END
$patch$;

-- ---------------------------------------------------------------------------
-- 3. handle_invoice_paid_ledger: conta, Start e congelamento
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_invoice_paid_ledger()'::regprocedure))
       <> 'e8efea563e729bf482dedb0a4a71c759' THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger mudou desde 06/10/2026: re-derivar o patch antes de aplicar';
    END IF;

    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        -- 3a. o papel vai para 2.1.2, como parceiro e lider
        ($de$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider') THEN$de$,
         $para$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider', 'originador_usina') THEN$para$),
        ($de$WHEN 'lider' THEN 'Líder'$de$,
         $para$WHEN 'lider' THEN 'Líder'
                                      WHEN 'originador_usina' THEN 'Originador da Usina'$para$),
        -- 3b. o lancamento dele nunca se chama "Bonus Start"
        ($de$CASE WHEN v_caminho = 'bonus_start' AND v_ben_nivel = '1'$de$,
         $para$CASE WHEN v_caminho = 'bonus_start' AND v_ben_nivel = '1' AND v_ben_papel <> 'originador_usina'$para$),
        -- 3c. fatura do Start: copia a entrada da matriz, o start_config nao fala dele
        ($de$'max_niveis', 4));
                    ELSE$de$,
         $para$'max_niveis', 4));
                    ELSIF v_papel_key = 'originador_usina' THEN
                        -- Plano de Usina (decisao 9): quem trouxe a USINA
                        -- recebe a recorrencia tambem na fatura do Start.
                        v_matriz_efetiva := v_matriz_efetiva || jsonb_build_object(
                            'originador_usina', v_matriz -> 'originador_usina');
                    ELSE$para$),
        -- 3d. plano start fora da janela: b2w + originador da usina
        ($de$v_matriz_efetiva := jsonb_build_object('b2w', v_matriz -> 'b2w');$de$,
         $para$-- Plano de Usina (decisao 9): o originador da usina recebe mesmo
                -- em plano start fora da janela.
                v_matriz_efetiva := jsonb_strip_nulls(jsonb_build_object(
                    'b2w', v_matriz -> 'b2w',
                    'originador_usina', v_matriz -> 'originador_usina'));$para$),
        -- 3e. congelamento
        ($de$v_plano -> 'plano_id',$de$,
         $para$v_plano -> 'plano_id',
            'plano_usina_id',        v_plano -> 'plano_usina_id',
            'percentual_recorrente', v_plano -> 'percentual_recorrente',$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    -- 3f. versao gravada no congelamento (aparece duas vezes)
    v_n := (length(d) - length(replace(d, '''20260929f_conta_receber_assinante''', '')))
           / length('''20260929f_conta_receber_assinante''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20260929f_conta_receber_assinante''', '''20261006g_originador_usina''');

    EXECUTE d;
END
$patch$;
