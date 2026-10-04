// Montagem do CSMS: servidor OCPP (+ /health) e fila de comandos sobre um Repo qualquer.
// O main.ts passa o SupabaseRepo; os testes passam o MemoryRepo e porta 0 (sem variaveis de ambiente).
import type { Repo } from './repo/types.js';
import { criarFila, type Fila } from './server/comandos.js';
import { criarServidor, type Servidor } from './server/index.js';
import type { ModoAuth, OnErro } from './server/auth.js';

export interface OpcoesApp {
  repo: Repo;
  porta: number; // 0 = efemera (testes)
  host?: string;
  auth: ModoAuth;
  connectionTimeoutS?: number;
  // espera pela resposta do carregador nos comandos (padrao 30 s)
  callTimeoutMs?: number;
  verificarOfflineMs?: number;
  varreduraMs?: number;
  onErro?: OnErro;
}

export interface App {
  porta: number;
  servidor: Servidor;
  fila: Fila;
  // encerra limpo: para a fila (varredura + assinatura), fecha conexoes e o servidor. Idempotente.
  parar(): Promise<void>;
}

export async function iniciarApp(o: OpcoesApp): Promise<App> {
  const servidor = await criarServidor({
    repo: o.repo, porta: o.porta, host: o.host, auth: o.auth,
    verificarOfflineMs: o.verificarOfflineMs, callTimeoutMs: o.callTimeoutMs, onErro: o.onErro,
  });
  const fila = criarFila({
    repo: o.repo, servidor, connectionTimeoutS: o.connectionTimeoutS, callTimeoutMs: o.callTimeoutMs,
    varreduraMs: o.varreduraMs, onErro: o.onErro,
  });
  // varredura imediata: recupera o que ficou pendente enquanto o processo estava fora
  void fila.processar().catch((e) => (o.onErro ?? ((c, err) => console.error(`[ocpp-csms] ${c}:`, err)))('processar (partida)', e));

  let parando: Promise<void> | undefined;
  return {
    porta: servidor.porta,
    servidor,
    fila,
    parar() {
      parando ??= (async () => {
        fila.parar();
        await servidor.fechar();
      })();
      return parando;
    },
  };
}
