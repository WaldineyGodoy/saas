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

import { escolherRepresentante, formatarCpfMascarado, cpfConfereComReceita } from '../src/lib/representanteLegal';

// Formato real do cnpj.ws (publica.cnpj.ws/cnpj/02052700000155), MULTI TV, 23/11/2026.
// Na MULTI TV o administrador e o primeiro socio; a ordem inversa e testada abaixo.
const SOCIO_ADM = { nome: 'JUANRIBE PAGLIARIN', cpf_cnpj_socio: '***454978**', tipo: 'Pessoa Física', qualificacao_socio: { descricao: 'Sócio-Administrador ' } };
const SOCIO = { nome: 'DEISE DE MELLO FERRAZ PAGLIARIN', cpf_cnpj_socio: '***312798**', tipo: 'Pessoa Física', qualificacao_socio: { descricao: 'Sócio' } };

describe('formatarCpfMascarado: o CPF que a Receita deixa ver', () => {
  test('cnpj.ws entrega ***454978** (so os 6 do meio): formata como CPF', () => {
    expect(formatarCpfMascarado('***454978**')).toBe('***.454.978-**');
  });
  test('ja formatado (CPFHub) fica igual', () => {
    expect(formatarCpfMascarado('***.456.789-**')).toBe('***.456.789-**');
  });
  test.each(['', null, undefined, '12345', 'abc', '***', '12345678901'])('%j nao e CPF mascarado: vazio', (v) => {
    expect(formatarCpfMascarado(v)).toBe('');
  });
});

describe('cpfConfereComReceita: confere os 6 digitos do meio', () => {
  test('CPF digitado com os mesmos 6 digitos: confere', () => {
    // 454.978 no meio
    expect(cpfConfereComReceita('123.454.978-09', '***.454.978-**')).toBe(true);
    expect(cpfConfereComReceita('12345497809', '***454978**')).toBe(true);
  });
  test('digitos diferentes: nao confere', () => {
    expect(cpfConfereComReceita('111.444.777-35', '***.454.978-**')).toBe(false);
  });
  test('CPF incompleto ou sem mascara da Receita: nao da para dizer (nulo), nunca falso alarme', () => {
    expect(cpfConfereComReceita('123.454', '***.454.978-**')).toBeNull();
    expect(cpfConfereComReceita('', '***.454.978-**')).toBeNull();
    expect(cpfConfereComReceita('12345497809', '')).toBeNull();
    expect(cpfConfereComReceita('12345497809', null)).toBeNull();
  });
});

describe('escolherRepresentante: quem assina pela empresa, a partir do QSA', () => {
  test('o sócio-administrador, mesmo quando nao e o primeiro da lista (o codigo antigo pegava sempre o primeiro)', () => {
    const r = escolherRepresentante([SOCIO, SOCIO_ADM]);
    expect(r).toEqual({ nome: 'Juanribe Pagliarin', cpfMascarado: '***.454.978-**', qualificacao: 'Sócio-Administrador' });
  });

  test('a MULTI TV: administrador primeiro na lista', () => {
    expect(escolherRepresentante([SOCIO_ADM, SOCIO]).nome).toBe('Juanribe Pagliarin');
  });

  test('o nome vem em caixa de nome proprio, com particulas em minuscula', () => {
    expect(escolherRepresentante([{ ...SOCIO_ADM, nome: 'MARIA DE FATIMA DOS SANTOS' }]).nome).toBe('Maria de Fatima dos Santos');
  });

  test('"Administrador" puro e "Diretor-Presidente"? so administrador conta como assinante legal', () => {
    expect(escolherRepresentante([SOCIO, { ...SOCIO_ADM, qualificacao_socio: { descricao: 'Administrador' } }]).nome).toBe('Juanribe Pagliarin');
  });

  test('sem administrador, um unico socio pessoa fisica: e ele', () => {
    expect(escolherRepresentante([SOCIO]).nome).toBe('Deise de Mello Ferraz Pagliarin');
  });

  test('sem administrador e varios socios: nao chuta quem assina', () => {
    expect(escolherRepresentante([SOCIO, { ...SOCIO, nome: 'OUTRO SOCIO DA SILVA' }])).toBeNull();
  });

  test('socio pessoa juridica nao pode ser representante (precisa de CPF)', () => {
    const pj = { nome: 'HOLDING LTDA', cpf_cnpj_socio: '12345678000190', tipo: 'Pessoa Jurídica', qualificacao_socio: { descricao: 'Sócio-Administrador' } };
    expect(escolherRepresentante([pj])).toBeNull();
    expect(escolherRepresentante([pj, SOCIO_ADM]).nome).toBe('Juanribe Pagliarin');
  });

  test('varios administradores: o primeiro, que e a ordem da Receita', () => {
    const a2 = { ...SOCIO_ADM, nome: 'SEGUNDO ADMINISTRADOR' };
    expect(escolherRepresentante([SOCIO_ADM, a2]).nome).toBe('Juanribe Pagliarin');
  });

  test('aceita a qualificacao como texto solto (outro formato de fonte)', () => {
    expect(escolherRepresentante([{ ...SOCIO_ADM, qualificacao_socio: 'Sócio-Administrador' }]).nome).toBe('Juanribe Pagliarin');
  });

  test('sem CPF mascarado na fonte, devolve o nome e a dica vazia', () => {
    expect(escolherRepresentante([{ ...SOCIO_ADM, cpf_cnpj_socio: '' }]).cpfMascarado).toBe('');
  });

  test.each([[null], [undefined], [[]], ['x'], [{}]])('lista invalida %j: nulo', (v) => {
    expect(escolherRepresentante(v)).toBeNull();
  });

  test('socio sem nome e ignorado', () => {
    expect(escolherRepresentante([{ ...SOCIO_ADM, nome: '' }])).toBeNull();
  });
});
