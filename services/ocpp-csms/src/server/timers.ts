// Verificacoes periodicas do CSMS (todas dirigidas por dados persistidos, sobrevivem a restart).
import type { Repo } from '../repo/types.js';
import { cancelarPorFaltaDePlug, falharRecargaDoComando } from './efeitos.js';

// Sem contato por 3 x heartbeat_intervalo_s => online = false (spec 5.2). Devolve os ocpp_id marcados.
export async function verificarOffline(repo: Repo, agora: Date): Promise<string[]> {
  const marcados: string[] = [];
  for (const c of await repo.listarOnline()) {
    const ultimo = c.ultimo_contato_em ? new Date(c.ultimo_contato_em).getTime() : 0;
    if (agora.getTime() - ultimo > 3 * c.heartbeat_intervalo_s * 1000) {
      await repo.marcarOffline(c.id);
      marcados.push(c.ocpp_id);
    }
  }
  return marcados;
}

// Comandos pendentes que passaram do expira_em (carregador offline, RS-06) -> expirado; RemoteStart falha a recarga.
export async function expirarComandos(repo: Repo, agora: Date): Promise<number> {
  const vencidos = await repo.listarComandosExpirados();
  for (const cmd of vencidos) {
    const c = await repo.atualizarComando(cmd.id, { status: 'expirado', erro: 'expirado sem ser enviado' });
    await falharRecargaDoComando(repo, c, 'RemoteStart expirado', agora);
  }
  return vencidos.length;
}

// RC-03: recarga em starting cujo RemoteStart foi aceito ha mais de CONNECTION_TIMEOUT_S sem StartTransaction.
export async function cancelarStartingSemPlug(repo: Repo, agora: Date, connectionTimeoutS: number): Promise<number> {
  let n = 0;
  for (const { recarga, aceito_em } of await repo.listarRecargasStarting()) {
    if (agora.getTime() - new Date(aceito_em).getTime() < connectionTimeoutS * 1000) continue;
    if (await cancelarPorFaltaDePlug(repo, recarga, agora)) n++;
  }
  return n;
}
