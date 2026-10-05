-- B2W Charge: dinheiro capturado sem recarga sempre vira estorno total (revisao final, C1 e I1).
-- Teste: supabase/tests/recarga_estorno_tardio.test.sql
-- Depende de 20261004a..d. So CREATE OR REPLACE + grants: pode ser reaplicada.
--
-- C1. Cartao recusado nao encerra mais a recarga (o webhook so registra o payment_failed e a reserva
-- de 10 min vence sozinha). Mas recargas que ja viraram failed/canceled antes de o pagamento entrar
-- (codigo antigo do webhook, checkout que liberou a reserva) podem receber um payment_intent.succeeded
-- depois: o dinheiro foi capturado e nao ha recarga. fn_marcar_estorno_pagamento_tardio grava
-- metadata.estorno_total_pendente = true, o mesmo contrato da varredura reconciliarEstornos do CSMS
-- (estorno total + valor_estornado + limpa a marca).
--
-- I1. Recarga paga sem destino resolvido (carregador_id/ocpp_connector_id nulos, ex.: checkout antigo)
-- fazia fn_confirmar_inicio devolver 'ok' e o webhook lancar para sempre (a Stripe reenviava sem fim e
-- ninguem estornava). Agora vira failed + estorno total pendente e devolve 'sem_destino'.

-- ---------------------------------------------------------------------------
-- 1. Pagamento confirmado de recarga ja encerrada sem energia
-- ---------------------------------------------------------------------------
-- Marca so quem: esta failed/canceled, nunca teve transacao OCPP (nao houve energia), nao tem
-- estorno registrado (stripe_refund_id nulo e valor_estornado nulo/zero) e ainda nao esta marcada.
-- Um UPDATE so (atomico) e merge do jsonb (as demais chaves de metadata ficam). Devolve o id da
-- recarga marcada agora, ou nulo (reentrega, ja estornada, outro status, PI desconhecido).
create or replace function public.fn_marcar_estorno_pagamento_tardio(p_payment_intent_id text)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
    update recargas_eletroposto
       set metadata      = coalesce(metadata, '{}'::jsonb) || '{"estorno_total_pendente": true}'::jsonb,
           valor_final   = 0,
           finalizada_em = coalesce(finalizada_em, now()),
           motivo_fim    = coalesce(motivo_fim, 'pago_apos_falha'),
           updated_at    = now()
     where stripe_payment_intent_id = p_payment_intent_id
       and status in ('failed', 'canceled')
       and ocpp_transacao_id is null
       and stripe_refund_id is null
       and coalesce(valor_estornado, 0) = 0
       and coalesce(metadata->>'estorno_total_pendente', 'false') <> 'true'
    returning id;
$$;

comment on function public.fn_marcar_estorno_pagamento_tardio(text) is
    'payment_intent.succeeded de recarga failed/canceled sem energia nem estorno: marca estorno total pendente (CSMS estorna). Idempotente.';
revoke all on function public.fn_marcar_estorno_pagamento_tardio(text) from public, anon, authenticated;
grant execute on function public.fn_marcar_estorno_pagamento_tardio(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. fn_confirmar_inicio: recarga paga sem destino -> 'sem_destino' (+ estorno total)
-- ---------------------------------------------------------------------------
-- Igual a 20261004c, exceto o ramo sem destino:
--   'ok'          nenhuma outra recarga segura o conector: pode iniciar;
--   'conflito'    outra recarga segura o conector: failed + estorno total pendente;
--   'sem_destino' recarga paga sem carregador/conector resolvido: failed + estorno total pendente;
--   'ignorada'    a recarga nao esta mais paid (reentrega do webhook): nada a fazer.
create or replace function public.fn_confirmar_inicio(p_recarga_id uuid, p_reserva_min integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v recargas_eletroposto%rowtype;
begin
    select * into v from recargas_eletroposto where id = p_recarga_id;
    if not found then
        return 'ignorada';
    end if;

    if v.carregador_id is null or v.ocpp_connector_id is null then
        -- guardado pelo status: duas entregas simultaneas, so uma transiciona
        update recargas_eletroposto
           set status = 'failed',
               valor_final = 0,
               finalizada_em = now(),
               motivo_fim = 'sem_destino',
               metadata = coalesce(metadata, '{}'::jsonb) || '{"estorno_total_pendente": true}'::jsonb
         where id = v.id
           and status = 'paid';
        return case when found then 'sem_destino' else 'ignorada' end;
    end if;

    perform pg_advisory_xact_lock(hashtext('conector_reserva:' || v.carregador_id::text || ':' || v.ocpp_connector_id::text));

    select * into v from recargas_eletroposto where id = p_recarga_id;
    if v.status <> 'paid' then
        return 'ignorada';
    end if;

    if exists (
        select 1 from recargas_eletroposto r
         where r.id <> v.id
           and r.carregador_id = v.carregador_id
           and r.ocpp_connector_id = v.ocpp_connector_id
           and (
                r.status in ('paid', 'starting', 'charging')
                or (r.status = 'pending_payment'
                    and r.created_at > now() - make_interval(mins => p_reserva_min))
           )
    ) then
        update recargas_eletroposto
           set status = 'failed',
               valor_final = 0,
               finalizada_em = now(),
               motivo_fim = 'conector_reservado_por_outro',
               metadata = coalesce(metadata, '{}'::jsonb) || '{"estorno_total_pendente": true}'::jsonb
         where id = v.id;
        return 'conflito';
    end if;

    return 'ok';
end;
$$;

revoke all on function public.fn_confirmar_inicio(uuid, integer) from public, anon, authenticated;
grant execute on function public.fn_confirmar_inicio(uuid, integer) to service_role;
