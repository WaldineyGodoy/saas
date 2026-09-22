import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MODELOS_LEAD,
  montarMensagemLead,
  montarLinkIndicacao,
  decidirEnvioLead,
  LIMITE_ENVIOS_DIA,
  LIMITE_ENVIOS_ORIGINADOR_DIA,
  nomeSeguro,
} from '../supabase/functions/_shared/mensagem-lead';

const vars = { nomeLead: 'Maria', nomeOriginador: 'João', link: 'https://b2w.link/joao-1234' };

describe('modelos de mensagem ao lead', () => {
  test('tem exatamente os 3 modelos', () =>
    expect(Object.keys(MODELOS_LEAD).sort()).toEqual(['convite', 'lembrete_simulacao', 'retomar_adesao']));

  test('convite', () =>
    expect(montarMensagemLead('convite', vars)).toBe(
      'Oi, Maria! Aqui é João, da B2W Energia. Veja quanto você economiza na conta de luz: https://b2w.link/joao-1234'));

  for (const chave of ['convite', 'lembrete_simulacao', 'retomar_adesao']) {
    test(`${chave} leva nome do lead, do originador e o link, sem sobra de chave`, () => {
      const t = montarMensagemLead(chave, vars)!;
      expect(t).toContain('Maria');
      expect(t).toContain('João');
      expect(t).toContain('https://b2w.link/joao-1234');
      expect(t).not.toMatch(/[{}]/);
      expect(t).not.toMatch(/R\$|\d+\s*%/); // sem promessa de valor
    });
  }

  test('chave desconhecida -> null', () => expect(montarMensagemLead('texto_livre', vars)).toBeNull());
  test('chave herdada do prototype -> null', () => expect(montarMensagemLead('toString', vars)).toBeNull());

  test('usa so o primeiro nome do lead e do originador', () => {
    const t = montarMensagemLead('convite', { nomeLead: '  Maria  da Silva ', nomeOriginador: 'João Pedro', link: 'x' })!;
    expect(t.startsWith('Oi, Maria! Aqui é João, da')).toBe(true);
  });

  test('sem nome do lead usa saudacao neutra', () =>
    expect(montarMensagemLead('convite', { nomeLead: '', nomeOriginador: 'Ana', link: 'x' })!.startsWith('Oi, tudo bem? Aqui')).toBe(true));
  test('nome do lead com URL vira saudacao neutra (fix C1b)', () => {
    const t = montarMensagemLead('convite', { nomeLead: 'www.evil.com', nomeOriginador: 'http://x.io', link: 'L' })!;
    expect(t).not.toMatch(/evil|x\.io|www/);
    expect(t.startsWith('Oi, tudo bem? Aqui')).toBe(true);
  });

  test('fonte sem bytes nao-ASCII (acentos em escapes unicode)', () => {
    const fonte = readFileSync(resolve(__dirname, '../supabase/functions/_shared/mensagem-lead.ts'), 'utf8');
    expect(fonte).toMatch(/^[\x00-\x7F]*$/);
  });
});

describe('nome seguro (fix C1b)', () => {
  test('primeira palavra so com letras', () => expect(nomeSeguro('  Maria  da Silva ')).toBe('Maria'));
  test('acentos sao letras', () => expect(nomeSeguro('José')).toBe('José'));
  test('hifen e apostrofo passam', () => {
    expect(nomeSeguro("D'Arc")).toBe("D'Arc");
    expect(nomeSeguro('Ana-Clara Souza')).toBe('Ana-Clara');
  });
  for (const ruim of ['www.evil.com', 'http://x', 'Maria1', 'a@b', 'R$50', '<b>', '*Promo*'])
    test(`"${ruim}" vira vazio`, () => expect(nomeSeguro(ruim)).toBe(''));
  test('vazio/nulo', () => { expect(nomeSeguro('')).toBe(''); expect(nomeSeguro(null)).toBe(''); });
  test('maximo 20 caracteres', () => expect(nomeSeguro('A'.repeat(30))).toBe('A'.repeat(20)));
});

describe('link de indicacao', () => {
  const ID = '11111111-2222-3333-4444-555555555555';
  test('short_url de outro host e ignorado (fix C1a)', () =>
    expect(montarLinkIndicacao({ id: ID, name: 'Ana', short_url: 'https://evil.com/x' }))
      .toBe(`https://b2wenergia.com.br/?name=Ana&id=${ID}`));
  test('short_url http (sem TLS) e ignorado', () =>
    expect(montarLinkIndicacao({ id: ID, name: 'Ana', short_url: 'http://link.b2wenergia.com.br/ana' }))
      .toBe(`https://b2wenergia.com.br/?name=Ana&id=${ID}`));
  test('short_url com host parecido e ignorado', () =>
    expect(montarLinkIndicacao({ id: ID, name: 'Ana', short_url: 'https://link.b2wenergia.com.br.evil.com/a' }))
      .toBe(`https://b2wenergia.com.br/?name=Ana&id=${ID}`));
  test('short_url invalido e ignorado', () =>
    expect(montarLinkIndicacao({ id: ID, name: 'Ana', short_url: 'nao e url' }))
      .toBe(`https://b2wenergia.com.br/?name=Ana&id=${ID}`));
  test('nome inseguro sai vazio na URL longa', () =>
    expect(montarLinkIndicacao({ id: ID, name: 'www.evil.com', short_url: null }))
      .toBe(`https://b2wenergia.com.br/?name=&id=${ID}`));
  test('prefere short_url do encurtador da B2W', () =>
    expect(montarLinkIndicacao({ id: 'abc', name: 'Ana Paula', short_url: 'https://link.b2wenergia.com.br/ana-1234' }))
      .toBe('https://link.b2wenergia.com.br/ana-1234'));
  test('sem short_url cai na raiz com primeiro nome e id', () =>
    expect(montarLinkIndicacao({ id: '11111111-2222-3333-4444-555555555555', name: '  José  Claudio ', short_url: null }))
      .toBe('https://b2wenergia.com.br/?name=Jos%C3%A9&id=11111111-2222-3333-4444-555555555555'));
});

describe('decisao do envio ao lead', () => {
  const base = { papel: 'originator', userId: 'u1', leadOriginatorId: 'u1', modelo: 'convite', enviosHoje: 0, enviosOriginadorHoje: 0, temTelefone: true };
  test('originador no proprio lead passa', () => expect(decidirEnvioLead(base).status).toBe(200));
  for (const papel of ['super_admin', 'admin', 'manager', 'coordinator'])
    test(`${papel} -> 403`, () => expect(decidirEnvioLead({ ...base, papel }).status).toBe(403));
  test('sem papel -> 401', () => expect(decidirEnvioLead({ ...base, papel: null }).status).toBe(401));
  test('assinante -> 401', () => expect(decidirEnvioLead({ ...base, papel: 'subscriber' }).status).toBe(401));
  test('modelo invalido -> 400', () => expect(decidirEnvioLead({ ...base, modelo: 'livre' }).status).toBe(400));
  test('lead de outro originador -> 403', () => expect(decidirEnvioLead({ ...base, leadOriginatorId: 'u2' }).status).toBe(403));
  test('lead inexistente/sem originador -> 403', () => expect(decidirEnvioLead({ ...base, leadOriginatorId: null }).status).toBe(403));
  test('limite diario', () => {
    expect(LIMITE_ENVIOS_DIA).toBe(3);
    expect(decidirEnvioLead({ ...base, enviosHoje: 2 }).status).toBe(200);
    expect(decidirEnvioLead({ ...base, enviosHoje: 3 }).status).toBe(429);
  });
  test('limite diario por embaixador (fix C1c)', () => {
    expect(LIMITE_ENVIOS_ORIGINADOR_DIA).toBe(20);
    expect(decidirEnvioLead({ ...base, enviosOriginadorHoje: 19 }).status).toBe(200);
    expect(decidirEnvioLead({ ...base, enviosOriginadorHoje: 20 }).status).toBe(429);
  });
  test('lead sem telefone -> 400', () => expect(decidirEnvioLead({ ...base, temTelefone: false }).status).toBe(400));
});
