import { describe, expect, it } from 'vitest';
import { enderecoCurto, fmtBRL, fmtCiclo, fmtData, fmtKwh, iniciais, mesCurto, variacao } from '../format';

describe('format', () => {
  it('formata moeda e trata vazio', () => {
    expect(fmtBRL(1273)).toBe('R$ 1.273,00');
    expect(fmtBRL(null)).toBe('—');
    expect(fmtBRL('abc')).toBe('—');
  });
  it('formata kWh sem casas', () => {
    expect(fmtKwh(14145.4)).toBe('14.145');
    expect(fmtKwh(undefined)).toBe('—');
  });
  it('datas do banco nao deslocam por fuso', () => {
    expect(fmtCiclo('2025-03-01')).toBe('03/2025');
    expect(fmtData('2025-04-15')).toBe('15/04/2025');
    expect(fmtData('2025-04-15T00:00:00+00:00')).toBe('15/04/2025');
    expect(mesCurto('2025-04-01')).toBe('Abr');
  });
  it('variacao', () => {
    expect(variacao(110, 100)).toBeCloseTo(10);
    expect(variacao(1, 0)).toBeNull();
    expect(variacao(null, 5)).toBeNull();
  });
  it('endereco aceita chaves pt e en', () => {
    expect(enderecoCurto({ rua: 'Av. Paulista', numero: '1842', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' }))
      .toBe('Av. Paulista, 1842 - Bela Vista, São Paulo - SP');
    expect(enderecoCurto({ street: 'Rua A', city: 'BH', state: 'MG' })).toBe('Rua A - BH - MG');
    expect(enderecoCurto(null)).toBe('');
  });
  it('iniciais', () => {
    expect(iniciais('Mariana  Silveira Costa')).toBe('MS');
    expect(iniciais('')).toBe('');
  });
});
