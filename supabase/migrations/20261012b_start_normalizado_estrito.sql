-- Fix round 2 da Task 12: o Start normalizado distingue chave ausente / vazio /
-- texto de zero. O motor trata b2w ausente ou '' diferente de 0 (cai na matriz),
-- entao tirar a chave ou trocar por '' muda dinheiro e a trava tem de ver.
-- Por papel e por fatura:
--   ausente              -> JSON null
--   numero ou texto que vira numero (" 5.5", ".5", "60") -> o numero
--   qualquer outra coisa ('' , 'abc', null, ...)         -> o valor cru
-- O shape numerico da tela (mesmos numeros + chaves legadas extras) segue passando.

CREATE OR REPLACE FUNCTION public.fn_start_regra_valor(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF p IS NULL THEN
        RETURN 'null'::jsonb;
    END IF;
    IF jsonb_typeof(p) = 'string' THEN
        BEGIN
            RETURN to_jsonb((p #>> '{}')::numeric);
        EXCEPTION WHEN others THEN
            RETURN p;
        END;
    END IF;
    RETURN p;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_start_regra_valor(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_start_regra_valor(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_plano_start_normalizado(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
    SELECT jsonb_build_object(
        'faturas_elegiveis', p -> 'faturas_elegiveis',
        'regras', COALESCE(
            CASE WHEN jsonb_typeof(p -> 'regras') = 'object' THEN
                (SELECT jsonb_object_agg(e.key,
                    CASE WHEN jsonb_typeof(e.value) = 'object' THEN
                        jsonb_build_object(
                            'b2w',              public.fn_start_regra_valor(e.value -> 'b2w'),
                            'lider',            public.fn_start_regra_valor(e.value -> 'lider'),
                            'ppe',              public.fn_start_regra_valor(e.value -> 'ppe'),
                            'ppp',              public.fn_start_regra_valor(e.value -> 'ppp'),
                            'ppf',              public.fn_start_regra_valor(e.value -> 'ppf'),
                            'assinante_conect', public.fn_start_regra_valor(e.value -> 'assinante_conect'))
                    ELSE e.value END)
                   FROM jsonb_each(p -> 'regras') e)
            END,
            '{}'::jsonb))
$function$;
