import { describe, it, expect } from 'vitest';
import { calcularFechamento } from '../../src/domain/estorno.js';

describe('calcularFechamento', () => {
  it('consumo abaixo do pago devolve a diferenca', () => {
    expect(calcularFechamento({ valor: 50, tarifa: 2.15, whStart: 1000, whStop: 11000 }))
      .toMatchObject({ valor_final: 21.5, estorno: 28.5, revisar: false });
  });
  it('consumo acima do limite cobra o valor pago, sem estorno', () => {
    expect(calcularFechamento({ valor: 50, tarifa: 2.15, whStart: 0, whStop: 30000 }))
      .toMatchObject({ valor_final: 50, estorno: 0, revisar: false });
  });
  it('estorno abaixo de R$ 0,50 vira 0', () => {
    const r = calcularFechamento({ valor: 50, tarifa: 2.15, whStart: 0, whStop: 23100 });
    expect(r.estorno).toBe(0);
    expect(r.valor_final).toBe(50);
  });
  it('estorno de exatamente R$ 0,50 e devolvido', () => {
    const r = calcularFechamento({ valor: 10, tarifa: 2, whStart: 0, whStop: 4750 });
    expect(r.estorno).toBe(0.5);
    expect(r.valor_final).toBe(9.5);
  });
  it('whStop < whStart pede revisao (MV-03)', () => {
    expect(calcularFechamento({ valor: 50, tarifa: 2.15, whStart: 5000, whStop: 4000 }))
      .toMatchObject({ revisar: true, estorno: 0, valor_final: 50 });
  });
  it('sem consumo devolve tudo', () => {
    expect(calcularFechamento({ valor: 50, tarifa: 2.15, whStart: 100, whStop: 100 }))
      .toMatchObject({ valor_final: 0, estorno: 50 });
  });
});
