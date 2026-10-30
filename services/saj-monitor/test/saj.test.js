import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assinar, textoAssinado, criarClienteSaj } from '../src/saj.js';
import { coletar, dataHoraLocal, paraIso } from '../src/coleta.js';

// exemplos 4.1 e 4.2 da "Signature Rule" do guia de acesso da SAJ
test('assinatura bate com os exemplos da documentação', () => {
  assert.equal(assinar('123456789', {}), '696c9d8c59f2ccb6c5c3c7c76ef5d36a6206c967f751f2fee8a2359e0065fb7d');
  assert.equal(
    assinar('123456789', { deviceSn: '123456789' }),
    '602edf03828821359b06f75bce12dd0829038e7fbeff55aedb2cde85f0e23f01',
  );
});

test('parâmetros entram em ordem ASCII e nulos ficam de fora', () => {
  assert.equal(textoAssinado('A1', { pageSize: 50, deviceSn: 'X', vazio: undefined }), 'appId=A1,deviceSn=X,pageSize=50');
});

function fetchFalso(respostas) {
  const chamadas = [];
  const fn = async (url, init = {}) => {
    chamadas.push({ url, init });
    const caminho = new URL(url).pathname.replace('/prod-api', '');
    const fila = respostas[caminho];
    const corpo = typeof fila === 'function' ? fila(url, init, chamadas) : fila.shift();
    return { json: async () => corpo };
  };
  fn.chamadas = chamadas;
  return fn;
}

const tokenOk = () => ({ code: 200, data: { access_token: 'TK', expires: 28800 } });

test('token fica em cache entre chamadas', async () => {
  const f = fetchFalso({
    '/open/api/access_token': tokenOk,
    '/open/api/plant/getPlantStatisticsData': () => ({ code: 200, data: { powerNow: 1 } }),
  });
  const saj = criarClienteSaj({ appId: 'A', appSecret: 'S', fetchImpl: f, intervaloMs: 0 });
  await saj.estatisticas('P1', '2026-10-31 10:00:00');
  await saj.estatisticas('P1', '2026-10-31 10:10:00');
  assert.equal(f.chamadas.filter((c) => c.url.includes('access_token')).length, 1);
  const h = f.chamadas[1].init.headers;
  assert.equal(h.accessToken, 'TK');
  assert.equal(h.clientSign, assinar('A', { plantId: 'P1', clientDate: '2026-10-31 10:00:00' }));
});

test('assinatura recusada troca a caixa do hash uma vez', async () => {
  let n = 0;
  const f = fetchFalso({
    '/open/api/access_token': tokenOk,
    '/open/api/plant/getPlantStatisticsData': () => (++n === 1 ? { code: 200012, msg: 'sign' } : { code: 200, data: { ok: 1 } }),
  });
  const saj = criarClienteSaj({ appId: 'A', appSecret: 'S', fetchImpl: f, intervaloMs: 0 });
  assert.deepEqual(await saj.estatisticas('P1', 'x'), { ok: 1 });
  const assinaturas = f.chamadas.filter((c) => c.url.includes('Statistics')).map((c) => c.init.headers.clientSign);
  assert.equal(assinaturas[1], assinaturas[0].toUpperCase());
});

test('token inexistente é renovado e a chamada repetida', async () => {
  let n = 0;
  const f = fetchFalso({
    '/open/api/access_token': tokenOk,
    '/open/api/plant/getPlantStatisticsData': () => (++n === 1 ? { code: 200010 } : { code: 200, data: { ok: 1 } }),
  });
  const saj = criarClienteSaj({ appId: 'A', appSecret: 'S', fetchImpl: f, intervaloMs: 0 });
  await saj.estatisticas('P1', 'x');
  assert.equal(f.chamadas.filter((c) => c.url.includes('access_token')).length, 2);
});

test('app não publicado vira erro com o código da SAJ', async () => {
  const f = fetchFalso({ '/open/api/access_token': () => ({ code: 200014, msg: 'app is not released' }) });
  const saj = criarClienteSaj({ appId: 'A', appSecret: 'S', fetchImpl: f, intervaloMs: 0 });
  await assert.rejects(saj.obterToken(), /200014/);
});

test('datas: horário local das usinas e conversão para ISO', () => {
  assert.equal(dataHoraLocal(new Date('2026-10-31T12:00:00Z')), '2026-10-31 09:00:00');
  assert.equal(paraIso('2026-10-31 09:00:00'), '2026-10-31T12:00:00.000Z');
  assert.equal(paraIso(Date.UTC(2026, 9, 31, 12)), '2026-10-31T12:00:00.000Z');
  assert.equal(paraIso(''), null);
});

test('coleta junta inversores, usinas e alarmes; falha de uma usina não derruba o ciclo', async () => {
  const saj = {
    dispositivos: async () => [
      { deviceSn: 'SN1', deviceType: 'C6', plantId: 161369, plantName: 'UFV Bom Jesus', isOnline: 1, isAlarm: 0 },
      { deviceSn: 'SN2', deviceType: 'R6', plantId: 'P2', plantName: 'Outra', isOnline: 0, isAlarm: 1 },
    ],
    estatisticas: async (id) => {
      if (id === 'P2') throw new Error('SAJ x: 10001');
      return { powerNow: 52000, todayPvEnergy: '310.5', totalPvEnergy: 120000, updateDate: '2026-10-31 09:55:00' };
    },
    alarmes: async () => [
      { deviceSn: 'SN2', alarmCode: 17, alarmName: 'Grid lost', alarmLevel: 2, status: 1, alarmTime: '2026-10-31 08:00:00' },
      { deviceSn: 'SN2', alarmCode: null, alarmTime: null },
    ],
  };
  const p = await coletar(saj, new Date('2026-10-31T13:00:00Z'));
  assert.equal(p.dispositivos.length, 2);
  assert.equal(p.dispositivos[0].plant_id, '161369');
  assert.equal(p.plantas.length, 1);
  assert.equal(p.plantas[0].energia_hoje_kwh, 310.5);
  assert.equal(p.plantas[0].dados_em, '2026-10-31T12:55:00.000Z');
  assert.equal(p.alarmes.length, 1);
  assert.equal(p.alarmes[0].codigo, '17');
  assert.deepEqual(p.erros, ['planta P2: SAJ x: 10001']);
});
