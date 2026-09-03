-- ============================================================================
-- Dispensa de ciclo: destravar o fechamento sem sepultar a cobranca
--
-- A guarda de ciclo completo (20260903a) trava o assinante inteiro quando uma
-- UC nao tem fatura apurada. Isso e o certo para leitura que ainda vai chegar,
-- e virou prisao para leitura que a concessionaria simplesmente nao postou: a
-- Guanabara tem 4 UCs assim desde 05/2026, e o assinante ficaria sem faturar
-- indefinidamente por causa de um erro que nao e nosso nem do cliente.
--
-- A dispensa libera o ciclo. O que ela NAO faz -- e aqui esta o ponto todo --
-- e encerrar a cobranca daquela UC.
--
-- A indisponibilidade da conta e erro da concessionaria e pode ser corrigida a
-- qualquer momento. Quando a fatura aparecer, ela e devida, e o cliente vai
-- receber por ela mesmo que o ciclo tenha fechado ha meses. Por isso a dispensa
-- so tem efeito ENQUANTO a fatura estiver sem valor apurado: no instante em que
-- o faturista trouxer o valor, a UC volta a fila como `pronta` e entra na
-- emissao do seu proprio ciclo, retroativa, sem ninguem revogar nada.
--
-- E a diferenca entre isto e o acidente que originou a guarda. La, a UC
-- 1.979.411.032-86 entrou num consolidado a R$ 0,00 com `asaas_payment_id`
-- preenchido: conta real de R$ 31,69 fechada para sempre, porque cobrada e
-- cobrada. Aqui nada e marcado como cobrado -- a fatura continua aberta, com
-- motivo escrito de por que nao entrou naquele fechamento.
-- ============================================================================

create table if not exists public.dispensas_ciclo (
    id         uuid primary key default gen_random_uuid(),
    uc_id      uuid not null references public.consumer_units(id) on delete cascade,
    ciclo      date not null,
    motivo     text not null,
    criado_em  timestamptz not null default now(),
    criado_por uuid references auth.users(id),
    unique (uc_id, ciclo)
);

comment on table public.dispensas_ciclo is
    'UC dispensada do fechamento de um ciclo. NAO encerra a cobranca: se a fatura for apurada depois, volta a fila e e cobrada retroativamente.';

alter table public.dispensas_ciclo enable row level security;

drop policy if exists dispensas_ciclo_leitura on public.dispensas_ciclo;
create policy dispensas_ciclo_leitura on public.dispensas_ciclo
    for select to authenticated using (true);

drop policy if exists dispensas_ciclo_escrita on public.dispensas_ciclo;
create policy dispensas_ciclo_escrita on public.dispensas_ciclo
    for all to authenticated
    using (public.check_user_is_admin(auth.uid()))
    with check (public.check_user_is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Dispensar / revogar
-- ---------------------------------------------------------------------------
create or replace function public.fn_dispensar_uc_do_ciclo(
    p_uc_id uuid, p_ciclo date, p_motivo text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_valor numeric;
begin
    if coalesce(btrim(p_motivo), '') = '' then
        raise exception 'Dispensa exige motivo escrito.';
    end if;

    -- Dispensar UC que JA tem valor apurado seria esconder cobranca devida.
    select max(coalesce(valor_a_pagar, 0)) into v_valor
    from invoices
    where uc_id = p_uc_id
      and date_trunc('month', mes_referencia) = date_trunc('month', p_ciclo)
      and status::text <> 'cancelado';

    if coalesce(v_valor, 0) > 0 then
        raise exception 'Esta UC tem fatura apurada de R$ % neste ciclo. Dispensa serve para conta indisponivel, nao para deixar de cobrar.', v_valor;
    end if;

    insert into dispensas_ciclo (uc_id, ciclo, motivo, criado_por)
    values (p_uc_id, date_trunc('month', p_ciclo)::date, p_motivo, auth.uid())
    on conflict (uc_id, ciclo) do update
        set motivo = excluded.motivo, criado_em = now(), criado_por = excluded.criado_por;
end;
$$;

create or replace function public.fn_revogar_dispensa_ciclo(p_uc_id uuid, p_ciclo date)
returns void
language sql
security definer
set search_path = public
as $$
    delete from dispensas_ciclo
    where uc_id = p_uc_id and ciclo = date_trunc('month', p_ciclo)::date;
$$;

revoke execute on function public.fn_dispensar_uc_do_ciclo(uuid, date, text) from anon;
revoke execute on function public.fn_revogar_dispensa_ciclo(uuid, date) from anon;

-- ---------------------------------------------------------------------------
-- Fila de emissao, agora ciente da dispensa e do retroativo
--
-- Duas mudancas de regra em relacao a 20260903a:
--
--   1. `dispensada` deixou de ser impedimento -- mas so vale enquanto a fatura
--      estiver a zero. Fatura apurada ignora a dispensa e conta como `pronta`.
--
--   2. Varios ciclos pendentes deixaram de bloquear. Antes travava porque o
--      risco era somar meses diferentes num boleto so. O robo emite UM CICLO
--      POR VEZ, o mais antigo primeiro, cada um com seu proprio boleto e seu
--      proprio demonstrativo -- entao nada e somado as escondidas, e a fatura
--      retroativa que aparecer depois vira um boleto proprio, identificado pelo
--      mes de referencia dela. Continua saindo na coluna `observacao`, para
--      quem olha a tela saber que ha mais de um mes em aberto.
-- ---------------------------------------------------------------------------
create or replace function public.fn_fila_emissao_faturas(p_limite integer default 50)
returns table (
    subscriber_id       uuid,
    subscriber_name     text,
    billing_mode        text,
    ciclo               date,
    retroativo          boolean,
    ucs                 integer,
    prontas             integer,
    ja_cobradas         integer,
    dispensadas         integer,
    sem_valor           integer,
    ausentes            integer,
    total               numeric,
    invoice_ids         uuid[],
    vencimento_sugerido date,
    impedimento         text,
    observacao          text
)
language sql
stable
security definer
set search_path = public
as $$
    with todas as (
        select cu.subscriber_id, i.mes_referencia, cu.id as uc_id, i.id as invoice_id,
               coalesce(i.valor_a_pagar, 0) as valor,
               (i.asaas_payment_id is not null or i.consolidated_invoice_id is not null) as cobrada,
               i.status::text as st
        from invoices i
        join consumer_units cu on cu.id = i.uc_id
        where coalesce(cu.nao_faturavel, false) = false
          and i.status::text <> 'cancelado'
    ),
    abertas as (select * from todas where not cobrada and st <> 'pago'),
    ciclos  as (select distinct subscriber_id, mes_referencia from abertas),
    esperadas as (
        select c.subscriber_id, c.mes_referencia, cu.id as uc_id, cu.numero_uc
        from ciclos c
        join consumer_units cu on cu.subscriber_id = c.subscriber_id
        where coalesce(cu.nao_faturavel, false) = false
          and (cu.status::text in ('ativo','em_atraso','em_transf_titularidade')
               or exists (select 1 from abertas a
                          where a.uc_id = cu.id and a.mes_referencia = c.mes_referencia))
    ),
    classificada as (
        select e.subscriber_id, e.mes_referencia, e.numero_uc, t.invoice_id, t.valor,
               case
                   -- Valor apurado manda em tudo: dispensa nao esconde cobranca devida.
                   when coalesce(t.valor, 0) > 0 and not t.cobrada and t.st <> 'pago' then 'pronta'
                   when t.invoice_id is not null and (t.cobrada or t.st = 'pago')     then 'cobrada'
                   when exists (select 1 from dispensas_ciclo d
                                where d.uc_id = e.uc_id
                                  and d.ciclo = date_trunc('month', e.mes_referencia)::date)
                                                                                      then 'dispensada'
                   when t.invoice_id is null                                          then 'ausente'
                   else 'sem_valor'
               end as situacao
        from esperadas e
        left join todas t on t.uc_id = e.uc_id and t.mes_referencia = e.mes_referencia
    ),
    agregada as (
        select c.subscriber_id, c.mes_referencia,
               count(*)::int                                          as ucs,
               count(*) filter (where situacao='pronta')::int         as prontas,
               count(*) filter (where situacao='cobrada')::int        as ja_cobradas,
               count(*) filter (where situacao='dispensada')::int     as dispensadas,
               count(*) filter (where situacao='sem_valor')::int      as sem_valor,
               count(*) filter (where situacao='ausente')::int        as ausentes,
               coalesce(sum(valor) filter (where situacao='pronta'),0) as total,
               array_agg(invoice_id order by numero_uc)
                   filter (where situacao='pronta')                   as invoice_ids,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='sem_valor')                as ucs_sem_valor,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='ausente')                  as ucs_ausentes,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='dispensada')               as ucs_dispensadas,
               (select count(distinct a2.mes_referencia)
                  from abertas a2 where a2.subscriber_id = c.subscriber_id) as ciclos_pendentes,
               (select string_agg(to_char(x, 'MM/YYYY'), ', ' order by x)
                  from (select distinct a3.mes_referencia as x
                          from abertas a3 where a3.subscriber_id = c.subscriber_id) q) as lista_ciclos,
               (select max(a4.mes_referencia)
                  from abertas a4 where a4.subscriber_id = c.subscriber_id) as ciclo_mais_novo
        from classificada c
        group by c.subscriber_id, c.mes_referencia
    )
    select a.subscriber_id,
           s.name,
           s.billing_mode::text,
           a.mes_referencia,
           (a.mes_referencia < a.ciclo_mais_novo) as retroativo,
           a.ucs, a.prontas, a.ja_cobradas, a.dispensadas, a.sem_valor, a.ausentes,
           round(a.total, 2),
           a.invoice_ids,
           public.fn_vencimento_sugerido(coalesce(s.consolidated_due_day, 10)),
           nullif(concat_ws('; ',
               case when a.ausentes > 0
                    then a.ausentes || ' UC ativa sem fatura no ciclo: ' || a.ucs_ausentes end,
               case when a.sem_valor > 0
                    then a.sem_valor || ' UC com fatura a R$ 0,00: ' || a.ucs_sem_valor end,
               case when a.prontas = 0
                    then 'nada apurado para cobrar' end
           ), '') as impedimento,
           nullif(concat_ws('; ',
               case when a.dispensadas > 0
                    then a.dispensadas || ' UC dispensada deste ciclo (volta a cobranca se a conta aparecer): '
                         || a.ucs_dispensadas end,
               case when a.ciclos_pendentes > 1
                    then a.ciclos_pendentes || ' ciclos em aberto (' || a.lista_ciclos
                         || ') -- cada um sai em boleto proprio' end
           ), '') as observacao
    from agregada a
    join subscribers s on s.id = a.subscriber_id
    order by s.name, a.mes_referencia
    limit p_limite;
$$;

revoke execute on function public.fn_fila_emissao_faturas(integer) from anon;
