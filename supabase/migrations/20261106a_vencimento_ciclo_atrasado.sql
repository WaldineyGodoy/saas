-- Vencimento de ciclo atrasado e feriado bancario no robo emissor.
--
-- Caso de origem: Guanabara (dia de vencimento 5). Em 04, 05 e 06/11/2026 o
-- emissor soltou um ciclo atrasado por execucao (06, 07 e 08/2026), todos com
-- vencimento 07/12/2026. A regra so conhecia o dia cadastrado: hoje + 2 = 06/11
-- passou do dia 5, entao foi para 05/12, sabado, 07/12. Mais de um mes para
-- cobrar conta que ja estava atrasada.
--
-- Decisao do dono (06/11/2026):
--   * prazo minimo continua hoje + 2 dias corridos;
--   * o vencimento deixa de seguir o dia cadastrado quando o ciclo esta
--     atrasado -- vence no primeiro dia util a partir do prazo minimo;
--   * ciclo atrasado continua saindo em boleto proprio, um por ciclo (o boleto
--     unico da Guanabara de 09/11 foi excecao de urgencia).
--
-- Ciclo atrasado = ciclo anterior ao mes passado (em 11/2026, ciclo 09/2026 ou
-- mais antigo) OU ciclo que ja tem ciclo mais novo em aberto para o assinante
-- (o "retroativo" da fila). O ciclo normal de 11/2026 e o 10/2026, que segue o
-- dia cadastrado como sempre.
--
-- Feriado: a nota do 20260903a deixou o feriado de fora porque a lista so
-- vivia no front. Ela passa a existir no banco, igual a src/lib/diasUteis.js
-- (nacionais + Carnaval e Corpus Christi por fechamento bancario), e os dois
-- caminhos do vencimento -- ciclo normal e atrasado -- pulam feriado alem do fim
-- de semana. A Edge Function nao muda: ela usa vencimento_sugerido da fila.

create or replace function public.fn_domingo_pascoa(p_ano integer)
returns date
language plpgsql
immutable
as $$
declare
    a int := p_ano % 19;
    b int := p_ano / 100;
    c int := p_ano % 100;
    d int := b / 4;
    e int := b % 4;
    f int := (b + 8) / 25;
    g int := (b - f + 1) / 3;
    h int := (19 * a + b - d - g + 15) % 30;
    i int := c / 4;
    k int := c % 4;
    l int := (32 + 2 * e + 2 * i - h - k) % 7;
    m int := (a + 11 * h + 22 * l) / 451;
begin
    return make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

-- Mesmo calendario de src/lib/diasUteis.js. Mudou la, muda aqui.
create or replace function public.fn_eh_dia_util(p_data date)
returns boolean
language sql
immutable
as $$
    select extract(isodow from p_data) < 6
       and to_char(p_data, 'MM-DD') not in
           ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25')
       and p_data not in (
           public.fn_domingo_pascoa(extract(year from p_data)::int) - 48,  -- Carnaval (segunda)
           public.fn_domingo_pascoa(extract(year from p_data)::int) - 47,  -- Carnaval (terca)
           public.fn_domingo_pascoa(extract(year from p_data)::int) - 2,   -- Sexta-feira Santa
           public.fn_domingo_pascoa(extract(year from p_data)::int) + 60); -- Corpus Christi
$$;

create or replace function public.fn_proximo_dia_util(p_data date)
returns date
language sql
immutable
as $$
    select min(d)::date
      from generate_series(p_data, p_data + 15, interval '1 day') d
     where public.fn_eh_dia_util(d::date);
$$;

-- p_atrasado = true: primeiro dia util a partir de hoje + 2.
-- p_atrasado = false: proxima ocorrencia do dia cadastrado a partir de hoje + 2
-- (mes curto vira o ultimo dia do mes), empurrada para dia util.
create or replace function public.fn_vencimento_sugerido(p_dia integer, p_atrasado boolean)
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
        select case
            when p_atrasado then d
            when v >= d     then v
            else make_date(extract(year from (d + interval '1 month'))::int,
                           extract(month from (d + interval '1 month'))::int,
                           least(p_dia, extract(day from (date_trunc('month', d + interval '1 month')
                                                          + interval '1 month - 1 day'))::int))
            end as v
        from cand
    )
    select public.fn_proximo_dia_util(v) from escolhido;
$$;

-- A versao de um argumento fica para quem ainda a chame: ciclo normal.
create or replace function public.fn_vencimento_sugerido(p_dia integer)
returns date
language sql
stable
as $$
    select public.fn_vencimento_sugerido(p_dia, false);
$$;

-- Na fila, so a chamada do vencimento muda. Troca e confere que pegou.
do $mig$
declare
    d text := pg_get_functiondef('public.fn_fila_emissao_faturas(integer)'::regprocedure);
    antes text := 'public.fn_vencimento_sugerido(coalesce(s.consolidated_due_day, 10)),';
    depois text := 'public.fn_vencimento_sugerido(coalesce(s.consolidated_due_day, 10),
               a.mes_referencia < a.ciclo_mais_novo
               or a.mes_referencia < (date_trunc(''month'', current_date) - interval ''1 month'')::date),';
begin
    if position(antes in d) = 0 then
        raise exception 'fn_fila_emissao_faturas mudou: chamada do vencimento nao encontrada';
    end if;
    execute replace(d, antes, depois);
end
$mig$;
