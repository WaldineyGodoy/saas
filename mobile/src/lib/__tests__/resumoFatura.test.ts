import { describe, expect, it } from 'vitest';
import { resumoFatura } from '../resumoFatura';
import type { Fatura } from '../types';

// Valores de uma fatura real de 10/2026 (sem identificar a UC): o resumo
// precisa bater com o boleto e com o Resumo da Fatura do CRM.
const base: Fatura = {
  id: 'f1', mes_referencia: '2026-10-01', vencimento: '2026-11-15', status: 'a_vencer',
  consumo_kwh: 490, consumo_compensado: 490, energia_injetada: null,
  valor_concessionaria: 55.27, economia_reais: 100.92, valor_a_pagar: 458.95, desconto_aplicado: 20,
  te_apurado: 0.38950833, tusd_apurado: 0.64027822, iluminacao_publica: 55.27,
  outros_lancamentos: 0, parcelamento: 0, parcelamento_repassado: true,
  tarifa_minima: 0, consumo_reais: 403.68,
  asaas_boleto_url: null, asaas_pdf_storage_url: null, linha_digitavel: null, pix_string: null,
};

describe('resumoFatura', () => {
  it('bate com o boleto usando a tarifa da conta', () => {
    const r = resumoFatura(base, 1.0347);
    expect(r.tarifaOrigem).toBe('conta');
    expect(r.tarifa).toBeCloseTo(1.02979, 5);
    expect(r.compensadaCheia).toBe(504.6);
    expect(r.desconto).toBe(100.92);
    expect(r.compensadaComDesconto).toBe(403.68);
    expect(r.valorFatura).toBe(458.95);
    expect(r.contaProjetada).toBe(559.87);
    expect(r.economia).toBe(100.92);
    expect(r.descontoPct).toBeCloseTo(20, 1);
    expect(Math.round(r.economiaPct!)).toBe(18);
  });

  it('usa a tarifa do cadastro so quando a conta nao traz TE e TUSD', () => {
    const r = resumoFatura({ ...base, te_apurado: null, tusd_apurado: null }, 1.0347);
    expect(r.tarifaOrigem).toBe('cadastro');
    expect(r.tarifa).toBe(1.0347);
  });

  it('parcelamento nao repassado fica fora da conta projetada', () => {
    const r = resumoFatura({ ...base, parcelamento: 80, parcelamento_repassado: false });
    expect(r.parcelamento).toBe(0);
    expect(r.contaProjetada).toBe(559.87);
  });

  it('consumo nao compensado entra nas duas contas', () => {
    const r = resumoFatura({ ...base, consumo_kwh: 590, tarifa_minima: 102.98, consumo_reais: 506.66, valor_a_pagar: 561.93 });
    expect(r.naoCompensada).toBe(102.98);
    expect(r.compensadaComDesconto).toBe(403.68);
    expect(r.contaProjetada).toBeCloseTo(590 * 1.02978655 + 55.27, 1);
    expect(r.economia).toBeCloseTo(100.92, 1);
  });
});
