import { describe, test, expect } from 'vitest';
import { enfileirarParada } from '../supabase/functions/_shared/parada-recarga';
import { falso, type Consulta } from './support/supabase-falso';

const recarga = { id: 'rec_1', carregador_id: 'cp_1', ocpp_transacao_id: 42 };
const agora = new Date('2026-10-05T12:00:00.000Z');
const silencioso = { log: () => {}, warn: () => {}, error: () => {} };
const doTipo = (cs: Consulta[], tabela: string, op: string) => cs.filter((c) => c.tabela === tabela && c.op === op);

describe('stop-charging: enfileirarParada (I3)', () => {
  test('primeira parada: cria stop:<recarga>; o rearme guardado nao acha nada; sem alerta', async () => {
    const { cliente, consultas } = falso((q) => (q.op === 'update' ? { data: [] } : { data: [{ id: 'cmd_1' }] }));
    expect(await enfileirarParada(cliente, recarga, agora, silencioso)).toBe('enfileirada');
    const [ins] = doTipo(consultas, 'ocpp_comandos', 'upsert');
    expect(ins.payload).toMatchObject({
      carregador_id: 'cp_1', acao: 'RemoteStopTransaction', payload: { transactionId: 42 },
      chave_idempotencia: 'stop:rec_1', recarga_id: 'rec_1',
    });
    expect(doTipo(consultas, 'notification_logs', 'insert')).toEqual([]);
  });

  test('parada anterior terminou sem aceite: UM update guardado volta a pendente e alerta a operacao', async () => {
    const { cliente, consultas } = falso((q) => {
      if (q.tabela === 'ocpp_comandos' && q.op === 'upsert') return { data: [] }; // chave ja existia
      if (q.tabela === 'ocpp_comandos' && q.op === 'update') return { data: [{ id: 'cmd_1' }] };
      return { data: null };
    });
    expect(await enfileirarParada(cliente, recarga, agora, silencioso)).toBe('rearmada');
    const [up] = doTipo(consultas, 'ocpp_comandos', 'update');
    expect(up.payload).toEqual({
      status: 'pendente', tentativas: 0, proxima_tentativa_em: agora.toISOString(),
      expira_em: '2026-10-05T12:02:00.000Z', erro: null, resposta: null,
    });
    expect(up.filtros).toEqual([
      ['eq', 'chave_idempotencia', 'stop:rec_1'],
      ['in', 'status', ['expirado', 'rejeitado', 'erro']],
    ]);
    const [alerta] = doTipo(consultas, 'notification_logs', 'insert');
    expect(alerta.payload).toMatchObject({
      entity_type: 'eletroposto_carregador', entity_id: 'cp_1', channel: 'sistema', recipient: 'operacao',
      metadata: { tipo: 'parada_rearmada', dados: { recargaId: 'rec_1', origem: 'app' } },
    });
  });

  test('parada ja pendente/enviada/aceita: nada muda (sucesso idempotente)', async () => {
    const { cliente, consultas } = falso((q) => ({ data: q.op === 'upsert' || q.op === 'update' ? [] : null }));
    expect(await enfileirarParada(cliente, recarga, agora, silencioso)).toBe('existente');
    expect(doTipo(consultas, 'notification_logs', 'insert')).toEqual([]);
  });

  test('alerta que falha nao derruba a parada', async () => {
    const { cliente } = falso((q) => {
      if (q.tabela === 'notification_logs') return { error: { message: 'sem tabela' } };
      return { data: q.op === 'update' ? [{ id: 'cmd_1' }] : [] };
    });
    expect(await enfileirarParada(cliente, recarga, agora, silencioso)).toBe('rearmada');
  });

  test('erro do banco ao enfileirar lanca', async () => {
    const { cliente } = falso(() => ({ error: { message: 'caiu' } }));
    await expect(enfileirarParada(cliente, recarga, agora, silencioso)).rejects.toBeTruthy();
  });
});
