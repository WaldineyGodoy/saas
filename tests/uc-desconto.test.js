import { describe, test, expect } from 'vitest';
import { descontoParaGravar, descontoDoPlanoParaCampo } from '../src/lib/ucDesconto';

const planos = [
  { id: 'premium', nome: 'Plano Premium', desconto_assinante: '20.00' },
  { id: 'ultra', nome: 'Plano Ultra Connect', desconto_assinante: '15.00' },
  { id: 'sem-desconto', nome: 'Sem desconto', desconto_assinante: null },
  { id: 'zerado', nome: 'Zerado', desconto_assinante: 0 },
];

describe('descontoParaGravar: o que o modal da UC grava em consumer_units.desconto_assinante', () => {
  test('com plano escolhido, grava o desconto do PLANO -- o caso MULTI TV (CEP trouxe 20, plano e 15)', () => {
    // A busca por CEP preenche o campo com o desconto do municipio (20 em Natal);
    // a tela mostra "Desconto Herdado" = plano (15). Gravava o 20.
    expect(descontoParaGravar({ plano_assinatura_id: 'ultra', desconto_assinante: '20.00' }, planos)).toBe(15);
  });

  test('trocar o plano troca o desconto gravado', () => {
    expect(descontoParaGravar({ plano_assinatura_id: 'premium', desconto_assinante: '15.00' }, planos)).toBe(20);
  });

  test('plano e campo iguais: o mesmo valor', () => {
    expect(descontoParaGravar({ plano_assinatura_id: 'ultra', desconto_assinante: '15.00' }, planos)).toBe(15);
  });

  test('desconto do plano chega como texto "15.00" e vira numero', () => {
    expect(typeof descontoParaGravar({ plano_assinatura_id: 'ultra', desconto_assinante: '' }, planos)).toBe('number');
  });

  test('sem plano, mantem o que estava no campo (comportamento anterior)', () => {
    expect(descontoParaGravar({ plano_assinatura_id: '', desconto_assinante: '17.50' }, planos)).toBe(17.5);
    expect(descontoParaGravar({ plano_assinatura_id: null, desconto_assinante: '12.00' }, planos)).toBe(12);
    expect(descontoParaGravar({ plano_assinatura_id: '', desconto_assinante: '' }, planos)).toBe(0);
  });

  test('plano sem desconto definido nao zera a UC: fica com o campo', () => {
    expect(descontoParaGravar({ plano_assinatura_id: 'sem-desconto', desconto_assinante: '20.00' }, planos)).toBe(20);
    expect(descontoParaGravar({ plano_assinatura_id: 'zerado', desconto_assinante: '20.00' }, planos)).toBe(20);
  });

  test('plano que nao esta na lista carregada nao zera nem quebra: fica com o campo', () => {
    expect(descontoParaGravar({ plano_assinatura_id: 'desconhecido', desconto_assinante: '20.00' }, planos)).toBe(20);
    expect(descontoParaGravar({ plano_assinatura_id: 'ultra', desconto_assinante: '20.00' }, [])).toBe(20);
    expect(descontoParaGravar({ plano_assinatura_id: 'ultra', desconto_assinante: '20.00' }, undefined)).toBe(20);
  });

  test('desconto em fracao no campo (0,20) segue como veio, sem ser reinterpretado aqui', () => {
    expect(descontoParaGravar({ plano_assinatura_id: '', desconto_assinante: '0.20' }, planos)).toBe(0.2);
  });
});

describe('descontoDoPlanoParaCampo: valor mostrado no campo ao escolher o plano', () => {
  test('formata o desconto do plano com 2 casas, como o campo ja usa', () => {
    expect(descontoDoPlanoParaCampo('ultra', planos)).toBe('15.00');
    expect(descontoDoPlanoParaCampo('premium', planos)).toBe('20.00');
  });
  test('plano sem desconto, desconhecido ou vazio: nulo (nao mexe no campo)', () => {
    expect(descontoDoPlanoParaCampo('sem-desconto', planos)).toBeNull();
    expect(descontoDoPlanoParaCampo('zerado', planos)).toBeNull();
    expect(descontoDoPlanoParaCampo('desconhecido', planos)).toBeNull();
    expect(descontoDoPlanoParaCampo('', planos)).toBeNull();
    expect(descontoDoPlanoParaCampo(null, planos)).toBeNull();
  });
});
