import type { Fatura } from './types';

/**
 * Resumo da fatura do assinante, com as mesmas regras do "Resumo da Fatura"
 * do CRM (src/components/InvoiceFormModal.jsx) para bater com o boleto:
 *
 * - tarifa = TE + TUSD impressos na conta; a do cadastro da UC so na falta;
 * - consumo_reais ja vem liquido de desconto (compensada com desconto +
 *   consumo nao compensado): compensada com desconto = consumo_reais - tarifa_minima;
 * - desconto B2W = economia_reais (gravado); desconto_aplicado 20 = 20%;
 * - parcelamento com parcelamento_repassado = false fica fora do total;
 * - conta projetada = consumo x tarifa + CIP + outros + parcelamento repassado
 *   (o que a concessionaria cobraria sem compensacao e sem desconto).
 *
 * Valores gravados prevalecem sobre recalculo: numero mostrado e numero apurado.
 */
export type ResumoFatura = {
  tarifa: number;
  tarifaOrigem: 'conta' | 'cadastro';
  consumoKwh: number;
  compensadoKwh: number;
  compensadaCheia: number;
  desconto: number;
  descontoPct: number | null;
  compensadaComDesconto: number;
  naoCompensada: number;
  iluminacao: number;
  outros: number;
  parcelamento: number;
  valorFatura: number;
  contaProjetada: number;
  economia: number;
  economiaPct: number | null;
};

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const centavos = (v: number) => Math.round(v * 100) / 100;

export function resumoFatura(f: Fatura, tarifaCadastro?: number | null): ResumoFatura {
  const te = n(f.te_apurado);
  const tusd = n(f.tusd_apurado);
  const daConta = te > 0 && tusd > 0;
  const tarifa = daConta ? te + tusd : n(tarifaCadastro);

  const consumoKwh = n(f.consumo_kwh);
  const compensadoKwh = n(f.consumo_compensado);
  const iluminacao = n(f.iluminacao_publica);
  const outros = n(f.outros_lancamentos);
  const parcelamento = f.parcelamento_repassado === false ? 0 : n(f.parcelamento);

  const pctBruto = n(f.desconto_aplicado);
  const mult = pctBruto > 1 ? pctBruto / 100 : pctBruto;

  // Gravados primeiro; recalculo so quando a fatura nao trouxer o campo.
  const naoCompensada = f.tarifa_minima != null
    ? n(f.tarifa_minima)
    : Math.max(0, (consumoKwh - compensadoKwh) * tarifa);
  const compensadaComDesconto = f.consumo_reais != null
    ? n(f.consumo_reais) - naoCompensada
    : compensadoKwh * tarifa * (1 - mult);
  const desconto = f.economia_reais != null ? n(f.economia_reais) : compensadoKwh * tarifa * mult;
  const compensadaCheia = compensadaComDesconto + desconto;

  const valorFatura = f.valor_a_pagar != null
    ? n(f.valor_a_pagar)
    : compensadaComDesconto + naoCompensada + iluminacao + outros + parcelamento;
  const contaProjetada = consumoKwh * tarifa + iluminacao + outros + parcelamento;
  const economia = contaProjetada - valorFatura;

  return {
    tarifa,
    tarifaOrigem: daConta ? 'conta' : 'cadastro',
    consumoKwh,
    compensadoKwh,
    compensadaCheia: centavos(compensadaCheia),
    desconto: centavos(desconto),
    descontoPct: compensadaCheia > 0 ? ((compensadaCheia - compensadaComDesconto) / compensadaCheia) * 100 : null,
    compensadaComDesconto: centavos(compensadaComDesconto),
    naoCompensada: centavos(naoCompensada),
    iluminacao,
    outros,
    parcelamento,
    valorFatura: centavos(valorFatura),
    contaProjetada: centavos(contaProjetada),
    economia: centavos(economia),
    economiaPct: contaProjetada > 0 ? (economia / contaProjetada) * 100 : null,
  };
}
