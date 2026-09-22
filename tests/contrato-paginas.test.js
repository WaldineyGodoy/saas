import { test, expect } from 'vitest';
import { TITULO_ADESAO, dividirEmPaginas, montarTextoContrato, paginasTermoAdesao } from '../src/lib/contrato';
import { semTituloRepetido } from '../src/lib/contratoBase';

const sub = { name: 'Fulano', cpf_cnpj: '52998224725', rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'Natal', uf: 'RN', consolidated_due_day: 15 };
const ucs = [{ concessionaria: 'COSERN', desconto_assinante: 18 }];

test('paginasTermoAdesao = paginação do ContratoAdesao (sem título repetido)', () => {
  const texto = montarTextoContrato(sub, 'COSERN', { desconto: 18, diaVencimento: 15 });
  const n = paginasTermoAdesao(sub, ucs);
  expect(n).toBe(dividirEmPaginas(semTituloRepetido(texto, TITULO_ADESAO)).length);
  expect(n).toBeGreaterThanOrEqual(1);
});

test('vencimento cai para consolidated_due_day quando a UC não tem', () => {
  const a = paginasTermoAdesao(sub, ucs);
  const b = dividirEmPaginas(semTituloRepetido(montarTextoContrato(sub, 'COSERN', { desconto: 18, diaVencimento: 15 }), TITULO_ADESAO)).length;
  expect(a).toBe(b);
});

test('minuta editada (texto) substitui o texto automático e perde o título', () => {
  const minuta = `${TITULO_ADESAO.toUpperCase()}\n\nCLÁUSULA 1 – ÚNICA\nTexto curto.`;
  expect(paginasTermoAdesao(sub, ucs, { texto: minuta })).toBe(1);
  expect(paginasTermoAdesao(sub, ucs, { texto: minuta })).toBe(dividirEmPaginas(semTituloRepetido(minuta, TITULO_ADESAO)).length);
});
