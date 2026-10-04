import { describe, test, expect } from 'vitest';
import {
  exigirAssinatura, RECARGA_TRANSICOES, transicaoValida,
  conectorDisponivel, mensagemConectorIndisponivel, comandoInicio, comandoParada, gerarIdTag,
  igualConstante, podeParar, valorEstornoCentavos, validarPedidoEstorno, tarifaDoMotorista,
  ESTORNO_MINIMO_CENTAVOS,
} from '../supabase/functions/_shared/recarga';

describe('exigirAssinatura (SG-03)', () => {
  test('sem STRIPE_WEBHOOK_SECRET lança', () => {
    expect(() => exigirAssinatura(undefined, 't=1,v1=abc')).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => exigirAssinatura('', 't=1,v1=abc')).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
  test('sem cabeçalho stripe-signature lança', () => {
    expect(() => exigirAssinatura('whsec_x', null)).toThrow(/stripe-signature/);
    expect(() => exigirAssinatura('whsec_x', '')).toThrow(/stripe-signature/);
  });
  test('com os dois devolve o par para a verificação da Stripe', () => {
    expect(exigirAssinatura('whsec_x', 't=1,v1=abc')).toEqual({ secret: 'whsec_x', assinatura: 't=1,v1=abc' });
  });
});

describe('RECARGA_TRANSICOES (spec §4.8)', () => {
  test.each([
    ['pending_payment', 'paid'],
    ['pending_payment', 'failed'],
    ['pending_payment', 'canceled'],
    ['paid', 'starting'],
    ['paid', 'failed'],
    ['starting', 'charging'],
    ['starting', 'failed'],
    ['starting', 'canceled'],
    ['charging', 'completed'],
  ])('%s → %s é válida', (de, para) => expect(transicaoValida(de, para)).toBe(true));

  test.each([
    ['pending_payment', 'charging'],
    ['pending_payment', 'starting'],
    ['pending_payment', 'completed'],
    ['paid', 'pending_payment'],
    ['paid', 'charging'],
    ['charging', 'paid'],
    ['completed', 'paid'],
    ['failed', 'paid'],
    ['canceled', 'paid'],
    ['paid', 'paid'],
    ['inexistente', 'paid'],
  ])('%s → %s é inválida', (de, para) => expect(transicaoValida(de, para)).toBe(false));

  test('estados finais não têm saída', () => {
    for (const s of ['completed', 'failed', 'canceled']) expect(RECARGA_TRANSICOES[s]).toEqual([]);
  });
});

describe('conectorDisponivel (ST-04, UI-01, ST-02, ST-03)', () => {
  const base = { online: true, status: 'Available', bloqueado: false };
  test('Available e Preparing, online e livre: ok', () => {
    expect(conectorDisponivel(base)).toEqual({ ok: true });
    expect(conectorDisponivel({ ...base, status: 'Preparing' })).toEqual({ ok: true });
  });
  test('carregador offline: offline (mesmo com status Available gravado)', () => {
    expect(conectorDisponivel({ ...base, online: false })).toEqual({ ok: false, motivo: 'offline' });
  });
  test('bloqueado_ate_reset: bloqueado, mesmo Available', () => {
    expect(conectorDisponivel({ ...base, bloqueado: true })).toEqual({ ok: false, motivo: 'bloqueado' });
  });
  test.each(['Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing', 'Reserved'])(
    '%s: ocupado', (status) => {
      expect(conectorDisponivel({ ...base, status })).toEqual({ ok: false, motivo: 'ocupado' });
    });
  test.each(['Faulted', 'Unavailable'])('%s: bloqueado', (status) => {
    expect(conectorDisponivel({ ...base, status })).toEqual({ ok: false, motivo: 'bloqueado' });
  });
  test('status desconhecido nao libera', () => {
    expect(conectorDisponivel({ ...base, status: 'Qualquer' }).ok).toBe(false);
  });
  test('offline vence bloqueado e ocupado', () => {
    expect(conectorDisponivel({ online: false, status: 'Charging', bloqueado: true }))
      .toEqual({ ok: false, motivo: 'offline' });
  });
  test('mensagem legivel por motivo', () => {
    expect(mensagemConectorIndisponivel('offline')).toMatch(/offline/i);
    expect(mensagemConectorIndisponivel('ocupado')).toMatch(/em uso/i);
    expect(mensagemConectorIndisponivel('bloqueado')).toMatch(/indispon/i);
  });
});

describe('tarifaDoMotorista (spec §4.9)', () => {
  test('plano com tarifa positiva', () => {
    expect(tarifaDoMotorista({ tarifa_motorista_kwh: '1.9900' })).toEqual({ ok: true, tarifa: 1.99 });
    expect(tarifaDoMotorista({ tarifa_motorista_kwh: 2.15 })).toEqual({ ok: true, tarifa: 2.15 });
  });
  test('sem plano recusa', () => {
    const r = tarifaDoMotorista(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/plano/i);
  });
  test.each([null, undefined, 0, '0', -1, 'abc', ''])('tarifa %s recusa', (t) => {
    const r = tarifaDoMotorista({ tarifa_motorista_kwh: t as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/tarifa/i);
  });
});

describe('gerarIdTag (CiString20Type)', () => {
  test('formato RC + 18 base32, 20 caracteres', () => {
    for (let i = 0; i < 50; i++) {
      const t = gerarIdTag();
      expect(t).toMatch(/^RC[A-Z2-7]{18}$/);
      expect(t.length).toBeLessThanOrEqual(20);
    }
  });
  test('nao repete', () => {
    expect(new Set(Array.from({ length: 200 }, () => gerarIdTag())).size).toBe(200);
  });
  test('usa a fonte de bytes injetada (determinismo)', () => {
    const t = gerarIdTag(() => Uint8Array.from({ length: 18 }, () => 0));
    expect(t).toBe('RC' + 'A'.repeat(18));
    const u = gerarIdTag(() => Uint8Array.from({ length: 18 }, () => 255));
    expect(u).toBe('RC' + '7'.repeat(18));
  });
});

describe('comandoInicio (RC-01, RC-10)', () => {
  const agora = new Date('2026-10-04T12:00:00.000Z');
  test('RemoteStartTransaction com chave start:<id> e expiracao de 2 min', () => {
    expect(comandoInicio({ id: 'r-1', ocpp_connector_id: 2 }, 'RCABCDEFGHIJKLMNOPQR', agora)).toEqual({
      acao: 'RemoteStartTransaction',
      payload: { connectorId: 2, idTag: 'RCABCDEFGHIJKLMNOPQR' },
      chave_idempotencia: 'start:r-1',
      expira_em: '2026-10-04T12:02:00.000Z',
    });
  });
  test('connectorId inteiro positivo; sem conector resolvido lanca', () => {
    expect(() => comandoInicio({ id: 'r-1', ocpp_connector_id: null }, 'RCX', agora)).toThrow(/conector/i);
    expect(() => comandoInicio({ id: 'r-1', ocpp_connector_id: 0 }, 'RCX', agora)).toThrow(/conector/i);
    expect(() => comandoInicio({ id: 'r-1', ocpp_connector_id: 1.5 }, 'RCX', agora)).toThrow(/conector/i);
  });
  test('idTag acima de 20 caracteres lanca', () => {
    expect(() => comandoInicio({ id: 'r-1', ocpp_connector_id: 1 }, 'R'.repeat(21), agora)).toThrow(/idTag/);
  });
});

describe('comandoParada (SG-04, RC-04)', () => {
  test('RemoteStopTransaction com transactionId inteiro e a mesma chave do corte pre-pago', () => {
    expect(comandoParada({ id: 'r-1', ocpp_transacao_id: 77 })).toEqual({
      acao: 'RemoteStopTransaction',
      payload: { transactionId: 77 },
      chave_idempotencia: 'stop:r-1',
    });
  });
  test('transactionId vem do bigint do PostgREST (numero ou texto numerico)', () => {
    expect(comandoParada({ id: 'r-1', ocpp_transacao_id: '77' }).payload).toEqual({ transactionId: 77 });
  });
  test('sem transacao lanca', () => {
    expect(() => comandoParada({ id: 'r-1', ocpp_transacao_id: null })).toThrow(/transa/i);
  });
});

describe('igualConstante', () => {
  test('iguais e diferentes', () => {
    expect(igualConstante('abc', 'abc')).toBe(true);
    expect(igualConstante('abc', 'abd')).toBe(false);
    expect(igualConstante('abc', 'abcd')).toBe(false);
    expect(igualConstante('', '')).toBe(true);
  });
  test('nulo ou indefinido nunca casa', () => {
    expect(igualConstante(null, null)).toBe(false);
    expect(igualConstante(undefined, 'x')).toBe(false);
    expect(igualConstante('x', undefined)).toBe(false);
  });
});

describe('podeParar (SG-04)', () => {
  const recarga = { user_id: 'u-1', client_secret: 'pi_1_secret_abc' };
  test('dono logado', () => {
    expect(podeParar(recarga, { userId: 'u-1' })).toBe(true);
  });
  test('outro usuario logado: nao', () => {
    expect(podeParar(recarga, { userId: 'u-2' })).toBe(false);
  });
  test('client_secret do PI: sim', () => {
    expect(podeParar(recarga, { clientSecret: 'pi_1_secret_abc' })).toBe(true);
  });
  test('client_secret errado: nao', () => {
    expect(podeParar(recarga, { clientSecret: 'pi_1_secret_xyz' })).toBe(false);
  });
  test('avulso (user_id nulo) nao casa com chamador sem usuario', () => {
    const avulsa = { user_id: null, client_secret: 'pi_2_secret' };
    expect(podeParar(avulsa, { userId: null })).toBe(false);
    expect(podeParar(avulsa, { userId: undefined })).toBe(false);
    expect(podeParar(avulsa, {})).toBe(false);
    expect(podeParar(avulsa, { clientSecret: 'pi_2_secret' })).toBe(true);
  });
  test('recarga sem client_secret conhecido nao aceita segredo vazio', () => {
    expect(podeParar({ user_id: null, client_secret: null }, { clientSecret: '' })).toBe(false);
    expect(podeParar({ user_id: null, client_secret: null }, { clientSecret: null })).toBe(false);
  });
  test('usuario errado mas segredo certo: sim (qualquer prova basta)', () => {
    expect(podeParar(recarga, { userId: 'u-2', clientSecret: 'pi_1_secret_abc' })).toBe(true);
  });
});

// Mesma tabela de services/ocpp-csms/test/unit/estorno.test.ts, em centavos.
describe('valorEstornoCentavos (coerente com calcularFechamento do CSMS)', () => {
  test.each([
    ['consumo abaixo do pago devolve a diferenca', { valor: 50, tarifa_kwh_aplicada: 2.15, meter_start_wh: 1000, meter_stop_wh: 11000 }, 2850],
    ['consumo acima do limite: sem estorno', { valor: 50, tarifa_kwh_aplicada: 2.15, meter_start_wh: 0, meter_stop_wh: 30000 }, 0],
    ['estorno abaixo de R$ 0,50 vira 0', { valor: 50, tarifa_kwh_aplicada: 2.15, meter_start_wh: 0, meter_stop_wh: 23100 }, 0],
    ['exatamente R$ 0,50 e devolvido', { valor: 10, tarifa_kwh_aplicada: 2, meter_start_wh: 0, meter_stop_wh: 4750 }, 50],
    ['contador regrediu (MV-03): 0', { valor: 50, tarifa_kwh_aplicada: 2.15, meter_start_wh: 5000, meter_stop_wh: 4000 }, 0],
    ['sem consumo devolve tudo', { valor: 50, tarifa_kwh_aplicada: 2.15, meter_start_wh: 100, meter_stop_wh: 100 }, 5000],
  ])('%s', (_n, r, esperado) => expect(valorEstornoCentavos(r)).toBe(esperado));

  test('minimo e R$ 0,50', () => expect(ESTORNO_MINIMO_CENTAVOS).toBe(50));
  test('valor e tarifa em string numerica (NUMERIC do PostgREST)', () => {
    expect(valorEstornoCentavos({ valor: '50.00', tarifa_kwh_aplicada: '2.1500', meter_start_wh: 1000, meter_stop_wh: 11000 })).toBe(2850);
  });
});

describe('validarPedidoEstorno', () => {
  const recarga = { valor: '50.00', status: 'completed', stripe_payment_intent_id: 'pi_1', stripe_refund_id: null };
  test('pedido valido', () => expect(validarPedidoEstorno(recarga, 2850)).toBeNull());
  test('total e permitido', () => expect(validarPedidoEstorno(recarga, 5000)).toBeNull());
  test.each([0, -1, 1.5, NaN, '10', null, undefined])('valor_centavos %s invalido', (v) => {
    expect(validarPedidoEstorno(recarga, v as never)).toMatch(/valor_centavos/);
  });
  test('acima do valor pago recusa', () => {
    expect(validarPedidoEstorno(recarga, 5001)).toMatch(/excede/i);
  });
  test('sem PaymentIntent recusa', () => {
    expect(validarPedidoEstorno({ ...recarga, stripe_payment_intent_id: null }, 100)).toMatch(/PaymentIntent/);
  });
  test('recarga que nunca foi paga recusa', () => {
    expect(validarPedidoEstorno({ ...recarga, status: 'pending_payment' }, 100)).toMatch(/paga/i);
  });
});
