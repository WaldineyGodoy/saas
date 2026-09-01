-- ============================================================================
-- Retenção deliberada de uma fatura na fila do enviador
--
-- Nasceu de um caso concreto: as duas faturas 07/2026 da Brigitte saíram com
-- vencimento 10/09 quando deveria ser 04/09. Corrigir exige cancelar e
-- reemitir pela tela (o `requireAdmin` das funções financeiras não aceita
-- robô), mas o enviador rodaria antes disso e mandaria a data errada.
--
-- As duas saídas ruins eram marcar como enviada — que é mentira e some com a
-- fatura — ou estourar `envio_tentativas`, que é abusar de um campo com outro
-- sentido e não deixa registro do porquê.
--
-- Aqui a fatura CONTINUA na fila, com o motivo escrito, e o robô a pula:
--
--   [pulado] Brigitte Caturano · 07/2026 · R$ 303,75 — Retida em 01/09/2026: ...
--
-- Limpar o campo devolve a fatura ao fluxo.
-- ============================================================================

alter table public.invoices
    add column if not exists envio_retido_motivo text;

alter table public.consolidated_invoices
    add column if not exists envio_retido_motivo text;

comment on column public.invoices.envio_retido_motivo is
    'Preenchido = o enviador nao envia esta fatura e mostra o motivo. Limpar libera.';

-- A fila passa a devolver o motivo da retenção junto dos demais impedimentos.
create or replace function public.fn_fila_envio_faturas(p_limite integer default 50)
returns table (
    tipo              text,
    id                uuid,
    subscriber_id     uuid,
    subscriber_name   text,
    subscriber_email  text,
    subscriber_phone  text,
    referencia        text,
    vencimento        date,
    valor             numeric,
    boleto_url        text,
    invoice_ids       uuid[],
    tentativas        integer,
    impedimento       text
)
language sql
stable
security definer
set search_path = public
as $$
    (
    select
        'consolidada'::text,
        ci.id,
        s.id,
        s.name,
        s.email,
        s.phone,
        to_char(min(i.mes_referencia), 'MM/YYYY'),
        ci.due_date,
        ci.total_value,
        ci.asaas_boleto_url,
        array_agg(i.id order by cu.numero_uc),
        ci.envio_tentativas,
        nullif(concat_ws('; ',
            ci.envio_retido_motivo,
            case when s.phone is null and s.email is null
                 then 'assinante sem telefone e sem e-mail' end,
            case when ci.asaas_boleto_url is null
                 then 'boleto sem URL' end,
            case when abs(ci.total_value - sum(
                     coalesce(i.consumo_reais,0) + coalesce(i.iluminacao_publica,0)
                   + coalesce(i.outros_lancamentos,0) + coalesce(i.parcelamento,0))) > 0.05
                 then 'demonstrativo nao fecha com o boleto' end
        ), '')
    from consolidated_invoices ci
    join subscribers s   on s.id = ci.subscriber_id
    join invoices i      on i.consolidated_invoice_id = ci.id
    join consumer_units cu on cu.id = i.uc_id
    where ci.asaas_payment_id is not null
      and ci.fatura_enviada_em is null
      and ci.envio_tentativas < 5
      and coalesce(ci.status, '') not in ('paid', 'cancelled', 'canceled')
    group by ci.id, s.id, s.name, s.email, s.phone, ci.due_date, ci.total_value,
             ci.asaas_boleto_url, ci.envio_tentativas, ci.envio_retido_motivo
    )
    union all
    (
    select
        'individual'::text,
        i.id,
        s.id,
        s.name,
        s.email,
        s.phone,
        to_char(i.mes_referencia, 'MM/YYYY'),
        i.vencimento,
        i.valor_a_pagar,
        i.asaas_boleto_url,
        array[i.id],
        i.envio_tentativas,
        nullif(concat_ws('; ',
            i.envio_retido_motivo,
            case when s.phone is null and s.email is null
                 then 'assinante sem telefone e sem e-mail' end,
            case when i.asaas_boleto_url is null
                 then 'boleto sem URL' end,
            case when abs(coalesce(i.valor_a_pagar,0) - (
                     coalesce(i.consumo_reais,0) + coalesce(i.iluminacao_publica,0)
                   + coalesce(i.outros_lancamentos,0) + coalesce(i.parcelamento,0))) > 0.05
                 then 'demonstrativo nao fecha com o boleto' end
        ), '')
    from invoices i
    join consumer_units cu on cu.id = i.uc_id
    join subscribers s     on s.id  = cu.subscriber_id
    where i.asaas_payment_id is not null
      and i.consolidated_invoice_id is null
      and i.fatura_enviada_em is null
      and i.envio_tentativas < 5
      and i.status::text in ('a_vencer', 'atrasado')
      and coalesce(i.asaas_status, '') not in ('RECEIVED', 'CONFIRMED', 'REFUNDED')
    )
    order by 8 nulls last
    limit p_limite;
$$;

revoke execute on function public.fn_fila_envio_faturas(integer) from anon;
