// Estorno minimo (decisao do dono): diferenca abaixo disso nao e devolvida.
export const ESTORNO_MINIMO = 0.5;

export interface Fechamento {
  kwh: number;
  valor_final: number;
  estorno: number;
  revisar: boolean;
}

// valor_final = min(valor, kwh x tarifa). Tudo em centavos inteiros.
export function calcularFechamento(p: {
  valor: number;
  tarifa: number;
  whStart: number;
  whStop: number;
}): Fechamento {
  const valorC = Math.round(p.valor * 100);
  // contador regrediu (MV-03): cobra o valor pago, sem estorno automatico
  if (p.whStop < p.whStart) {
    return { kwh: 0, valor_final: valorC / 100, estorno: 0, revisar: true };
  }
  const wh = p.whStop - p.whStart;
  const tarifa4 = Math.round(p.tarifa * 10000);
  const custoC = Math.round((wh * tarifa4) / 100000);
  const kwh = wh / 1000;
  if (custoC >= valorC) return { kwh, valor_final: valorC / 100, estorno: 0, revisar: false };
  const difC = valorC - custoC;
  if (difC < Math.round(ESTORNO_MINIMO * 100)) {
    return { kwh, valor_final: valorC / 100, estorno: 0, revisar: false };
  }
  return { kwh, valor_final: custoC / 100, estorno: difC / 100, revisar: false };
}
