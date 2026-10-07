-- B2W Charge / OCPP: pre-requisitos MINIMOS para o Supabase LOCAL (somente ambiente local/CI).
-- NUNCA aplicar em producao: la estes objetos ja existem (criados fora de supabase/migrations).
--
-- Por que existe: as 124 migracoes de supabase/migrations nao reproduzem o banco do zero (a
-- primeira, 20250130_add_invoice_fields.sql, altera `invoices`, que nenhuma migracao cria; ha
-- versoes repetidas e nomes com sufixo de letra que o CLI ignora). O ambiente de testes do OCPP
-- (Tarefa 10) sobe o stack com as migracoes desligadas, aplica ESTE arquivo e depois, VERBATIM e
-- nesta ordem (scripts/ocpp-local-db.mjs faz isso):
--   20260923_create_planos_assinatura_energia.sql
--   20260929a_eletropostos.sql
--   20260929b_planos_escrita_so_admin.sql
--   20260930_create_recargas_eletroposto.sql
--   20261007a_recarga_seguranca.sql
--   20261007b_ocpp_estrutura.sql
--   20261007c_conector_numero.sql
--
-- Cada objeto abaixo e a menor forma compativel com o que essas migracoes e os testes
-- supabase/tests/{eletropostos,recarga_seguranca,ocpp_estrutura,conector_numero}.test.sql usam.
-- Idempotente (pode rodar de novo).

-- pg_cron: 20261007b agenda a limpeza de ocpp_mensagens (cron.schedule)
create extension if not exists pg_cron;

-- handle_updated_at: gatilho padrao de updated_at (usado por todas as tabelas novas)
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- profiles: 1 linha por auth.users (criada por gatilho), com o papel do usuario
create table if not exists public.profiles (
    id         uuid primary key references auth.users(id) on delete cascade,
    email      text,
    name       text,
    role       text not null default 'subscriber',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_proprio on public.profiles;
create policy profiles_proprio on public.profiles for select to authenticated using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.profiles (id, email, name)
    values (new.id, new.email, new.raw_user_meta_data->>'name')
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- fn_papel_interno: COPIA de supabase/migrations/20260922d_originators_v2_rls.sql (secao 1).
-- A migracao inteira nao e aplicada porque depende do schema completo de originators_v2.
create or replace function public.fn_papel_interno()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role in ('super_admin', 'admin', 'manager', 'coordinator')
  );
$fn$;
revoke execute on function public.fn_papel_interno() from public;
grant execute on function public.fn_papel_interno() to authenticated, service_role;

-- suppliers (fornecedores/investidores): eletroposto_fornecedores e fn_eletroposto_do_fornecedor
create table if not exists public.suppliers (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    profile_id uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;

-- consumer_units: eletropostos.consumer_unit_id
create table if not exists public.consumer_units (
    id         uuid primary key default gen_random_uuid(),
    numero_uc  text,
    created_at timestamptz not null default now()
);
alter table public.consumer_units enable row level security;

-- originators_v2: eletropostos.originator_id
create table if not exists public.originators_v2 (
    id         uuid primary key default gen_random_uuid(),
    name       text,
    created_at timestamptz not null default now()
);
alter table public.originators_v2 enable row level security;

-- notification_logs: alertas internos do CSMS (channel 'sistema'). Em producao nao ha CHECK em
-- channel/status e entity_id e uuid NOT NULL (conferido pelo controlador na Tarefa 7). O gatilho de
-- despacho (fn_dispatch_notification) nao existe aqui: so whatsapp/email disparam envio la.
create table if not exists public.notification_logs (
    id          uuid primary key default gen_random_uuid(),
    trigger_id  uuid,
    entity_type text,
    entity_id   uuid not null,
    channel     text,
    recipient   text,
    body        text,
    status      text,
    metadata    jsonb default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
alter table public.notification_logs enable row level security;
