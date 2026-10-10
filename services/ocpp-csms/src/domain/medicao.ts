// Normaliza SampledValue do MeterValues: energia sempre em Wh, potencia em W.
// Defaults do OCPP 1.6: measurand = Energy.Active.Import.Register, unit = Wh.

export interface SampledValue {
  value: string;
  unit?: string;
  measurand?: string;
}

const FATOR: Record<string, { unidade: string; fator: number }> = {
  kWh: { unidade: 'Wh', fator: 1000 },
  kW: { unidade: 'W', fator: 1000 },
  kvarh: { unidade: 'varh', fator: 1000 },
  kvar: { unidade: 'var', fator: 1000 },
};

export function normalizar(sv: SampledValue): { valor: number; unidade: string } {
  const bruto = String(sv.value ?? '').trim();
  const num = bruto === '' ? NaN : Number(bruto);
  if (!Number.isFinite(num)) throw new Error(`Valor de medicao nao numerico: "${bruto}"`);
  const unit = sv.unit ?? 'Wh';
  const conv = FATOR[unit];
  if (!conv) return { valor: num, unidade: unit };
  // 3 casas: tira artefato de ponto flutuante (0.0003 * 1000)
  return { valor: Math.round(num * conv.fator * 1000) / 1000, unidade: conv.unidade };
}
