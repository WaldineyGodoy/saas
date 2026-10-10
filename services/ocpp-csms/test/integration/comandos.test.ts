// Esperas: o timeout de chamada do ocpp-rpc usa timers/promises (que o fake timer do vitest nao
// cobre), entao estes testes usam timers reais com valores injetados bem pequenos
// (callTimeoutMs, backoff, connectionTimeoutS) e vi.waitFor em vez de vi.useFakeTimers().
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RPCClient } from 'ocpp-rpc';
import { subirCenario, BOOT, type Cenario } from './helpers.js';
import { criarFila, type Fila, type OpcoesFila } from '../../src/server/comandos.js';

let c: Cenario;
let cli: RPCClient;
let fila: Fila;
afterEach(async () => { fila?.parar(); await c?.encerrar(); });

const TAG = 'CMDTAG000000000001';
const ABERTO = 1; // WebSocket.OPEN

type OpcExtra = Partial<Omit<OpcoesFila, 'repo' | 'servidor'>>;

async function preparar(opc: OpcExtra = {}) {
  c = await subirCenario();
  const cp = c.repo.carregadores[0]!;
  const recarga = c.repo.semearRecarga({
    status: 'paid', valor: 50, tarifa_kwh_aplicada: 2, ocpp_id_tag: TAG, eletroposto_id: cp.eletroposto_id,
  });
  c.repo.semearIdTag({ id_tag: TAG, recarga_id: recarga.id });
  cli = c.carregadorFake('CP-1', 'segredo-cp1');
  fila = criarFila({ repo: c.repo, servidor: c.srv, varreduraMs: 15, ...opc });
  return { cp, recarga };
}
const conectar = async (status = 'Available', errorCode = 'NoError') => {
  await cli.connect();
  await cli.call('BootNotification', BOOT);
  await cli.call('StatusNotification', { connectorId: 1, status, errorCode });
};
const startCmd = (recargaId: string, idTag = TAG, chave = `start:${recargaId}`) =>
  c.repo.enfileirarComando({
    carregador_id: c.repo.carregadores[0]!.id, acao: 'RemoteStartTransaction',
    payload: { connectorId: 1, idTag }, recarga_id: recargaId, chave_idempotencia: chave,
  });
const cmd = (id: string) => c.repo.comandos.find((x) => x.id === id)!;
const rec = (id: string) => c.repo.recargas.find((r) => r.id === id)!;
const tag = (t: string) => c.repo.idTags.find((x) => x.id_tag === t)!;

describe('RC - comandos de partida', () => {
  it('RC-01 RemoteStart pendente chega ao carregador; Accepted -> comando aceito, recarga starting', async () => {
    const { recarga } = await preparar();
    const recebidos: unknown[] = [];
    cli.handle('RemoteStartTransaction', async ({ params }) => { recebidos.push(params); return { status: 'Accepted' }; });
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    expect(recebidos).toEqual([{ connectorId: 1, idTag: TAG }]);
    expect(cmd(comando.id)).toMatchObject({ status: 'aceito', resposta: { status: 'Accepted' } });
    expect(rec(recarga.id).status).toBe('starting');
  });

  it('RC-01 comando duplicado (mesma chave) e processamento concorrente nao geram 2o envio', async () => {
    const { recarga } = await preparar();
    let n = 0;
    cli.handle('RemoteStartTransaction', async () => { n++; return { status: 'Accepted' }; });
    await conectar();
    await startCmd(recarga.id);
    const dup = await startCmd(recarga.id);
    expect(dup.criado).toBe(false);
    await Promise.all([fila.processar(), fila.processar()]);
    expect(n).toBe(1);
  });

  it('RC-02 Rejected -> comando rejeitado, recarga failed, estorno total, idTag Expired', async () => {
    const { recarga } = await preparar();
    cli.handle('RemoteStartTransaction', async () => ({ status: 'Rejected' }));
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    expect(cmd(comando.id).status).toBe('rejeitado');
    expect(rec(recarga.id).status).toBe('failed');
    expect(c.repo.estornos).toEqual([expect.objectContaining({ recarga_id: recarga.id, valor: 50 })]);
    expect(tag(TAG).status).toBe('Expired');
  });

  it('RC-03 aceito e sem StartTransaction em CONNECTION_TIMEOUT_S -> canceled, idTag Expired, estorno total', async () => {
    const { recarga } = await preparar({ connectionTimeoutS: 0.2 });
    cli.handle('RemoteStartTransaction', async () => ({ status: 'Accepted' }));
    await conectar();
    await startCmd(recarga.id);
    await fila.processar();
    expect(rec(recarga.id).status).toBe('starting');
    await vi.waitFor(() => expect(rec(recarga.id).status).toBe('canceled'), { timeout: 3000 });
    expect(tag(TAG).status).toBe('Expired');
    expect(c.repo.estornos).toEqual([expect.objectContaining({ recarga_id: recarga.id, valor: 50 })]);
  });

  it('RC-03 StartTransaction dentro do prazo: a varredura nao cancela', async () => {
    const { recarga } = await preparar({ connectionTimeoutS: 1.5 });
    cli.handle('RemoteStartTransaction', async () => ({ status: 'Accepted' }));
    await conectar();
    await startCmd(recarga.id);
    await fila.processar();
    await cli.call('StartTransaction', { connectorId: 1, idTag: TAG, meterStart: 0, timestamp: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 2000));
    expect(rec(recarga.id).status).toBe('charging');
    expect(c.repo.estornos).toEqual([]);
  });
});

describe('RC - corte pre-pago', () => {
  it('RC-04 MeterValues atinge kwh_limite -> exatamente um RemoteStopTransaction mesmo com mais amostras', async () => {
    const { recarga } = await preparar();
    await conectar('Preparing');
    const s = await cli.call('StartTransaction', {
      connectorId: 1, idTag: TAG, meterStart: 1000, timestamp: '2026-10-04T12:00:00.000Z',
    }) as { transactionId: number };
    const mv = (ts: string, wh: number) => cli.call('MeterValues', {
      connectorId: 1, transactionId: s.transactionId,
      meterValue: [{ timestamp: ts, sampledValue: [{ value: String(wh) }] }],
    });
    await mv('2026-10-04T12:05:00.000Z', 10000);
    expect(c.repo.comandos.filter((x) => x.acao === 'RemoteStopTransaction')).toHaveLength(0);
    await mv('2026-10-04T12:10:00.000Z', 26000); // 25 kWh = limite
    await mv('2026-10-04T12:11:00.000Z', 27000);
    await mv('2026-10-04T12:12:00.000Z', 28000);
    await mv('2026-10-04T12:13:00.000Z', 29000);
    const stops = c.repo.comandos.filter((x) => x.acao === 'RemoteStopTransaction');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      payload: { transactionId: s.transactionId }, recarga_id: recarga.id, chave_idempotencia: `stop:${recarga.id}`,
    });
  });

  it('I3 stop:<recarga> que terminou sem aceite e rearmado pelo corte (um UPDATE guardado) com alerta', async () => {
    const { recarga } = await preparar();
    fila.parar(); // so o estado da fila importa aqui; sem envio ao carregador
    await conectar('Preparing');
    const s = await cli.call('StartTransaction', {
      connectorId: 1, idTag: TAG, meterStart: 1000, timestamp: '2026-10-04T12:00:00.000Z',
    }) as { transactionId: number };
    const mv = (ts: string, wh: number) => cli.call('MeterValues', {
      connectorId: 1, transactionId: s.transactionId,
      meterValue: [{ timestamp: ts, sampledValue: [{ value: String(wh) }] }],
    });
    await mv('2026-10-04T12:10:00.000Z', 26000); // limite
    const stop = c.repo.comandos.find((x) => x.acao === 'RemoteStopTransaction')!;
    for (const terminal of ['expirado', 'rejeitado', 'erro'] as const) {
      await c.repo.atualizarComando(stop.id, { status: terminal, tentativas: 4, erro: 'falhou' });
      await mv(`2026-10-04T12:1${['expirado', 'rejeitado', 'erro'].indexOf(terminal) + 1}:00.000Z`, 27000 + 1000 * ['expirado', 'rejeitado', 'erro'].indexOf(terminal));
      expect(cmd(stop.id)).toMatchObject({ status: 'pendente', tentativas: 0, erro: null });
      expect(new Date(cmd(stop.id).expira_em).getTime()).toBeGreaterThan(Date.now());
    }
    expect(c.repo.comandos.filter((x) => x.acao === 'RemoteStopTransaction')).toHaveLength(1);
    const alertas = c.repo.alertas.filter((a) => a.tipo === 'parada_rearmada');
    expect(alertas).toHaveLength(3);
    expect(alertas[0]!.dados).toMatchObject({ recargaId: recarga.id });
    // aceito (ou ainda pendente/enviado): nao mexe
    await c.repo.atualizarComando(stop.id, { status: 'aceito' });
    await mv('2026-10-04T12:20:00.000Z', 31000);
    expect(cmd(stop.id).status).toBe('aceito');
    expect(c.repo.alertas.filter((a) => a.tipo === 'parada_rearmada')).toHaveLength(3);
  });
});

describe('RS - resiliencia dos comandos', () => {
  it('RS-04 carregador demora a responder GetConfiguration (menos que o timeout) -> aceito; socket aberto', async () => {
    await preparar({ callTimeoutMs: 1000 });
    cli.handle('GetConfiguration', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { configurationKey: [{ key: 'HeartbeatInterval', readonly: false, value: '60' }] };
    });
    await conectar();
    const { comando } = await c.repo.enfileirarComando({ carregador_id: c.repo.carregadores[0]!.id, acao: 'GetConfiguration', payload: {} });
    await fila.processar();
    expect(cmd(comando.id).status).toBe('aceito');
    expect(cli.state).toBe(ABERTO);
  });

  it('RS-05 carregador nunca responde -> 1 envio + 3 reenvios com backoff, depois expirado; socket aberto; recarga failed + estorno', async () => {
    const { recarga } = await preparar({ callTimeoutMs: 40, backoff: (n) => (n <= 3 ? 10 * 2 ** n : null) });
    let chamadas = 0;
    cli.handle('RemoteStartTransaction', async () => { chamadas++; return new Promise(() => undefined); });
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    await vi.waitFor(() => expect(cmd(comando.id).status).toBe('expirado'), { timeout: 5000 });
    expect(chamadas).toBe(4);
    expect(cmd(comando.id).tentativas).toBe(4);
    expect(cli.state).toBe(ABERTO);
    expect(rec(recarga.id).status).toBe('failed');
    expect(c.repo.estornos).toEqual([expect.objectContaining({ recarga_id: recarga.id, valor: 50 })]);
  });

  it('RS-05 timeout reagenda (pendente, tentativas+1, proxima_tentativa_em no futuro) sem fechar o socket nem falhar a recarga', async () => {
    const { recarga } = await preparar({ callTimeoutMs: 40, backoff: () => 60000 });
    cli.handle('RemoteStartTransaction', async () => new Promise(() => undefined));
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    expect(cmd(comando.id)).toMatchObject({ status: 'pendente', tentativas: 1 });
    expect(new Date(cmd(comando.id).proxima_tentativa_em).getTime()).toBeGreaterThan(Date.now() + 50000);
    expect(cli.state).toBe(ABERTO);
    expect(rec(recarga.id).status).toBe('paid');
  });

  it('RS-06 comando criado com carregador desconectado fica pendente e e enviado quando ele conecta antes de expira_em', async () => {
    await preparar();
    const recebidos: unknown[] = [];
    cli.handle('ChangeAvailability', async ({ params }) => { recebidos.push(params); return { status: 'Accepted' }; });
    const { comando } = await c.repo.enfileirarComando({
      carregador_id: c.repo.carregadores[0]!.id, acao: 'ChangeAvailability', payload: { connectorId: 1, type: 'Operative' },
    });
    await fila.processar();
    expect(cmd(comando.id).status).toBe('pendente');
    await conectar();
    await vi.waitFor(() => expect(cmd(comando.id).status).toBe('aceito'), { timeout: 3000 });
    expect(recebidos).toHaveLength(1);
  });

  it('RS-06 comando cujo expira_em passou sem o carregador conectar -> expirado (RemoteStart: recarga failed + estorno)', async () => {
    const { recarga } = await preparar();
    const { comando } = await c.repo.enfileirarComando({
      carregador_id: c.repo.carregadores[0]!.id, acao: 'RemoteStartTransaction',
      payload: { connectorId: 1, idTag: TAG }, recarga_id: recarga.id, chave_idempotencia: `start:${recarga.id}`,
      expira_em: new Date(Date.now() - 1000).toISOString(),
    });
    await fila.processar();
    expect(cmd(comando.id).status).toBe('expirado');
    expect(rec(recarga.id).status).toBe('failed');
    expect(c.repo.estornos).toEqual([expect.objectContaining({ recarga_id: recarga.id, valor: 50 })]);
    expect(tag(TAG).status).toBe('Expired');
  });

  it('RS-05 CALLERROR do carregador vira comando erro (RemoteStart falha a recarga); socket aberto', async () => {
    const { recarga } = await preparar();
    cli.handle('RemoteStartTransaction', async () => { throw new Error('falha interna'); });
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    expect(cmd(comando.id).status).toBe('erro');
    expect(cmd(comando.id).erro).toBeTruthy();
    expect(rec(recarga.id).status).toBe('failed');
    expect(cli.state).toBe(ABERTO);
  });

  it('RS-05 payload invalido no strict mode -> erro sem chegar ao carregador', async () => {
    await preparar();
    let n = 0;
    cli.handle('ChangeAvailability', async () => { n++; return { status: 'Accepted' }; });
    await conectar();
    const { comando } = await c.repo.enfileirarComando({
      carregador_id: c.repo.carregadores[0]!.id, acao: 'ChangeAvailability', payload: { connectorId: 'x' },
    });
    await fila.processar();
    expect(cmd(comando.id).status).toBe('erro');
    expect(n).toBe(0);
  });
});

describe('ST - pre-condicoes do RemoteStart', () => {
  it('ST-03 conector bloqueado_ate_reset: RemoteStart rejeitado sem envio; Reset Hard aceito + novo Boot + Available libera o proximo', async () => {
    const { recarga } = await preparar();
    const recebidos: unknown[] = [];
    cli.handle('RemoteStartTransaction', async ({ params }) => { recebidos.push(params); return { status: 'Accepted' }; });
    cli.handle('Reset', async () => ({ status: 'Accepted' }));
    await conectar('Faulted', 'GroundFailure');
    expect(c.repo.conectores[0]!.bloqueado_ate_reset).toBe(true);

    const a = await startCmd(recarga.id);
    await fila.processar();
    expect(cmd(a.comando.id).status).toBe('rejeitado');
    expect(cmd(a.comando.id).erro).toMatch(/bloquead/i);
    expect(recebidos).toEqual([]);
    expect(rec(recarga.id).status).toBe('failed');

    const reset = await c.repo.enfileirarComando({
      carregador_id: c.repo.carregadores[0]!.id, acao: 'Reset', payload: { type: 'Hard' },
    });
    await fila.processar();
    expect(cmd(reset.comando.id).status).toBe('aceito');
    expect(c.srv.resetAceito.has('CP-1')).toBe(true);

    await cli.call('BootNotification', BOOT);
    await cli.call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
    expect(c.repo.conectores[0]!.bloqueado_ate_reset).toBe(false);

    const tag2 = 'CMDTAG000000000002';
    const r2 = c.repo.semearRecarga({
      status: 'paid', valor: 20, tarifa_kwh_aplicada: 2, ocpp_id_tag: tag2, eletroposto_id: c.repo.carregadores[0]!.eletroposto_id,
    });
    c.repo.semearIdTag({ id_tag: tag2, recarga_id: r2.id });
    const b = await startCmd(r2.id, tag2);
    await fila.processar();
    expect(cmd(b.comando.id).status).toBe('aceito');
    expect(recebidos).toEqual([{ connectorId: 1, idTag: tag2 }]);
  });

  it('ST-04 conector em Charging: RemoteStart rejeitado sem envio', async () => {
    const { recarga } = await preparar();
    const recebidos: unknown[] = [];
    cli.handle('RemoteStartTransaction', async ({ params }) => { recebidos.push(params); return { status: 'Accepted' }; });
    await conectar('Charging');
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    expect(cmd(comando.id).status).toBe('rejeitado');
    expect(cmd(comando.id).erro).toMatch(/Charging/);
    expect(recebidos).toEqual([]);
    expect(rec(recarga.id).status).toBe('failed');
  });
});

const semRuido = { onErro: () => undefined };

describe('FIX - recuperacao de falhas parciais', () => {
  it('FIX-1 estorno que falhou apos a recarga virar failed e refeito pela varredura (valor_estornado so apos o pedido)', async () => {
    const { recarga } = await preparar(semRuido);
    cli.handle('RemoteStartTransaction', async () => ({ status: 'Rejected' }));
    await conectar();
    vi.spyOn(c.repo, 'solicitarEstorno').mockRejectedValueOnce(new Error('stripe fora'));
    await startCmd(recarga.id);
    await fila.processar();
    expect(rec(recarga.id).status).toBe('failed');
    expect(rec(recarga.id).valor_estornado).toBeNull();
    await vi.waitFor(() => expect(c.repo.estornos).toHaveLength(1), { timeout: 3000 });
    await vi.waitFor(() => expect(rec(recarga.id).valor_estornado).toBe(50), { timeout: 3000 });
    expect(tag(TAG).status).toBe('Expired');
  });

  it('I2 estorno parcial que falhou no StopTransaction: alerta e a varredura pede de novo, uma vez so', async () => {
    // varredura so quando o teste manda (senao ela pode pedir o estorno antes do Stop)
    const { recarga } = await preparar({ ...semRuido, varreduraMs: 60_000 });
    await conectar('Preparing');
    const s = await cli.call('StartTransaction', {
      connectorId: 1, idTag: TAG, meterStart: 1000, timestamp: '2026-10-04T12:00:00.000Z',
    }) as { transactionId: number };
    await fila.processar();
    const espiao = vi.spyOn(c.repo, 'solicitarEstorno').mockRejectedValueOnce(new Error('stripe fora'));
    // 10 kWh x R$ 2 = R$ 20; pago R$ 50 -> devolver R$ 30. O Stop recebe CALLERROR (o carregador pode desistir).
    await expect(cli.call('StopTransaction', {
      transactionId: s.transactionId, meterStop: 11000, timestamp: '2026-10-04T12:20:00.000Z', reason: 'EVDisconnected',
    })).rejects.toBeTruthy();
    expect(rec(recarga.id)).toMatchObject({ status: 'completed', valor_estornado: 30, stripe_refund_id: null });
    expect(c.repo.alertas.filter((a) => a.tipo === 'estorno_falhou')).toEqual([
      expect.objectContaining({ dados: expect.objectContaining({ recargaId: recarga.id, valor: 30 }) }),
    ]);
    expect(c.repo.estornos).toEqual([]);
    await fila.processar(); // varredura
    expect(c.repo.estornos).toEqual([expect.objectContaining({ recarga_id: recarga.id, valor: 30 })]);
    expect(rec(recarga.id).stripe_refund_id).not.toBeNull();
    const chamadas = espiao.mock.calls.length;
    await fila.processar();
    await fila.processar();
    expect(espiao.mock.calls.length).toBe(chamadas); // confirmado: nao e mais listado
    expect(rec(recarga.id)).toMatchObject({ status: 'completed', valor_final: 20, valor_estornado: 30 });
  });

  it('FIX-2 comando preso em enviado (queda entre a trava e a resposta) e reenviado pela varredura', async () => {
    const { recarga } = await preparar({ ...semRuido, callTimeoutMs: 20, margemEnviadoMs: 30 });
    let n = 0;
    cli.handle('RemoteStartTransaction', async () => { n++; return { status: 'Accepted' }; });
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await c.repo.reivindicarComando(comando.id); // simula crash apos a trava
    expect(cmd(comando.id).status).toBe('enviado');
    await vi.waitFor(() => expect(cmd(comando.id).status).toBe('aceito'), { timeout: 3000 });
    expect(n).toBe(1);
    expect(rec(recarga.id).status).toBe('starting');
  });

  it('FIX-2 enviado preso sem mais tentativas -> expirado e RemoteStart falha a recarga com estorno', async () => {
    const { recarga } = await preparar({ ...semRuido, callTimeoutMs: 20, margemEnviadoMs: 30, backoff: () => null });
    cli.handle('RemoteStartTransaction', async () => ({ status: 'Accepted' }));
    await conectar();
    const { comando } = await startCmd(recarga.id);
    await c.repo.reivindicarComando(comando.id);
    await vi.waitFor(() => expect(cmd(comando.id).status).toBe('expirado'), { timeout: 3000 });
    expect(rec(recarga.id).status).toBe('failed');
    await vi.waitFor(() => expect(c.repo.estornos).toHaveLength(1), { timeout: 3000 });
  });

  it('FIX-3 falha do repo ao gravar o resultado nao reenvia nem reseta o comando', async () => {
    const { recarga } = await preparar(semRuido);
    let n = 0;
    cli.handle('RemoteStartTransaction', async () => { n++; return { status: 'Accepted' }; });
    await conectar();
    const { comando } = await startCmd(recarga.id);
    vi.spyOn(c.repo, 'atualizarComando').mockRejectedValueOnce(new Error('banco fora'));
    await fila.processar();
    await new Promise((r) => setTimeout(r, 150)); // varreduras de 15 ms
    expect(n).toBe(1);
    expect(cmd(comando.id).status).toBe('enviado');
  });

  it('FIX-4 paid->starting que falhou apos o aceito: a varredura promove e o RC-03 cancela com estorno', async () => {
    const { recarga } = await preparar({ ...semRuido, connectionTimeoutS: 0.2 });
    cli.handle('RemoteStartTransaction', async () => ({ status: 'Accepted' }));
    await conectar();
    vi.spyOn(c.repo, 'atualizarRecarga').mockRejectedValueOnce(new Error('banco fora'));
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    expect(cmd(comando.id).status).toBe('aceito');
    await vi.waitFor(() => expect(rec(recarga.id).status).toBe('canceled'), { timeout: 3000 });
    await vi.waitFor(() => expect(c.repo.estornos).toHaveLength(1), { timeout: 3000 });
  });

  it('FIX-5 conector sem StatusNotification nesta conexao: RemoteStart espera pendente (nao rejeita por status velho) e segue quando o status chega', async () => {
    const { recarga } = await preparar(semRuido);
    let n = 0;
    cli.handle('RemoteStartTransaction', async () => { n++; return { status: 'Accepted' }; });
    // status velho de uma conexao anterior
    await c.repo.upsertConector(c.repo.carregadores[0]!.id, 1, { status: 'Charging' });
    await cli.connect();
    await cli.call('BootNotification', BOOT);
    const { comando } = await startCmd(recarga.id);
    await fila.processar();
    await new Promise((r) => setTimeout(r, 100));
    expect(cmd(comando.id).status).toBe('pendente');
    expect(n).toBe(0);
    expect(rec(recarga.id).status).toBe('paid');
    await cli.call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' });
    await vi.waitFor(() => expect(cmd(comando.id).status).toBe('aceito'), { timeout: 3000 });
    expect(n).toBe(1);
  });
});

describe('FIX - isolamento por item nas varreduras', () => {
  it('FIX-6 estorno do 1o item sempre falha: o 2o ainda e reconciliado no mesmo ciclo e onErro nomeia varredura e item', async () => {
    const erros: { ctx: string; err: unknown }[] = [];
    await preparar({ onErro: (ctx, err) => { erros.push({ ctx, err }); } });
    const marca = { estorno_total_pendente: true };
    const a = c.repo.semearRecarga({ status: 'failed', valor: 10, metadata: marca, motivo_fim: 'x' });
    const b = c.repo.semearRecarga({ status: 'failed', valor: 20, metadata: marca, motivo_fim: 'x' });
    const original = c.repo.solicitarEstorno.bind(c.repo);
    vi.spyOn(c.repo, 'solicitarEstorno').mockImplementation(async (id, e) => {
      if (id === a.id) throw new Error('stripe fora');
      return original(id, e);
    });
    await fila.processar();
    expect(c.repo.estornos.map((e) => e.recarga_id)).toEqual([b.id]);
    expect(rec(b.id).valor_estornado).toBe(20);
    expect(rec(a.id).valor_estornado).toBeNull();
    expect(erros.some((e) => e.ctx.includes('reconciliarEstornos') && e.ctx.includes(a.id))).toBe(true);
  });
});
