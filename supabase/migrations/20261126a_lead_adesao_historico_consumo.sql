-- Adesao publica: o historico da conta lida chegava ao banco so pela media.
--
-- fn_lead_adesao devolvia da conta do lead apenas `mediaKwh`; a tela usava a
-- MEDIA como franquia e nao tinha o historico para mandar a fn_criar_assinante_publico
-- (que ja grava o perfil de 12 meses e a mediana quando o item de p_ucs traz
-- `historico`, migracao 20261112b). Resultado: UC criada sem historico_consumo,
-- sem consumo_mediano_kwh e com franquia = media (um mes fora da curva a
-- arrasta: 1.408 contra 599 de mediana na conta da UC 960.129.032-01).
--
-- Agora o ramo "id de lead" devolve tambem `medianaKwh` e `historico`.
-- O ramo "id de visita" (v.dados) fica como estava.

CREATE OR REPLACE FUNCTION public.fn_lead_adesao(p_lead uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    -- Id de visita: so o que a propria pessoa digitou naquela vez.
    SELECT v.dados
      FROM public.lead_visitas v
      JOIN public.leads l ON l.id = v.lead_id
     WHERE v.id = p_lead
       AND l.status NOT IN ('ativacao', 'ativo', 'pago', 'negocio_perdido')
    UNION ALL
    -- Id de lead: link gerado pela equipe no CRM (comportamento anterior).
    SELECT jsonb_build_object(
        'name', l.name, 'email', l.email, 'phone', l.phone,
        'cep', l.cep, 'rua', l.rua, 'numero', l.numero, 'complemento', l.complemento,
        'bairro', l.bairro, 'cidade', l.cidade, 'uf', l.uf,
        'concessionaria', l.concessionaria, 'consumo_kwh', l.consumo_kwh,
        'uc', CASE WHEN l.conta_lida IS NULL THEN NULL ELSE jsonb_build_object(
            'numeroUc', l.conta_lida ->> 'numeroUc',
            'titular', l.conta_lida ->> 'titular',
            'ligacao', l.conta_lida ->> 'ligacao',
            'mediaKwh', l.conta_lida -> 'mediaKwh',
            'medianaKwh', l.conta_lida -> 'medianaKwh',
            'historico', CASE WHEN jsonb_typeof(l.conta_lida -> 'historico') = 'array'
                              THEN l.conta_lida -> 'historico' END,
            'endereco', l.conta_lida -> 'endereco'
        ) END
    )
      FROM public.leads l
     WHERE l.id = p_lead
       AND l.solicitante_assinante_id IS NULL
       AND l.status NOT IN ('ativacao', 'ativo', 'pago', 'negocio_perdido')
    LIMIT 1;
$function$;
