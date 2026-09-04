-- ============================================================================
-- A fila de emissao nao pode enxergar UC geradora
--
-- Furo meu, encontrado em 03/09/2026 ao conferir uma divergencia de R$ 187,01
-- que o dono do sistema apontou. A `fn_fila_emissao_faturas` classificava
-- qualquer UC com fatura apurada como `pronta`, sem olhar `tipo_unidade`.
-- Resultado: a UC 7021781376 (geradora, Novo Leblon - G8) aparecia PRONTA em
-- dois ciclos, 03/2026 e 08/2026, e o emissor teria criado duas cobrancas
-- reais contra uma usina.
--
-- Na UC geradora as duas obrigacoes da linha de `invoices` se separam: existe
-- conta a pagar a concessionaria (`energy_bill_status`), e NAO existe boleto de
-- assinante. `valor_a_pagar` ali e residuo de calculo, nao cobranca devida.
-- Emitir contra ela injeta recebimento fantasma no razao -- ja aconteceu duas
-- vezes por marcar fatura de UG como paga, e a automacao transformaria o
-- acidente ocasional em rotina diaria.
--
-- Hoje sao 7 UCs geradoras, 3 ainda vinculadas a assinante, entao o risco nao
-- era de uma linha isolada.
--
-- A geradora sai das DUAS pontas: nao entra como fatura cobravel, e nao conta
-- para o fechamento do ciclo -- senao passaria a travar o assinante inteiro por
-- uma fatura que ninguem jamais vai emitir.
-- ============================================================================

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
          and coalesce(cu.tipo_unidade, 'beneficiaria') <> 'geradora'
          and i.status::text <> 'cancelado'
    ),
    abertas as (select * from todas where not cobrada and st <> 'pago'),
    ciclos  as (select distinct subscriber_id, mes_referencia from abertas),
    esperadas as (
        select c.subscriber_id, c.mes_referencia, cu.id as uc_id, cu.numero_uc
        from ciclos c
        join consumer_units cu on cu.subscriber_id = c.subscriber_id
        where coalesce(cu.nao_faturavel, false) = false
          and coalesce(cu.tipo_unidade, 'beneficiaria') <> 'geradora'
          and (cu.status::text in ('ativo','em_atraso','em_transf_titularidade')
               or exists (select 1 from abertas a
                          where a.uc_id = cu.id and a.mes_referencia = c.mes_referencia))
    ),
    classificada as (
        select e.subscriber_id, e.mes_referencia, e.numero_uc, t.invoice_id, t.valor,
               case
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
