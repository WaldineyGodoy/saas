import { describe, test, expect } from 'vitest';
import { exigirAssinatura, RECARGA_TRANSICOES, transicaoValida } from '../supabase/functions/_shared/recarga';

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
