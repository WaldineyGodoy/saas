import { describe, it, expect } from 'vitest';
import { normalizar } from '../../src/domain/medicao.js';

describe('normalizar', () => {
  it('kWh vira Wh', () => {
    expect(normalizar({ value: '1.5', unit: 'kWh', measurand: 'Energy.Active.Import.Register' }))
      .toEqual({ valor: 1500, unidade: 'Wh' });
  });
  it('kW vira W', () => {
    expect(normalizar({ value: '7.4', unit: 'kW', measurand: 'Power.Active.Import' }))
      .toEqual({ valor: 7400, unidade: 'W' });
  });
  it('sem measurand assume energia (MV-04)', () => {
    expect(normalizar({ value: '2', unit: 'kWh' })).toEqual({ valor: 2000, unidade: 'Wh' });
  });
  it('sem unit assume Wh (default do 1.6)', () => {
    expect(normalizar({ value: '1234' })).toEqual({ valor: 1234, unidade: 'Wh' });
  });
  it('mantem unidades que nao precisam de conversao', () => {
    expect(normalizar({ value: '230.5', unit: 'V', measurand: 'Voltage' }))
      .toEqual({ valor: 230.5, unidade: 'V' });
  });
  it('sem artefato de ponto flutuante', () => {
    expect(normalizar({ value: '0.0003', unit: 'kWh' }).valor).toBe(0.3);
  });
  it('valor nao numerico lanca', () => {
    expect(() => normalizar({ value: 'abc', unit: 'Wh' })).toThrow();
    expect(() => normalizar({ value: '', unit: 'Wh' })).toThrow();
    expect(() => normalizar({ value: 'NaN' })).toThrow();
  });
});
