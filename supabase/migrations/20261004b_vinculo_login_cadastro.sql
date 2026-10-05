-- Vinculo login -> cadastro (subscribers.user_id / suppliers.user_id) pelo e-mail.
--
-- Antes: so' o handle_new_user vinculava, e so' no instante em que o login
-- nascia. Tres falhas:
--   1. Cadastro criado DEPOIS do login nunca era vinculado.
--   2. Comparacao de e-mail sensivel a maiusculas.
--   3. E-mail que tambem era de originador nao vinculava assinante nem
--      fornecedor (o IF NOT is_originator pulava os dois).
--
-- Agora o vinculo acontece nos dois sentidos (login novo e cadastro novo ou
-- com e-mail alterado), sem diferenciar maiusculas, e SO' com e-mail
-- confirmado: sem isso, quem se cadastrasse com o e-mail de um assinante
-- passaria a ver os dados dele no app.
--
-- Nunca sobrescreve um user_id ja' preenchido. Trocar um vinculo errado e'
-- decisao manual.

-- ---------------------------------------------------------------------------
-- Login confirmado com este e-mail (um so'; ambiguo -> nenhum)
-- ---------------------------------------------------------------------------
create or replace function public.fn_login_confirmado_por_email(p_email text)
returns uuid
language sql stable security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
    select case when count(*) = 1 then min(u.id::text)::uuid end
      from auth.users u
     where lower(u.email) = lower(btrim(p_email))
       and u.email_confirmed_at is not null
       and nullif(btrim(p_email), '') is not null;
$$;

revoke all on function public.fn_login_confirmado_por_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vincula todos os cadastros sem user_id que tenham o e-mail deste login
-- ---------------------------------------------------------------------------
create or replace function public.fn_vincular_cadastros_do_login(p_user uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
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
end;
$$;

revoke all on function public.fn_vincular_cadastros_do_login(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cadastro novo ou com e-mail alterado: procura o login
-- ---------------------------------------------------------------------------
create or replace function public.fn_trg_cadastro_vincula_login()
returns trigger
language plpgsql security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
    if new.user_id is null and nullif(btrim(new.email), '') is not null then
        new.user_id := public.fn_login_confirmado_por_email(new.email);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_subscriber_vincula_login on public.subscribers;
create trigger trg_subscriber_vincula_login
    before insert or update of email on public.subscribers
    for each row execute function public.fn_trg_cadastro_vincula_login();

drop trigger if exists trg_supplier_vincula_login on public.suppliers;
create trigger trg_supplier_vincula_login
    before insert or update of email on public.suppliers
    for each row execute function public.fn_trg_cadastro_vincula_login();

-- ---------------------------------------------------------------------------
-- Login que confirma o e-mail depois (ou troca de e-mail)
-- ---------------------------------------------------------------------------
create or replace function public.fn_trg_login_confirmado_vincula()
returns trigger
language plpgsql security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
    if new.email_confirmed_at is not null
       and (old.email_confirmed_at is null or old.email is distinct from new.email) then
        perform public.fn_vincular_cadastros_do_login(new.id);
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed_vincula on auth.users;
create trigger on_auth_user_confirmed_vincula
    after update of email_confirmed_at, email on auth.users
    for each row execute function public.fn_trg_login_confirmado_vincula();

-- ---------------------------------------------------------------------------
-- handle_new_user: mesmo papel de antes, mas o vinculo passa pela funcao acima
-- (sem diferenciar maiusculas, so' com e-mail confirmado, e sem o originador
-- bloquear assinante/fornecedor). A atualizacao de originators_v2.id fica
-- exatamente como era.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
as $function$
DECLARE
    matched_role TEXT := 'visitor';
    is_originator BOOLEAN := FALSE;
    is_subscriber BOOLEAN := FALSE;
    is_supplier BOOLEAN := FALSE;
    user_name TEXT;
BEGIN
    SET LOCAL search_path = public, auth;

    RAISE LOG 'Handle New User Started. Email: %, ID: %', NEW.email, NEW.id;

    user_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email);

    -- 1. Originators (V2) -- inalterado
    IF EXISTS (SELECT 1 FROM public.originators_v2 WHERE email = NEW.email) THEN
        UPDATE public.originators_v2 SET id = NEW.id WHERE email = NEW.email;
        matched_role := 'originator';
        is_originator := TRUE;
    END IF;

    is_subscriber := EXISTS (SELECT 1 FROM public.subscribers
                              WHERE lower(btrim(email)) = lower(btrim(NEW.email)));
    is_supplier   := EXISTS (SELECT 1 FROM public.suppliers
                              WHERE lower(btrim(email)) = lower(btrim(NEW.email)));

    -- 2. Vinculo (so' age se o e-mail ja' nasce confirmado; senao, o
    --    gatilho on_auth_user_confirmed_vincula faz isso na confirmacao)
    PERFORM public.fn_vincular_cadastros_do_login(NEW.id);

    -- 3. Papel: mesma precedencia de antes (originador > assinante > fornecedor)
    IF NOT is_originator AND is_subscriber THEN
        matched_role := 'subscriber';
    ELSIF NOT is_originator AND is_supplier THEN
        matched_role := 'supplier';
    END IF;

    IF matched_role = 'visitor' THEN
        matched_role := 'lead';
    END IF;

    -- 4. Profile
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

-- ---------------------------------------------------------------------------
-- Backfill: cadastros sem user_id cujo e-mail ja' tem login confirmado
-- ---------------------------------------------------------------------------
update public.subscribers s
   set user_id = public.fn_login_confirmado_por_email(s.email)
 where s.user_id is null
   and public.fn_login_confirmado_por_email(s.email) is not null;

update public.suppliers s
   set user_id = public.fn_login_confirmado_por_email(s.email)
 where s.user_id is null
   and public.fn_login_confirmado_por_email(s.email) is not null;
