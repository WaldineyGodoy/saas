// Contrato do Repo contra o MemoryRepo (sempre roda).
import { describe } from 'vitest';
import { MemoryRepo } from '../../src/repo/memory.js';
import { contratoRepo, type Mundo } from './contrato-repo.js';

describe('contrato Repo: MemoryRepo', () => {
  contratoRepo(async (): Promise<Mundo> => {
    // relogio que sempre avanca: duas leituras nunca devolvem o mesmo instante (como o updated_at do banco)
    let desvio = 0;
    const agora = () => new Date(Date.now() + (desvio += 2));
    const repo = new MemoryRepo({ agora });
    let n = 0;
    return {
      repo,
      agora,
      async semearCarregador(p = {}) {
        return repo.semearCarregador({ ...p, ocppId: p.ocppId ?? `CP-${++n}-${Math.random().toString(36).slice(2, 8)}` });
      },
      async semearIdTag(p) { return repo.semearIdTag(p); },
      async semearRecarga(p) { return repo.semearRecarga(p); },
      async mensagens(ocppId) { return repo.mensagens.filter((x) => x.ocpp_id === ocppId); },
      async estornos(recargaId) {
        return repo.estornos.filter((e) => e.recarga_id === recargaId).map(({ valor, motivo }) => ({ valor, motivo }));
      },
      async alertas(carregadorId) { return repo.alertas.filter((a) => a.carregador_id === carregadorId); },
      async limpar() { /* memoria descartavel */ },
    };
  });
});
