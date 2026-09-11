-- Task 4 do plano 2026-09-11-arrendamento-repasse.
--
-- O razao auxiliar do passivo 2.1.5. O razao diz quanto se deve; esta tabela
-- diz a quem, por qual competencia e por qual trilho. Sem ela, "o Marcos
-- recebeu julho?" so' se responde garimpando lancamento contabil.
--
-- Uma linha por beneficiario por competencia, e nao por area: uma area com
-- dois donos pode ter um pago e outro pendente. Pagamento parcial e' estado
-- legitimo, nao erro.

create table if not exists public.arrendamento_pagamentos (
    id uuid primary key default gen_random_uuid(),

    beneficiary_id uuid not null references public.leased_area_beneficiaries(id) on delete restrict,
    usina_id       uuid not null references public.usinas(id) on delete restrict,
    competencia    date not null,

    valor      numeric not null check (valor >= 0),
    vencimento date,

    -- fornecedor        = usina em operacao; o investidor foi debitado
    -- b2w_pre_operacao  = usina em obra; custo da propria B2W (decisao do
    --                     dono em 11/09/2026). O trilho de saida e' o mesmo:
    --                     o que muda e' a origem do debito, nunca o pagamento.
    origem text not null check (origem in ('fornecedor', 'b2w_pre_operacao')),

    -- aguardando_boleto existe porque o boleto tem dependencia externa: a
    -- linha digitavel chega da imobiliaria a cada competencia e sem ela nao
    -- ha o que pagar. O PIX nao tem essa espera e nasce em a_pagar.
    status text not null default 'a_pagar'
        check (status in ('a_pagar', 'aguardando_boleto', 'enfileirado', 'pago', 'falhou')),

    forma_pagamento text check (forma_pagamento in ('pix', 'boleto')),
    linha_digitavel text,
    financial_transfer_id uuid references public.financial_transfers(id) on delete set null,

    external_id text,
    pago_em     timestamptz,
    observacoes text,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now(),

    -- A chave natural. E' ela que impede o reconhecimento de rodar duas vezes
    -- e cobrar o mesmo mes duas vezes.
    constraint arrendamento_pagamento_unico unique (beneficiary_id, usina_id, competencia),

    -- Cada trilho carrega so' o seu instrumento. Linha digitavel em pagamento
    -- PIX e' dado de outro fluxo vazando.
    constraint pagamento_pix_sem_boleto check (
        forma_pagamento is distinct from 'pix' or linha_digitavel is null
    ),
    constraint pagamento_boleto_sem_transfer check (
        forma_pagamento is distinct from 'boleto' or financial_transfer_id is null
    )
);

create index if not exists arrendamento_pagamentos_competencia_idx
    on public.arrendamento_pagamentos (competencia, status);
create index if not exists arrendamento_pagamentos_beneficiario_idx
    on public.arrendamento_pagamentos (beneficiary_id);

alter table public.arrendamento_pagamentos enable row level security;
drop policy if exists "Enable all for authenticated users" on public.arrendamento_pagamentos;
create policy "Enable all for authenticated users" on public.arrendamento_pagamentos
    for all to authenticated using (true) with check (true);

-- O status inicial e' derivado do trilho, e fica no gatilho em vez de no
-- chamador para valer tambem quando a linha nasce pela tela ou por correcao
-- manual. Sem forma_pagamento definida, nasce a_pagar e o portao do
-- pagamento barra depois: trilho ausente e' dado faltante, nao boleto.
create or replace function public.fn_arrendamento_pagamento_status_inicial()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    if tg_op = 'INSERT' and new.status = 'a_pagar' and new.forma_pagamento = 'boleto' then
        new.status := 'aguardando_boleto';
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_arrendamento_pagamento_status on public.arrendamento_pagamentos;
create trigger trg_arrendamento_pagamento_status
    before insert or update on public.arrendamento_pagamentos
    for each row execute function public.fn_arrendamento_pagamento_status_inicial();
