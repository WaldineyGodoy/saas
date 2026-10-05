// SupabaseRepo contra um cliente falso: confere a FORMA das consultas (guarda no mesmo UPDATE, upsert,
// filtros jsonb) e os caminhos de erro, sem banco. O comportamento real e coberto pelo teste de contrato
// (test/integration/supabase-repo.test.ts, com Supabase local).
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SupabaseRepo } from '../../src/repo/supabase.js';

interface Chamada { tabela: string; ops: [string, unknown[]][] }
type Resp = { data: unknown; error: { message: string; code?: string } | null };

// Cliente falso: qualquer cadeia de metodos e registrada; ao ser aguardada (ou terminada em
// single/maybeSingle) devolve a proxima resposta da fila.
function clienteFalso(respostas: Resp[]) {
  const chamadas: Chamada[] = [];
  const from = (tabela: string) => {
    const ch: Chamada = { tabela, ops: [] };
    chamadas.push(ch);
    const resolver = () => Promise.resolve(respostas.shift() ?? { data: null, error: { message: 'sem resposta no roteiro' } });
    const proxy: unknown = new Proxy({}, {
      get(_t, nome: string) {
        if (nome === 'then') { const p = resolver(); return p.then.bind(p); }
        return (...args: unknown[]) => {
          ch.ops.push([nome, args]);
          return nome === 'single' || nome === 'maybeSingle' ? resolver() : proxy;
        };
      },
    });
    return proxy;
  };
  return { client: { from } as unknown as SupabaseClient, chamadas };
}

const op = (c: Chamada, nome: string) => c.ops.filter(([n]) => n === nome).map(([, a]) => a);
const recargaDb = (o: Record<string, unknown> = {}) => ({
  id: 'r1', eletroposto_id: 'e1', status: 'paid', valor: 50, tarifa_kwh_aplicada: 2, metadata: { origem: 'x' },
  updated_at: '2026-10-04T12:00:00.123456+00:00', ...o,
});

describe('SupabaseRepo (cliente falso)', () => {
  it('transicao guardada e UM update condicional por id e status, sem leitura antes', async () => {
    const { client, chamadas } = clienteFalso([{ data: [recargaDb({ status: 'starting' })], error: null }]);
    const r = await new SupabaseRepo(client).atualizarRecarga('r1', { status: 'starting' }, 'paid');
    expect(r?.status).toBe('starting');
    expect(chamadas).toHaveLength(1);
    expect(op(chamadas[0]!, 'update')[0]![0]).toEqual({ status: 'starting' });
    expect(op(chamadas[0]!, 'eq')).toEqual([['id', 'r1'], ['status', 'paid']]);
  });

  it('guarda nao satisfeita: devolve null; recarga inexistente lanca', async () => {
    const a = clienteFalso([{ data: [], error: null }, { data: recargaDb({ status: 'charging' }), error: null }]);
    expect(await new SupabaseRepo(a.client).atualizarRecarga('r1', { status: 'starting' }, 'paid')).toBeNull();
    const b = clienteFalso([{ data: [], error: null }, { data: null, error: null }]);
    await expect(new SupabaseRepo(b.client).atualizarRecarga('r1', { kwh_consumido: 1 }, 'paid')).rejects.toThrow(/inexistente/);
  });

  it('erro do banco (gatilho de transicao) lanca com a mensagem original', async () => {
    const { client } = clienteFalso([{ data: null, error: { message: 'Transição de status da recarga inválida', code: '23514' } }]);
    await expect(new SupabaseRepo(client).atualizarRecarga('r1', { status: 'completed' })).rejects.toThrow(/Transição/);
  });

  it('metadata: mescla com o lido e grava com guarda de updated_at; refaz se a versao trocou', async () => {
    const lida1 = recargaDb({ updated_at: '2026-10-04T12:00:00.111111+00:00' });
    const lida2 = recargaDb({ metadata: { origem: 'x', outra: 1 }, updated_at: '2026-10-04T12:00:00.222222+00:00' });
    const { client, chamadas } = clienteFalso([
      { data: lida1, error: null },                // leitura 1
      { data: [], error: null },                   // update 1 perdeu (versao trocada)
      { data: lida2, error: null },                // releitura apos 0 linhas (status confere)
      { data: lida2, error: null },                // leitura 2
      { data: [recargaDb({ metadata: { origem: 'x', outra: 1, nova: true } })], error: null }, // update 2 ok
    ]);
    const r = await new SupabaseRepo(client).atualizarRecarga('r1', { metadata: { nova: true } });
    expect(r?.metadata).toEqual({ origem: 'x', outra: 1, nova: true });
    const updates = chamadas.filter((c) => op(c, 'update').length > 0);
    expect(op(updates[0]!, 'update')[0]![0]).toEqual({ metadata: { origem: 'x', nova: true } });
    expect(op(updates[0]!, 'eq')).toContainEqual(['updated_at', '2026-10-04T12:00:00.111111+00:00']);
    expect(op(updates[1]!, 'update')[0]![0]).toEqual({ metadata: { origem: 'x', outra: 1, nova: true } });
    expect(op(updates[1]!, 'eq')).toContainEqual(['updated_at', '2026-10-04T12:00:00.222222+00:00']);
  });

  it('reivindicarComando e atualizarComandoSe: guarda de status e do updated_at exato no mesmo update', async () => {
    const linha = { id: 'c1', carregador_id: 'k', acao: 'Reset', payload: {}, status: 'enviado', tentativas: 0, updated_at: 'T' };
    const a = clienteFalso([{ data: [linha], error: null }, { data: [], error: null }]);
    const repo = new SupabaseRepo(a.client);
    expect((await repo.reivindicarComando('c1'))?.atualizado_em).toBe('T');
    expect(op(a.chamadas[0]!, 'eq')).toEqual([['id', 'c1'], ['status', 'pendente']]);
    expect(await repo.atualizarComandoSe('c1', { status: 'enviado', atualizado_em: '2026-10-04T12:00:00.123456+00:00' }, { status: 'pendente' })).toBeNull();
    expect(op(a.chamadas[1]!, 'eq')).toEqual([['id', 'c1'], ['status', 'enviado'], ['updated_at', '2026-10-04T12:00:00.123456+00:00']]);
  });

  it('fecharTransacao: update com fim_em is null; devolve fechada=false se ja estava fechada', async () => {
    const tx = { id: 7, carregador_id: 'k', connector_id: 1, id_tag: 't', meter_start_wh: 0, meter_stop_wh: 5, inicio_em: 'a', fim_em: 'b', chave_idempotencia: 'c' };
    const { client, chamadas } = clienteFalso([{ data: [], error: null }, { data: tx, error: null }]);
    const r = await new SupabaseRepo(client).fecharTransacao(7, { meter_stop_wh: 9, fim_em: 'z' });
    expect(r.fechada).toBe(false);
    expect(r.transacao.meter_stop_wh).toBe(5);
    expect(op(chamadas[0]!, 'is')).toEqual([['fim_em', null]]);
  });

  it('criarOuObterTransacao: violacao 23505 da chave devolve a existente', async () => {
    const tx = { id: 7, carregador_id: 'k', connector_id: 1, id_tag: 't', meter_start_wh: 0, inicio_em: 'a', chave_idempotencia: 'c' };
    const { client } = clienteFalso([
      { data: null, error: null },                                           // caminho rapido: nao existe
      { data: null, error: { message: 'duplicate key', code: '23505' } },    // insert perdeu a corrida
      { data: tx, error: null },                                             // select da existente
    ]);
    const r = await new SupabaseRepo(client).criarOuObterTransacao('c', { carregador_id: 'k', connector_id: 1, recarga_id: null, id_tag: 't', meter_start_wh: 0, inicio_em: 'a' });
    expect(r).toMatchObject({ criada: false, transacao: { id: 7 } });
  });

  it('gravarMedicoes: upsert com onConflict, ignoreDuplicates e defaults explicitos; conta so as inseridas', async () => {
    const { client, chamadas } = clienteFalso([{ data: [{ id: 1 }], error: null }]);
    const n = await new SupabaseRepo(client).gravarMedicoes([
      { transacao_id: 1, connector_id: 1, medido_em: 't', valor: 1, unidade: 'Wh' },
      { transacao_id: 1, connector_id: 1, medido_em: 't', valor: 2, unidade: 'Wh' },
    ]);
    expect(n).toBe(1);
    const [linhas, opcoes] = op(chamadas[0]!, 'upsert')[0]!;
    expect(opcoes).toEqual({ onConflict: 'transacao_id,medido_em,measurand,phase', ignoreDuplicates: true });
    expect((linhas as unknown[])[0]).toMatchObject({ measurand: 'Energy.Active.Import.Register', phase: '', contexto: null });
  });

  it('estorno pendente usa filtro jsonb por texto; parcial nao confirmado = completed OCPP sem stripe_refund_id (I2)', async () => {
    const { client, chamadas } = clienteFalso([
      { data: [recargaDb({ id: 'r1', status: 'failed' })], error: null },
      { data: [recargaDb({ id: 'r2', status: 'completed', valor_estornado: 30 })], error: null },
    ]);
    const l = await new SupabaseRepo(client).listarRecargasComEstornoPendente();
    expect(l.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(op(chamadas[0]!, 'eq')).toEqual([['metadata->>estorno_total_pendente', 'true']]);
    expect(op(chamadas[0]!, 'in')[0]).toEqual(['status', ['failed', 'canceled']]);
    expect(op(chamadas[1]!, 'eq')).toEqual([['status', 'completed']]);
    expect(op(chamadas[1]!, 'not')).toEqual([['ocpp_transacao_id', 'is', null]]);
    expect(op(chamadas[1]!, 'gt')).toEqual([['valor_estornado', 0]]);
    expect(op(chamadas[1]!, 'is')).toEqual([['stripe_refund_id', null]]);
  });

  it('rearmarComando e UM update guardado por chave e status terminal sem aceite (I3)', async () => {
    const { client, chamadas } = clienteFalso([{ data: [], error: null }]);
    expect(await new SupabaseRepo(client).rearmarComando('stop:r1', '2026-10-04T12:02:00.000Z')).toBeNull();
    expect(chamadas).toHaveLength(1);
    expect(op(chamadas[0]!, 'update')[0]![0]).toMatchObject({
      status: 'pendente', tentativas: 0, expira_em: '2026-10-04T12:02:00.000Z', erro: null, resposta: null,
    });
    expect(op(chamadas[0]!, 'eq')).toEqual([['chave_idempotencia', 'stop:r1']]);
    expect(op(chamadas[0]!, 'in')).toEqual([['status', ['expirado', 'rejeitado', 'erro']]]);
  });

  it('solicitarEstorno: corpo em centavos; funcao com erro lanca; ja estornada nao chama; valor invalido nao consulta', async () => {
    const chamadas: unknown[] = [];
    let falha: Error | null = new Error('HTTP 500');
    const invocarFuncao = async (nome: string, body: Record<string, unknown>) => { chamadas.push({ nome, body }); if (falha) throw falha; };
    const a = clienteFalso([{ data: recargaDb(), error: null }, { data: recargaDb(), error: null }]);
    const repo = new SupabaseRepo(a.client, { invocarFuncao });
    await expect(repo.solicitarEstorno('r1', { valor: 30.1, motivo: 'm' })).rejects.toThrow('HTTP 500');
    falha = null;
    await repo.solicitarEstorno('r1', { valor: 30.1, motivo: 'm' });
    expect(chamadas.at(-1)).toEqual({ nome: 'refund-charging', body: { recarga_id: 'r1', valor_centavos: 3010, motivo: 'm' } });

    const b = clienteFalso([{ data: recargaDb({ stripe_refund_id: 're_1' }), error: null }]);
    const n = chamadas.length;
    await new SupabaseRepo(b.client, { invocarFuncao }).solicitarEstorno('r1', { valor: 1, motivo: 'm' });
    expect(chamadas).toHaveLength(n);

    const c = clienteFalso([]);
    await expect(new SupabaseRepo(c.client, { invocarFuncao }).solicitarEstorno('r1', { valor: 0, motivo: 'm' })).rejects.toThrow();
    expect(c.chamadas).toHaveLength(0);
  });

  it('estorno pelo padrao (functions.invoke): erro HTTP lanca', async () => {
    const base = clienteFalso([{ data: recargaDb(), error: null }]);
    const client = {
      from: (t: string) => (base.client as unknown as { from: (t: string) => unknown }).from(t),
      functions: { invoke: async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } }) },
    } as unknown as SupabaseClient;
    await expect(new SupabaseRepo(client).solicitarEstorno('r1', { valor: 5, motivo: 'm' })).rejects.toThrow(/refund-charging falhou/);
  });

  it('alertar: carregador inexistente lanca; grava em notification_logs com canal interno', async () => {
    const a = clienteFalso([{ data: null, error: null }]);
    await expect(new SupabaseRepo(a.client).alertar({ carregador_id: 'x', connector_id: null, tipo: 't', mensagem: 'm' })).rejects.toThrow(/inexistente/);
    const b = clienteFalso([{ data: { id: 'k', ocpp_id: 'CP', eletroposto_id: 'e' }, error: null }, { data: null, error: null }]);
    await new SupabaseRepo(b.client).alertar({ carregador_id: 'k', connector_id: 1, tipo: 'falha', mensagem: 'm' });
    expect(b.chamadas[1]!.tabela).toBe('notification_logs');
    expect(op(b.chamadas[1]!, 'insert')[0]![0]).toMatchObject({ channel: 'sistema', entity_id: 'k', body: 'm', metadata: { tipo: 'falha', connector_id: 1 } });
  });
});
