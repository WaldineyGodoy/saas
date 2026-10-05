import { describe, test, expect } from 'vitest';
import { tratarEventoRecarga } from '../supabase/functions/_shared/webhook-recarga';
import { falso, type Consulta } from './support/supabase-falso';

const silencioso = { log: () => {}, warn: () => {}, error: () => {} };
const evento = (type: string, id = 'pi_1') => ({ type, data: { object: { id } } });
const escritas = (cs: Consulta[]) => cs.filter((c) => ['insert', 'update', 'upsert'].includes(c.op));

describe('stripe-charging-webhook: payment_intent.payment_failed (C1a)', () => {
  test('nao encerra a recarga: o motorista pode tentar de novo no MESMO PaymentIntent', async () => {
    const { cliente, consultas } = falso(() => ({ data: [] }));
    await tratarEventoRecarga(cliente, evento('payment_intent.payment_failed'), silencioso);
    expect(escritas(consultas)).toEqual([]);
    expect(consultas.filter((c) => c.rpc)).toEqual([]);
  });
});

describe('stripe-charging-webhook: payment_intent.succeeded', () => {
  test('recarga failed/canceled que recebe o pagamento depois: marca estorno total (C1b)', async () => {
    const { cliente, consultas } = falso((q) => {
      if (q.rpc === 'fn_marcar_recarga_paga') return { data: null };
      if (q.rpc === 'fn_marcar_estorno_pagamento_tardio') return { data: 'rec_1' };
      if (q.tabela === 'recargas_eletroposto' && q.op === 'select') return { data: null }; // nao esta paid
      throw new Error(`consulta inesperada: ${JSON.stringify(q)}`);
    });
    const r = await tratarEventoRecarga(cliente, evento('payment_intent.succeeded', 'pi_tardio'), silencioso);
    expect(r).toBe('estorno_tardio');
    const rpc = consultas.find((c) => c.rpc === 'fn_marcar_estorno_pagamento_tardio');
    expect(rpc?.args).toEqual({ p_payment_intent_id: 'pi_tardio' });
    expect(escritas(consultas)).toEqual([]); // nada de comando nem de idTag
  });

  test('reentrega de recarga ja processada: nada a fazer', async () => {
    const { cliente, consultas } = falso((q) => {
      if (q.rpc === 'fn_marcar_recarga_paga') return { data: null };
      if (q.rpc === 'fn_marcar_estorno_pagamento_tardio') return { data: null };
      if (q.tabela === 'recargas_eletroposto' && q.op === 'select') return { data: null };
      throw new Error(`consulta inesperada: ${JSON.stringify(q)}`);
    });
    expect(await tratarEventoRecarga(cliente, evento('payment_intent.succeeded'), silencioso)).toBe('nada');
    expect(escritas(consultas)).toEqual([]);
  });

  test('recarga paga sem destino: fn_confirmar_inicio a encerra; sem comando e SEM lancar (I1)', async () => {
    const { cliente, consultas } = falso((q) => {
      if (q.rpc === 'fn_marcar_recarga_paga') return { data: 'rec_2' };
      if (q.rpc === 'fn_confirmar_inicio') return { data: 'sem_destino' };
      throw new Error(`consulta inesperada: ${JSON.stringify(q)}`);
    });
    expect(await tratarEventoRecarga(cliente, evento('payment_intent.succeeded'), silencioso)).toBe('sem_destino');
    expect(escritas(consultas)).toEqual([]);
  });

  test('conflito de conector: sem comando', async () => {
    const { cliente, consultas } = falso((q) => {
      if (q.rpc === 'fn_marcar_recarga_paga') return { data: 'rec_3' };
      if (q.rpc === 'fn_confirmar_inicio') return { data: 'conflito' };
      throw new Error(`consulta inesperada: ${JSON.stringify(q)}`);
    });
    expect(await tratarEventoRecarga(cliente, evento('payment_intent.succeeded'), silencioso)).toBe('conflito');
    expect(escritas(consultas)).toEqual([]);
  });

  test('fluxo feliz: idTag + comando start:<recarga>', async () => {
    const { cliente, consultas } = falso((q) => {
      if (q.rpc === 'fn_marcar_recarga_paga') return { data: 'rec_4' };
      if (q.rpc === 'fn_confirmar_inicio') return { data: 'ok' };
      if (q.tabela === 'recargas_eletroposto' && q.op === 'select') {
        return { data: { id: 'rec_4', carregador_id: 'cp_1', ocpp_connector_id: 1, ocpp_id_tag: null } };
      }
      if (q.tabela === 'ocpp_id_tags' && q.op === 'select') return { data: [] };
      return { data: null };
    });
    expect(await tratarEventoRecarga(cliente, evento('payment_intent.succeeded'), silencioso)).toBe('ok');
    const cmd = consultas.find((c) => c.tabela === 'ocpp_comandos' && c.op === 'upsert');
    expect((cmd?.payload as any).chave_idempotencia).toBe('start:rec_4');
    expect((cmd?.payload as any).acao).toBe('RemoteStartTransaction');
  });

  test('erro do banco lanca (a Stripe reenvia)', async () => {
    const { cliente } = falso(() => ({ error: { message: 'caiu' } }));
    await expect(tratarEventoRecarga(cliente, evento('payment_intent.succeeded'), silencioso)).rejects.toBeTruthy();
  });
});
