import { describe, expect, it } from 'vitest';
import { documentoValido, tipoDocumento } from '../documento';

describe('documentoValido', () => {
  it('aceita CPF e CNPJ validos, com ou sem mascara', () => {
    expect(documentoValido('111.444.777-35')).toBe(true);
    expect(documentoValido('11144477735')).toBe(true);
    expect(documentoValido('11.222.333/0001-81')).toBe(true);
  });
  it('recusa digito errado, repetido e tamanho errado', () => {
    expect(documentoValido('111.444.777-00')).toBe(false);
    expect(documentoValido('111.111.111-11')).toBe(false);
    expect(documentoValido('11.222.333/0001-80')).toBe(false);
    expect(documentoValido('1234')).toBe(false);
  });
  it('separa CPF de CNPJ pelo tamanho', () => {
    expect(tipoDocumento('111.444.777-35')).toBe('cpf');
    expect(tipoDocumento('11.222.333/0001-81')).toBe('cnpj');
  });
});
