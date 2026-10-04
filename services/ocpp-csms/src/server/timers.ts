// Verificacoes periodicas do CSMS. A Tarefa 6 estende este arquivo (despachante de comandos etc.).
import type { Repo } from '../repo/types.js';

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
