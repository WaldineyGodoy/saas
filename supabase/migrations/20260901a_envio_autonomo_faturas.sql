-- ============================================================================
-- Envio autônomo de faturas — marcadores, fila e demonstrativo
--
-- Até aqui o boleto chegava ao assinante só quando alguém clicava em "Gerar
-- Faturamento" no CRM: a emissão e o envio andavam juntos na mesma função de
-- tela (`sendCombinedNotification`). Quem emitisse por qualquer outro caminho
-- — como as duas faturas da Brigitte Caturano em 01/09/2026 — deixava o
-- cliente sem aviso nenhum até a fatura vencer.
--
-- Esta migration cria o que falta para separar as duas coisas: o envio vira um
-- estágio próprio, que reage a "existe boleto e ninguém mandou ainda".
-- ============================================================================

-- ---------------------------------------------------------------- marcadores
alter table public.invoices
    add column if not exists fatura_enviada_em timestamptz,
    add column if not exists envio_tentativas  integer not null default 0,
    add column if not exists envio_erro        text;

alter table public.consolidated_invoices
    add column if not exists fatura_enviada_em timestamptz,
    add column if not exists envio_tentativas  integer not null default 0,
    add column if not exists envio_erro        text;

comment on column public.invoices.fatura_enviada_em is
    'Quando o PDF (demonstrativo + boleto + conta) foi entregue ao assinante. Nulo = na fila do enviador.';

-- ------------------------------------------------------------------ backfill
--
-- SEM ISTO A PRIMEIRA EXECUÇÃO DISPARA 50 PDFs DE UMA VEZ.
--
-- Toda fatura que já tem boleto foi emitida pela tela, e a tela emite e envia
-- no mesmo clique — ou seja, já chegou ao assinante. Marcar como enviada é o
-- que impede o enviador de reprocessar o histórico inteiro.
--
-- As duas exceções são as faturas 07/2026 da Brigitte (UCs 7030004455 e
-- 7030004579), emitidas em 01/09/2026 direto pela `create-asaas-charge`, sem
-- passar pela tela: essas de fato ninguém enviou, e devem ficar na fila.
update public.invoices
set fatura_enviada_em = coalesce(vencimento::timestamptz, created_at, now())
where asaas_payment_id is not null
  and fatura_enviada_em is null
  and asaas_payment_id not in ('pay_zpa9q3liajtkflxi', 'pay_dv7cje8vredfrwej');

update public.consolidated_invoices
set fatura_enviada_em = coalesce(due_date::timestamptz, created_at, now())
where asaas_payment_id is not null
  and fatura_enviada_em is null;

-- =========================================================== o demonstrativo
--
-- Uma fonte só para os números que o assinante lê.
--
-- Hoje existem QUATRO decomposições da mesma fatura no código: três na tela
-- (unificadas em `decomporFatura` em 29/08/2026) e uma quarta escondida no
-- `renderHiddenInvoiceDetail`, que é justamente a que vira PDF e vai para o
-- cliente. Essa quarta recalcula tudo a partir de `consumo_kwh × tarifa` em
-- vez de ler o que foi gravado — dá o mesmo total quando a tarifa da UC está
-- certa (confirmado nas duas da Brigitte, com 1 centavo de arredondamento),
-- e dá zero quando a tarifa está zerada, que é o defeito nº 1 do pipeline.
--
-- Aqui a conta sai dos valores GRAVADOS, os mesmos que a `fn_calcular_fatura`
-- usou para chegar no valor do boleto. Assim o demonstrativo não tem como
-- discordar da cobrança: é a mesma linha lida duas vezes.
--
--   consumo_reais  = energia compensada COM desconto + tarifa mínima
--   economia_reais = o desconto concedido
--   total          = consumo_reais + iluminação + outros + parcelamento
create or replace function public.fn_demonstrativo_fatura(p_invoice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with base as (
        select
            i.id,
            i.mes_referencia,
            i.vencimento,
            i.data_leitura,
            i.data_leitura_anterior,
            i.status,
            i.valor_a_pagar,
            i.valor_concessionaria,
            i.asaas_boleto_url,
            i.concessionaria_pdf_url,
            coalesce(i.consumo_kwh, 0)          as consumo_kwh,
            coalesce(i.consumo_compensado, 0)   as compensado_kwh,
            coalesce(i.consumo_reais, 0)        as consumo_reais,
            coalesce(i.tarifa_minima, 0)        as tarifa_minima,
            coalesce(i.iluminacao_publica, 0)   as ip,
            coalesce(i.outros_lancamentos, 0)   as outros,
            coalesce(i.parcelamento, 0)         as parcelamento,
            coalesce(i.economia_reais, 0)       as desconto,
            coalesce(nullif(i.desconto_aplicado, 0), cu.desconto_assinante, 0) as percentual,
            cu.id            as uc_id,
            cu.numero_uc,
            cu.titular_conta,
            cu.address       as uc_address,
            s.id             as subscriber_id,
            s.name           as subscriber_name,
            s.email          as subscriber_email,
            s.phone          as subscriber_phone
        from invoices i
        join consumer_units cu on cu.id = i.uc_id
        join subscribers s     on s.id  = cu.subscriber_id
        where i.id = p_invoice_id
    ), calc as (
        select b.*,
               greatest(0, b.consumo_kwh - b.compensado_kwh)   as nao_compensado_kwh,
               greatest(0, b.consumo_reais - b.tarifa_minima)  as compensada_com_desconto
        from base b
    )
    select to_jsonb(x) from (
        select
            c.id                as invoice_id,
            c.uc_id,
            c.numero_uc,
            c.titular_conta,
            c.uc_address,
            c.subscriber_id,
            c.subscriber_name,
            c.subscriber_email,
            c.subscriber_phone,
            to_char(c.mes_referencia, 'MM/YYYY')      as referencia,
            c.vencimento,
            c.data_leitura,
            c.data_leitura_anterior,
            c.status::text                            as status,
            c.asaas_boleto_url,
            c.concessionaria_pdf_url,
            c.consumo_kwh,
            c.compensado_kwh,
            c.nao_compensado_kwh,
            round(c.compensada_com_desconto + c.desconto, 2) as compensada_bruta,
            round(c.desconto, 2)                      as desconto,
            round(c.percentual, 0)                    as percentual_desconto,
            round(c.tarifa_minima, 2)                 as tarifa_minima,
            round(c.ip, 2)                            as iluminacao_publica,
            round(c.outros, 2)                        as outros_lancamentos,
            round(c.parcelamento, 2)                  as parcelamento,
            round(c.consumo_reais + c.ip + c.outros + c.parcelamento, 2) as total,
            round(coalesce(c.valor_a_pagar, 0), 2)    as valor_cobrado,
            round(coalesce(c.valor_concessionaria, 0), 2) as valor_concessionaria
        from calc c
    ) x;
$$;

comment on function public.fn_demonstrativo_fatura(uuid) is
    'Decomposição da fatura a partir dos valores GRAVADOS — mesma fonte do boleto. Usada pelo enviador autônomo.';

-- ================================================================ a fila
--
-- Regra de quem entra: existe boleto, a cobrança está de pé, ninguém enviou e
-- ainda há tentativa disponível. O portão da auditoria não se repete aqui — ele
-- já barrou (ou deixou passar) na emissão, e reauditar depois do boleto criado
-- só produziria fatura cobrada e não entregue.
--
-- O que se confere de novo é o que pode ter mudado DEPOIS da emissão: se o
-- total do demonstrativo ainda bate com o valor cobrado. Divergiu, não sai —
-- mandar ao cliente um demonstrativo que não fecha com o boleto é pior do que
-- não mandar nada.
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
    -- ---------------------------------------------------------- consolidadas
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
             ci.asaas_boleto_url, ci.envio_tentativas
    )
    union all
    -- ---------------------------------------------------------- individuais
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

comment on function public.fn_fila_envio_faturas(integer) is
    'Faturas com boleto emitido e ainda não entregues. `impedimento` preenchido = não enviar.';

-- ======================================================= registro do envio
--
-- Uma tentativa é registrada ANTES de qualquer disparo e o sucesso depois. Se
-- o processo morrer no meio, a fatura volta para a fila com uma tentativa a
-- menos disponível — nunca com o contador intacto, que a faria repetir para
-- sempre.
create or replace function public.fn_registrar_tentativa_envio(
    p_tipo text,
    p_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_tipo = 'consolidada' then
        update consolidated_invoices
        set envio_tentativas = envio_tentativas + 1
        where id = p_id;
    else
        update invoices
        set envio_tentativas = envio_tentativas + 1
        where id = p_id;
    end if;
end;
$$;

create or replace function public.fn_marcar_fatura_enviada(
    p_tipo        text,
    p_id          uuid,
    p_invoice_ids uuid[],
    p_erro        text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_erro is not null then
        if p_tipo = 'consolidada' then
            update consolidated_invoices set envio_erro = left(p_erro, 500) where id = p_id;
        else
            update invoices set envio_erro = left(p_erro, 500) where id = p_id;
        end if;
        return;
    end if;

    if p_tipo = 'consolidada' then
        update consolidated_invoices
        set fatura_enviada_em = now(), envio_erro = null
        where id = p_id;
    end if;

    -- No consolidado as faturas-filha também ficam marcadas: o PDF que saiu
    -- cobre todas, e sem isto elas voltariam à fila individual se o vínculo
    -- com o consolidado fosse desfeito.
    update invoices
    set fatura_enviada_em = now(), envio_erro = null
    where id = any(p_invoice_ids);
end;
$$;

revoke execute on function public.fn_fila_envio_faturas(integer)      from anon;
revoke execute on function public.fn_registrar_tentativa_envio(text, uuid) from anon;
revoke execute on function public.fn_marcar_fatura_enviada(text, uuid, uuid[], text) from anon;
