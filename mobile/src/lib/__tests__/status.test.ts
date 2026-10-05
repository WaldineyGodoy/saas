import { describe, expect, it, vi } from 'vitest';

vi.mock('../../theme/tokens', () => ({ colors: {} }));
const { grupoRede, pedidoUcStatus, ucStatus } = await import('../status');

describe('grupoRede', () => {
  it('agrupa nas abas do Home Connect', () => {
    expect(grupoRede('ativo')).toBe('ativo');
    expect(grupoRede('ativo', 'atrasado')).toBe('atrasado');
    expect(grupoRede('ativo_inadimplente')).toBe('atrasado');
    expect(grupoRede('contrato_assinado')).toBe('cadastrado');
    expect(grupoRede('ativacao')).toBe('cadastrado');
    expect(grupoRede('transferido')).toBe('cancelado');
    expect(grupoRede('cancelado_inadimplente', 'atrasado')).toBe('cancelado');
  });
  it('status desconhecido nao quebra', () => {
    expect(ucStatus('algo_novo')).toEqual(['algo novo', 'neutral']);
    expect(ucStatus(null)).toEqual(['—', 'neutral']);
  });
});

describe('pedidoUcStatus', () => {
  it('rotula a situacao do pedido de nova UC', () => {
    expect(pedidoUcStatus('aguardando_assinatura')).toEqual(['Assinatura pendente', 'warn']);
    expect(pedidoUcStatus('uc_criada')).toEqual(['UC incluída', 'ok']);
    expect(pedidoUcStatus('qualquer')).toEqual(['Em análise', 'neutral']);
  });
});
