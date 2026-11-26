import { describe, expect, it } from 'vitest';
import { casaBusca } from '../buscaRede';

// Dados fictícios.
const cliente = { name: 'João Conceição', cpf_cnpj: '123.456.789-09', representante_cpf: null, telefone: '(84) 99876-5432' };
const empresa = { name: 'Padaria Exemplo LTDA', cpf_cnpj: '12.345.678/0001-90', representante_cpf: '987.654.321-00', telefone: null };

describe('casaBusca', () => {
  it('busca vazia mostra todos', () => {
    expect(casaBusca(cliente, '  ')).toBe(true);
  });
  it('acha pelo nome sem acento e sem diferenciar maiúsculas', () => {
    expect(casaBusca(cliente, 'joao conc')).toBe(true);
    expect(casaBusca(cliente, 'Maria')).toBe(false);
  });
  it('acha por CPF/CNPJ com ou sem pontuação', () => {
    expect(casaBusca(cliente, '12345678909')).toBe(true);
    expect(casaBusca(cliente, '456.789')).toBe(true);
    expect(casaBusca(empresa, '12345678000190')).toBe(true);
  });
  it('acha pelo CPF do representante', () => {
    expect(casaBusca(empresa, '987654')).toBe(true);
  });
  it('acha pelo telefone', () => {
    expect(casaBusca(cliente, '99876 5432')).toBe(true);
    expect(casaBusca(cliente, '8499876')).toBe(true);
  });
  it('não casa com menos de 3 dígitos', () => {
    expect(casaBusca(cliente, '12')).toBe(false);
  });
});
