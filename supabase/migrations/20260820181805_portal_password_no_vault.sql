-- Senha de portal sai do jsonb e vai para o Vault.
--
-- Hoje portal_credentials guarda {login, password} em texto puro, e a policy
-- de subscribers e "ALL para authenticated com qual = true": qualquer usuario
-- logado no CRM le a senha de todos os titulares pela API. Duas telas de lista
-- ainda mandavam o campo inteiro para o browser sem usar.
--
-- Depois desta migration a senha vive em vault.secrets (cifrada) e a linha
-- guarda so o id do segredo. Quem le a senha e a funcao abaixo, com EXECUTE
-- concedido apenas a service_role -- o robo. A UI so escreve.

alter table public.subscribers     add column if not exists portal_password_secret_id uuid;
alter table public.usinas          add column if not exists portal_password_secret_id uuid;
alter table public.consumer_units  add column if not exists portal_password_secret_id uuid;

comment on column public.subscribers.portal_password_secret_id is
  'Referencia ao segredo em vault.secrets. A senha NAO fica na linha; ler com fn_get_portal_credentials (so service_role).';
comment on column public.usinas.portal_password_secret_id is
  'Referencia ao segredo em vault.secrets. Ver fn_get_portal_credentials.';
comment on column public.consumer_units.portal_password_secret_id is
  'Referencia ao segredo em vault.secrets. Ver fn_get_portal_credentials.';

-- Grava ou troca a senha. Senha vazia/nula apaga o segredo.
-- Sempre remove a chave 'password' do jsonb: e o unico caminho de escrita.
create or replace function public.fn_set_portal_password(
    p_entidade text,
    p_id uuid,
    p_senha text
) returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
    v_secret_id uuid;
    v_nome text;
begin
    if p_entidade not in ('subscribers', 'usinas', 'consumer_units') then
        raise exception 'entidade invalida: %', p_entidade;
    end if;

    execute format('select portal_password_secret_id from public.%I where id = $1', p_entidade)
        into v_secret_id using p_id;

    if p_senha is null or length(trim(p_senha)) = 0 then
        if v_secret_id is not null then
            delete from vault.secrets where id = v_secret_id;
        end if;
        execute format(
            'update public.%I set portal_password_secret_id = null,
                 portal_credentials = coalesce(portal_credentials, ''{}''::jsonb) - ''password''
             where id = $1', p_entidade) using p_id;
        return;
    end if;

    v_nome := format('portal:%s:%s', p_entidade, p_id);

    if v_secret_id is null then
        v_secret_id := vault.create_secret(p_senha, v_nome, 'Senha de portal de concessionaria');
        execute format(
            'update public.%I set portal_password_secret_id = $2,
                 portal_credentials = coalesce(portal_credentials, ''{}''::jsonb) - ''password''
             where id = $1', p_entidade) using p_id, v_secret_id;
    else
        perform vault.update_secret(v_secret_id, p_senha);
        execute format(
            'update public.%I set portal_credentials = coalesce(portal_credentials, ''{}''::jsonb) - ''password''
             where id = $1', p_entidade) using p_id;
    end if;
end;
$$;

-- Le login + senha decifrada. O portao e o GRANT: so service_role executa.
create or replace function public.fn_get_portal_credentials(
    p_entidade text,
    p_id uuid
) returns table (login text, senha text)
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
    v_secret_id uuid;
    v_login text;
begin
    if p_entidade not in ('subscribers', 'usinas', 'consumer_units') then
        raise exception 'entidade invalida: %', p_entidade;
    end if;

    execute format(
        'select portal_credentials->>''login'', portal_password_secret_id from public.%I where id = $1',
        p_entidade) into v_login, v_secret_id using p_id;

    login := v_login;
    senha := case
        when v_secret_id is null then null
        else (select s.decrypted_secret from vault.decrypted_secrets s where s.id = v_secret_id)
    end;
    return next;
end;
$$;

revoke all on function public.fn_set_portal_password(text, uuid, text) from public;
grant execute on function public.fn_set_portal_password(text, uuid, text) to authenticated, service_role;

revoke all on function public.fn_get_portal_credentials(text, uuid) from public;
grant execute on function public.fn_get_portal_credentials(text, uuid) to service_role;
