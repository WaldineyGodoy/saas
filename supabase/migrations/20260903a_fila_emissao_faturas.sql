-- ============================================================================
-- Fila de emissao: quais assinantes podem ser faturados sem uma pessoa olhando
--
-- Emitir e mais perigoso que enviar. O enviador entrega o que ja existe; o
-- emissor CRIA cobranca de verdade, e cobranca errada nao se desfaz sozinha.
--
-- O caso que motivou a guarda, em 03/09/2026: a Guanabara tinha R$ 1.660,80
-- "prontos" para faturar. Emitir esse valor teria fechado o ciclo de 07/2026
-- com 4 das 8 UCs valendo R$ 0,00 -- as que falharam na leitura -- e essas 4
-- ficariam marcadas como cobradas para sempre, com `asaas_payment_id`
-- preenchido. Nao e hipotese: aconteceu com a UC 1.979.411.032-86 do Mirantes,
-- conta real de R$ 31,69 sepultada a zero no consolidado de julho, ja pago.
--
-- Por isso a regra nao e "existe fatura com valor?" e sim "o CICLO fechou?".
-- Uma UC ativa sem fatura, ou com fatura a zero, trava o assinante inteiro.
-- Prefiro nao faturar a faturar pela metade: o que nao saiu hoje sai amanha,
-- o que saiu errado vira estorno, ligacao e credibilidade.
--
-- Esta funcao NAO emite nada. Ela responde quem esta pronto e, para quem nao
-- esta, escreve o porque em portugues. Serve tanto ao robo quanto a tela.
-- ============================================================================

-- Vencimento a partir do dia configurado no assinante. Piso de 2 dias e desvio
-- de fim de semana; feriado ainda nao entra aqui (ver nota no fim do arquivo).
create or replace function public.fn_vencimento_sugerido(p_dia integer)
returns date
language sql
stable
as $$
    with piso as (select current_date + 2 as d),
    cand as (
        select d,
               make_date(extract(year from d)::int, extract(month from d)::int,
                   least(p_dia, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)) as v
        from piso
    ),
    escolhido as (
        select case when v >= d then v else
            make_date(extract(year from (d + interval '1 month'))::int,
                      extract(month from (d + interval '1 month'))::int,
                      least(p_dia, extract(day from (date_trunc('month', d + interval '1 month')
                                                     + interval '1 month - 1 day'))::int))
            end as v
        from cand
    )
    select case extract(dow from v) when 6 then v + 2 when 0 then v + 1 else v end from escolhido;
$$;

create or replace function public.fn_fila_emissao_faturas(p_limite integer default 50)
returns table (
    subscriber_id       uuid,
    subscriber_name     text,
    billing_mode        text,
    ciclo               date,
    ucs                 integer,
    prontas             integer,
    ja_cobradas         integer,
    sem_valor           integer,
    ausentes            integer,
    total               numeric,
    invoice_ids         uuid[],
    vencimento_sugerido date,
    impedimento         text
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
    -- UC esperada no ciclo: ativa hoje, ou desligada mas ainda com fatura aberta
    -- nele (o caso da UC sombra, que tem conta final a cobrar depois do corte).
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
               case when t.invoice_id is null            then 'ausente'
                    when t.cobrada or t.st = 'pago'      then 'cobrada'
                    when t.valor > 0                     then 'pronta'
                    else 'sem_valor' end as situacao
        from esperadas e
        left join todas t on t.uc_id = e.uc_id and t.mes_referencia = e.mes_referencia
    ),
    agregada as (
        select c.subscriber_id, c.mes_referencia,
               count(*)::int                                          as ucs,
               count(*) filter (where situacao='pronta')::int         as prontas,
               count(*) filter (where situacao='cobrada')::int        as ja_cobradas,
               count(*) filter (where situacao='sem_valor')::int      as sem_valor,
               count(*) filter (where situacao='ausente')::int        as ausentes,
               coalesce(sum(valor) filter (where situacao='pronta'),0) as total,
               array_agg(invoice_id order by numero_uc)
                   filter (where situacao='pronta')                   as invoice_ids,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='sem_valor')                as ucs_sem_valor,
               string_agg(numero_uc, ', ' order by numero_uc)
                   filter (where situacao='ausente')                  as ucs_ausentes,
               (select count(distinct a2.mes_referencia)
                  from abertas a2 where a2.subscriber_id = c.subscriber_id) as ciclos_pendentes,
               (select string_agg(to_char(x, 'MM/YYYY'), ', ' order by x)
                  from (select distinct a3.mes_referencia as x
                          from abertas a3 where a3.subscriber_id = c.subscriber_id) q) as lista_ciclos
        from classificada c
        group by c.subscriber_id, c.mes_referencia
    )
    select a.subscriber_id,
           s.name,
           s.billing_mode::text,
           a.mes_referencia,
           a.ucs, a.prontas, a.ja_cobradas, a.sem_valor, a.ausentes,
           round(a.total, 2),
           a.invoice_ids,
           public.fn_vencimento_sugerido(coalesce(s.consolidated_due_day, 10)),
           nullif(concat_ws('; ',
               case when a.ciclos_pendentes > 1
                    then 'assinante tem ' || a.ciclos_pendentes || ' ciclos pendentes (' || a.lista_ciclos || ')' end,
               case when a.ausentes > 0
                    then a.ausentes || ' UC ativa sem fatura no ciclo: ' || a.ucs_ausentes end,
               case when a.sem_valor > 0
                    then a.sem_valor || ' UC com fatura a R$ 0,00: ' || a.ucs_sem_valor end,
               case when a.prontas = 0
                    then 'nada apurado para cobrar' end
           ), '')
    from agregada a
    join subscribers s on s.id = a.subscriber_id
    order by s.name, a.mes_referencia
    limit p_limite;
$$;

revoke execute on function public.fn_fila_emissao_faturas(integer) from anon;

-- Nota deliberada sobre feriado: `fn_vencimento_sugerido` desvia sabado e
-- domingo, nao feriado bancario. A lista de feriados hoje vive no front
-- (src/lib/diasUteis.js) e a Edge Function nao a conhece. Enquanto houver tres
-- caminhos de emissao -- lista, modal e robo -- colocar a regra so aqui criaria
-- uma quarta resposta diferente para a mesma pergunta. Unificar exige mover a
-- lista para o banco e fazer a Edge Function consultar; e mudanca em funcao
-- financeira de producao, e nao entra junto com esta.
