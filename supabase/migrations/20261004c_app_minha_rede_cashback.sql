-- Home Connect: cashback lido no formato real do motor do Plano de Recompensas.
--
-- O handle_invoice_paid_ledger grava em invoices.recompensas_aplicadas um
-- OBJETO; a parte de cada recebedor fica em resultado.beneficiarios[], no
-- formato {papel, id, nivel, pct, valor, cortado}. A parte do indicador e' o
-- item com papel = 'assinante_conect' e id = o assinante dele (vale para a
-- recorrencia e para o Bonus Start, que passam pelo mesmo split). A versao
-- anterior esperava uma lista na raiz e somava todos os valores: dava sempre 0.
--
-- Decisao do dono (04/10/2026): so' contam faturas do motor (as que tem
-- recompensas_aplicadas); o valor de cada indicado e' o acumulado.
--
-- Indicados: os dois caminhos que o motor aceita (fn_participantes_recompensa):
-- subscribers.indicador_assinante_id ou consumer_units.indicado_por_uc_id
-- apontando para uma UC do usuario.

create or replace function public.app_minha_rede()
returns table (
    subscriber_id uuid, name text, status text, numero_uc text, cidade text,
    uf text, consumo_kwh numeric, cashback numeric, fatura_status text,
    fatura_vencimento date
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
    with eu as (select fn_app_subscriber_id() as id),
    indicados as (
        select s.* from subscribers s, eu
         where eu.id is not null
           and s.id <> eu.id
           and (s.indicador_assinante_id = eu.id
                or exists (select 1
                             from consumer_units c
                             join consumer_units minha on minha.id = c.indicado_por_uc_id
                            where c.subscriber_id = s.id
                              and minha.subscriber_id = eu.id))
    )
    select s.id, s.name, s.status::text, u.numero_uc, s.cidade, s.uf,
           f.consumo_kwh,
           coalesce((
               select sum((b->>'valor')::numeric)
                 from consumer_units c
                 join invoices i on i.uc_id = c.id
                 cross join lateral jsonb_array_elements(
                        case when jsonb_typeof(i.recompensas_aplicadas #> '{resultado,beneficiarios}') = 'array'
                             then i.recompensas_aplicadas #> '{resultado,beneficiarios}'
                             else '[]'::jsonb end) b
                where c.subscriber_id = s.id
                  and b->>'papel' = 'assinante_conect'
                  and b->>'id' = (select id::text from eu)
                  and (b->>'valor') ~ '^-?[0-9]+(\.[0-9]+)?$'), 0),
           f.status::text, f.vencimento
      from indicados s
      left join lateral (
            select c.* from consumer_units c
             where c.subscriber_id = s.id
             order by c.created_at limit 1) u on true
      left join lateral (
            select i.* from invoices i
             where i.uc_id = u.id
               and i.status::text not in ('cancelado', 'cancelada')
               and coalesce(i.is_placeholder, false) = false
             order by i.mes_referencia desc nulls last
             limit 1) f on true
     order by s.created_at desc;
$$;
