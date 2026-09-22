import { test, expect } from 'vitest';
import { uuidOuNulo, documentosObrigatorios } from '../src/lib/onboarding';
test('uuid inválido vira null', () => { expect(uuidOuNulo('abc')).toBeNull(); expect(uuidOuNulo('')).toBeNull(); });
test('uuid válido passa', () => expect(uuidOuNulo('f86a003d-1b2c-4d5e-8f90-123456789abc')).toBe('f86a003d-1b2c-4d5e-8f90-123456789abc'));
test('CPF: identidade + conta por UC', () => {
  const d = documentosObrigatorios({ cpf_cnpj: '52998224725', ucs: [{ id: 'u1', numero_uc: '1' }, { id: 'u2', numero_uc: '2' }] });
  expect(d.map(x => x.tipo)).toEqual(['identidade', 'conta_energia', 'conta_energia']);
});
test('CNPJ: + contrato social', () => {
  const d = documentosObrigatorios({ cpf_cnpj: '11.222.333/0001-81', ucs: [{ id: 'u1', numero_uc: '1' }] });
  expect(d.map(x => x.tipo)).toEqual(['identidade', 'contrato_social', 'conta_energia']);
});

import { validarArquivo, lerErroFuncao } from '../src/lib/onboarding';
test('arquivo: tipo e 10 MB', () => {
  expect(validarArquivo({ type: 'application/pdf', size: 1000 })).toBeNull();
  expect(validarArquivo({ type: 'image/gif', size: 1000 })).toMatch(/PDF, JPG ou PNG/);
  expect(validarArquivo({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
});
test('erro de função: lê status e mensagem do corpo', async () => {
  const e = { message: 'Edge Function returned a non-2xx status code', context: { status: 409, json: async () => ({ error: 'Envie os documentos', faltantes: [{ tipo: 'identidade' }] }) } };
  const r = await lerErroFuncao(e);
  expect(r.status).toBe(409);
  expect(r.mensagem).toBe('Envie os documentos');
  expect(r.corpo.faltantes).toHaveLength(1);
  expect((await lerErroFuncao({ message: 'rede' })).mensagem).toBe('rede');
});
