// Efeitos do webhook da Stripe na recarga (stripe-charging-webhook). Sem imports Deno nem SDK:
// recebe o cliente Supabase (service role) e o evento JA verificado pela assinatura. Testado pelo
// Vitest em tests/stripe-charging-webhook.test.ts com um cliente falso.
// Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §5.4, §8.3
import {
  comandoInicio, expiraIdTag, gerarIdTag, novaExpiracaoDeTagReutilizado, RESERVA_PAGAMENTO_MIN,
} from './recarga.ts';

// deno-lint-ignore no-explicit-any
type Cliente = any;
type Log = { log: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
export type EventoRecarga = { type: string; data: { object: { id: string } } };
export type ResultadoWebhook =
  | 'ok' | 'conflito' | 'sem_destino' | 'ignorada' | 'estorno_tardio' | 'nada' | 'pagamento_recusado' | 'evento_ignorado';

const P = '[stripe-charging-webhook]';

// Garante idTag + comando de inicio da recarga. Idempotente e reentrante: se a
// primeira entrega caiu no meio (recarga ja 'paid', Stripe reenvia e o RPC
// devolve nulo), a nova tentativa reaproveita o idTag existente e o unique
// de chave_idempotencia ('start:<id>') impede o 2o comando (RC-10).
export async function garantirComandoInicio(supabase: Cliente, recargaId: string): Promise<void> {
  const { data: recarga, error: rErr } = await supabase
    .from('recargas_eletroposto')
    .select('id, carregador_id, ocpp_connector_id, ocpp_id_tag')
    .eq('id', recargaId)
    .single();
  if (rErr) throw rErr;
  // fn_confirmar_inicio ja encerra (sem_destino) a recarga sem destino; isto so protege contra corrida
  if (!recarga.carregador_id) throw new Error(`Recarga ${recargaId} sem carregador resolvido no checkout.`);

  // Duas entregas simultaneas podem chegar aqui juntas. A verdade e o tag que
  // esta em ocpp_id_tags (unique parcial por recarga_id): quem perde o insert
  // (23505) le o vencedor, e todos usam o mesmo tag no comando e na recarga.
  const lerTag = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from('ocpp_id_tags').select('id_tag').eq('recarga_id', recargaId).limit(1);
    if (error) throw error;
    return data?.[0]?.id_tag ?? null;
  };
  let idTag = await lerTag();
  let tagNovo = false;
  if (!idTag) {
    const candidato = gerarIdTag();
    const { error } = await supabase.from('ocpp_id_tags').insert({
      id_tag: candidato,
      recarga_id: recargaId,
      expira_em: expiraIdTag(),
    });
    if (error && error.code !== '23505') throw error;
    idTag = error ? await lerTag() : candidato;
    tagNovo = !error;
    if (!idTag) throw new Error(`Recarga ${recargaId}: idTag nao encontrado apos conflito.`);
  }
  if (recarga.ocpp_id_tag !== idTag) {
    const { error } = await supabase.from('recargas_eletroposto').update({ ocpp_id_tag: idTag }).eq('id', recargaId);
    if (error) throw error;
  }

  // Tag reutilizado (entrega anterior morreu antes do comando): sem comando start
  // a validade e renovada, senao o CSMS poderia responder Expired a quem pagou.
  if (!tagNovo) {
    const { data: existente, error: eErr } = await supabase
      .from('ocpp_comandos').select('id').eq('chave_idempotencia', `start:${recargaId}`).maybeSingle();
    if (eErr) throw eErr;
    const nova = novaExpiracaoDeTagReutilizado(!!existente);
    if (nova) {
      const { error } = await supabase.from('ocpp_id_tags').update({ expira_em: nova }).eq('id_tag', idTag);
      if (error) throw error;
    }
  }

  const cmd = comandoInicio(recarga, idTag);
  const { error: cErr } = await supabase.from('ocpp_comandos').upsert(
    {
      carregador_id: recarga.carregador_id,
      acao: cmd.acao,
      payload: cmd.payload,
      chave_idempotencia: cmd.chave_idempotencia,
      expira_em: cmd.expira_em,
      recarga_id: recargaId,
    },
    { onConflict: 'chave_idempotencia', ignoreDuplicates: true },
  );
  if (cErr) throw cErr;
}

// Depois de pago: so inicia se o conector ainda e desta recarga. A reserva de
// 10 min pode ter vencido e outro motorista reservado/pago o mesmo conector
// ('conflito'), ou a recarga pode nao ter destino resolvido ('sem_destino',
// checkout antigo). Nos dois casos fn_confirmar_inicio marca a recarga failed
// com metadata.estorno_total_pendente (o CSMS faz o estorno total), NENHUM
// comando start e criado e o webhook responde 200 (reenviar nao muda nada).
export async function iniciarRecarga(supabase: Cliente, recargaId: string, log: Log): Promise<ResultadoWebhook> {
  const { data: veredito, error } = await supabase.rpc('fn_confirmar_inicio', {
    p_recarga_id: recargaId,
    p_reserva_min: RESERVA_PAGAMENTO_MIN,
  });
  if (error) throw error;
  if (veredito === 'conflito') {
    log.warn(`${P} Recarga ${recargaId}: conector ja reservado por outro; falhou com estorno total pendente.`);
    return 'conflito';
  }
  if (veredito === 'sem_destino') {
    log.warn(`${P} Recarga ${recargaId}: paga sem carregador/conector resolvido; falhou com estorno total pendente.`);
    return 'sem_destino';
  }
  if (veredito !== 'ok') return 'ignorada';
  await garantirComandoInicio(supabase, recargaId);
  return 'ok';
}

async function pagamentoConfirmado(supabase: Cliente, piId: string, log: Log): Promise<ResultadoWebhook> {
  // RC-10: so a primeira entrega surte efeito; reenvio devolve nulo.
  const { data: recargaId, error } = await supabase.rpc('fn_marcar_recarga_paga', { p_payment_intent_id: piId });
  if (error) throw error;
  if (recargaId) {
    log.log(`${P} Recarga ${recargaId} marcada como 'paid'.`);
    return iniciarRecarga(supabase, recargaId, log);
  }

  // Reenvio. Se a 1a entrega morreu depois de marcar 'paid' e antes de
  // criar o comando, a recarga ainda esta 'paid' sem start: completa agora.
  const { data: paga, error: pErr } = await supabase
    .from('recargas_eletroposto')
    .select('id')
    .eq('stripe_payment_intent_id', piId)
    .eq('status', 'paid')
    .maybeSingle();
  if (pErr) throw pErr;
  if (paga) {
    log.log(`${P} Recarga ${paga.id} 'paid' sem comando: recuperando.`);
    return iniciarRecarga(supabase, paga.id, log);
  }

  // C1: o dinheiro entrou para uma recarga ja encerrada sem energia (failed/canceled). Sem isto a
  // Stripe capturava e ninguem devolvia. A marca faz o CSMS estornar o valor inteiro.
  const { data: tardia, error: tErr } = await supabase.rpc('fn_marcar_estorno_pagamento_tardio', {
    p_payment_intent_id: piId,
  });
  if (tErr) throw tErr;
  if (tardia) {
    log.warn(`${P} PI ${piId}: pago depois de a recarga ${tardia} encerrar; estorno total pendente.`);
    return 'estorno_tardio';
  }
  log.log(`${P} PI ${piId}: recarga ja processada ou inexistente; nada a fazer.`);
  return 'nada';
}

// payment_failed NAO encerra a recarga: o Payment Element continua aberto e o motorista pode
// tentar de novo no MESMO PaymentIntent (outro cartao, Pix). Se desistir, a reserva de
// RESERVA_PAGAMENTO_MIN minutos vence sozinha e o conector fica livre; se pagar depois de outro
// reservar o conector, fn_confirmar_inicio da 'conflito' (estorno total).
export async function tratarEventoRecarga(supabase: Cliente, event: EventoRecarga, log: Log = console): Promise<ResultadoWebhook> {
  const piId = event.data.object.id;
  if (event.type === 'payment_intent.succeeded') return pagamentoConfirmado(supabase, piId, log);
  if (event.type === 'payment_intent.payment_failed') {
    log.log(`${P} PI ${piId}: pagamento recusado; recarga segue aguardando nova tentativa ate a reserva vencer.`);
    return 'pagamento_recusado';
  }
  return 'evento_ignorado';
}
