-- Task 2 do plano 2026-09-11-arrendamento-repasse.
--
-- O arrendante morava na propria linha da area (arrendante_nome, _doc,
-- _endereco), o que impede tres casos reais: terra com dois donos, imobiliaria
-- recebendo no lugar do proprietario, e a B2W retendo margem de intermediacao.
--
-- Quem recebe o dinheiro nao e' necessariamente quem assina o contrato. A B2W
-- e' a ARRENDATARIA: se entrasse como arrendante, o gerador de contrato a
-- colocaria nos dois polos do documento. A imobiliaria recebe e nao arrenda.
-- Dai o par (tipo, assina_contrato).

create table if not exists public.leased_area_beneficiaries (
    id uuid primary key default gen_random_uuid(),
    leased_area_id uuid not null references public.leased_areas(id) on delete cascade,

    nome text not null,
    doc text,

    -- terceiro      = dono da terra; recebe e assina
    -- intermediario = imobiliaria; recebe e NAO assina
    -- casa          = B2W; NAO recebe (o dinheiro ja' esta' na conta dela) e
    --                 NAO assina. Credito vai para receita 3.1.4, nunca para
    --                 o passivo: obrigacao da empresa com ela mesma nunca e'
    --                 paga e nunca e' extinta.
    tipo text not null default 'terceiro'
        check (tipo in ('terceiro', 'intermediario', 'casa')),
    assina_contrato boolean not null default false,

    rateio_tipo text not null default 'percentual'
        check (rateio_tipo in ('percentual', 'fixo')),
    rateio_valor numeric not null,

    -- NULO significa "ainda nao definido", e o pagamento fica barrado ate'
    -- ser preenchido. Nao existe default: escolher um trilho por omissao
    -- seria inventar dado (regra da casa: faltante propaga NULL).
    forma_pagamento text check (forma_pagamento in ('pix', 'boleto')),
    pix_key text,
    pix_key_type text,

    ativo boolean not null default true,
    observacoes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),

    -- A casa nao tem para onde receber.
    constraint beneficiario_casa_nao_recebe check (
        tipo <> 'casa'
        or (forma_pagamento is null and pix_key is null and pix_key_type is null)
    ),
    -- Trilho PIX sem chave e' trilho que nao paga.
    constraint beneficiario_pix_tem_chave check (
        forma_pagamento is distinct from 'pix'
        or (pix_key is not null and pix_key_type is not null)
    ),
    -- So' terceiro assina o contrato de arrendamento.
    constraint beneficiario_assinante_e_terceiro check (
        assina_contrato is false or tipo = 'terceiro'
    )
);

-- Duas linhas de casa na mesma area significaria margem contada duas vezes.
create unique index if not exists leased_area_beneficiaries_uma_casa_idx
    on public.leased_area_beneficiaries (leased_area_id)
    where tipo = 'casa';

create index if not exists leased_area_beneficiaries_area_idx
    on public.leased_area_beneficiaries (leased_area_id);

alter table public.leased_area_beneficiaries enable row level security;
drop policy if exists "Enable all for authenticated users" on public.leased_area_beneficiaries;
create policy "Enable all for authenticated users" on public.leased_area_beneficiaries
    for all to authenticated using (true) with check (true);

-- Migracao do dado existente: o arrendante em linha vira o primeiro
-- beneficiario, a 100%. forma_pagamento fica NULA de proposito -- nenhuma das
-- areas tem chave PIX ou boleto cadastrado hoje, e o campo nao existia.
insert into public.leased_area_beneficiaries
    (leased_area_id, nome, doc, tipo, assina_contrato, rateio_tipo, rateio_valor)
select la.id, la.arrendante_nome, la.arrendante_doc, 'terceiro', true, 'percentual', 100
  from public.leased_areas la
 where la.arrendante_nome is not null
   and not exists (
       select 1 from public.leased_area_beneficiaries b
        where b.leased_area_id = la.id);

-- Aposentadorias. Nao dropar agora: a tela ainda escreve nestas colunas ate'
-- a Task 9 substituir o formulario.
comment on column public.leased_areas.supplier_id is
    'APOSENTADO em 11/09/2026. Redundante: o fornecedor vem de usinas.leased_area_id. Uma area pode receber duas usinas, e ai este campo passa a mentir.';
comment on column public.leased_areas.repasse_tipo is
    'APOSENTADO em 11/09/2026. Quem rateia agora é leased_area_beneficiaries.';
comment on column public.leased_areas.repasse_valor is
    'APOSENTADO em 11/09/2026. Quem rateia agora é leased_area_beneficiaries.';
comment on column public.leased_areas.arrendante_nome is
    'APOSENTADO em 11/09/2026 como fonte de pagamento. Mantido até a Task 11 migrar o gerador de contrato para leased_area_beneficiaries.';
