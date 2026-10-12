-- Lider do originador da usina so recebe com o originador ativo (decisao do
-- dono, 12/10/2026: "o lider deve incentivar o originador a ficar ativo").
-- Originador ausente ou inativo -> a cota do Lider entra suspensa e vira cota
-- sem dono (decisao 12: primeira cortada; so vai a B2W se couber).
-- Patch com ancora unica sobre o corpo vivo de fn_participantes_recompensa.

DO $patch$
DECLARE
    c_de   constant text := $de$'suspenso', v_ou.lider_id IS NULL OR v_ou.lider_id = v_ou.originador_id$de$;
    c_para constant text := $para$'suspenso', v_ou.originador_id IS NULL OR NOT COALESCE(v_ou.ativo, false)
                  OR v_ou.lider_id IS NULL OR v_ou.lider_id = v_ou.originador_id$para$;
    d   text;
    v_n integer;
BEGIN
    d := pg_get_functiondef('public.fn_participantes_recompensa(uuid)'::regprocedure);
    v_n := (length(d) - length(replace(d, c_de, ''))) / length(c_de);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'fn_participantes_recompensa: ancora achada % vezes (esperado 1)', v_n;
    END IF;
    EXECUTE replace(d, c_de, c_para);
END
$patch$;
