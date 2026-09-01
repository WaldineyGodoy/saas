-- Áreas arrendadas: entidade própria, não campo da usina.
-- Tem dono, matrícula e vida independente — pode receber outra usina, pode
-- ser vendida, e o arrendante pode ser sócio do grupo ou terceiro. Como
-- entidade, também entra no split de pagamento: o aluguel é saída
-- recorrente da usina como qualquer outra.
create table if not exists public.leased_areas (
    id uuid primary key default gen_random_uuid(),
    nome text not null,
    arrendante_nome text,
    arrendante_doc text,
    arrendante_endereco jsonb default '{}'::jsonb,
    supplier_id uuid references public.suppliers(id) on delete set null,
    matricula text,
    cartorio text,
    endereco jsonb default '{}'::jsonb,
    coordenadas text,
    area_m2 numeric,
    valor_aluguel numeric,
    dia_pagamento integer,
    mes_inicio text,
    indice_reajuste text default 'IPCA',
    comarca text,
    observacoes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table public.leased_areas enable row level security;
drop policy if exists "Enable all for authenticated users" on public.leased_areas;
create policy "Enable all for authenticated users" on public.leased_areas
    for all to authenticated using (true) with check (true);

-- Serviços: valores de política da casa (O&M e futuros), não parâmetro por
-- usina. O valor por módulo é o mesmo para toda a carteira; cadastrar em
-- cada usina seria repetir a informação e deixá-las divergirem com o tempo.
create table if not exists public.service_defaults (
    id uuid primary key default gen_random_uuid(),
    codigo text unique not null,
    nome text not null,
    ativo boolean default true,
    valores jsonb default '{}'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

alter table public.service_defaults enable row level security;
drop policy if exists "Enable all for authenticated users" on public.service_defaults;
create policy "Enable all for authenticated users" on public.service_defaults
    for all to authenticated using (true) with check (true);

insert into public.service_defaults (codigo, nome, valores)
values ('om', 'Operação e Manutenção (O&M)', jsonb_build_object(
    'valorModulo', 2.10, 'valorInversor', 0,
    'periodicidadePreventiva', 'trimestral', 'periodicidadeLimpeza', 'semestral',
    'prazoApuracaoHoras', 24, 'prazoDiagnosticoDias', 5,
    'indiceReajuste', 'IPCA', 'prazoMeses', 12))
on conflict (codigo) do nothing;

alter table public.usinas add column if not exists leased_area_id uuid references public.leased_areas(id) on delete set null;
alter table public.usinas add column if not exists contract_terms jsonb;

-- O signatário continua sendo o fornecedor (a SPE), mas o OBJETO passa a
-- poder ser uma usina: compra e venda, arrendamento e O&M são cada um sobre
-- uma central específica, e um mesmo investidor pode ter várias — o Tobias
-- já tem três.
alter table public.signatures add column if not exists usina_id uuid references public.usinas(id) on delete set null;
alter table public.signatures add column if not exists document_type text;

update public.signatures
set document_type = case signer_type
    when 'subscriber' then 'adesao' when 'supplier' then 'gestao' else document_type end
where document_type is null;

alter table public.signatures drop constraint if exists signatures_document_type_check;
alter table public.signatures add constraint signatures_document_type_check
    check (document_type is null or document_type = any (array['adesao','gestao','compra_venda','arrendamento','om']));

create index if not exists signatures_usina_id_idx on public.signatures (usina_id);

-- signature_link aposentado: coluna única para um link só, e o mesmo
-- investidor passa a ter vários contratos pendentes de tipos diferentes.
comment on column public.suppliers.signature_link is
    'APOSENTADO em 31/08/2026. Não escrever nem ler: usar public.signatures.';
comment on column public.subscribers.signature_link is
    'APOSENTADO em 31/08/2026. Não escrever nem ler: usar public.signatures.';
