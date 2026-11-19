import { describe, test, expect } from 'vitest';
import { documentoEhCnpj, validarRepresentante, representanteParaGravar, representanteParaContrato } from '../src/lib/representanteLegal';

const CNPJ = '02.052.700/0001-55';
const CPF_PF = '529.982.247-25';
const CPF_REP = '111.444.777-35';

describe('documentoEhCnpj', () => {
  test.each([[CNPJ, true], ['02052700000155', true], [CPF_PF, false], ['', false], [null, false], [undefined, false], ['1234567890123', false]])(
    '%s -> %s', (v, esperado) => expect(documentoEhCnpj(v)).toBe(esperado));
});

describe('validarRepresentante: o que impede salvar', () => {
  test('pessoa fisica: nunca valida representante (campos nem aparecem)', () => {
    expect(validarRepresentante({ cpf_cnpj: CPF_PF, representante_nome: '', representante_cpf: 'lixo' })).toBeNull();
  });

  test('CNPJ com os dois em branco: pode salvar (o contrato avisa e trava o envio)', () => {
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: '', representante_cpf: '' })).toBeNull();
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: '   ', representante_cpf: '  ' })).toBeNull();
    expect(validarRepresentante({ cpf_cnpj: CNPJ })).toBeNull();
  });

  test('CNPJ com nome e CPF validos: ok', () => {
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: 'Maria da Silva Souza', representante_cpf: CPF_REP })).toBeNull();
  });

  test('so o nome, ou so o CPF: pede os dois', () => {
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: 'Maria da Silva', representante_cpf: '' })).toMatch(/nome e CPF/i);
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: '', representante_cpf: CPF_REP })).toMatch(/nome e CPF/i);
  });

  test('CPF invalido (digito errado, repetido, incompleto)', () => {
    for (const cpf of ['111.444.777-36', '111.111.111-11', '111.444.777']) {
      expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: 'Maria da Silva', representante_cpf: cpf })).toMatch(/CPF do representante/i);
    }
  });

  test('nome de uma palavra so nao serve como nome completo', () => {
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: 'Maria', representante_cpf: CPF_REP })).toMatch(/nome completo/i);
  });

  test('o CPF do representante nao pode ser o CNPJ da empresa digitado por engano', () => {
    expect(validarRepresentante({ cpf_cnpj: CNPJ, representante_nome: 'Maria da Silva', representante_cpf: CNPJ })).toMatch(/CPF do representante/i);
  });
});

describe('representanteParaGravar: o que vai para subscribers', () => {
  test('CNPJ: nome aparado e CPF so com digitos (mesmo formato da adesao publica)', () => {
    expect(representanteParaGravar({ cpf_cnpj: CNPJ, representante_nome: '  Maria da Silva  ', representante_cpf: CPF_REP }))
      .toEqual({ representante_nome: 'Maria da Silva', representante_cpf: '11144477735' });
  });

  test('CNPJ com campos em branco grava nulo, nunca texto vazio', () => {
    expect(representanteParaGravar({ cpf_cnpj: CNPJ, representante_nome: '', representante_cpf: '' }))
      .toEqual({ representante_nome: null, representante_cpf: null });
  });

  test('pessoa fisica: limpa os dois (documento trocado de CNPJ para CPF nao deixa representante pendurado)', () => {
    expect(representanteParaGravar({ cpf_cnpj: CPF_PF, representante_nome: 'Maria da Silva', representante_cpf: CPF_REP }))
      .toEqual({ representante_nome: null, representante_cpf: null });
  });

  test('espacos repetidos no nome sao colapsados', () => {
    expect(representanteParaGravar({ cpf_cnpj: CNPJ, representante_nome: 'Maria   da  Silva', representante_cpf: CPF_REP }).representante_nome)
      .toBe('Maria da Silva');
  });
});

describe('representanteParaContrato: o que o termo imprime', () => {
  const sub = { name: 'MULTI TV', cpf_cnpj: CNPJ, representante_nome: null, representante_cpf: null };

  test('o que esta no formulario (ainda nao salvo) vale sobre o gravado, com CPF mascarado', () => {
    expect(representanteParaContrato(sub, { representante_nome: ' Maria da Silva ', representante_cpf: '11144477735' }))
      .toMatchObject({ name: 'MULTI TV', representante_nome: 'Maria da Silva', representante_cpf: '111.444.777-35' });
  });

  test('formulario em branco nao apaga o que ja esta gravado', () => {
    const gravado = { ...sub, representante_nome: 'Joao Souza', representante_cpf: '11144477735' };
    expect(representanteParaContrato(gravado, { representante_nome: '', representante_cpf: '' }))
      .toMatchObject({ representante_nome: 'Joao Souza', representante_cpf: '111.444.777-35' });
  });

  test('sem assinante gravado (cadastro novo), usa so o formulario', () => {
    expect(representanteParaContrato(null, { name: 'X', representante_nome: 'Maria da Silva', representante_cpf: '11144477735' }))
      .toMatchObject({ name: 'X', representante_nome: 'Maria da Silva', representante_cpf: '111.444.777-35' });
  });

  test('nao altera os objetos recebidos', () => {
    const form = { representante_nome: 'Maria da Silva', representante_cpf: '11144477735' };
    const copia = JSON.stringify([sub, form]);
    representanteParaContrato(sub, form);
    expect(JSON.stringify([sub, form])).toBe(copia);
  });
});
