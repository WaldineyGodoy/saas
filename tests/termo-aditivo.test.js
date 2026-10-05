import { describe, test, expect } from 'vitest';
import {
  paragrafosTermoAditivo, paragrafosProcuracao, percentualBr, qualificacaoAssinante, nomeArquivoAditivo,
} from '../supabase/functions/_shared/termo-aditivo.ts';

const assinante = {
  name: 'MARIA EXEMPLO DA SILVA', cpf_cnpj: '123.456.789-00',
  rua: 'Rua das Flores', numero: '100', bairro: 'Centro', cidade: 'Natal', uf: 'RN', cep: '59000-000',
};
const uc = {
  numeroUc: '7000000001', titular: 'MARIA EXEMPLO DA SILVA', concessionaria: 'Neoenergia Cosern',
  endereco: { completo: 'RUA DAS FLORES 100, CENTRO, 59678-000 TIBAU RN' },
};

describe('termo aditivo de inclusão de UC', () => {
  const texto = paragrafosTermoAditivo({ assinante, uc, plano: { nome: 'Plano Sol', desconto_assinante: 17.5 }, data: new Date(2026, 9, 5) }).join('\n');

  test('identifica a UC, o titular, o endereço e a distribuidora', () => {
    expect(texto).toContain('unidade consumidora nº 7000000001');
    expect(texto).toContain('titular perante a distribuidora é MARIA EXEMPLO DA SILVA');
    expect(texto).toContain('RUA DAS FLORES 100, CENTRO, 59678-000 TIBAU RN');
    expect(texto).toContain('distribuidora Neoenergia Cosern');
  });

  test('o desconto é o do plano escolhido', () => {
    expect(texto).toContain('plano Plano Sol, com desconto de 17,5%');
  });

  test('qualifica o assinante e data por extenso', () => {
    expect(texto).toContain('MARIA EXEMPLO DA SILVA, CPF/CNPJ 123.456.789-00, residente e domiciliado à Rua das Flores, 100, Centro, Natal/RN, CEP 59000-000');
    expect(texto).toContain('Natal/RN, 5 de outubro de 2026.');
  });

  test('pessoa jurídica sai com o representante', () => {
    const q = qualificacaoAssinante({ ...assinante, cpf_cnpj: '12.345.678/0001-90', representante_nome: 'JOAO EXEMPLO', representante_cpf: '111.222.333-44' });
    expect(q).toContain('pessoa jurídica inscrita no CNPJ 12.345.678/0001-90');
    expect(q).toContain('representada por JOAO EXEMPLO, CPF 111.222.333-44');
  });

  test('plano sem desconto não imprime percentual vazio', () => {
    const t = paragrafosTermoAditivo({ assinante, uc, plano: { nome: 'Plano X', desconto_assinante: null } }).join('\n');
    expect(t).not.toMatch(/desconto de\s*%/);
  });

  test('procuração cita a UC incluída', () => {
    expect(paragrafosProcuracao({ assinante, uc }).join('\n')).toContain('UNIDADE CONSUMIDORA: nº 7000000001');
  });

  test('formatação de percentual e nome do arquivo', () => {
    expect(percentualBr(20)).toBe('20');
    expect(percentualBr('17.5')).toBe('17,5');
    expect(percentualBr(0)).toBe('');
    expect(nomeArquivoAditivo(assinante, '1.900.000.001-23')).toBe('Termo_Aditivo_UC_190000000123_MARIA_EXEMPLO_DA_SILVA');
  });
});
