-- Plano de Usina -- adendo de 10/10/2026 (spec secao 6), decisoes 12 e 13.
--  * 13: o Lider do originador do fornecedor recebe originador_lider_recorrente_pct
--    (papel lider_originador_usina, nivel 1, so recorrencia);
--  * 12: cota de usina sem dono (originador ou Lider dele ausente/inativo) nao
--    engorda a B2W antes do corte: fica na fila, e a PRIMEIRA a ser cortada,
--    e so o que sobrar vai a B2W. As demais supressoes continuam como estao.
-- fn_participantes_recompensa e handle_invoice_paid_ledger sao PATCHADAS sobre
-- o corpo vivo atras de trava de md5 (mesmo padrao da 20261006g).

-- ---------------------------------------------------------------------------
-- 0. Travas de md5 (corpos vivos em 10/10/2026, conferidos na Task 9)
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_participantes_recompensa(uuid)'::regprocedure))
       <> '81895914cfb58b20c764ca129d2bd07c' THEN
        RAISE EXCEPTION 'fn_participantes_recompensa mudou desde 10/10/2026: re-derivar o patch';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure))
       <> '60ee6b0152cd3181845ea4e0dcc90963' THEN
        RAISE EXCEPTION 'fn_calcular_split_recompensa mudou desde 10/10/2026: re-derivar a substituicao';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_invoice_paid_ledger()'::regprocedure))
       <> '1211633a8ad91bd473a2f4abdf0c8109' THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger mudou desde 10/10/2026: re-derivar o patch';
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. fn_regras_recompensa_uc: injeta lider_originador_usina na matriz
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
  IF v_pu.id IS NOT NULL THEN
    v_gestao := v_pu.percentual_recorrente;
    IF jsonb_typeof(v_matriz #> '{b2w,niveis}') = 'object' THEN
      v_pct := v_pu.percentual_recorrente::text;
      v_matriz := jsonb_set(v_matriz, '{b2w}', jsonb_build_object(
        'niveis', jsonb_build_object('L1', v_pct, 'L2', v_pct, 'L3', v_pct, 'L4', v_pct),
        'max_niveis', 4));

      -- quem esta ligado ao FORNECEDOR: so nivel 1, nao e multinivel.
      IF v_pu.originador_recorrente_pct > 0 THEN
        v_matriz := v_matriz || jsonb_build_object('originador_usina', jsonb_build_object(
          'niveis', jsonb_build_object('L1', v_pu.originador_recorrente_pct::text,
                                       'L2', '0', 'L3', '0', 'L4', '0'),
          'max_niveis', 1));
      END IF;
      IF v_pu.originador_lider_recorrente_pct > 0 THEN
        v_matriz := v_matriz || jsonb_build_object('lider_originador_usina', jsonb_build_object(
          'niveis', jsonb_build_object('L1', v_pu.originador_lider_recorrente_pct::text,
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
-- 2. fn_participantes_recompensa: o participante lider_originador_usina
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.fn_participantes_recompensa(uuid)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$  SELECT s.originator_id AS originador_id, pu.originador_recorrente_pct, o.ativo
    INTO v_ou$de$,
         $para$  SELECT s.originator_id AS originador_id, pu.originador_recorrente_pct, o.ativo,
         pu.originador_lider_recorrente_pct, o.lider_id, ol.cargo AS lider_cargo, ol.ativo AS lider_ativo
    INTO v_ou$para$),
        ($de$    LEFT JOIN public.originators_v2 o ON o.id = s.originator_id
   WHERE cu.id = p_uc;$de$,
         $para$    LEFT JOIN public.originators_v2 o ON o.id = s.originator_id
    LEFT JOIN public.originators_v2 ol ON ol.id = o.lider_id
   WHERE cu.id = p_uc;$para$),
        ($de$      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;$de$,
         $para$      'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
    );
  END IF;

  -- Adendo 10/10/2026 (decisao 13): o Lider do originador do fornecedor.
  -- So vale lider_id com cargo 'lider' (regra F3 do assinante); sem Lider
  -- valido e ativo, entra suspenso e o motor trata como cota sem dono
  -- (decisao 12: so vai a B2W se couber).
  IF FOUND AND COALESCE(v_ou.originador_lider_recorrente_pct, 0) > 0 THEN
    v_res := v_res || jsonb_build_object(
      'papel', 'lider_originador_usina',
      'id', CASE WHEN v_ou.lider_cargo = 'lider' THEN v_ou.lider_id END,
      'nivel', 1,
      'suspenso', v_ou.lider_id IS NULL OR v_ou.lider_cargo IS DISTINCT FROM 'lider'
                  OR NOT COALESCE(v_ou.lider_ativo, false)
    );
  END IF;$para$)
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
-- 3. fn_calcular_split_recompensa: papel novo, ordem de corte, cota sem dono
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_split_recompensa(p_base numeric, p_teto_deducao numeric, p_regras jsonb, p_participantes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_n_orig_usina     int;
  v_n_lider_usina    int;
  v_pct_b2w          numeric;
  v_valor_b2w        numeric;
  v_valor_absorvido  numeric := 0;
  v_pct_absorvido    numeric := 0;
  v_beneficiarios    jsonb := '[]'::jsonb;
  v_item             jsonb;
  v_papel            text;
  v_nivel            int;
  v_suspenso         boolean;
  v_pct              numeric;
  v_valor            numeric;
  v_max_niveis       int;
  v_total_bruto      numeric;
  v_excesso          numeric;
  v_corte_aplicado   numeric := 0;
  v_arr              jsonb[];
  v_idx              int;
  v_cat              text;
  v_cut              numeric;
  v_valor_atual      numeric;
  v_cortado_atual    numeric;
  v_total_deduzido   numeric;
  v_teto_estourado   boolean;
  v_n_parceiro       int;
  v_n_lider          int;
  v_n_conect         int;
  v_resto            numeric;
  v_pct_resto        numeric;
BEGIN
  -- Guarda de contrato (F1/F2/F5): entrada invalida estoura erro em vez de
  -- produzir um numero silenciosamente errado.
  IF p_base IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_base nao pode ser NULL (base ausente nao e o mesmo que base zero)';
  END IF;

  IF p_teto_deducao IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_teto_deducao nao pode ser NULL (teto ausente nao e o mesmo que teto zero -- viraria trava anti-deficit sempre aberta)';
  END IF;

  IF p_regras #> '{b2w,niveis}' IS NULL THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_regras precisa da chave b2w.niveis (a B2W sempre recebe; regra ausente nao pode zerar ela em silencio)';
  END IF;

  -- F7: no maximo um participante por categoria.
  SELECT
    count(*) FILTER (WHERE elem->>'papel' IN ('ppe', 'ppp', 'ppf')),
    count(*) FILTER (WHERE elem->>'papel' = 'lider'),
    count(*) FILTER (WHERE elem->>'papel' = 'assinante_conect'),
    count(*) FILTER (WHERE elem->>'papel' = 'originador_usina'),
    count(*) FILTER (WHERE elem->>'papel' = 'lider_originador_usina')
    INTO v_n_parceiro, v_n_lider, v_n_conect, v_n_orig_usina, v_n_lider_usina
    FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) elem;

  IF v_n_parceiro > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "parceiro" (ppe|ppp|ppf sao o mesmo agente indicador em niveis diferentes e nunca coexistem no mesmo pagamento) -- isso e bug de quem montou a lista, nao um caso de negocio', v_n_parceiro;
  END IF;

  IF v_n_lider > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "lider" -- so pode haver um por pagamento, isso e bug de quem montou a lista, nao um caso de negocio', v_n_lider;
  END IF;

  IF v_n_conect > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "assinante_conect" -- so pode haver um por pagamento, isso e bug de quem montou a lista, nao um caso de negocio', v_n_conect;
  END IF;

  IF v_n_orig_usina > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "originador_usina" -- uma usina tem um so originador, isso e bug de quem montou a lista, nao um caso de negocio', v_n_orig_usina;
  END IF;

  IF v_n_lider_usina > 1 THEN
    RAISE EXCEPTION 'fn_calcular_split_recompensa: p_participantes tem % participantes na categoria "lider_originador_usina" -- o originador da usina tem um so Lider, isso e bug de quem montou a lista, nao um caso de negocio', v_n_lider_usina;
  END IF;

  -- F3: base sempre com 2 casas ja na entrada.
  p_base := round(p_base, 2);

  -- base <= 0: nada a partilhar, tudo zerado, fornecedor fica com a base.
  IF p_base <= 0 THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'papel', elem->>'papel',
               'id', elem->'id',
               'nivel', (elem->>'nivel')::int,
               'pct', 0,
               'valor', 0,
               'cortado', 0
             )
           ), '[]'::jsonb)
      INTO v_beneficiarios
      FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb)) elem;

    RETURN jsonb_build_object(
      'b2w', jsonb_build_object('pct', 0, 'valor', 0, 'pct_absorvido', 0, 'valor_absorvido', 0),
      'beneficiarios', v_beneficiarios,
      'total_deduzido', 0,
      'corte_aplicado', 0,
      'fornecedor', p_base,
      'teto_estourado', (0::numeric > p_teto_deducao)
    );
  END IF;

  v_pct_b2w := GREATEST(COALESCE((p_regras #>> ARRAY['b2w','niveis','L1'])::numeric, 0), 0);
  v_valor_b2w := round(p_base * v_pct_b2w / 100, 2);

  -- 1a passada: um item por participante, com pct/valor brutos.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_participantes, '[]'::jsonb))
  LOOP
    v_papel    := v_item->>'papel';
    v_nivel    := NULLIF(v_item->>'nivel', '')::int;
    v_suspenso := COALESCE((v_item->>'suspenso')::boolean, false);
    v_max_niveis := COALESCE((p_regras #>> ARRAY[v_papel, 'max_niveis'])::int, 0);

    IF v_nivel IS NULL OR v_nivel > v_max_niveis THEN
      v_pct := 0;
    ELSE
      v_pct := GREATEST(COALESCE((p_regras #>> ARRAY[v_papel, 'niveis', 'L' || v_nivel])::numeric, 0), 0);
    END IF;

    v_valor := round(p_base * v_pct / 100, 2);

    IF v_suspenso AND v_papel IN ('originador_usina', 'lider_originador_usina') THEN
      -- Decisao 12 (10/10/2026): cota de usina sem dono fica na fila de
      -- corte (e a primeira) e so o que sobrar vai a B2W, depois do corte.
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', v_pct, 'valor', v_valor, 'cortado', 0, 'para_b2w', true
      );
    ELSIF v_suspenso THEN
      -- demais supressoes: percentual e valor vao para a B2W (nunca ao fornecedor)
      v_pct_absorvido   := v_pct_absorvido + v_pct;
      v_valor_absorvido := v_valor_absorvido + v_valor;
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', 0, 'valor', 0, 'cortado', 0
      );
    ELSE
      v_beneficiarios := v_beneficiarios || jsonb_build_object(
        'papel', v_papel, 'id', v_item->'id', 'nivel', v_nivel,
        'pct', v_pct, 'valor', v_valor, 'cortado', 0
      );
    END IF;
  END LOOP;

  -- F4: pct e valor da B2W sao sempre o TOTAL que ela recebe.
  v_valor_b2w := v_valor_b2w + v_valor_absorvido;
  v_pct_b2w   := v_pct_b2w + v_pct_absorvido;

  -- a cota de usina sem dono entra no bruto pela lista de beneficiarios
  SELECT v_valor_b2w + COALESCE(SUM((b->>'valor')::numeric), 0)
    INTO v_total_bruto
    FROM jsonb_array_elements(v_beneficiarios) b;

  -- trava anti-deficit: corta na ordem originador_usina -> lider_originador_usina
  -- -> assinante_conect -> parceiro -> lider. B2W nunca e alvo do corte.
  IF v_total_bruto > p_teto_deducao THEN
    v_excesso := v_total_bruto - p_teto_deducao;

    SELECT array_agg(elem ORDER BY ord)
      INTO v_arr
      FROM jsonb_array_elements(v_beneficiarios) WITH ORDINALITY AS t(elem, ord);

    FOR v_cat IN SELECT unnest(ARRAY['originador_usina', 'lider_originador_usina', 'assinante_conect', 'parceiro', 'lider'])
    LOOP
      EXIT WHEN v_excesso <= 0;

      FOR v_idx IN 1 .. COALESCE(array_length(v_arr, 1), 0)
      LOOP
        EXIT WHEN v_excesso <= 0;

        v_papel := v_arr[v_idx] ->> 'papel';
        CONTINUE WHEN NOT (
          (v_cat = 'originador_usina'       AND v_papel = 'originador_usina') OR
          (v_cat = 'lider_originador_usina' AND v_papel = 'lider_originador_usina') OR
          (v_cat = 'assinante_conect'       AND v_papel = 'assinante_conect') OR
          (v_cat = 'parceiro'               AND v_papel IN ('ppe', 'ppp', 'ppf')) OR
          (v_cat = 'lider'                  AND v_papel = 'lider')
        );

        v_valor_atual := (v_arr[v_idx] ->> 'valor')::numeric;
        CONTINUE WHEN v_valor_atual <= 0;

        v_cut := LEAST(v_valor_atual, v_excesso);
        v_cortado_atual := (v_arr[v_idx] ->> 'cortado')::numeric + v_cut;

        v_arr[v_idx] := jsonb_set(
          jsonb_set(v_arr[v_idx], '{valor}', to_jsonb(v_valor_atual - v_cut)),
          '{cortado}', to_jsonb(v_cortado_atual)
        );

        v_excesso        := v_excesso - v_cut;
        v_corte_aplicado := v_corte_aplicado + v_cut;
      END LOOP;
    END LOOP;

    SELECT jsonb_agg(elem ORDER BY ord)
      INTO v_beneficiarios
      FROM unnest(v_arr) WITH ORDINALITY AS t(elem, ord);
  END IF;

  -- Decisao 12: o que sobrou da cota de usina sem dono vai a B2W. O total
  -- nao muda (sai da lista e entra na B2W); o beneficiario fica com valor 0
  -- e registra em absorvido_b2w quanto foi para a associacao.
  SELECT array_agg(elem ORDER BY ord)
    INTO v_arr
    FROM jsonb_array_elements(v_beneficiarios) WITH ORDINALITY AS t(elem, ord);

  FOR v_idx IN 1 .. COALESCE(array_length(v_arr, 1), 0)
  LOOP
    CONTINUE WHEN NOT COALESCE((v_arr[v_idx] ->> 'para_b2w')::boolean, false);

    v_resto := (v_arr[v_idx] ->> 'valor')::numeric;
    IF v_resto > 0 THEN
      v_pct_resto := CASE WHEN (v_arr[v_idx] ->> 'cortado')::numeric = 0
                          THEN (v_arr[v_idx] ->> 'pct')::numeric
                          ELSE round((v_arr[v_idx] ->> 'pct')::numeric * v_resto
                                     / (v_resto + (v_arr[v_idx] ->> 'cortado')::numeric), 4) END;
      v_valor_absorvido := v_valor_absorvido + v_resto;
      v_pct_absorvido   := v_pct_absorvido + v_pct_resto;
      v_valor_b2w       := v_valor_b2w + v_resto;
      v_pct_b2w         := v_pct_b2w + v_pct_resto;
    END IF;

    v_arr[v_idx] := (v_arr[v_idx] - 'para_b2w')
                    || jsonb_build_object('pct', 0, 'valor', 0, 'absorvido_b2w', v_resto);
  END LOOP;

  v_beneficiarios := COALESCE(
    (SELECT jsonb_agg(elem ORDER BY ord) FROM unnest(v_arr) WITH ORDINALITY AS t(elem, ord)),
    '[]'::jsonb);

  v_total_deduzido := v_total_bruto - v_corte_aplicado;
  v_teto_estourado := (v_total_deduzido > p_teto_deducao);

  RETURN jsonb_build_object(
    'b2w', jsonb_build_object(
      'pct', v_pct_b2w,
      'valor', v_valor_b2w,
      'pct_absorvido', v_pct_absorvido,
      'valor_absorvido', v_valor_absorvido
    ),
    'beneficiarios', v_beneficiarios,
    'total_deduzido', v_total_deduzido,
    'corte_aplicado', v_corte_aplicado,
    'fornecedor', p_base - v_total_deduzido,
    'teto_estourado', v_teto_estourado
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. handle_invoice_paid_ledger: conta, rotulo, Start e versao
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.handle_invoice_paid_ledger()'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider', 'originador_usina') THEN$de$,
         $para$ELSIF v_ben_papel IN ('ppe', 'ppp', 'ppf', 'lider', 'originador_usina', 'lider_originador_usina') THEN$para$),
        ($de$WHEN 'originador_usina' THEN 'Originador da Usina'$de$,
         $para$WHEN 'originador_usina' THEN 'Originador da Usina'
                                      WHEN 'lider_originador_usina' THEN 'Líder do Originador da Usina'$para$),
        ($de$AND v_ben_papel <> 'originador_usina'$de$,
         $para$AND v_ben_papel NOT IN ('originador_usina', 'lider_originador_usina')$para$),
        ($de$ELSIF v_papel_key = 'originador_usina' THEN$de$,
         $para$ELSIF v_papel_key IN ('originador_usina', 'lider_originador_usina') THEN$para$),
        ($de$'originador_usina', v_matriz -> 'originador_usina');$de$,
         $para$v_papel_key, v_matriz -> v_papel_key);$para$),
        ($de$'originador_usina', v_matriz -> 'originador_usina'));$de$,
         $para$'originador_usina', v_matriz -> 'originador_usina',
                    'lider_originador_usina', v_matriz -> 'lider_originador_usina'));$para$)
    ) AS t(de, para)
    LOOP
        v_n := (length(d) - length(replace(d, v_par.de, ''))) / length(v_par.de);
        IF v_n <> 1 THEN
            RAISE EXCEPTION 'handle_invoice_paid_ledger: ancora achada % vezes (esperado 1): %', v_n, left(v_par.de, 80);
        END IF;
        d := replace(d, v_par.de, v_par.para);
    END LOOP;

    v_n := (length(d) - length(replace(d, '''20261006g_originador_usina''', '')))
           / length('''20261006g_originador_usina''');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'handle_invoice_paid_ledger: versao achada % vezes (esperado 2)', v_n;
    END IF;
    d := replace(d, '''20261006g_originador_usina''', '''20261010_plano_usina_adendo''');

    EXECUTE d;
END
$patch$;
