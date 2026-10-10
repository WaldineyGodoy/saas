// Regras puras da recarga. `tarifa` e sempre a foto da recarga
// (recargas_eletroposto.tarifa_kwh_aplicada, spec §4.9), nunca a tarifa atual do plano.

// Mesmo mapa de supabase/functions/_shared/recarga.ts (RECARGA_TRANSICOES)
// e do gatilho SQL fn_recarga_transicao_valida. Mantenha os tres iguais.
export const RECARGA_TRANSICOES: Record<string, readonly string[]> = {
  pending_payment: ['paid', 'failed', 'canceled'],
  paid: ['starting', 'failed'],
  starting: ['charging', 'failed', 'canceled'],
  charging: ['completed'],
  completed: [],
  failed: [],
  canceled: [],
};

export const transicaoValida = (de: string, para: string): boolean =>
  (RECARGA_TRANSICOES[de] ?? []).includes(para);

// Limite de kWh que o valor pago compra: valor / tarifa, 2 casas, para baixo.
// Aritmetica em centavos e decimos de milesimo para nao gerar artefato de float.
export function kwhLimite(valor: number, tarifa: number): number {
  if (!(tarifa > 0)) throw new Error('Tarifa deve ser maior que zero.');
  const centavos = Math.round(valor * 100);
  const tarifa4 = Math.round(tarifa * 10000);
  return Math.floor((centavos * 10000) / tarifa4) / 100;
}

export const deveCortar = (kwhConsumido: number, limite: number): boolean =>
  kwhConsumido >= limite;
