// Efeitos de um comando ou temporizador sobre a recarga (spec 5.3). Todos sao guardados
// (so agem se a recarga ainda esta no status esperado) e restart-safe: a transicao para
// failed/canceled grava a marca META_ESTORNO_PENDENTE na MESMA escrita, e `reconciliarEstornos`
// (varredura) conclui idTag Expired + estorno total + valor_estornado, que sao idempotentes.
import type { OnErro } from './auth.js';
import { META_ESTORNO_PENDENTE, type Comando, type Recarga, type Repo } from '../repo/types.js';

// Conclui o que falta numa recarga failed/canceled marcada: idTag Expired, pedido de estorno
// (idempotente por recarga) e so entao valor_estornado + limpa a marca. Se algo lanca, a marca fica
// e a varredura repete.
export async function reconciliarRecarga(repo: Repo, r: Recarga): Promise<void> {
  if (r.ocpp_id_tag && (await repo.buscarIdTag(r.ocpp_id_tag))) {
    await repo.atualizarIdTag(r.ocpp_id_tag, { status: 'Expired' });
  }
  await repo.solicitarEstorno(r.id, { valor: r.valor, motivo: r.motivo_fim ?? 'recarga nao iniciada' });
  await repo.atualizarRecarga(r.id, {
    valor_estornado: r.valor, metadata: { [META_ESTORNO_PENDENTE]: false },
  }, r.status);
}

export async function reconciliarEstornos(repo: Repo, onErro: OnErro = () => undefined): Promise<number> {
  const pendentes = await repo.listarRecargasComEstornoPendente();
  let n = 0;
  for (const r of pendentes) {
    // um item que sempre falha nao pode travar os demais
    try { await reconciliarRecarga(repo, r); n++; } catch (e) { onErro(`reconciliarEstornos recarga ${r.id}`, e); }
  }
  return n;
}

// RemoteStart rejeitado/expirado/com erro: paid|starting -> failed (+ marca de estorno total pendente).
export async function falharRecargaDoComando(repo: Repo, cmd: Comando, motivo: string, agora: Date): Promise<void> {
  if (cmd.acao !== 'RemoteStartTransaction' || !cmd.recarga_id) return;
  const r0 = await repo.buscarRecarga(cmd.recarga_id);
  if (!r0) return;
  const patch = {
    status: 'failed' as const, valor_final: 0, finalizada_em: agora.toISOString(), motivo_fim: motivo,
    metadata: { [META_ESTORNO_PENDENTE]: true },
  };
  const r = (await repo.atualizarRecarga(r0.id, patch, 'paid')) ?? (await repo.atualizarRecarga(r0.id, patch, 'starting'));
  if (!r) return; // ja avancou (charging/canceled/...): nao mexe
  await reconciliarRecarga(repo, r);
}

// RC-03: starting sem StartTransaction no prazo -> canceled (+ marca) e conclusao do estorno total.
export async function cancelarPorFaltaDePlug(repo: Repo, recarga: Recarga, agora: Date): Promise<boolean> {
  const r = await repo.atualizarRecarga(recarga.id, {
    status: 'canceled', valor_final: 0, finalizada_em: agora.toISOString(), motivo_fim: 'ConnectionTimeout',
    metadata: { [META_ESTORNO_PENDENTE]: true },
  }, 'starting');
  if (!r) return false;
  await reconciliarRecarga(repo, r);
  return true;
}
