// Regras puras da recarga de eletroposto (B2W Charge). Sem imports Deno:
// testadas pelo Vitest em tests/charging-recarga.test.ts.
// Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md

// A partir do OCPP, `paid` libera energia: o webhook so aceita evento com
// assinatura Stripe verificavel. Sem segredo configurado ou sem cabecalho,
// recusa (antes o corpo cru era aceito como evento legitimo).
export function exigirAssinatura(
  secret: string | null | undefined,
  assinatura: string | null | undefined,
): { secret: string; assinatura: string } {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET nao configurado.');
  if (!assinatura) throw new Error('Cabecalho stripe-signature ausente.');
  return { secret, assinatura };
}

// Maquina de status (spec §4.8). Espelha o gatilho fn_recarga_transicao_valida.
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
