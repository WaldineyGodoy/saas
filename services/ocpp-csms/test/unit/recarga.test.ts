import { describe, it, expect } from 'vitest';
import { kwhLimite, deveCortar, transicaoValida, RECARGA_TRANSICOES } from '../../src/domain/recarga.js';

describe('kwhLimite', () => {
  it('2 casas, para baixo', () => {
    expect(kwhLimite(50, 2.15)).toBe(23.25);
  });
  it('divisao exata fica exata', () => {
    expect(kwhLimite(21.5, 2.15)).toBe(10);
    expect(kwhLimite(30, 3)).toBe(10);
  });
  it('tarifa invalida lanca', () => {
    expect(() => kwhLimite(50, 0)).toThrow();
    expect(() => kwhLimite(50, -1)).toThrow();
  });
});

describe('deveCortar', () => {
  it('corta ao atingir ou passar o limite', () => {
    expect(deveCortar(23.24, 23.25)).toBe(false);
    expect(deveCortar(23.25, 23.25)).toBe(true);
    expect(deveCortar(30, 23.25)).toBe(true);
  });
});

describe('transicaoValida (espelha fn_recarga_transicao_valida)', () => {
  it('mapa completo', () => {
    expect(RECARGA_TRANSICOES).toEqual({
      pending_payment: ['paid', 'failed', 'canceled'],
      paid: ['starting', 'failed'],
      starting: ['charging', 'failed', 'canceled'],
      charging: ['completed'],
      completed: [],
      failed: [],
      canceled: [],
    });
  });
  it('permitidas e proibidas', () => {
    expect(transicaoValida('paid', 'starting')).toBe(true);
    expect(transicaoValida('charging', 'completed')).toBe(true);
    expect(transicaoValida('paid', 'charging')).toBe(false);
    expect(transicaoValida('completed', 'failed')).toBe(false);
    expect(transicaoValida('charging', 'failed')).toBe(false);
    expect(transicaoValida('x', 'paid')).toBe(false);
  });
});
