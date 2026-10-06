import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
const { extrairIndicador, celularBR } = await import('../indicacao');

const ID = '3f2b9c1e-8a4d-4e2f-9b1a-0c5d6e7f8a9b';

describe('extrairIndicador', () => {
  it('le o link longo da raiz', () => {
    expect(extrairIndicador(`https://b2wenergia.com.br/?indicador=${ID}&name=Maria`)).toEqual({ id: ID });
  });
  it('le a rota do webapp', () => {
    expect(extrairIndicador(`https://apps.b2wenergia.com.br/i/${ID.toUpperCase()}`)).toEqual({ id: ID });
  });
  it('aceita so o codigo, com espacos', () => {
    expect(extrairIndicador(`  ${ID} `)).toEqual({ id: ID });
  });
  it('link curto vai para resolver no servidor', () => {
    expect(extrairIndicador('link.b2wenergia.com.br/maria-c3f2b')).toEqual({ curto: 'https://link.b2wenergia.com.br/maria-c3f2b' });
  });
  it('recusa o que nao e indicacao', () => {
    expect(extrairIndicador('https://crm.b2wenergia.com.br/recarga?posto=abc')).toBeNull();
    expect(extrairIndicador('https://outro.com/qualquer')).toBeNull();
    expect(extrairIndicador('')).toBeNull();
    expect(extrairIndicador('texto solto')).toBeNull();
  });
});

describe('celularBR', () => {
  it('normaliza mascara e +55', () => {
    expect(celularBR('+55 (84) 99888-7766')).toBe('84998887766');
    expect(celularBR('(84) 3222-1100')).toBe('8432221100');
  });
  it('recusa curto e numero de fachada', () => {
    expect(celularBR('9988')).toBeNull();
    expect(celularBR('99999999999')).toBeNull();
  });
});
