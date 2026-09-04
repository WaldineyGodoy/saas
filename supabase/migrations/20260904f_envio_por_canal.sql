-- ============================================================================
-- Envio registrado por canal, e nao num carimbo so
--
-- `fatura_enviada_em` significa "algum canal saiu". Serve para a fila do
-- enviador -- que so precisa saber se a fatura ja chegou de alguma forma -- e
-- nao serve para responder "o WhatsApp foi?".
--
-- A pergunta apareceu tres vezes nesta semana e a resposta honesta foi sempre
-- "nao da para saber pelo banco". Em 01/09/2026 a tela chegou a dizer
-- "notificacao via WhatsApp enviada" numa entrega em que so o e-mail tinha
-- saido: o carimbo unico nao distingue, e a frase da tela prometia mais do que
-- o dado sustentava.
--
-- O `crm_history` ja registrava os dois canais separados, nos dois caminhos de
-- envio -- o dado existia, mas so em texto livre dentro do historico, invisivel
-- para consulta. Aqui ele vira coluna.
--
-- `fatura_enviada_em` continua com o sentido antigo, de proposito: a fila do
-- enviador depende dele, e mudar o significado de uma coluna que outro robo le
-- e a forma mais rapida de quebrar duas coisas de uma vez.
-- ============================================================================

alter table public.invoices
    add column if not exists enviado_whatsapp_em timestamptz,
    add column if not exists enviado_email_em    timestamptz,
    add column if not exists envio_canais        jsonb;

alter table public.consolidated_invoices
    add column if not exists enviado_whatsapp_em timestamptz,
    add column if not exists enviado_email_em    timestamptz,
    add column if not exists envio_canais        jsonb;

comment on column public.invoices.enviado_whatsapp_em is
    'Quando o WhatsApp saiu de fato. Nulo = nao saiu por esse canal, mesmo que fatura_enviada_em esteja preenchido.';
comment on column public.invoices.envio_canais is
    'Resultado por canal da ultima tentativa: {whatsapp:{ok,erro},email:{ok,erro}}.';

-- ---------------------------------------------------------------------------
-- A funcao ganha os resultados por canal.
--
-- Precisa de DROP: `create or replace` nao muda lista de argumentos, e criar a
-- versao nova ao lado deixaria duas candidatas para uma chamada de 4 argumentos
-- -- Postgres recusa por ambiguidade. Os chamadores antigos, que passam so os
-- quatro primeiros por nome, seguem funcionando com os defaults.
-- ---------------------------------------------------------------------------
drop function if exists public.fn_marcar_fatura_enviada(text, uuid, uuid[], text);

create function public.fn_marcar_fatura_enviada(
    p_tipo           text,
    p_id             uuid,
    p_invoice_ids    uuid[]  default null,
    p_erro           text    default null,
    p_whatsapp_ok    boolean default null,
    p_whatsapp_erro  text    default null,
    p_email_ok       boolean default null,
    p_email_erro     text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ids     uuid[];
    v_agora   timestamptz := now();
    v_wa      timestamptz;
    v_email   timestamptz;
    v_canais  jsonb;
begin
    v_wa    := case when p_whatsapp_ok then v_agora end;
    v_email := case when p_email_ok    then v_agora end;

    v_canais := jsonb_build_object(
        'whatsapp', jsonb_build_object('ok', coalesce(p_whatsapp_ok, false), 'erro', p_whatsapp_erro),
        'email',    jsonb_build_object('ok', coalesce(p_email_ok, false),    'erro', p_email_erro),
        'em',       v_agora
    );

    if p_erro is not null then
        -- Falha total: nao carimba entrega, mas registra o que cada canal disse.
        -- Sem isto, tentativa fracassada nao deixava diagnostico por canal.
        if p_tipo = 'consolidada' then
            update consolidated_invoices
            set envio_erro = left(p_erro, 500), envio_canais = v_canais
            where id = p_id;

            v_ids := coalesce(p_invoice_ids,
                (select array_agg(id) from invoices where consolidated_invoice_id = p_id));
            update invoices set envio_erro = left(p_erro, 500), envio_canais = v_canais
            where id = any(v_ids);
        else
            update invoices set envio_erro = left(p_erro, 500), envio_canais = v_canais
            where id = coalesce(p_invoice_ids[1], p_id);
        end if;
        return;
    end if;

    if p_tipo = 'consolidada' then
        update consolidated_invoices
        set fatura_enviada_em    = v_agora,
            enviado_whatsapp_em  = coalesce(v_wa, enviado_whatsapp_em),
            enviado_email_em     = coalesce(v_email, enviado_email_em),
            envio_canais         = v_canais,
            envio_erro           = null,
            envio_retido_motivo  = null
        where id = p_id;

        v_ids := coalesce(
            p_invoice_ids,
            (select array_agg(id) from invoices where consolidated_invoice_id = p_id)
        );
    else
        v_ids := coalesce(p_invoice_ids, array[p_id]);
    end if;

    update invoices
    set fatura_enviada_em    = v_agora,
        enviado_whatsapp_em  = coalesce(v_wa, enviado_whatsapp_em),
        enviado_email_em     = coalesce(v_email, enviado_email_em),
        envio_canais         = v_canais,
        envio_erro           = null,
        envio_retido_motivo  = null
    where id = any(v_ids);
end;
$$;

revoke execute on function public.fn_marcar_fatura_enviada(text, uuid, uuid[], text, boolean, text, boolean, text) from anon;

-- ---------------------------------------------------------------------------
-- Resposta direta para "o WhatsApp foi?"
-- ---------------------------------------------------------------------------
create or replace function public.fn_entrega_por_canal(p_desde date default current_date - 30)
returns table (
    assinante   text,
    tipo        text,
    referencia  text,
    valor       numeric,
    whatsapp    timestamptz,
    email       timestamptz,
    erro_whatsapp text,
    erro_email    text
)
language sql
stable
security definer
set search_path = public
as $$
    select s.name,
           'consolidada'::text,
           to_char(min(i.mes_referencia), 'MM/YYYY'),
           round(ci.total_value, 2),
           ci.enviado_whatsapp_em,
           ci.enviado_email_em,
           ci.envio_canais #>> '{whatsapp,erro}',
           ci.envio_canais #>> '{email,erro}'
    from consolidated_invoices ci
    join subscribers s on s.id = ci.subscriber_id
    join invoices i on i.consolidated_invoice_id = ci.id
    where ci.fatura_enviada_em >= p_desde
    group by s.name, ci.id, ci.total_value, ci.enviado_whatsapp_em, ci.enviado_email_em, ci.envio_canais

    union all

    select s.name,
           'individual'::text,
           to_char(i.mes_referencia, 'MM/YYYY'),
           round(i.valor_a_pagar, 2),
           i.enviado_whatsapp_em,
           i.enviado_email_em,
           i.envio_canais #>> '{whatsapp,erro}',
           i.envio_canais #>> '{email,erro}'
    from invoices i
    join consumer_units cu on cu.id = i.uc_id
    join subscribers s on s.id = cu.subscriber_id
    where i.fatura_enviada_em >= p_desde
      and i.consolidated_invoice_id is null

    order by 5 desc nulls last;
$$;

revoke execute on function public.fn_entrega_por_canal(date) from anon;
