-- =====================================================================
-- App: o convite do originador também vale no cadastro pelo app
-- (decisão do dono, 11/10/2026).
--
-- Até aqui o app só entendia o link do assinante que indica
-- (?indicador=<subscribers.id>, crédito na fatura). O link do originador
-- (/convite/?name=..&id=<originators_v2.id>, comissão) era recusado como
-- "link inválido", e o lead nascia sem originador: a comissão se perdia.
--
-- Agora o mesmo código (link, QR ou /i/<id>) pode ser dos dois:
--   - assinante ativo   -> indicador_assinante_id (como antes);
--   - originador ativo  -> originator_id do lead, pela mesma regra de
--     "último link vale" e da trava pelo contrato do site
--     (fn_registrar_lead_publico, 20261006b).
-- Os ids são uuid de tabelas diferentes; o assinante tem precedência.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_indicador_publico(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH alvo AS (
    SELECT CASE WHEN btrim(coalesce(p_id, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN lower(btrim(p_id))::uuid END AS id
  ), quem AS (
    SELECT s.id, s.name, s.user_id AS dono, 'assinante'::text AS tipo, 1 AS ordem
      FROM public.subscribers s, alvo
     WHERE s.id = alvo.id AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente')
    UNION ALL
    -- O id do originador vira o id do login dele quando ele entra no app.
    SELECT o.id, o.name, o.id, 'originador', 2
      FROM public.originators_v2 o, alvo
     WHERE o.id = alvo.id AND o.ativo IS DISTINCT FROM false
  )
  SELECT CASE
    WHEN q.id IS NULL THEN jsonb_build_object('valido', false)
    WHEN auth.uid() IS NOT NULL AND q.dono = auth.uid() THEN jsonb_build_object('valido', false, 'motivo', 'proprio')
    ELSE jsonb_build_object('valido', true, 'id', q.id, 'tipo', q.tipo, 'primeiro_nome', split_part(btrim(q.name), ' ', 1))
  END
  FROM (SELECT NULL) x
  LEFT JOIN LATERAL (SELECT * FROM quem ORDER BY ordem LIMIT 1) q ON true;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_indicador_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_indicador_publico(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_indicador_publico(text) IS
  'Valida o id do link/QR (assinante que indica ou originador) e devolve so o primeiro nome e o tipo. Recusa quem nao pode indicar e o proprio login.';

CREATE OR REPLACE FUNCTION public.app_registrar_interesse(
  p_dados jsonb,
  p_indicador text DEFAULT NULL,
  p_meio text DEFAULT 'app')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_ind jsonb;
  v_visita uuid;
  v_lead uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre na sua conta para continuar.' USING ERRCODE = '42501';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirme seu e-mail para continuar.' USING ERRCODE = '42501';
  END IF;
  IF public.fn_app_subscriber_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Voce ja e assinante B2W.' USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_indicador, '')), '') IS NOT NULL THEN
    v_ind := public.fn_indicador_publico(p_indicador);
    IF NOT coalesce((v_ind ->> 'valido')::boolean, false) THEN
      RAISE EXCEPTION 'Este link de indicacao nao e valido.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Mesma trava e mesma regra de ultimo link do site; o e-mail e o da conta.
  -- O originador so entra pelo link validado acima, nunca pelo p_dados.
  v_visita := public.fn_registrar_lead_publico(
    (coalesce(p_dados, '{}'::jsonb) - 'originator_id' - 'indicador_assinante_id')
      || jsonb_build_object('email', v_email)
      || CASE v_ind ->> 'tipo'
           WHEN 'assinante'  THEN jsonb_build_object('indicador_assinante_id', v_ind ->> 'id')
           WHEN 'originador' THEN jsonb_build_object('originator_id', v_ind ->> 'id')
           ELSE '{}'::jsonb
         END,
    CASE WHEN p_meio = 'qr' THEN 'qr' ELSE 'app' END);

  SELECT lead_id INTO v_lead FROM public.lead_visitas WHERE id = v_visita;
  UPDATE public.leads SET user_id = v_uid WHERE id = v_lead AND user_id IS NULL;

  RETURN v_visita;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_registrar_interesse(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_registrar_interesse(jsonb, text, text) TO authenticated;

-- app_perfil: o card "indicação registrada" mostra também o originador.
CREATE OR REPLACE FUNCTION public.app_perfil()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    select jsonb_build_object(
        'id', auth.uid(),
        'name', coalesce(p.name, ''),
        'email', p.email,
        'role', p.role,
        'subscriber', (select to_jsonb(x) from (
            select s.id, s.name, s.status, s.short_url
              from subscribers s where s.id = fn_app_subscriber_id()) x),
        'supplier', (select to_jsonb(x) from (
            select s.id, s.name
              from suppliers s where s.id = fn_app_supplier_id()) x),
        'originator', exists (select 1 from originators_v2 o where o.id = auth.uid()),
        -- Login sem nenhum produto (D, 06/10/2026): o app pergunta a indicacao.
        'sem_produto', fn_app_subscriber_id() is null
                       and fn_app_supplier_id() is null
                       and not exists (select 1 from originators_v2 o where o.id = auth.uid())
                       and coalesce(p.role::text, 'lead') = 'lead',
        'lead', (select to_jsonb(x) from (
            select l.id, l.status,
                   coalesce(
                     (select split_part(btrim(s.name), ' ', 1) from subscribers s where s.id = l.indicador_assinante_id),
                     (select split_part(btrim(o.name), ' ', 1) from originators_v2 o where o.id = l.originator_id)
                   ) as indicador_nome
              from leads l
             where l.user_id = auth.uid()
             order by l.updated_at desc nulls last limit 1) x)
    )
    from profiles p where p.id = auth.uid();
$function$;
