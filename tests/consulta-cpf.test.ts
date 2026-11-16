import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  soDigitos, cpfValido, nascimentoIso, nomeProprio,
  interpretarResposta, mensagemDoMotivo, origemDoPapel,
  respostaParaCliente, lerLimites, ipDoRequest, hashearIp, urlDaConsulta,
} from '../supabase/functions/_shared/consulta-cpf';

// CPFs de teste: matematicamente validos, nao pertencem a ninguem conhecido.
const CPF_OK = '52998224725';

describe('cpfValido: a validacao interna que decide se ha chamada paga', () => {
  test.each([
    [CPF_OK, true],
    ['529.982.247-25', true],
    ['11144477735', true],
  ])('%s -> %s', (v, esperado) => expect(cpfValido(v)).toBe(esperado));

  test.each([
    ['', 'vazio'],
    ['5299822472', '10 digitos'],
    ['529982247255', '12 digitos'],
    ['52998224726', 'digito verificador errado'],
    ['52998224715', 'primeiro digito errado'],
    ['00000000000', 'repetido'],
    ['11111111111', 'repetido'],
    ['99999999999', 'repetido'],
    ['abcdefghijk', 'letras'],
  ])('%s e rejeitado (%s)', (v) => expect(cpfValido(v)).toBe(false));

  test('aceita numero e nulo sem explodir', () => {
    expect(cpfValido(null as unknown as string)).toBe(false);
    expect(cpfValido(undefined as unknown as string)).toBe(false);
  });
});

describe('soDigitos', () => {
  test('tira mascara', () => expect(soDigitos('529.982.247-25')).toBe(CPF_OK));
  test('nulo vira vazio', () => expect(soDigitos(null as unknown as string)).toBe(''));
});

describe('nascimentoIso: DD/MM/AAAA da CPFHub para o formato do banco', () => {
  test('data comum', () => expect(nascimentoIso('15/06/1990')).toBe('1990-06-15'));
  test('zeros a esquerda', () => expect(nascimentoIso('01/02/1985')).toBe('1985-02-01'));
  test('29/02 de ano bissexto existe', () => expect(nascimentoIso('29/02/2000')).toBe('2000-02-29'));
  test.each(['29/02/2001', '31/04/1990', '00/01/1990', '15/13/1990', '15/06/90', '1990-06-15', '', 'x'])(
    '%s e recusada, nunca vira data inventada', (v) => expect(nascimentoIso(v)).toBeNull());
  test('data no futuro e recusada', () => expect(nascimentoIso('01/01/2999')).toBeNull());
  test('seculo absurdo e recusado', () => expect(nascimentoIso('01/01/1850')).toBeNull());
});

describe('nomeProprio: a base pode devolver tudo em maiusculas', () => {
  test('caixa alta vira nome proprio, com particulas em minusculas', () => {
    expect(nomeProprio('MARIA APARECIDA DA SILVA')).toBe('Maria Aparecida da Silva');
    expect(nomeProprio('JOSE DOS SANTOS E SOUSA')).toBe('Jose dos Santos e Sousa');
  });
  test('acentos sao preservados', () => expect(nomeProprio('JOÃO DA SILVA')).toBe('João da Silva'));
  test('nome que ja esta em caixa mista nao e mexido', () => {
    expect(nomeProprio('Maria de Souza')).toBe('Maria de Souza');
    expect(nomeProprio('Ana McDonald')).toBe('Ana McDonald');
  });
  test('espacos repetidos e das pontas saem', () => expect(nomeProprio('  ANA   LIMA ')).toBe('Ana Lima'));
  test('vazio fica vazio', () => expect(nomeProprio('')).toBe(''));
});

describe('interpretarResposta: cada status da CPFHub e o que ele custa', () => {
  const ok = { success: true, data: { cpf: CPF_OK, name: 'FULANO DE TAL', nameUpper: 'FULANO DE TAL', gender: 'M', birthDate: '15/06/1990' } };

  test('200 traz nome e nascimento, e custou 1 credito', () => {
    const r = interpretarResposta(200, ok);
    expect(r).toEqual({ tipo: 'encontrado', cpf: CPF_OK, nome: 'Fulano de Tal', nascimento: '1990-06-15', creditos: 1 });
  });
  test('200 com data ilegivel ainda entrega o nome, sem nascimento', () => {
    const r = interpretarResposta(200, { success: true, data: { ...ok.data, birthDate: 'lixo' } });
    expect(r).toMatchObject({ tipo: 'encontrado', nome: 'Fulano de Tal', nascimento: null, creditos: 1 });
  });
  test('200 sem nome nao e tratado como encontrado', () => {
    expect(interpretarResposta(200, { success: true, data: { cpf: CPF_OK } }).tipo).toBe('indisponivel');
  });
  test('200 com corpo quebrado vira indisponivel e nao presume credito gratis', () => {
    const r = interpretarResposta(200, null);
    expect(r.tipo).toBe('indisponivel');
  });
  test('404: nao encontrado, nao cobra', () => {
    expect(interpretarResposta(404, { success: false })).toEqual({ tipo: 'nao_encontrado', creditos: 0 });
  });
  test.each([400, 422])('%s: cpf invalido, nao cobra e nao se repete', (s) => {
    expect(interpretarResposta(s, { error: { message: 'CPF inválido' } })).toEqual({ tipo: 'cpf_invalido', creditos: 0 });
  });
  test('429 leva a espera do Retry-After', () => {
    expect(interpretarResposta(429, {}, '12')).toEqual({ tipo: 'limite_minuto', espera: 12, creditos: 0 });
  });
  test('429 sem cabecalho assume uma espera curta, nunca zero', () => {
    const r = interpretarResposta(429, {}) as { espera: number };
    expect(r.espera).toBeGreaterThan(0);
  });
  test('401 e chave errada ou trocada', () => {
    expect(interpretarResposta(401, { error: 'API Key inválida' }).tipo).toBe('chave_invalida');
  });
  test('403 com objeto "Limite de creditos" e saldo acabado', () => {
    expect(interpretarResposta(403, { error: { message: 'Limite de créditos excedido' } }).tipo).toBe('sem_credito');
  });
  test('403 com string (conta inativa/bloqueada) nao e saldo acabado', () => {
    expect(interpretarResposta(403, { error: 'Conta bloqueada. Entre em contato com o suporte.' }).tipo).toBe('conta_bloqueada');
    expect(interpretarResposta(403, { error: 'Usuário inativo. Entre em contato com o suporte.' }).tipo).toBe('conta_bloqueada');
  });
  test.each([500, 502, 503])('%s: falha passageira, pode repetir, nao cobra', (s) => {
    expect(interpretarResposta(s, {})).toEqual({ tipo: 'indisponivel', retentavel: true, creditos: 0 });
  });
  test('status desconhecido nao e retentavel', () => {
    expect(interpretarResposta(418, {})).toEqual({ tipo: 'indisponivel', retentavel: false, creditos: 0 });
  });
});

describe('mensagemDoMotivo: texto para a tela, sempre em portugues e sem vazar detalhe da API', () => {
  test.each(['cpf_invalido', 'nao_encontrado', 'limite_minuto', 'limite_publico', 'sem_credito', 'chave_invalida', 'conta_bloqueada', 'indisponivel', 'nao_configurado'])(
    '%s tem mensagem', (m) => expect(mensagemDoMotivo(m).length).toBeGreaterThan(10));
  test('erro de conta e de chave nao revelam a causa a quem usa o site', () => {
    for (const m of ['sem_credito', 'chave_invalida', 'conta_bloqueada', 'nao_configurado']) {
      expect(mensagemDoMotivo(m)).not.toMatch(/cr[eé]dito|chave|api|bloquead|saldo/i);
    }
  });
  test('motivo desconhecido cai numa mensagem generica', () => expect(mensagemDoMotivo('xyz').length).toBeGreaterThan(10));
});

describe('origemDoPapel: quem e equipe e quem e publico', () => {
  test.each(['super_admin', 'admin', 'manager', 'coordinator'])('%s e interno', (p) => expect(origemDoPapel(p)).toBe('interno'));
  test.each(['originator', 'subscriber', 'supplier', 'lead', 'anon', null, undefined, ''])('%s e publico', (p) =>
    expect(origemDoPapel(p as string)).toBe('publico'));
});

describe('respostaParaCliente: o que um visitante anonimo NAO pode receber', () => {
  const achado = { tipo: 'encontrado' as const, cpf: CPF_OK, nome: 'Fulano de Tal', nascimento: '1990-06-15', creditos: 1 };

  test('equipe recebe nome e nascimento', () => {
    expect(respostaParaCliente(achado, 'interno', false)).toEqual({
      ok: true, encontrado: true, nome: 'Fulano de Tal', nascimento: '1990-06-15', cache: false });
  });
  test('publico recebe so o nome: a data de nascimento fica no servidor', () => {
    const r = respostaParaCliente(achado, 'publico', false);
    expect(r).toEqual({ ok: true, encontrado: true, nome: 'Fulano de Tal', cache: false });
    expect(JSON.stringify(r)).not.toContain('1990');
    expect('nascimento' in r).toBe(false);
  });
  test('publico nunca recebe o CPF de volta nem o corpo cru', () => {
    expect(JSON.stringify(respostaParaCliente(achado, 'publico', true))).not.toContain(CPF_OK);
  });
  test('nao encontrado e resultado normal, nao erro', () => {
    expect(respostaParaCliente({ tipo: 'nao_encontrado', creditos: 0 }, 'publico', false)).toEqual({
      ok: true, encontrado: false, mensagem: mensagemDoMotivo('nao_encontrado') });
  });
  test('falha vira ok:false com motivo e mensagem amigavel', () => {
    const r = respostaParaCliente({ tipo: 'sem_credito', creditos: 0 }, 'publico', false) as { ok: boolean; motivo: string; mensagem: string };
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('indisponivel');            // o publico nao sabe que acabou o saldo
    expect(r.mensagem).toBe(mensagemDoMotivo('sem_credito'));
  });
  test('a equipe ve o motivo real, para saber o que consertar', () => {
    const r = respostaParaCliente({ tipo: 'sem_credito', creditos: 0 }, 'interno', false) as { motivo: string };
    expect(r.motivo).toBe('sem_credito');
  });
});

describe('lerLimites: ajustes do dono em integrations_config.variables', () => {
  test('sem configuracao, valem os padroes conservadores', () => {
    expect(lerLimites(null)).toEqual({ publicoAtivo: true, limiteIpHora: 5, limitePublicoDia: 150, validadeCacheDias: 180 });
    expect(lerLimites({})).toEqual(lerLimites(null));
  });
  test('valores validos sao respeitados', () => {
    expect(lerLimites({ publico_ativo: false, limite_ip_hora: 2, limite_publico_dia: 40, validade_cache_dias: 30 }))
      .toEqual({ publicoAtivo: false, limiteIpHora: 2, limitePublicoDia: 40, validadeCacheDias: 30 });
  });
  test('zero desliga o publico sem precisar de outro botao', () => {
    expect(lerLimites({ limite_publico_dia: 0 }).limitePublicoDia).toBe(0);
  });
  test.each([[-5], ['muito'], [NaN], [Infinity], [1.5]])('valor invalido %s volta ao padrao, nunca a "sem limite"', (v) => {
    const l = lerLimites({ limite_ip_hora: v, limite_publico_dia: v });
    expect(l.limiteIpHora).toBe(5);
    expect(l.limitePublicoDia).toBe(150);
  });
  test('teto: ninguem libera um milhao por engano', () => {
    expect(lerLimites({ limite_publico_dia: 1_000_000 }).limitePublicoDia).toBe(5000);
  });
});

describe('lerLimites: a tela de Integracoes grava tudo como TEXTO', () => {
  test('numero em texto vale como numero', () => {
    expect(lerLimites({ limite_ip_hora: '2', limite_publico_dia: '40', validade_cache_dias: '30' }))
      .toMatchObject({ limiteIpHora: 2, limitePublicoDia: 40, validadeCacheDias: 30 });
  });
  test('"0" em texto tambem desliga o publico', () => {
    expect(lerLimites({ limite_publico_dia: '0' }).limitePublicoDia).toBe(0);
  });
  test.each(['false', 'FALSE', ' false ', '0', 'nao', 'não', 'off', 'desligado'])(
    'publico_ativo = %j desliga (um "false" digitado nao pode virar "ligado")', (v) => {
      expect(lerLimites({ publico_ativo: v }).publicoAtivo).toBe(false);
    });
  test.each(['true', 'TRUE', '1', 'sim', 'on', true])('publico_ativo = %j mantem ligado', (v) => {
    expect(lerLimites({ publico_ativo: v }).publicoAtivo).toBe(true);
  });
  test('texto sem sentido em publico_ativo desliga: na duvida, nao gasta credito', () => {
    expect(lerLimites({ publico_ativo: 'talvez' }).publicoAtivo).toBe(false);
  });
  test.each(['abc', '', '1.5', '-3', ' '])('numero em texto invalido %j volta ao padrao', (v) => {
    expect(lerLimites({ limite_ip_hora: v }).limiteIpHora).toBe(5);
  });
});

describe('ipDoRequest / hashearIp: o IP nunca e gravado em claro', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  test('usa o primeiro IP de x-forwarded-for', () => expect(ipDoRequest(h({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9'));
  test('cf-connecting-ip tem prioridade', () => expect(ipDoRequest(h({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.9' }))).toBe('198.51.100.7'));
  test('sem cabecalho, devolve vazio', () => expect(ipDoRequest(h({}))).toBe(''));
  test('hash e estavel e nao contem o IP', async () => {
    const a = await hashearIp('203.0.113.9', 'sal');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await hashearIp('203.0.113.9', 'sal'));
    expect(a).not.toContain('203');
    expect(a).not.toBe(await hashearIp('203.0.113.9', 'outro-sal'));
    expect(a).not.toBe(await hashearIp('203.0.113.10', 'sal'));
  });
  test('sem IP, o hash e vazio e o chamador cai no limite mais rigido', async () => {
    expect(await hashearIp('', 'sal')).toBe('');
  });
});

describe('urlDaConsulta: o CPF vai no caminho, so com digitos', () => {
  test('monta a URL oficial', () => expect(urlDaConsulta('https://api.cpfhub.io', CPF_OK)).toBe(`https://api.cpfhub.io/cpf/${CPF_OK}`));
  test('barra final da base nao duplica', () => expect(urlDaConsulta('https://api.cpfhub.io/', CPF_OK)).toBe(`https://api.cpfhub.io/cpf/${CPF_OK}`));
  test('recusa montar URL com CPF que nao e so digito (nada de ../ no caminho)', () => {
    expect(() => urlDaConsulta('https://api.cpfhub.io', '../quota')).toThrow();
    expect(() => urlDaConsulta('https://api.cpfhub.io', '5299822472')).toThrow();
  });
});

test('fonte sem bytes nao-ASCII (acentos em escapes unicode, como as demais shared)', () => {
  const src = readFileSync('supabase/functions/_shared/consulta-cpf.ts', 'utf8');
  // eslint-disable-next-line no-control-regex
  expect(/[^\x00-\x7f]/.test(src)).toBe(false);
});
