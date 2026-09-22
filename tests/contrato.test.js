import { test, expect } from 'vitest';
import { montarTextoContrato } from '../src/lib/contrato';

const base = { name: 'ACME LTDA', cpf_cnpj: '11222333000181', rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'Natal', uf: 'RN' };

test('CNPJ qualifica o representante', () => {
  const t = montarTextoContrato({ ...base, representante_nome: 'Ana Souza', representante_cpf: '52998224725' }, 'COSERN', { desconto: 15, diaVencimento: 20 });
  expect(t).toContain('inscrita no CNPJ 11222333000181');
  expect(t).toContain('neste ato representada por Ana Souza, CPF 52998224725');
  expect(t).not.toContain('residente e domiciliado');
});

test('CPF mantém a qualificação de pessoa física', () => {
  const t = montarTextoContrato({ ...base, name: 'Ana', cpf_cnpj: '52998224725' }, 'COSERN', { desconto: 15, diaVencimento: 20 });
  expect(t).toContain('residente e domiciliado');
});

test('desconto e vencimento reais aparecem', () => {
  const t = montarTextoContrato({ ...base, name: 'Ana', cpf_cnpj: '52998224725' }, 'COSERN', { desconto: 17.5, diaVencimento: 5 });
  expect(t).toMatch(/17,5/); expect(t).toMatch(/dia 5\b/);
});
