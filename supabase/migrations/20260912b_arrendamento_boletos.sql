-- Fila anual de boletos do arrendamento.
--
-- A imobiliaria manda os 12 boletos do ano de uma vez, antes de qualquer
-- competencia ser reconhecida. Sem lugar para guarda-los, a linha digitavel so'
-- existiria no papel ate' o mes de pagar, e alguem digitaria 47 digitos 12
-- vezes ao longo do ano -- 12 chances de colar o boleto do mes errado.
--
-- Por isso o boleto tem tabela propria, e nao um campo no pagamento: ele CHEGA
-- ANTES do pagamento existir.

create table if not exists public.arrendamento_boletos (
    id uuid primary key default gen_random_uuid(),
    beneficiary_id uuid not null references public.leased_area_beneficiaries(id) on delete cascade,
    competencia date not null,
    linha_digitavel text not null,

    -- Lidos da propria linha pelo gatilho abaixo. Nao se digitam: o boleto ja'
    -- os carrega, e reescreve-los a mao abriria espaco para divergirem do que o
    -- banco vai cobrar.
    valor      numeric,
    vencimento date,

    arrendamento_pagamento_id uuid references public.arrendamento_pagamentos(id) on delete set null,
    usado_em    timestamptz,
    observacoes text,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now(),

    constraint boleto_unico_por_competencia unique (beneficiary_id, competencia)
);

create index if not exists arrendamento_boletos_competencia_idx
    on public.arrendamento_boletos (competencia);

alter table public.arrendamento_boletos enable row level security;
drop policy if exists "Enable all for authenticated users" on public.arrendamento_boletos;
create policy "Enable all for authenticated users" on public.arrendamento_boletos
    for all to authenticated using (true) with check (true);

-- Le valor e vencimento da linha e RECUSA o que nao souber ler. Guardar uma
-- linha ilegivel seria adiar o erro para o dia do pagamento.
create or replace function public.fn_arrendamento_boleto_extrai()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
    v jsonb;
begin
    new.linha_digitavel := regexp_replace(coalesce(new.linha_digitavel, ''), '\s', '', 'g');

    -- p_valor nulo faz a funcao devolver ok=false de proposito (nao ha o que
    -- conferir); aqui so' interessam o formato e os campos extraidos.
    v := public.fn_validar_linha_digitavel(new.linha_digitavel, null, null);

    if v->>'formato' is null or v->>'formato' = 'desconhecido' then
        raise exception 'Linha digitavel nao reconhecida para a competencia %: %',
                        to_char(new.competencia, 'MM/YYYY'), v->'divergencias';
    end if;

    new.valor      := (v->>'valor_boleto')::numeric;
    new.vencimento := (v->>'vencimento_boleto')::date;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_arrendamento_boleto_extrai on public.arrendamento_boletos;
create trigger trg_arrendamento_boleto_extrai
    before insert or update on public.arrendamento_boletos
    for each row execute function public.fn_arrendamento_boleto_extrai();

-- O pagamento so' espera boleto quando nao ha boleto. Com a linha ja' guardada,
-- ele nasce pronto para pagar.
create or replace function public.fn_arrendamento_pagamento_status_inicial()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    if tg_op = 'INSERT' and new.status = 'a_pagar'
       and new.forma_pagamento = 'boleto' and new.linha_digitavel is null then
        new.status := 'aguardando_boleto';
    end if;

    if new.status = 'pago' and (tg_op = 'INSERT' or old.status is distinct from 'pago') then
        new.pago_em := coalesce(new.pago_em, now());
    elsif new.status is distinct from 'pago' then
        new.pago_em := null;
    end if;

    new.updated_at := now();
    return new;
end;
$$;
