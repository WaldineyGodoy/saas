import { describe, test, expect } from 'vitest';
import { medianaKwh, montarPerfil, perfilParaLista, medianaDoPerfil, perfilTemDados, gravarHistoricoConsumo, ehErroBancoDesatualizado } from '../src/lib/historicoConsumo.js';
import { parseEnergyBillText, completarLeitura, contaParaUc } from '../src/lib/energyBillParser.js';

describe('medianaKwh', () => {
  test('ímpar, par e ignora zeros', () => {
    expect(medianaKwh([300, 100, 200])).toBe(200);
    expect(medianaKwh([100, 200, 300, 400])).toBe(250);
    expect(medianaKwh([0, 0, 100, 300])).toBe(200);
    expect(medianaKwh([{ kwh: 5 }, { kwh: 0 }, { kwh: 7 }, { kwh: 9 }])).toBe(7);
  });
  test('sem consumo -> null', () => {
    expect(medianaKwh([])).toBeNull();
    expect(medianaKwh([0, 0])).toBeNull();
    expect(medianaKwh(null)).toBeNull();
  });
});

describe('montarPerfil', () => {
  test('mês mais recente vence; zerado e ausente recebem a mediana', () => {
    const perfil = montarPerfil([
      { mes: '2026-05', kwh: 166, dias: 29 },
      { mes: '2025-05', kwh: 999, dias: 30 }, // mesmo mês do calendário, mais antigo
      { mes: '2026-04', kwh: 200, dias: 30 },
      { mes: '2026-03', kwh: 0, dias: 31 },
      { mes: '2026-02', kwh: 300, dias: 28 },
    ]);
    expect(perfil['05']).toEqual({ kwh: 166, ref: '2026-05', origem: 'cadastro' });
    expect(perfil['04']).toEqual({ kwh: 200, ref: '2026-04', origem: 'cadastro' });
    // mediana de 166, 200, 300 = 200
    expect(perfil['03']).toEqual({ kwh: 200, ref: '2026-03', origem: 'mediana' });
    expect(perfil['12']).toEqual({ kwh: 200, ref: null, origem: 'mediana' });
    expect(Object.keys(perfil)).toHaveLength(12);
    expect(medianaDoPerfil(perfil)).toBe(200);
  });

  test('sem consumo nenhum não inventa meses', () => {
    expect(montarPerfil([{ mes: '2026-01', kwh: 0 }])).toEqual({ '01': { kwh: 0, ref: '2026-01', origem: 'cadastro' } });
    expect(montarPerfil([])).toEqual({});
    expect(perfilTemDados({})).toBe(false);
  });

  test('perfilParaLista devolve 12 linhas em ordem de calendário', () => {
    const lista = perfilParaLista({ '02': { kwh: 10, ref: '2026-02', origem: 'conta' } });
    expect(lista).toHaveLength(12);
    expect(lista[0]).toEqual({ mes: '01', nome: 'Jan', kwh: null, ref: null, origem: null });
    expect(lista[1]).toEqual({ mes: '02', nome: 'Fev', kwh: 10, ref: '2026-02', origem: 'conta' });
  });
});

describe('leitor expõe a mediana', () => {
  test('completarLeitura traz medianaKwh e contaParaUc usa ela na franquia', () => {
    const lido = completarLeitura({ historico: [{ mes: '2026-01', kwh: 100 }, { mes: '2026-02', kwh: 110 }, { mes: '2026-03', kwh: 900 }] });
    expect(lido.medianaKwh).toBe(110);
    expect(lido.mediaKwh).toBe(370);
    expect(contaParaUc({ ...lido, numeroUc: '1' }).franquia).toBe('110');
  });
  test('parseEnergyBillText sem histórico -> mediana 0', () => {
    expect(parseEnergyBillText('').medianaKwh).toBe(0);
  });
});

describe('gravarHistoricoConsumo', () => {
  const cliente = (resposta) => {
    const chamadas = [];
    return { chamadas, rpc: async (nome, args) => { chamadas.push([nome, args]); return resposta; } };
  };

  test('chama a RPC do contrato com o array do leitor', async () => {
    const sb = cliente({ data: { mediana: 200 }, error: null });
    const hist = [{ mes: '2026-05', kwh: 166, dias: 29 }];
    const r = await gravarHistoricoConsumo(sb, 'uc-1', hist, 'cadastro');
    expect(r).toEqual({ ok: true, data: { mediana: 200 } });
    expect(sb.chamadas).toEqual([['fn_gravar_historico_consumo', { p_uc: 'uc-1', p_historico: hist, p_origem: 'cadastro' }]]);
  });

  test('sem histórico não chama nada', async () => {
    const sb = cliente({ data: null, error: null });
    expect((await gravarHistoricoConsumo(sb, 'uc-1', [])).ok).toBe(false);
    expect(sb.chamadas).toHaveLength(0);
  });

  test('RPC inexistente vira semBanco, sem lançar', async () => {
    const sb = cliente({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_gravar_historico_consumo' } });
    const r = await gravarHistoricoConsumo(sb, 'uc-1', [{ mes: '2026-05', kwh: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.semBanco).toBe(true);
    expect(ehErroBancoDesatualizado({ code: '42703', message: 'column consumer_units.historico_consumo does not exist' })).toBe(true);
    expect(ehErroBancoDesatualizado({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
