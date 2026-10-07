-- Eletropostos no CRM — cadastro (projeto 1).
-- Spec: docs/superpowers/specs/2026-09-29-eletropostos-cadastro-design.md
--
-- Cadeia: usina -> compensa na UC -> a UC fornece ao eletroposto.
-- So cria o que e novo: nenhum gatilho de UC, usina, fornecedor ou fatura
-- muda, e nada entra no razao. O dinheiro (energia fornecida x tarifa do
-- investidor - despesas) e o projeto 2.

-- ---------------------------------------------------------------------------
-- 1. Status (manual, espelha a usina)
-- ---------------------------------------------------------------------------
create type public.eletroposto_status as enum
    ('pre_operacao', 'em_instalacao', 'operando', 'manutencao', 'inativo', 'cancelado');

-- ---------------------------------------------------------------------------
-- 2. Eletroposto
-- ---------------------------------------------------------------------------
create table public.eletropostos (
    id                    uuid primary key default gen_random_uuid(),
    nome                  text not null check (btrim(nome) <> ''),
    endereco              jsonb not null default '{}'::jsonb,
    status                public.eletroposto_status not null default 'pre_operacao',
    -- Uma UC atende no maximo um eletroposto. A usina vem da UC.
    consumer_unit_id      uuid unique references public.consumer_units(id) on delete set null,
    -- Hierarquia (Lider, Parceiro Power) do split: e do eletroposto, nao do fornecedor.
    originator_id         uuid references public.originators_v2(id) on delete set null,
    plano_id              uuid references public.planos_assinatura_energia(id) on delete set null,
    tarifa_investidor_kwh numeric(10,4) check (tarifa_investidor_kwh >= 0),
    qtd_carregadores      integer check (qtd_carregadores >= 0),
    potencia_kw           numeric check (potencia_kw >= 0),
    tipo_recarga          text check (tipo_recarga in ('AC', 'DC', 'AC_DC')),
    fabricante            text,
    modelo                text,
    observacoes           text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

comment on table public.eletropostos is
    'Eletroposto: consome de uma UC (que e compensada por uma usina) e tem um ou mais fornecedores (eletroposto_fornecedores). Status manual.';
comment on column public.eletropostos.consumer_unit_id is
    'UC que fornece energia ao eletroposto. Unica. A usina e lida por consumer_units.usina_id, nunca gravada aqui.';
comment on column public.eletropostos.originator_id is
    'Originador cuja hierarquia (Lider, Parceiro Power) entra no split do eletroposto.';
comment on column public.eletropostos.tarifa_investidor_kwh is
    'Tarifa do investidor (piso), R$/kWh. Base do projeto 2: energia fornecida x tarifa do investidor - despesas.';

create index eletropostos_originator_id_idx on public.eletropostos (originator_id);
create index eletropostos_plano_id_idx on public.eletropostos (plano_id);

create trigger trg_eletropostos_updated_at
    before update on public.eletropostos
    for each row execute function public.handle_updated_at();

-- So plano da aba Eletropostos (categoria_plano = 'eletroposto').
create or replace function public.fn_eletroposto_plano_valido()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.plano_id is not null and not exists (
        select 1 from planos_assinatura_energia p
         where p.id = new.plano_id
           and p.recorrente_config->>'categoria_plano' = 'eletroposto'
    ) then
        raise exception 'O plano escolhido não é um plano de eletroposto.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger trg_eletroposto_plano_valido
    before insert or update of plano_id on public.eletropostos
    for each row execute function public.fn_eletroposto_plano_valido();

-- ---------------------------------------------------------------------------
-- 3. Fornecedores do eletroposto (divisao do lucro)
-- ---------------------------------------------------------------------------
create table public.eletroposto_fornecedores (
    id             uuid primary key default gen_random_uuid(),
    eletroposto_id uuid not null references public.eletropostos(id) on delete cascade,
    supplier_id    uuid not null references public.suppliers(id),
    percentual     numeric(5,2) not null check (percentual > 0 and percentual <= 100),
    ativo          boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (eletroposto_id, supplier_id)
);

comment on table public.eletroposto_fornecedores is
    'Fornecedores (investidores) do eletroposto e o percentual de cada um. Soma dos ativos <= 100 (gatilho adiado). Gravar pela RPC fn_salvar_fornecedores_eletroposto.';

create index eletroposto_fornecedores_supplier_id_idx on public.eletroposto_fornecedores (supplier_id);

create trigger trg_eletroposto_fornecedores_updated_at
    before update on public.eletroposto_fornecedores
    for each row execute function public.handle_updated_at();

-- Adiado: confere o estado final da transacao, entao trocar 60/40 por 40/60
-- nao falha no meio do caminho.
create or replace function public.fn_eletroposto_fornecedores_soma()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_soma numeric;
begin
    select coalesce(sum(percentual), 0) into v_soma
      from eletroposto_fornecedores
     where eletroposto_id = new.eletroposto_id
       and ativo;

    if v_soma > 100 then
        raise exception using
            errcode = '23514',
            message = format('A soma dos percentuais dos fornecedores do eletroposto passa de 100%% (%s%%).', v_soma);
    end if;
    return null;
end;
$$;

create constraint trigger trg_eletroposto_fornecedores_soma
    after insert or update on public.eletroposto_fornecedores
    deferrable initially deferred
    for each row execute function public.fn_eletroposto_fornecedores_soma();

-- Grava a lista inteira numa transacao so: remove quem saiu, insere quem
-- entrou e atualiza so o que mudou. SECURITY INVOKER: a RLS decide quem pode.
create or replace function public.fn_salvar_fornecedores_eletroposto(
    p_eletroposto_id uuid,
    p_fornecedores   jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_lista jsonb := coalesce(p_fornecedores, '[]'::jsonb);
begin
    if jsonb_typeof(v_lista) <> 'array' then
        raise exception 'Lista de fornecedores inválida.' using errcode = '22023';
    end if;

    if exists (select 1 from jsonb_array_elements(v_lista) x
                where coalesce(x->>'supplier_id', '') = '') then
        raise exception 'Há fornecedor sem identificação na lista.' using errcode = '22023';
    end if;

    if exists (select 1 from jsonb_array_elements(v_lista) x
                group by x->>'supplier_id' having count(*) > 1) then
        raise exception 'O mesmo fornecedor aparece duas vezes na lista.' using errcode = '22023';
    end if;

    -- FOR UPDATE exige a politica de escrita: quem so le cai aqui.
    perform 1 from eletropostos where id = p_eletroposto_id for update;
    if not found then
        raise exception 'Eletroposto não encontrado ou sem permissão para alterar.' using errcode = 'P0002';
    end if;

    delete from eletroposto_fornecedores f
     where f.eletroposto_id = p_eletroposto_id
       and not exists (select 1 from jsonb_array_elements(v_lista) x
                        where (x->>'supplier_id')::uuid = f.supplier_id);

    insert into eletroposto_fornecedores (eletroposto_id, supplier_id, percentual, ativo)
    select p_eletroposto_id,
           (x->>'supplier_id')::uuid,
           (x->>'percentual')::numeric,
           coalesce((x->>'ativo')::boolean, true)
      from jsonb_array_elements(v_lista) x
    on conflict (eletroposto_id, supplier_id) do update
       set percentual = excluded.percentual,
           ativo      = excluded.ativo
     where (eletroposto_fornecedores.percentual, eletroposto_fornecedores.ativo)
           is distinct from (excluded.percentual, excluded.ativo);
end;
$$;

revoke all on function public.fn_salvar_fornecedores_eletroposto(uuid, jsonb) from public, anon;
grant execute on function public.fn_salvar_fornecedores_eletroposto(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Acesso
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para a politica de uma tabela nao depender da RLS da outra.
create or replace function public.fn_eletroposto_do_fornecedor(p_eletroposto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
          from eletroposto_fornecedores f
          join suppliers s on s.id = f.supplier_id
         where f.eletroposto_id = p_eletroposto_id
           and s.profile_id = auth.uid()
    );
$$;

revoke all on function public.fn_eletroposto_do_fornecedor(uuid) from public, anon;
grant execute on function public.fn_eletroposto_do_fornecedor(uuid) to authenticated;

alter table public.eletropostos enable row level security;
alter table public.eletroposto_fornecedores enable row level security;

revoke all on public.eletropostos from anon;
revoke all on public.eletroposto_fornecedores from anon;

create policy eletropostos_interno on public.eletropostos
    for all to authenticated
    using (public.fn_papel_interno())
    with check (public.fn_papel_interno());

create policy eletropostos_fornecedor_le on public.eletropostos
    for select to authenticated
    using (public.fn_eletroposto_do_fornecedor(id));

create policy eletroposto_fornecedores_interno on public.eletroposto_fornecedores
    for all to authenticated
    using (public.fn_papel_interno())
    with check (public.fn_papel_interno());

create policy eletroposto_fornecedores_fornecedor_le on public.eletroposto_fornecedores
    for select to authenticated
    using (public.fn_eletroposto_do_fornecedor(eletroposto_id));
