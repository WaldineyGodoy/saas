import { describe, test, expect } from 'vitest';
import {
  procurarParceiro, dadosParaParceiroPower, podeTrocarPapel, textoConfirmacaoParceiroPower,
} from '../src/lib/parceiroPower';

const ASSINANTE = {
  id: 'sub-1', name: '  Maria Aparecida Souza ', cpf_cnpj: '529.982.247-25', email: ' Maria@Exemplo.com ', phone: '84994142332',
  cep: '59158155', rua: 'Rua A', numero: '10', complemento: 'Ap 2', bairro: 'Centro', cidade: 'Parnamirim', uf: 'RN', user_id: null,
};

describe('dadosParaParceiroPower: o cadastro de originador montado a partir do assinante', () => {
  test('mesmos campos e formatos do cadastro manual em Originadores', () => {
    const r = dadosParaParceiroPower(ASSINANTE);
    expect(r.ok).toBe(true);
    expect(r.faltando).toEqual([]);
    expect(r.payload).toEqual({
      name: 'Maria Aparecida Souza',
      cpf_cnpj: '529.982.247-25',
      email: 'maria@exemplo.com',
      phone: '84994142332',
      pix_key: '529.982.247-25',
      pix_key_type: 'cpf',
      cargo: 'ppf',
      address: { cep: '59158155', rua: 'Rua A', numero: '10', complemento: 'Ap 2', bairro: 'Centro', cidade: 'Parnamirim', uf: 'RN' },
    });
  });

  test('nao manda plano: o gatilho do banco ja coloca o Plano Padrao do Originador', () => {
    expect('plano_originador_id' in dadosParaParceiroPower(ASSINANTE).payload).toBe(false);
  });

  test('CPF digitado so com numeros sai com mascara, igual ao modal manual', () => {
    expect(dadosParaParceiroPower({ ...ASSINANTE, cpf_cnpj: '52998224725' }).payload.cpf_cnpj).toBe('529.982.247-25');
  });

  test('CNPJ: a chave PIX padrao e do tipo cnpj', () => {
    const r = dadosParaParceiroPower({ ...ASSINANTE, cpf_cnpj: '02.052.700/0001-55' });
    expect(r.payload.pix_key_type).toBe('cnpj');
    expect(r.payload.pix_key).toBe('02.052.700/0001-55');
  });

  test('telefone vai so com digitos, mesmo se vier mascarado', () => {
    expect(dadosParaParceiroPower({ ...ASSINANTE, phone: '(84) 99414-2332' }).payload.phone).toBe('84994142332');
  });

  test('sem login, nao leva id: o banco gera, e o convite do app liga depois', () => {
    expect('id' in dadosParaParceiroPower(ASSINANTE).payload).toBe(false);
  });

  test('COM login, o originador nasce com o MESMO id do login (a area de embaixador procura por ele)', () => {
    const r = dadosParaParceiroPower({ ...ASSINANTE, user_id: 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb' });
    expect(r.payload.id).toBe('aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb');
  });

  test('endereco ausente vira campos vazios, nao "undefined"', () => {
    const r = dadosParaParceiroPower({ ...ASSINANTE, cep: null, rua: undefined, numero: '', complemento: null, bairro: null, cidade: null, uf: null });
    expect(r.payload.address).toEqual({ cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  });
});

describe('dadosParaParceiroPower: o que impede (e o que diz que falta)', () => {
  test('CPF invalido', () => {
    const r = dadosParaParceiroPower({ ...ASSINANTE, cpf_cnpj: '529.982.247-26' });
    expect(r.ok).toBe(false);
    expect(r.faltando).toContain('CPF/CNPJ válido');
  });

  test('sem e-mail: o login e ligado por ele, entao e obrigatorio', () => {
    const r = dadosParaParceiroPower({ ...ASSINANTE, email: '  ' });
    expect(r.ok).toBe(false);
    expect(r.faltando).toContain('e-mail');
  });

  test('e-mail sem formato de e-mail', () => {
    expect(dadosParaParceiroPower({ ...ASSINANTE, email: 'maria' }).faltando).toContain('e-mail');
  });

  test('telefone sem DDD + 9 digitos (mesma regra do cadastro manual)', () => {
    expect(dadosParaParceiroPower({ ...ASSINANTE, phone: '9941423' }).faltando).toContain('telefone com DDD e 9 dígitos');
    expect(dadosParaParceiroPower({ ...ASSINANTE, phone: '' }).faltando).toContain('telefone com DDD e 9 dígitos');
  });

  test('lista tudo o que falta de uma vez, na mesma mensagem', () => {
    const r = dadosParaParceiroPower({ name: '', cpf_cnpj: '', email: '', phone: '' });
    expect(r.ok).toBe(false);
    expect(r.faltando).toEqual(expect.arrayContaining(['nome', 'CPF/CNPJ válido', 'e-mail', 'telefone com DDD e 9 dígitos']));
  });

  test('entrada nula nao explode', () => {
    expect(dadosParaParceiroPower(null).ok).toBe(false);
    expect(dadosParaParceiroPower(undefined).ok).toBe(false);
  });
});

describe('procurarParceiro: a pessoa ja e parceira?', () => {
  const lista = [
    { id: 'o1', name: 'Outro', email: 'outro@x.com', cpf_cnpj: '111.444.777-35' },
    { id: 'o2', name: 'Maria A.', email: 'MARIA@exemplo.com', cpf_cnpj: '000.000.000-00' },
    { id: 'o3', name: 'Joao', email: 'joao@x.com', cpf_cnpj: '52998224725' },
  ];

  test('acha pelo e-mail, sem diferenciar caixa nem espacos', () => {
    expect(procurarParceiro(lista, ASSINANTE).id).toBe('o2');
  });

  test('acha pelo CPF mesmo com formatos diferentes (mascarado x so digitos)', () => {
    expect(procurarParceiro(lista, { ...ASSINANTE, email: 'diferente@x.com' }).id).toBe('o3');
  });

  test('acha pelo id do login (o originador criado com o id do usuario)', () => {
    expect(procurarParceiro([{ id: 'U1', name: 'X', email: null, cpf_cnpj: null }], { ...ASSINANTE, email: 'z@z.com', cpf_cnpj: '111.444.777-35', user_id: 'U1' }).id).toBe('U1');
  });

  test('ninguem: nulo', () => {
    expect(procurarParceiro(lista, { ...ASSINANTE, email: 'sem@x.com', cpf_cnpj: '390.533.447-05' })).toBeNull();
  });

  test('CPF vazio ou curto nunca casa com outro vazio', () => {
    expect(procurarParceiro([{ id: 'v', email: null, cpf_cnpj: '' }], { ...ASSINANTE, email: 'a@a.com', cpf_cnpj: '' })).toBeNull();
    expect(procurarParceiro([{ id: 'v', email: null, cpf_cnpj: '123' }], { ...ASSINANTE, email: 'a@a.com', cpf_cnpj: '123' })).toBeNull();
  });

  test('e-mail vazio nunca casa com e-mail vazio', () => {
    expect(procurarParceiro([{ id: 'v', email: '', cpf_cnpj: null }], { ...ASSINANTE, email: '', cpf_cnpj: '390.533.447-05' })).toBeNull();
  });

  test('lista invalida: nulo', () => {
    expect(procurarParceiro(null, ASSINANTE)).toBeNull();
    expect(procurarParceiro([], ASSINANTE)).toBeNull();
  });
});

describe('podeTrocarPapel: quem ja tem login como assinante passa a ver a area de embaixador', () => {
  test('so login de assinante, e so se quem clica e admin', () => {
    expect(podeTrocarPapel({ role: 'subscriber' }, 'admin')).toBe(true);
    expect(podeTrocarPapel({ role: 'subscriber' }, 'super_admin')).toBe(true);
    expect(podeTrocarPapel({ role: 'subscriber' }, 'manager')).toBe(true);
  });
  test('coordenador e outros papeis nao trocam papel de ninguem', () => {
    expect(podeTrocarPapel({ role: 'subscriber' }, 'coordinator')).toBe(false);
    expect(podeTrocarPapel({ role: 'subscriber' }, 'originator')).toBe(false);
  });
  test('nunca mexe em login que nao seja de assinante (admin, fornecedor, ja embaixador)', () => {
    for (const role of ['admin', 'super_admin', 'manager', 'supplier', 'originator', 'lead']) {
      expect(podeTrocarPapel({ role }, 'admin')).toBe(false);
    }
  });
  test('sem perfil: nao troca', () => {
    expect(podeTrocarPapel(null, 'admin')).toBe(false);
    expect(podeTrocarPapel(undefined, 'admin')).toBe(false);
  });
});

describe('textoConfirmacaoParceiroPower', () => {
  test('sem login: explica o cargo, o PIX e o proximo passo (convidar para o app)', () => {
    const t = textoConfirmacaoParceiroPower({ nome: 'Maria Souza', temLogin: false, vaiTrocarPapel: false });
    expect(t).toContain('Maria Souza');
    expect(t).toMatch(/Parceiro Power/);
    expect(t).toMatch(/PPF/);
    expect(t).toMatch(/PIX/i);
    expect(t).toMatch(/Convidar para o app/);
  });

  test('com login e troca de papel: avisa que o papel muda e que a assinatura segue no app', () => {
    const t = textoConfirmacaoParceiroPower({ nome: 'Maria Souza', temLogin: true, vaiTrocarPapel: true });
    expect(t).toMatch(/já tem acesso/i);
    expect(t).toMatch(/papel/i);
    expect(t).not.toMatch(/Convidar para o app/);
  });

  test('com login e sem permissao para trocar: manda pedir a um administrador', () => {
    const t = textoConfirmacaoParceiroPower({ nome: 'Maria Souza', temLogin: true, vaiTrocarPapel: false });
    expect(t).toMatch(/administrador/i);
    expect(t).toMatch(/Perfil de Usuários/);
  });
});
