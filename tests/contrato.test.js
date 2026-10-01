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

import { montarCompraVenda, montarArrendamento } from '../src/lib/contratosUsina';
import { extensoReais, porExtenso } from '../src/lib/contratoBase';

test('extensoReais e porExtenso suportam valores monetários', () => {
  expect(porExtenso(60)).toBe('sessenta');
  expect(porExtenso(60000)).toBe('sessenta mil');
  expect(extensoReais(60000)).toBe('sessenta mil reais');
  expect(extensoReais(100000)).toBe('cem mil reais');
});

test('Compra e venda: Cenário A outorga opção exercível em até 60 meses', () => {
  const t = montarCompraVenda({}, { valorOpcaoImovel: 60000 });
  expect(t).toContain('exercível em até 60 (sessenta) meses da assinatura deste Contrato');
  expect(t).toContain('R$ 60.000,00');
});

test('Arrendamento: Cláusula 8.3 detalhada em até 60 meses quando Cenário A definido', () => {
  const t = montarArrendamento({}, { valorOpcaoImovel: 60000 });
  expect(t).toContain('Fica conferida ao ARRENDATÁRIO, e expressamente outorgada pelo ARRENDANTE, a opção irrevogável e irretratável de compra');
  expect(t).toContain('Durante os primeiros 60 (sessenta) meses contados da data de assinatura deste contrato, o ARRENDANTE compromete-se a vender a área ao ARRENDATÁRIO pelo preço fixo de R$ 60.000,00 (sessenta mil reais);');
  expect(t).toContain('Critério de Correção: O valor indicado na alínea "a" será corrigido monetariamente');
  expect(t).toContain('Exercício após 60 meses: Transcorrido o prazo de 60 (sessenta) meses');

  const t80k = montarArrendamento({}, { valorOpcaoImovel: 80000 });
  expect(t80k).toContain('pelo preço fixo de R$ 80.000,00 (oitenta mil reais);');
});

test('Arrendamento: Cláusula 8.3 padrão de preferência quando opção não definida', () => {
  const t = montarArrendamento({}, { valorOpcaoImovel: 0 });
  expect(t).toContain('8.3. O ARRENDATÁRIO tem direito de preferência na aquisição do imóvel, em igualdade de condições com terceiros, exercível em 30 (trinta) dias');
  expect(t).not.toContain('opção irrevogável e irretratável de compra');
});

test('Compra e venda: Cláusula 12.1 referencia apenas o Contrato de Gestão sem alíneas a, b, c', () => {
  const t = montarCompraVenda();
  expect(t).toContain('12.1. Contratada a gestão, a remuneração da ASSOCIAÇÃO é a prevista no Contrato de Gestão.');
  expect(t).not.toContain('Remuneração Inicial — 100%');
  expect(t).not.toContain('Remuneração Recorrente —');
  expect(t).not.toContain('Taxa de Administração —');
});


