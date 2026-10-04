// Verificacoes periodicas do CSMS (todas dirigidas por dados persistidos, sobrevivem a restart).
import type { Repo } from '../repo/types.js';
import type { OnErro } from './auth.js';
import { cancelarPorFaltaDePlug, falharRecargaDoComando } from './efeitos.js';

// Sem contato por 3 x heartbeat_intervalo_s => online = false (spec 5.2). Devolve os ocpp_id marcados.
export async function verificarOffline(repo: Repo, agora: Date, onErro: OnErro = () => undefined): Promise<string[]> {
  const marcados: string[] = [];
  for (const c of await repo.listarOnline()) {
    const ultimo = c.ultimo_contato_em ? new Date(c.ultimo_contato_em).getTime() : 0;
    if (agora.getTime() - ultimo > 3 * c.heartbeat_intervalo_s * 1000) {
      try { await repo.marcarOffline(c.id); marcados.push(c.ocpp_id); } catch (e) { onErro(`verificarOffline carregador ${c.ocpp_id}`, e); }
    }
  }
  return marcados;
}

// Comandos pendentes que passaram do expira_em (carregador offline, RS-06) -> expirado; RemoteStart falha a recarga.
export async function expirarComandos(repo: Repo, agora: Date, onErro: OnErro = () => undefined): Promise<number> {
  const vencidos = await repo.listarComandosExpirados();
  let n = 0;
  for (const cmd of vencidos) {
    try {
      const c = await repo.atualizarComando(cmd.id, { status: 'expirado', erro: 'expirado sem ser enviado' });
      await falharRecargaDoComando(repo, c, 'RemoteStart expirado', agora);
      n++;
    } catch (e) { onErro(`expirarComandos comando ${cmd.id}`, e); }
  }
  return n;
}

// RC-03: recarga com RemoteStart aceito ha mais de CONNECTION_TIMEOUT_S sem StartTransaction.
// Recargas ainda em paid com RemoteStart aceito (paid->starting falhou apos o aceito) sao promovidas antes.
export async function cancelarStartingSemPlug(
  repo: Repo, agora: Date, connectionTimeoutS: number, onErro: OnErro = () => undefined,
): Promise<number> {
  let n = 0;
  for (const { recarga, aceito_em } of await repo.listarRecargasComPartidaAceita()) {
    try {
      let atual: typeof recarga | null = recarga;
      if (recarga.status === 'paid') atual = await repo.atualizarRecarga(recarga.id, { status: 'starting' }, 'paid');
      if (!atual) continue; // outro processo ja moveu a recarga
      if (agora.getTime() - new Date(aceito_em).getTime() < connectionTimeoutS * 1000) continue;
      if (await cancelarPorFaltaDePlug(repo, atual, agora)) n++;
    } catch (e) { onErro(`cancelarStartingSemPlug recarga ${recarga.id}`, e); }
  }
  return n;
}
