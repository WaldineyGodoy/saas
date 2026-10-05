// Parada pelo app (stop-charging): enfileira o RemoteStopTransaction da recarga. Sem imports Deno:
// testado pelo Vitest em tests/stop-charging.test.ts com um cliente falso.
// Spec: docs/superpowers/specs/2026-10-04-ocpp-comunicacao-eletroposto-design.md §5.4
import { comandoParada } from './recarga.ts';

// deno-lint-ignore no-explicit-any
type Cliente = any;
type Log = { log: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

// RemoteStop que terminou sem aceite: pode voltar para a fila (mesma lista do CSMS, handlers.ts).
export const STATUS_PARADA_REARMAVEL = ['expirado', 'rejeitado', 'erro'] as const;
const EXPIRA_PARADA_MS = 2 * 60 * 1000;

export function rearmeParada(agora: Date = new Date()) {
  return {
    status: 'pendente' as const,
    tentativas: 0,
    proxima_tentativa_em: agora.toISOString(),
    expira_em: new Date(agora.getTime() + EXPIRA_PARADA_MS).toISOString(),
    erro: null,
    resposta: null,
  };
}

export type ResultadoParada = 'enfileirada' | 'rearmada' | 'existente';

// `stop:<recarga>` e uma chave permanente (a mesma do corte pre-pago do CSMS). Se uma parada anterior
// terminou expirado/rejeitado/erro, o upsert com ignoreDuplicates nao enfileirava nada e o motorista
// via "sucesso" com a energia seguindo (I3). Agora, depois do upsert, UM update guardado pelo status
// devolve esse comando a pendente; dois cliques (ou app + corte do CSMS) ao mesmo tempo rearmam uma
// vez so. Comando pendente/enviado/aceito nao e tocado.
export async function enfileirarParada(
  supabase: Cliente,
  recarga: { id: string; carregador_id: string; ocpp_transacao_id: number | string | null },
  agora: Date = new Date(),
  log: Log = console,
): Promise<ResultadoParada> {
  const cmd = comandoParada(recarga);
  const { data: criado, error: cErr } = await supabase.from('ocpp_comandos').upsert(
    {
      carregador_id: recarga.carregador_id,
      acao: cmd.acao,
      payload: cmd.payload,
      chave_idempotencia: cmd.chave_idempotencia,
      recarga_id: recarga.id,
    },
    { onConflict: 'chave_idempotencia', ignoreDuplicates: true },
  ).select('id');
  if (cErr) throw cErr;
  if (criado?.length) return 'enfileirada';

  const { data: rearmado, error: rErr } = await supabase.from('ocpp_comandos')
    .update(rearmeParada(agora))
    .eq('chave_idempotencia', cmd.chave_idempotencia)
    .in('status', [...STATUS_PARADA_REARMAVEL])
    .select('id');
  if (rErr) throw rErr;
  if (!rearmado?.length) return 'existente';

  log.warn(`[stop-charging] Recarga ${recarga.id}: RemoteStop anterior terminou sem aceite; rearmado.`);
  // Alerta interno no mesmo formato do CSMS (notification_logs, canal 'sistema': nada e enviado).
  // Falha no alerta nao desfaz a parada.
  const { error: aErr } = await supabase.from('notification_logs').insert({
    entity_type: 'eletroposto_carregador',
    entity_id: recarga.carregador_id,
    channel: 'sistema',
    recipient: 'operacao',
    body: `Recarga ${recarga.id}: parada pelo app rearmou o RemoteStop que terminou sem aceite`,
    status: 'pending',
    metadata: {
      tipo: 'parada_rearmada',
      connector_id: null,
      dados: { recargaId: recarga.id, comandoId: rearmado[0].id, origem: 'app' },
    },
  });
  if (aErr) log.error('[stop-charging] Alerta parada_rearmada nao gravado:', aErr);
  return 'rearmada';
}
