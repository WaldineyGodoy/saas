import { describe, test, expect } from 'vitest';
import { PAGINA_TERMOS, urlTermosDoContrato, linkDeAssinaturaDaSig, textoLinkContratoCrm, keywordTermos } from '../src/lib/contratoLink';

const DIRETO = 'https://link.b2wenergia.com.br/assinaturae22887430';
const UC = { numero_uc: '123', concessionaria: 'Neoenergia Cosern', desconto_assinante: '15.00', planos_assinatura_energia: { desconto_assinante: '15.00' } };

describe('PAGINA_TERMOS', () => {
  test('e a pagina publica de termos, a mesma que o servidor usa na adesao', () => {
    expect(PAGINA_TERMOS).toBe('https://www.b2wenergia.com.br/contrato/');
  });
});

describe('urlTermosDoContrato: o destino do link que o cliente recebe', () => {
  const u = (o = {}) => new URL(urlTermosDoContrato({ linkAssinatura: DIRETO, nome: 'MULTI TV COMUNICACOES LTDA', uc: UC, ...o }));

  test('vai para a pagina de termos, nao para a Autentique', () => {
    const url = u();
    expect(url.origin + url.pathname).toBe('https://www.b2wenergia.com.br/contrato/');
  });

  test('leva o link de assinatura em Linkdocontrato (o botao "assinar" da pagina)', () => {
    expect(u().searchParams.get('Linkdocontrato')).toBe(DIRETO);
  });

  test('leva nome, concessionaria e o desconto da UC', () => {
    const q = u().searchParams;
    expect(q.get('nome')).toBe('MULTI TV COMUNICACOES LTDA');
    expect(q.get('concessionaria')).toBe('Neoenergia Cosern');
    expect(q.get('desconto')).toBe('15');
  });

  test('o desconto vem da regra de contratoUcs: UC primeiro, depois o plano', () => {
    expect(u({ uc: { ...UC, desconto_assinante: '17.5' } }).searchParams.get('desconto')).toBe('17.5');
    expect(u({ uc: { ...UC, desconto_assinante: 0 } }).searchParams.get('desconto')).toBe('15');
  });

  test('sem desconto em lugar nenhum, nao manda o parametro (a pagina nao imprime numero inventado)', () => {
    const q = u({ uc: { concessionaria: 'X', desconto_assinante: null, planos_assinatura_energia: null } }).searchParams;
    expect(q.has('desconto')).toBe(false);
  });

  test('sem UC, manda so o essencial e nao quebra', () => {
    const q = u({ uc: undefined }).searchParams;
    expect(q.get('Linkdocontrato')).toBe(DIRETO);
    expect(q.get('concessionaria')).toBe('');
    expect(q.has('desconto')).toBe(false);
  });

  test('nunca vai CPF, CNPJ nem endereco na URL (o link circula em WhatsApp e e-mail)', () => {
    const url = urlTermosDoContrato({ linkAssinatura: DIRETO, nome: 'MULTI TV', uc: UC });
    expect(url).not.toMatch(/cpf|cnpj|endereco|rua|\d{3}\.\d{3}\.\d{3}/i);
    expect([...new URL(url).searchParams.keys()].sort()).toEqual(['Linkdocontrato', 'concessionaria', 'desconto', 'nome']);
  });

  test('nome com acento, espaco e & e codificado, sem quebrar os demais parametros', () => {
    const q = u({ nome: 'José & Filhos Ltda' }).searchParams;
    expect(q.get('nome')).toBe('José & Filhos Ltda');
    expect(q.get('Linkdocontrato')).toBe(DIRETO);
  });

  test('o host esta na lista que o encurtador aceita (senao o link nem seria criado)', () => {
    const host = u().hostname;
    expect(['b2wenergia.com.br'].some((d) => host === d || host.endsWith(`.${d}`))).toBe(true);
  });
});

describe('linkDeAssinaturaDaSig: qual link da Autentique vai dentro da pagina de termos', () => {
  test('o link curto direto, quando existe', () => {
    expect(linkDeAssinaturaDaSig({ short_url: DIRETO, autentique_url: 'https://assina.ae/x' })).toBe(DIRETO);
  });
  test('sem curto, o da Autentique', () => {
    expect(linkDeAssinaturaDaSig({ short_url: null, autentique_url: 'https://assina.ae/x' })).toBe('https://assina.ae/x');
  });
  test('sem nenhum, nulo', () => {
    expect(linkDeAssinaturaDaSig({})).toBeNull();
    expect(linkDeAssinaturaDaSig(null)).toBeNull();
  });
});

describe('textoLinkContratoCrm: a mensagem do CRM com UM link so', () => {
  const LINK = 'https://link.b2wenergia.com.br/contrato-e2288197-ab12';
  const t = textoLinkContratoCrm('MULTI TV COMUNICACOES LTDA', LINK);

  test('traz o link exatamente uma vez', () => {
    expect(t.split(LINK).length - 1).toBe(1);
  });
  test('nao repete a pagina generica de resumo (o proprio link ja e a pagina)', () => {
    expect(t).not.toMatch(/b2wenergia\.com\.br\/contrato(?!-)/);
    expect(t).not.toMatch(/um resumo do contrato/i);
  });
  test('chama o cliente pelo nome e pede a assinatura', () => {
    expect(t).toContain('MULTI TV COMUNICACOES LTDA');
    expect(t).toMatch(/assine/i);
  });
  test('o unico endereco na mensagem e o do link', () => {
    expect(t.match(/https?:\/\/\S+/g)).toEqual([LINK]);
  });
});

describe('keywordTermos reexportada do servidor', () => {
  test('mesmo formato do servidor: contrato-<8 do id>-<4 aleatorios>', () => {
    expect(keywordTermos('e2288197-b541-4332-9ed7-347aa06c8f5d', new Date())).toMatch(/^contrato-e2288197-[0-9a-z]{4}$/);
  });
});
