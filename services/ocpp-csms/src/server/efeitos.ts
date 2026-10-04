// Efeitos de um comando ou temporizador sobre a recarga (spec 5.3). Todos sao guardados
// (so agem se a recarga ainda esta no status esperado) e idempotentes: o estorno e idempotente por recarga.
import type { Comando, Recarga, Repo } from '../repo/types.js';

async function expirarIdTag(repo: Repo, r: Recarga): Promise<void> {
  if (r.ocpp_id_tag && (await repo.buscarIdTag(r.ocpp_id_tag))) {
    await repo.atualizarIdTag(r.ocpp_id_tag, { status: 'Expired' });
  }
}

async function estornoTotal(repo: Repo, r: Recarga, motivo: string): Promise<void> {
  await repo.solicitarEstorno(r.id, { valor: r.valor, motivo });
}

// RemoteStart rejeitado/expirado/com erro: paid|starting -> failed + idTag Expired + estorno total.
export async function falharRecargaDoComando(repo: Repo, cmd: Comando, motivo: string, agora: Date): Promise<void> {
  if (cmd.acao !== 'RemoteStartTransaction' || !cmd.recarga_id) return;
  const fim = {
    status: 'failed' as const, valor_final: 0, finalizada_em: agora.toISOString(), motivo_fim: motivo,
  };
  const r0 = await repo.buscarRecarga(cmd.recarga_id);
  if (!r0) return;
  const r = (await repo.atualizarRecarga(r0.id, { ...fim, valor_estornado: r0.valor }, 'paid'))
    ?? (await repo.atualizarRecarga(r0.id, { ...fim, valor_estornado: r0.valor }, 'starting'));
  if (!r) return; // ja avancou (charging/canceled/...): nao mexe
  await expirarIdTag(repo, r);
  await estornoTotal(repo, r, motivo);
}

// RC-03: starting sem StartTransaction no prazo -> canceled + idTag Expired + estorno total.
export async function cancelarPorFaltaDePlug(repo: Repo, recarga: Recarga, agora: Date): Promise<boolean> {
  const r = await repo.atualizarRecarga(recarga.id, {
    status: 'canceled', valor_final: 0, valor_estornado: recarga.valor,
    finalizada_em: agora.toISOString(), motivo_fim: 'ConnectionTimeout',
  }, 'starting');
  if (!r) return false;
  await expirarIdTag(repo, r);
  await estornoTotal(repo, r, 'ConnectionTimeout: cabo nao conectado');
  return true;
}
