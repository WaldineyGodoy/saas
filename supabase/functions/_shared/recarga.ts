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

// ---------------------------------------------------------------------------
// Ponte app <-> CSMS (Tarefa 9). Spec §4.3, §4.8, §4.9, §5.4.
// ---------------------------------------------------------------------------

export type MotivoIndisponivel = 'offline' | 'ocupado' | 'bloqueado';

// Antes de criar o PaymentIntent (ST-04, UI-01). Preparing entra: o motorista
// pode pagar com o cabo ja plugado. Faulted/Unavailable contam como bloqueado
// (nao e ocupacao por outra recarga e so sai com operador/Reset).
export function conectorDisponivel(c: {
  online: boolean;
  status: string;
  bloqueado: boolean;
}): { ok: true } | { ok: false; motivo: MotivoIndisponivel } {
  if (!c.online) return { ok: false, motivo: 'offline' };
  if (c.bloqueado) return { ok: false, motivo: 'bloqueado' };
  if (c.status === 'Available' || c.status === 'Preparing') return { ok: true };
  if (['Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing', 'Reserved'].includes(c.status)) {
    return { ok: false, motivo: 'ocupado' };
  }
  return { ok: false, motivo: 'bloqueado' };
}

export const mensagemConectorIndisponivel = (motivo: MotivoIndisponivel): string =>
  ({
    offline: 'O carregador esta offline no momento. Tente novamente em instantes.',
    ocupado: 'Este conector esta em uso por outra recarga.',
    bloqueado: 'Este conector esta indisponivel (bloqueado ou com falha). Procure outro conector.',
  })[motivo];

// Tarifa ao motorista = tarifa_motorista_kwh do plano do eletroposto (§4.9).
export function tarifaDoMotorista(
  plano: { tarifa_motorista_kwh?: number | string | null } | null | undefined,
): { ok: true; tarifa: number } | { ok: false; erro: string } {
  if (!plano) return { ok: false, erro: 'Este eletroposto nao tem plano configurado. Recarga indisponivel.' };
  const t = Number(plano.tarifa_motorista_kwh);
  if (plano.tarifa_motorista_kwh == null || plano.tarifa_motorista_kwh === '' || !(t > 0)) {
    return { ok: false, erro: 'O plano deste eletroposto nao tem tarifa ao motorista definida. Recarga indisponivel.' };
  }
  return { ok: true, tarifa: t };
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// idTag efemero (CiString20Type): 'RC' + 18 caracteres base32 = 20.
// 256 e multiplo de 32: `byte % 32` nao tem vies.
export function gerarIdTag(
  bytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const b = bytes(18);
  let s = 'RC';
  for (let i = 0; i < 18; i++) s += BASE32[b[i] % 32];
  return s;
}

const EXPIRA_COMANDO_INICIO_MS = 2 * 60 * 1000;

export function comandoInicio(
  recarga: { id: string; ocpp_connector_id: number | null | undefined },
  idTag: string,
  agora: Date = new Date(),
) {
  const c = recarga.ocpp_connector_id;
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 1) {
    throw new Error(`Recarga ${recarga.id} sem conector OCPP resolvido.`);
  }
  if (idTag.length < 1 || idTag.length > 20) throw new Error('idTag deve ter de 1 a 20 caracteres.');
  return {
    acao: 'RemoteStartTransaction' as const,
    payload: { connectorId: c, idTag },
    chave_idempotencia: `start:${recarga.id}`,
    expira_em: new Date(agora.getTime() + EXPIRA_COMANDO_INICIO_MS).toISOString(),
  };
}

// Mesma chave que o corte pre-pago do CSMS usa: duplicata e inofensiva.
export function comandoParada(recarga: { id: string; ocpp_transacao_id: number | string | null | undefined }) {
  const t = Number(recarga.ocpp_transacao_id);
  if (recarga.ocpp_transacao_id == null || !Number.isInteger(t) || t < 1) {
    throw new Error(`Recarga ${recarga.id} sem transacao OCPP em andamento.`);
  }
  return {
    acao: 'RemoteStopTransaction' as const,
    payload: { transactionId: t },
    chave_idempotencia: `stop:${recarga.id}`,
  };
}

// Comparacao de segredos sem sair no primeiro caractere diferente.
export function igualConstante(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// SG-04: dono = usuario logado da recarga, ou quem apresenta o client_secret
// do PaymentIntent dela. `recarga.client_secret` e lido da Stripe pela funcao.
export function podeParar(
  recarga: { user_id?: string | null; client_secret?: string | null },
  prova: { userId?: string | null; clientSecret?: string | null },
): boolean {
  const porUsuario = !!prova.userId && !!recarga.user_id && igualConstante(prova.userId, recarga.user_id);
  const porSegredo = !!prova.clientSecret && !!recarga.client_secret &&
    igualConstante(prova.clientSecret, recarga.client_secret);
  return porUsuario || porSegredo;
}

// Estorno minimo (decisao do dono): diferenca abaixo disso nao e devolvida.
export const ESTORNO_MINIMO_CENTAVOS = 50;

// Espelha calcularFechamento (services/ocpp-csms/src/domain/estorno.ts) em
// centavos inteiros. O CSMS decide o valor; aqui serve de referencia testada.
export function valorEstornoCentavos(r: {
  valor: number | string;
  tarifa_kwh_aplicada: number | string;
  meter_start_wh: number;
  meter_stop_wh: number;
}): number {
  const valorC = Math.round(Number(r.valor) * 100);
  if (r.meter_stop_wh < r.meter_start_wh) return 0;
  const wh = r.meter_stop_wh - r.meter_start_wh;
  const tarifa4 = Math.round(Number(r.tarifa_kwh_aplicada) * 10000);
  const custoC = Math.round((wh * tarifa4) / 100000);
  if (custoC >= valorC) return 0;
  const difC = valorC - custoC;
  return difC < ESTORNO_MINIMO_CENTAVOS ? 0 : difC;
}

// Pedido do CSMS a refund-charging: devolve a mensagem de recusa ou null.
export function validarPedidoEstorno(
  recarga: { valor: number | string; status: string; stripe_payment_intent_id: string | null },
  valorCentavos: unknown,
): string | null {
  if (typeof valorCentavos !== 'number' || !Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    return 'valor_centavos deve ser um inteiro maior que zero.';
  }
  if (recarga.status === 'pending_payment') return 'Recarga ainda nao paga.';
  if (!recarga.stripe_payment_intent_id) return 'Recarga sem PaymentIntent.';
  if (valorCentavos > Math.round(Number(recarga.valor) * 100)) return 'Estorno excede o valor pago.';
  return null;
}
