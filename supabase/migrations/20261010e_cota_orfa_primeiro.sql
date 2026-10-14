-- Plano de Usina -- adendo de 10/10/2026, fix round 1 da Task 11.
--  * I1: a cota de usina sem dono (para_b2w) e a PRIMEIRA a ser cortada, antes de
--    qualquer pessoa real: ninguem paga para uma cota sem dono ir a B2W (decisao 12).
--  * M6: originador cujo lider_id aponta para ele mesmo nao tem Lider valido.
--  * M1: o COMMENT da funcao do motor refletia a ordem de corte antiga.
-- Patch sobre o corpo vivo atras de trava de md5 (mesmo padrao da 20261010b).

-- ---------------------------------------------------------------------------
-- 0. Travas de md5 (corpos vivos apos a 20261010b)
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure))
       <> '04b90f1f0d57ae2ee6f20fff389a07e7' THEN
        RAISE EXCEPTION 'fn_calcular_split_recompensa mudou desde a 20261010b: re-derivar o patch';
    END IF;
    IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_participantes_recompensa(uuid)'::regprocedure))
       <> '16ab6d702a2e7b8fa1ccd59ed992731a' THEN
        RAISE EXCEPTION 'fn_participantes_recompensa mudou desde a 20261010b: re-derivar o patch';
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. fn_calcular_split_recompensa: cota sem dono primeiro na fila de corte
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$unnest(ARRAY['originador_usina', 'lider_originador_usina', 'assinante_conect', 'parceiro', 'lider'])$de$,
         $para$unnest(ARRAY['cota_orfa_usina', 'originador_usina', 'lider_originador_usina', 'assinante_conect', 'parceiro', 'lider'])$para$),
        ($de$(v_cat = 'originador_usina'       AND v_papel = 'originador_usina') OR$de$,
         $para$(v_cat = 'cota_orfa_usina'        AND COALESCE((v_arr[v_idx] ->> 'para_b2w')::boolean, false)) OR
          (v_cat = 'originador_usina'       AND v_papel = 'originador_usina') OR$para$),
        ($de$-- trava anti-deficit: corta na ordem originador_usina -> lider_originador_usina$de$,
         $para$-- trava anti-deficit: corta primeiro a cota de usina sem dono (decisao 12), depois originador_usina -> lider_originador_usina$para$)
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
-- 2. fn_participantes_recompensa: lider_id = o proprio originador nao e Lider
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
    d     text;
    v_par record;
    v_n   int;
BEGIN
    d := pg_get_functiondef('public.fn_participantes_recompensa(uuid)'::regprocedure);

    FOR v_par IN SELECT * FROM (VALUES
        ($de$'id', CASE WHEN v_ou.lider_cargo = 'lider' THEN v_ou.lider_id END,$de$,
         $para$'id', CASE WHEN v_ou.lider_cargo = 'lider' AND v_ou.lider_id IS DISTINCT FROM v_ou.originador_id THEN v_ou.lider_id END,$para$),
        ($de$'suspenso', v_ou.lider_id IS NULL OR v_ou.lider_cargo IS DISTINCT FROM 'lider'$de$,
         $para$'suspenso', v_ou.lider_id IS NULL OR v_ou.lider_id = v_ou.originador_id OR v_ou.lider_cargo IS DISTINCT FROM 'lider'$para$)
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
-- 3. COMMENT da funcao do motor
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.fn_calcular_split_recompensa(numeric, numeric, jsonb, jsonb) IS 'Motor puro do split. B2W nunca e cortada; pct e valor da B2W sao totais (nominal + absorvido). Supressoes do lado do assinante vao inteiras a B2W antes do corte. Cota de usina sem dono (originador_usina / lider_originador_usina suspensos) entra na fila de corte e e a PRIMEIRA cortada; so o que sobrar vai a B2W (decisao 12, 10/10/2026). Ordem de corte: cota de usina sem dono -> originador_usina -> lider_originador_usina -> assinante_conect -> parceiro (ppe|ppp|ppf) -> lider. Fornecedor = base - total_deduzido.';
