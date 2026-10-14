import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ CRM_URL: 'https://crm.b2wenergia.com.br' }));
const { linkIndicacao, linkParceiro, linkSiteConvite, textoContratoCliente, textoConviteParceiro, parseQrRecarga, textoIndicacao, urlCheckoutRecarga, whatsappPara } = await import('../links');

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

describe('linkSiteConvite', () => {
  it('monta o convite do originador como o CRM', () => {
    expect(linkSiteConvite(ID, ' Carlos  Silva ')).toBe(`https://b2wenergia.com.br/convite/?name=Carlos&id=${ID}`);
  });
});

describe('link do Parceiro Power', () => {
  it('usa o link curto e, sem ele, a rota do webapp', () => {
    expect(linkParceiro({ id: ID, short_url: 'https://link.b2wenergia.com.br/fabiof038' })).toBe('https://link.b2wenergia.com.br/fabiof038');
    expect(linkParceiro({ id: ID, short_url: null })).toBe(`https://apps.b2wenergia.com.br/i/${ID}`);
    expect(linkParceiro(null)).toBe('');
  });
  it('mensagem do parceiro leva o link', () => {
    expect(textoConviteParceiro('Fabio Santos', 'https://x/y')).toMatch(/^Oi! Aqui é Fabio, parceiro da B2W Energia\..*https:\/\/x\/y$/);
    expect(textoConviteParceiro('Fabio', '')).toBe('');
  });
});

describe('adesão assistida: mensagem ao cliente', () => {
  it('chama o cliente pelo primeiro nome e leva o link de assinatura', () => {
    const t = textoContratoCliente('Carla Mendes', 'https://assina.example/abc');
    expect(t).toMatch(/^Oi, Carla!/);
    expect(t).toContain('https://assina.example/abc');
  });
  it('sem link não monta mensagem', () => {
    expect(textoContratoCliente('Carla', '')).toBe('');
  });
  it('WhatsApp vai direto para o celular do cliente, com o 55', () => {
    expect(whatsappPara('84999990001', 'oi')).toBe('https://wa.me/5584999990001?text=oi');
    expect(whatsappPara(null, 'oi')).toBe('https://wa.me/?text=oi');
  });
});
