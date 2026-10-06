-- =====================================================================
-- Cadastro pelo app e indicacao (link/QR) -- banco
-- Data: 06/10/2026 · branch app-v1.3 · plano: docs/plano-indicacao-app.md
--
-- O app (nativo e webapp em apps.b2wenergia.com.br) passa a aceitar login
-- NOVO, criado pela propria pessoa. Antes de abrir isso, duas correcoes:
--
-- 1. handle_new_user ligava o ORIGINADOR pelo e-mail no momento em que o
--    login nascia -- antes da confirmacao do e-mail. Com cadastro aberto,
--    qualquer um criaria um login com o e-mail de um parceiro e trocaria o
--    id dele (originators_v2.id), levando a carteira junto. Agora o
--    originador e ligado como assinante e fornecedor ja eram: so com o
--    e-mail confirmado (fn_vincular_cadastros_do_login).
--
-- 2. A troca de id do originador (o jeito como o login se liga a ele)
--    depende de ON UPDATE CASCADE em quem aponta para originators_v2.
--    lead_visitas (20261006b), eletropostos, o historico de cargo e o
--    lider_id nao tinham: o primeiro login de um parceiro com visitas
--    registradas falharia.
--
-- Depois: o lead do app fica ligado ao login (leads.user_id), a indicacao
-- e confirmada pelo primeiro nome de quem indicou, e o app_perfil diz se o
-- login ainda nao tem produto nenhum (e mostra a pergunta da indicacao).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ON UPDATE CASCADE para o id do originador
-- ---------------------------------------------------------------------
ALTER TABLE public.lead_visitas DROP CONSTRAINT IF EXISTS lead_visitas_originator_id_fkey;
ALTER TABLE public.lead_visitas ADD CONSTRAINT lead_visitas_originator_id_fkey
  FOREIGN KEY (originator_id) REFERENCES public.originators_v2(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.eletropostos DROP CONSTRAINT IF EXISTS eletropostos_originator_id_fkey;
ALTER TABLE public.eletropostos ADD CONSTRAINT eletropostos_originator_id_fkey
  FOREIGN KEY (originator_id) REFERENCES public.originators_v2(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.originator_cargo_history DROP CONSTRAINT IF EXISTS originator_cargo_history_originator_id_fkey;
ALTER TABLE public.originator_cargo_history ADD CONSTRAINT originator_cargo_history_originator_id_fkey
  FOREIGN KEY (originator_id) REFERENCES public.originators_v2(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.originators_v2 DROP CONSTRAINT IF EXISTS originators_v2_lider_id_fkey;
ALTER TABLE public.originators_v2 ADD CONSTRAINT originators_v2_lider_id_fkey
  FOREIGN KEY (lider_id) REFERENCES public.originators_v2(id) ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- 2. Ligacao login <-> cadastros so com e-mail confirmado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_vincular_cadastros_do_login(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
    v_email text;
begin
    select u.email into v_email
      from auth.users u
     where u.id = p_user and u.email_confirmed_at is not null;

    if v_email is null or public.fn_login_confirmado_por_email(v_email) is distinct from p_user then
        return;
    end if;

    update public.subscribers set user_id = p_user
     where user_id is null and lower(btrim(email)) = lower(btrim(v_email));

    update public.suppliers set user_id = p_user
     where user_id is null and lower(btrim(email)) = lower(btrim(v_email));

    -- Originador: o id dele vira o do login (era o que handle_new_user fazia,
    -- mas sem exigir confirmacao). So se ainda nao estiver ligado a um login.
    update public.originators_v2 o set id = p_user
     where lower(btrim(o.email)) = lower(btrim(v_email))
       and o.id <> p_user
       and not exists (select 1 from auth.users u where u.id = o.id);

    -- Papel: login que nasceu 'lead' sobe para o cadastro que ganhou.
    update public.profiles p
       set role = case
             when exists (select 1 from public.originators_v2 o where o.id = p_user) then 'originator'
             when exists (select 1 from public.subscribers s where s.user_id = p_user) then 'subscriber'
             when exists (select 1 from public.suppliers s where s.user_id = p_user) then 'supplier'
             else p.role end::public.user_role
     where p.id = p_user and p.role = 'lead';
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    matched_role TEXT := 'lead';
    user_name TEXT;
BEGIN
    SET LOCAL search_path = public, auth;

    RAISE LOG 'Handle New User Started. Email: %, ID: %', NEW.email, NEW.id;

    user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email);

    -- Liga originador, assinante e fornecedor SO se o e-mail ja nasce
    -- confirmado (convite pelo CRM). Cadastro feito pela propria pessoa
    -- liga quando ela confirmar (on_auth_user_confirmed_vincula).
    PERFORM public.fn_vincular_cadastros_do_login(NEW.id);

    IF EXISTS (SELECT 1 FROM public.originators_v2 WHERE id = NEW.id) THEN
        matched_role := 'originator';
    ELSIF EXISTS (SELECT 1 FROM public.subscribers WHERE user_id = NEW.id) THEN
        matched_role := 'subscriber';
    ELSIF EXISTS (SELECT 1 FROM public.suppliers WHERE user_id = NEW.id) THEN
        matched_role := 'supplier';
    END IF;

    INSERT INTO public.profiles (id, email, name, role)
    VALUES (NEW.id, NEW.email, user_name, matched_role::public.user_role)
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        role = CASE
            WHEN profiles.role IS NULL THEN EXCLUDED.role
            ELSE profiles.role
        END;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RAISE;
END;
$function$;

-- Cadastro que ganha login depois (adesao feita por quem ja tinha conta no
-- app): o papel 'lead' sobe para assinante/fornecedor.
--
-- A protecao de papel (protect_profile_privileges) desfaz qualquer troca
-- feita DENTRO da sessao do usuario -- e e assim que deve ser. Por isso a
-- promocao tambem dispara na mudanca de status: a assinatura do contrato
-- chega pelo webhook do Autentique (sem sessao de usuario), e ai o papel
-- sobe. Na sessao do proprio usuario a tentativa e inofensiva (desfeita).
CREATE OR REPLACE FUNCTION public.fn_promover_papel_do_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET role = (CASE TG_TABLE_NAME WHEN 'subscribers' THEN 'subscriber' ELSE 'supplier' END)::public.user_role
     WHERE id = NEW.user_id AND role = 'lead';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_promover_papel_do_login() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_promover_papel_assinante ON public.subscribers;
CREATE TRIGGER trg_promover_papel_assinante
  AFTER INSERT OR UPDATE OF user_id, status ON public.subscribers
  FOR EACH ROW EXECUTE FUNCTION public.fn_promover_papel_do_login();
DROP TRIGGER IF EXISTS trg_promover_papel_fornecedor ON public.suppliers;
CREATE TRIGGER trg_promover_papel_fornecedor
  AFTER INSERT OR UPDATE OF user_id ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_promover_papel_do_login();

-- ---------------------------------------------------------------------
-- 3. Lead ligado ao login
-- ---------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON public.leads (user_id) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN public.leads.user_id IS
  'Login do app que gerou este lead (cadastro pelo app). Celular e e-mail vem da conta, nao de formulario.';

-- ---------------------------------------------------------------------
-- 4. Confirmar o indicador: so o primeiro nome
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_indicador_publico(p_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN s.id IS NULL THEN jsonb_build_object('valido', false)
    WHEN auth.uid() IS NOT NULL AND s.user_id = auth.uid() THEN jsonb_build_object('valido', false, 'motivo', 'proprio')
    ELSE jsonb_build_object('valido', true, 'id', s.id, 'primeiro_nome', split_part(btrim(s.name), ' ', 1))
  END
  FROM (SELECT NULL) x
  LEFT JOIN public.subscribers s
    ON s.id = CASE WHEN btrim(coalesce(p_id, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN btrim(p_id)::uuid END
   AND s.status IN ('contrato_assinado', 'ativo', 'ativo_inadimplente');
$$;
REVOKE EXECUTE ON FUNCTION public.fn_indicador_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_indicador_publico(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_indicador_publico(text) IS
  'Valida o id do link/QR de indicacao e devolve so o primeiro nome de quem indicou (o link ja traz esse nome). Recusa quem nao pode indicar e o proprio login.';

-- ---------------------------------------------------------------------
-- 5. Interesse registrado pelo app
-- ---------------------------------------------------------------------
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
  v_visita := public.fn_registrar_lead_publico(
    (coalesce(p_dados, '{}'::jsonb) - 'originator_id')
      || jsonb_build_object('email', v_email, 'indicador_assinante_id', v_ind ->> 'id'),
    CASE WHEN p_meio = 'qr' THEN 'qr' ELSE 'app' END);

  SELECT lead_id INTO v_lead FROM public.lead_visitas WHERE id = v_visita;
  UPDATE public.leads SET user_id = v_uid WHERE id = v_lead AND user_id IS NULL;

  RETURN v_visita;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_registrar_interesse(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_registrar_interesse(jsonb, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. app_perfil: login sem produto e o lead em andamento
-- ---------------------------------------------------------------------
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
                   (select split_part(btrim(s.name), ' ', 1) from subscribers s where s.id = l.indicador_assinante_id) as indicador_nome
              from leads l
             where l.user_id = auth.uid()
             order by l.updated_at desc nulls last limit 1) x)
    )
    from profiles p where p.id = auth.uid();
$function$;
