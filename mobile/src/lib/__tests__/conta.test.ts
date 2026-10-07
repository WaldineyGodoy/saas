import { describe, expect, it } from 'vitest';
import { contaParaPedido, mensagemDeErro, tamanhoReduzido } from '../conta';

describe('contaParaPedido', () => {
  it('guarda so os campos de cadastro e assume Cosern', () => {
    const r = contaParaPedido({
      numeroUc: '7000000001', titular: 'MARIA EXEMPLO', ligacao: 'monofasico', mediaKwh: 275,
      linhaDigitavel: '3419...', pixString: '000201...', legivel: true, observacoes: '', complemento: '',
    });
    expect(r).toEqual({
      concessionaria: 'Neoenergia Cosern', numeroUc: '7000000001', titular: 'MARIA EXEMPLO', ligacao: 'monofasico', mediaKwh: 275,
    });
  });
});

describe('tamanhoReduzido', () => {
  it('reduz o lado maior para 2000 px', () => {
    expect(tamanhoReduzido(3000, 4000)).toEqual({ height: 2000 });
    expect(tamanhoReduzido(4032, 3024)).toEqual({ width: 2000 });
  });
  it('nao amplia foto pequena', () => {
    expect(tamanhoReduzido(900, 1600)).toBeNull();
    expect(tamanhoReduzido(0, 0)).toBeNull();
  });
});

describe('mensagemDeErro', () => {
  it('traduz funcao ausente e repassa o resto', () => {
    expect(mensagemDeErro('Could not find the function public.app_solicitar_nova_uc')).toMatch(/servidor/);
    expect(mensagemDeErro('Esta UC ja esta cadastrada na sua conta.')).toBe('Esta UC ja esta cadastrada na sua conta.');
  });
});
