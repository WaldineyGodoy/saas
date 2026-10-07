import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ CRM_URL: 'https://crm.b2wenergia.com.br' }));
const { linkIndicacao, parseQrRecarga, textoIndicacao, urlCheckoutRecarga } = await import('../links');

const ID = '3f2b9c1e-8a4d-4e2f-9b1a-0c5d6e7f8a9b';

describe('QR de recarga', () => {
  it('le o link do carregador', () => {
    expect(parseQrRecarga(`https://crm.b2wenergia.com.br/recarga?posto=${ID}&conector=2`)).toEqual({ posto: ID, conector: '2' });
  });
  it('aceita so o ID e assume conector 1', () => {
    expect(parseQrRecarga(` ${ID} `)).toEqual({ posto: ID, conector: '1' });
  });
  it('recusa QR que nao e de carregador', () => {
    expect(parseQrRecarga('https://exemplo.com/?posto=abc')).toBeNull();
    expect(parseQrRecarga('texto qualquer')).toBeNull();
  });
  it('conector invalido vira 1', () => {
    expect(parseQrRecarga(`https://x.com/recarga?posto=${ID}&conector=a;b`)?.conector).toBe('1');
  });
  it('monta a URL do checkout', () => {
    expect(urlCheckoutRecarga(ID, '3')).toBe(`https://crm.b2wenergia.com.br/recarga?posto=${ID}&conector=3`);
  });
});

describe('link de indicacao', () => {
  it('prefere o encurtado', () => {
    expect(linkIndicacao({ id: ID, name: 'Maria', short_url: 'https://b2w.link/x' })).toBe('https://b2w.link/x');
  });
  it('mesma string canonica do CRM web (assinanteConnect.js)', () => {
    expect(linkIndicacao({ id: ID, name: 'Maria José da Silva', short_url: null }))
      .toBe(`https://b2wenergia.com.br/?indicador=${ID}&name=Maria`);
  });
  it('sem link nao ha mensagem', () => {
    expect(textoIndicacao('Maria', '')).toBe('');
    expect(textoIndicacao('Maria Silva', 'L')).toContain('Oi! Aqui é Maria.');
  });
});
