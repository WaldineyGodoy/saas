import { describe, test, expect } from 'vitest';
import { avaliarCpfDigitado, aplicarConsulta, MSG_CPF_INVALIDO, MSG_CPF_INCOMPLETO } from '../src/lib/consultaCpf';

const CPF = '529.982.247-25';
const CPF_DIG = '52998224725';

describe('avaliarCpfDigitado: validacao interna ANTES de qualquer consulta paga', () => {
  test('CPF valido e novo: consulta', () => {
    expect(avaliarCpfDigitado(CPF)).toEqual({ acao: 'consultar', cpf: CPF_DIG });
  });

  test('CPF com digito verificador errado: avisa e NAO consulta', () => {
    expect(avaliarCpfDigitado('529.982.247-26')).toEqual({ acao: 'avisar', mensagem: MSG_CPF_INVALIDO });
  });

  test.each(['000.000.000-00', '111.111.111-11', '999.999.999-99'])('CPF repetido %s: avisa e NAO consulta', (v) => {
    expect(avaliarCpfDigitado(v)).toEqual({ acao: 'avisar', mensagem: MSG_CPF_INVALIDO });
  });

  test.each(['1', '529', '529.982.247', '529.982.247-2'])('CPF incompleto %s: avisa que falta digito, sem consultar', (v) => {
    expect(avaliarCpfDigitado(v)).toEqual({ acao: 'avisar', mensagem: MSG_CPF_INCOMPLETO });
  });

  test('campo vazio: nao faz nada nem reclama', () => {
    expect(avaliarCpfDigitado('')).toEqual({ acao: 'nada' });
    expect(avaliarCpfDigitado('   ')).toEqual({ acao: 'nada' });
    expect(avaliarCpfDigitado(null)).toEqual({ acao: 'nada' });
    expect(avaliarCpfDigitado(undefined)).toEqual({ acao: 'nada' });
  });

  test('CNPJ completo e tratado em outro fluxo: nao mexe aqui', () => {
    expect(avaliarCpfDigitado('11.222.333/0001-81')).toEqual({ acao: 'nada' });
  });

  test('CNPJ incompleto (12 ou 13 digitos) pede para completar', () => {
    expect(avaliarCpfDigitado('11.222.333/0001-8').acao).toBe('avisar');
    expect(avaliarCpfDigitado('11222333000').acao).toBe('avisar');
  });

  test('o mesmo CPF ja consultado nesta tela nao consulta de novo', () => {
    expect(avaliarCpfDigitado(CPF, { ultimoConsultado: CPF_DIG })).toEqual({ acao: 'ignorar' });
  });

  test('o ultimo consultado vale mesmo digitado com outra mascara', () => {
    expect(avaliarCpfDigitado(CPF_DIG, { ultimoConsultado: CPF_DIG })).toEqual({ acao: 'ignorar' });
  });

  test('CPF diferente do ultimo consultado volta a consultar', () => {
    expect(avaliarCpfDigitado('111.444.777-35', { ultimoConsultado: CPF_DIG })).toEqual({ acao: 'consultar', cpf: '11144477735' });
  });

  test('assinante ja cadastrado com o mesmo CPF: abrir e sair do campo nao gasta consulta nem apaga nome corrigido', () => {
    expect(avaliarCpfDigitado(CPF, { cpfOriginal: CPF_DIG })).toEqual({ acao: 'ignorar' });
  });

  test('assinante cadastrado cujo CPF foi trocado: consulta o novo', () => {
    expect(avaliarCpfDigitado('111.444.777-35', { cpfOriginal: CPF_DIG })).toEqual({ acao: 'consultar', cpf: '11144477735' });
  });

  test('CPF invalido avisa mesmo que seja o original (nao esconde cadastro ruim)', () => {
    expect(avaliarCpfDigitado('529.982.247-26', { cpfOriginal: '52998224726' }).acao).toBe('avisar');
  });
});

describe('aplicarConsulta: o que a resposta preenche no formulario', () => {
  const form = { name: '', data_nascimento: '' };

  test('equipe: preenche nome e nascimento', () => {
    const r = aplicarConsulta(form, { ok: true, encontrado: true, nome: 'Fulano de Tal', nascimento: '1990-06-15', cache: false });
    expect(r.patch).toEqual({ name: 'Fulano de Tal', data_nascimento: '1990-06-15' });
    expect(r.aviso).toBeNull();
  });

  test('publico: preenche so o nome e nao apaga o nascimento ja digitado', () => {
    const r = aplicarConsulta({ name: 'x', data_nascimento: '1985-01-02' }, { ok: true, encontrado: true, nome: 'Fulano de Tal', cache: false });
    expect(r.patch).toEqual({ name: 'Fulano de Tal', data_nascimento: '1985-01-02' });
  });

  test('achado sem nascimento mantem o que ja estava', () => {
    const r = aplicarConsulta({ name: '', data_nascimento: '1985-01-02' }, { ok: true, encontrado: true, nome: 'Fulano', nascimento: null, cache: true });
    expect(r.patch.data_nascimento).toBe('1985-01-02');
    expect(r.patch.name).toBe('Fulano');
  });

  test('nao encontrado: nada e preenchido e a pessoa e avisada, sem tom de erro grave', () => {
    const r = aplicarConsulta(form, { ok: true, encontrado: false, mensagem: 'Nao encontramos esse CPF.' });
    expect(r.patch).toEqual({});
    expect(r.aviso).toBe('Nao encontramos esse CPF.');
  });

  test('falha da consulta: nada e preenchido e o formulario segue utilizavel', () => {
    const r = aplicarConsulta(form, { ok: false, motivo: 'indisponivel', mensagem: 'Indisponivel agora.' });
    expect(r.patch).toEqual({});
    expect(r.aviso).toBe('Indisponivel agora.');
  });

  test('resposta nula ou quebrada nao explode e cai numa mensagem generica', () => {
    for (const quebrada of [null, undefined, {}, 'x']) {
      const r = aplicarConsulta(form, quebrada);
      expect(r.patch).toEqual({});
      expect(typeof r.aviso).toBe('string');
      expect(r.aviso.length).toBeGreaterThan(10);
    }
  });

  test('achado com nome vazio nao apaga o nome digitado', () => {
    const r = aplicarConsulta({ name: 'Digitado', data_nascimento: '' }, { ok: true, encontrado: true, nome: '', nascimento: null });
    expect(r.patch).toEqual({});
  });
});
