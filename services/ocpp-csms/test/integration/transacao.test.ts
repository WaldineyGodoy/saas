import { afterEach, describe, expect, it } from 'vitest';
import type { RPCClient } from 'ocpp-rpc';
import { subirCenario, BOOT, type Cenario } from './helpers.js';

let c: Cenario;
let cli: RPCClient;
afterEach(async () => { await c?.encerrar(); });

const T0 = '2026-10-04T12:00:00.000Z';
const T1 = '2026-10-04T12:05:00.000Z';
const T2 = '2026-10-04T12:10:00.000Z';
const T3 = '2026-10-04T12:20:00.000Z';
const TAG = 'RCTAG0000000000001';

// recarga R$ 50 a R$ 2,00/kWh => limite 25 kWh
async function preparar(status: 'starting' | 'paid' = 'starting') {
  c = await subirCenario();
  const cp = c.repo.carregadores[0]!;
  const r = c.repo.semearRecarga({ status, valor: 50, tarifa_kwh_aplicada: 2, ocpp_id_tag: TAG, eletroposto_id: cp.eletroposto_id });
  c.repo.semearIdTag({ id_tag: TAG, recarga_id: r.id });
  cli = c.carregadorFake('CP-1', 'segredo-cp1');
  await cli.connect();
  await cli.call('BootNotification', BOOT);
  return r;
}

type StartConf = { transactionId: number; idTagInfo: { status: string } };
type AuthConf = { idTagInfo: { status: string } };
const iniciar = (idTag = TAG, extra: Record<string, unknown> = {}) =>
  cli.call('StartTransaction', { connectorId: 1, idTag, meterStart: 1000, timestamp: T0, ...extra }) as Promise<StartConf>;
const autorizar = (idTag = TAG) => cli.call('Authorize', { idTag }) as Promise<AuthConf>;
const mv = (transactionId: number, timestamp: string, value: string, unit?: string, measurand?: string) =>
  cli.call('MeterValues', {
    connectorId: 1, transactionId,
    meterValue: [{ timestamp, sampledValue: [{ value, ...(unit ? { unit } : {}), ...(measurand ? { measurand } : {}) }] }],
  });
const parar = (transactionId: number, meterStop: number, extra: Record<string, unknown> = {}) =>
  cli.call('StopTransaction', { transactionId, meterStop, timestamp: T3, ...extra });
const recarga = (id: string) => c.repo.recargas.find((r) => r.id === id)!;

describe('RC - autorizacao e transacao', () => {
  it('RC-06 Authorize e StartTransaction aceitos; recarga charging com kwh_limite', async () => {
    const r = await preparar();
    expect((await autorizar()).idTagInfo.status).toBe('Accepted');
    const s = await iniciar();
    expect(s.idTagInfo.status).toBe('Accepted');
    expect(Number.isInteger(s.transactionId)).toBe(true);
    expect(recarga(r.id)).toMatchObject({
      status: 'charging', kwh_limite: 25, ocpp_transacao_id: s.transactionId, iniciada_em: T0,
    });
    expect(c.repo.idTags[0]!.usado_em).not.toBeNull();
  });

  it('RC-06 partida local (totem): recarga paid passa por starting e vai a charging', async () => {
    const r = await preparar('paid');
    const s = await iniciar();
    expect(s.idTagInfo.status).toBe('Accepted');
    expect(recarga(r.id)).toMatchObject({ status: 'charging', kwh_limite: 25 });
  });

  it('RC-06 recarga em outro status (pending_payment) -> Invalid e recarga intocada', async () => {
    const r = await preparar('starting');
    c.repo.recargas[0]!.status = 'pending_payment';
    expect((await autorizar()).idTagInfo.status).toBe('Invalid');
    const s = await iniciar();
    expect(s.idTagInfo.status).toBe('Invalid');
    expect(Number.isInteger(s.transactionId)).toBe(true);
    expect(recarga(r.id)).toMatchObject({ status: 'pending_payment', kwh_limite: null, ocpp_transacao_id: null });
  });

  it('RC-06 idTag em uso por transacao aberta -> ConcurrentTx', async () => {
    await preparar();
    await iniciar();
    expect((await autorizar()).idTagInfo.status).toBe('ConcurrentTx');
    const s2 = await iniciar(TAG, { timestamp: T1 });
    expect(s2.idTagInfo.status).toBe('ConcurrentTx');
  });

  it('RC-06 sem foto de tarifa: aceita, alerta e deixa kwh_limite nulo', async () => {
    const r = await preparar();
    c.repo.recargas[0]!.tarifa_kwh_aplicada = 0;
    const s = await iniciar();
    expect(s.idTagInfo.status).toBe('Accepted');
    expect(recarga(r.id)).toMatchObject({ status: 'charging', kwh_limite: null });
    expect(c.repo.alertas.some((a) => a.tipo === 'recarga_sem_tarifa')).toBe(true);
  });

  it('RC-07 idTag desconhecido: Invalid no Authorize e no StartTransaction; recarga intocada', async () => {
    const r = await preparar();
    expect((await autorizar('TAG_DESCONHECIDA_99')).idTagInfo.status).toBe('Invalid');
    const s = await iniciar('TAG_DESCONHECIDA_99');
    expect(s.idTagInfo.status).toBe('Invalid');
    expect(Number.isInteger(s.transactionId)).toBe(true);
    expect(recarga(r.id)).toMatchObject({ status: 'starting', kwh_limite: null, ocpp_transacao_id: null });
    expect(c.repo.transacoes[0]).toMatchObject({ recarga_id: null });
    // StopTransaction da transacao orfa fecha limpo, sem efeito na recarga
    await parar(s.transactionId, 1000);
    expect(c.repo.transacoes[0]!.fim_em).toBe(T3);
    expect(recarga(r.id).status).toBe('starting');
  });

  it('RC-08 apos StopTransaction o mesmo idTag vira Expired', async () => {
    await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 11000);
    expect(c.repo.idTags[0]!.status).toBe('Expired');
    expect((await autorizar()).idTagInfo.status).toBe('Expired');
    const s2 = await iniciar(TAG, { timestamp: T1 });
    expect(s2.idTagInfo.status).toBe('Expired');
  });

  it('RS-03 StartTransaction repetido (mesmo instante, formato diferente) -> mesmo transactionId, 1 transacao', async () => {
    const r = await preparar();
    const a = await iniciar();
    const b = await iniciar(TAG, { timestamp: '2026-10-04T09:00:00-03:00' });
    expect(b.transactionId).toBe(a.transactionId);
    expect(b.idTagInfo.status).toBe('Accepted');
    expect(c.repo.transacoes).toHaveLength(1);
    expect(recarga(r.id).status).toBe('charging');
  });
});

describe('MV - medicao', () => {
  it('MV-01 kWh e Wh dao o mesmo kwh_consumido', async () => {
    const r = await preparar();
    const s = await iniciar();
    await mv(s.transactionId, T1, '3500', 'Wh');
    expect(recarga(r.id).kwh_consumido).toBe(2.5);
    await mv(s.transactionId, T2, '5.5', 'kWh');
    expect(recarga(r.id).kwh_consumido).toBe(4.5);
    const ms = await c.repo.listarMedicoes(s.transactionId);
    expect(ms.map((m) => [m.valor, m.unidade])).toEqual([[3500, 'Wh'], [5500, 'Wh']]);
  });

  it('MV-02 registro que regride e ignorado com alerta; kwh_consumido nao diminui', async () => {
    const r = await preparar();
    const s = await iniciar();
    await mv(s.transactionId, T1, '5000', 'Wh');
    await mv(s.transactionId, T2, '4000', 'Wh');
    expect(recarga(r.id).kwh_consumido).toBe(4);
    expect(await c.repo.listarMedicoes(s.transactionId)).toHaveLength(1);
    expect(c.repo.alertas.some((a) => a.tipo === 'medicao_regrediu')).toBe(true);
  });

  it('MV-04 sem measurand e sem unit: energia ativa em Wh; retransmissao nao duplica', async () => {
    const r = await preparar();
    const s = await iniciar();
    await mv(s.transactionId, T1, '2000');
    await mv(s.transactionId, T1, '2000');
    const ms = await c.repo.listarMedicoes(s.transactionId);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ measurand: 'Energy.Active.Import.Register', unidade: 'Wh', valor: 2000 });
    expect(recarga(r.id).kwh_consumido).toBe(1);
  });

  it('MV outras grandezas (potencia kW) sao gravadas em W e nao mexem em kwh_consumido', async () => {
    const r = await preparar();
    const s = await iniciar();
    await mv(s.transactionId, T1, '7.4', 'kW', 'Power.Active.Import');
    const ms = await c.repo.listarMedicoes(s.transactionId);
    expect(ms[0]).toMatchObject({ measurand: 'Power.Active.Import', unidade: 'W', valor: 7400 });
    expect(recarga(r.id).kwh_consumido).toBeNull();
  });

  it('MV sem transactionId usa a transacao aberta do conector', async () => {
    const r = await preparar();
    await iniciar();
    await cli.call('MeterValues', { connectorId: 1, meterValue: [{ timestamp: T1, sampledValue: [{ value: '3000' }] }] });
    expect(recarga(r.id).kwh_consumido).toBe(2);
  });
});

describe('Fechamento', () => {
  it('RC-05 StopTransaction(EVDisconnected): completed, valor proporcional e estorno solicitado', async () => {
    const r = await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 11000, { reason: 'EVDisconnected' }); // 10 kWh x 2 = 20
    expect(recarga(r.id)).toMatchObject({
      status: 'completed', kwh_consumido: 10, valor_final: 20, valor_estornado: 30,
      finalizada_em: T3, motivo_fim: 'EVDisconnected',
    });
    expect(c.repo.estornos).toEqual([{ recarga_id: r.id, valor: 30, motivo: expect.stringContaining('EVDisconnected') }]);
    expect(c.repo.transacoes[0]).toMatchObject({ meter_stop_wh: 11000, fim_em: T3, motivo_parada: 'EVDisconnected' });
  });

  it('ST-02 StopTransaction(EmergencyStop): completed com valor proporcional e estorno', async () => {
    const r = await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 6000, { reason: 'EmergencyStop' }); // 5 kWh x 2 = 10
    expect(recarga(r.id)).toMatchObject({ status: 'completed', valor_final: 10, valor_estornado: 40, motivo_fim: 'EmergencyStop' });
    expect(c.repo.estornos).toHaveLength(1);
  });

  it('sem reason: motivo Local; consumo total (sem diferenca) nao pede estorno', async () => {
    const r = await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 26000); // 25 kWh x 2 = 50
    expect(recarga(r.id)).toMatchObject({ status: 'completed', valor_final: 50, valor_estornado: 0, motivo_fim: 'Local' });
    expect(c.repo.estornos).toHaveLength(0);
  });

  it('MV-03 meterStop < meterStart: completed, valor_final = valor, metadata.revisar, sem estorno, alerta', async () => {
    const r = await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 500);
    expect(recarga(r.id)).toMatchObject({ status: 'completed', valor_final: 50, valor_estornado: 0 });
    expect(recarga(r.id).metadata.revisar).toBe(true);
    expect(c.repo.estornos).toHaveLength(0);
    expect(c.repo.alertas.some((a) => a.tipo === 'medicao_revisar')).toBe(true);
  });

  it('RS-02 StopTransaction offline com transactionData grava medicoes e fecha com o timestamp do carregador', async () => {
    const r = await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 11000, {
      transactionData: [
        { timestamp: T1, sampledValue: [{ value: '4000', unit: 'Wh' }] },
        { timestamp: T2, sampledValue: [{ value: '8', unit: 'kWh' }] },
      ],
    });
    const ms = await c.repo.listarMedicoes(s.transactionId);
    expect(ms.map((m) => m.valor)).toEqual([4000, 8000]);
    expect(c.repo.transacoes[0]!.fim_em).toBe(T3);
    expect(recarga(r.id)).toMatchObject({ status: 'completed', finalizada_em: T3, kwh_consumido: 10 });
  });

  it('RS-02/RS-03 StopTransaction retransmitido e idempotente: nao sobrescreve, nao repete estorno', async () => {
    const r = await preparar();
    const s = await iniciar();
    await parar(s.transactionId, 11000, { reason: 'EVDisconnected' });
    const antes = JSON.stringify(recarga(r.id));
    const resp = await cli.call('StopTransaction', {
      transactionId: s.transactionId, meterStop: 20000, timestamp: '2026-10-04T13:00:00.000Z', reason: 'Local',
    });
    expect(resp).toBeTruthy();
    expect(JSON.stringify(recarga(r.id))).toBe(antes);
    expect(c.repo.transacoes[0]).toMatchObject({ meter_stop_wh: 11000, fim_em: T3, motivo_parada: 'EVDisconnected' });
    expect(c.repo.estornos).toHaveLength(1);
  });
});

describe('Fix round 1', () => {
  it('SG ownership: carregador nao fecha nem mede transacao de outro carregador', async () => {
    const r = await preparar();
    const s = await iniciar();
    c.repo.semearCarregador({ ocppId: 'CP-2', senha_hash: c.repo.carregadores[0]!.senha_hash });
    const outro = c.carregadorFake('CP-2', 'segredo-cp1');
    await outro.connect();
    await outro.call('MeterValues', { connectorId: 1, transactionId: s.transactionId, meterValue: [{ timestamp: T1, sampledValue: [{ value: '9000' }] }] });
    await outro.call('StopTransaction', { transactionId: s.transactionId, meterStop: 11000, timestamp: T3 });
    expect(c.repo.transacoes[0]!.fim_em).toBeNull();
    expect(await c.repo.listarMedicoes(s.transactionId)).toHaveLength(0);
    expect(recarga(r.id).status).toBe('charging');
    expect(c.repo.estornos).toHaveLength(0);
    expect(c.repo.alertas.filter((a) => a.tipo === 'transacao_desconhecida')).toHaveLength(2);
  });

  it('RS-02 falha no estorno: Stop retransmitido conclui e pede exatamente um estorno', async () => {
    const r = await preparar();
    const s = await iniciar();
    const orig = c.repo.solicitarEstorno.bind(c.repo);
    let falhou = false;
    c.repo.solicitarEstorno = async (id, e) => {
      if (!falhou) { falhou = true; throw new Error('boom'); }
      return orig(id, e);
    };
    const dados = { transactionData: [{ timestamp: T1, sampledValue: [{ value: '4000' }] }] };
    await expect(parar(s.transactionId, 11000, { reason: 'EVDisconnected', ...dados })).rejects.toBeTruthy();
    expect(c.repo.estornos).toHaveLength(0);
    await parar(s.transactionId, 11000, { reason: 'EVDisconnected', ...dados });
    expect(recarga(r.id)).toMatchObject({ status: 'completed', valor_estornado: 30 });
    expect(c.repo.estornos).toHaveLength(1);
    await parar(s.transactionId, 11000, { reason: 'EVDisconnected', ...dados });
    expect(c.repo.estornos).toHaveLength(1);
    expect(await c.repo.listarMedicoes(s.transactionId)).toHaveLength(1);
  });

  it('RS-02 falha ao atualizar a recarga: Stop retransmitido a completa e usa os dados ja gravados', async () => {
    const r = await preparar();
    const s = await iniciar();
    const orig = c.repo.atualizarRecarga.bind(c.repo);
    let falhou = false;
    c.repo.atualizarRecarga = async (id, patch, de) => {
      if (!falhou && patch.status === 'completed') { falhou = true; throw new Error('boom'); }
      return orig(id, patch, de);
    };
    await expect(parar(s.transactionId, 11000, { reason: 'EVDisconnected' })).rejects.toBeTruthy();
    expect(recarga(r.id).status).toBe('charging');
    expect(c.repo.idTags[0]!.status).toBe('Expired');
    await parar(s.transactionId, 99999, { reason: 'Local', timestamp: '2026-10-04T14:00:00.000Z' });
    expect(recarga(r.id)).toMatchObject({ status: 'completed', valor_final: 20, finalizada_em: T3, motivo_fim: 'EVDisconnected' });
    expect(c.repo.estornos).toHaveLength(1);
  });

  it('SG idTag de recarga de outro eletroposto: Invalid no Authorize e no Start; recarga intocada', async () => {
    const r = await preparar();
    c.repo.recargas[0]!.eletroposto_id = 'outro-eletroposto';
    expect((await autorizar()).idTagInfo.status).toBe('Invalid');
    const s = await iniciar();
    expect(s.idTagInfo.status).toBe('Invalid');
    expect(Number.isInteger(s.transactionId)).toBe(true);
    expect(c.repo.transacoes[0]!.recarga_id).toBeNull();
    expect(recarga(r.id)).toMatchObject({ status: 'starting', ocpp_transacao_id: null, kwh_limite: null });
  });
});
