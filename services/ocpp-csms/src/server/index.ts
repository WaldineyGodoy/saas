// Servidor OCPP 1.6-J do CSMS: handshake com auth, mapa de conexoes, trilha de frames e handlers.
// A Tarefa 6 usa `clientes` (ocpp_id -> cliente conectado) para despachar comandos e marca
// `resetAceito` quando um Reset e aceito; a Tarefa 7 liga tudo em main.ts com o repo do Supabase.
import { RPCServer } from 'ocpp-rpc';
import type { RPCClient } from 'ocpp-rpc';
import type { Repo } from '../repo/types.js';
import { criarAuth, type ModoAuth } from './auth.js';
import { registrarHandlers, type ClienteHandlers } from './handlers.js';
import { verificarOffline } from './timers.js';

export type ClienteConectado = RPCClient & { session: Record<string, unknown> };

export interface OpcoesServidor {
  repo: Repo;
  porta: number; // 0 = efemera (testes)
  host?: string;
  auth: ModoAuth;
  // periodo do verificador de offline por heartbeat (padrao 30 s)
  verificarOfflineMs?: number;
  agora?: () => Date;
  callTimeoutMs?: number;
}

export interface Servidor {
  porta: number;
  // ocpp_id -> conexao vigente
  clientes: Map<string, ClienteConectado>;
  // ocpp_id com Reset aceito aguardando o proximo Boot (a Tarefa 6 adiciona; o Boot consome)
  resetAceito: Set<string>;
  fechar(): Promise<void>;
}

type TipoFrame = 2 | 3 | 4;

export async function criarServidor(o: OpcoesServidor): Promise<Servidor> {
  const { repo } = o;
  const agora = o.agora ?? (() => new Date());
  const clientes = new Map<string, ClienteConectado>();
  const resetAceito = new Set<string>();

  const server = new RPCServer({
    protocols: ['ocpp1.6'], strictMode: true, callTimeoutMs: o.callTimeoutMs ?? 30000,
  });
  server.auth(criarAuth(repo, o.auth) as Parameters<typeof server.auth>[0]);

  server.on('client', (client: ClienteConectado) => {
    const ocppId = client.identity as string;
    const carregadorId = client.session.carregadorId as string;

    // CP-08: a nova conexao derruba a anterior. O mapa e trocado ANTES do close, para o
    // evento 'close' da antiga reconhecer que ja nao e a vigente.
    const antiga = clientes.get(ocppId);
    clientes.set(ocppId, client);
    if (antiga) antiga.close({ code: 4000, reason: 'substituida por nova conexao' }).catch(() => undefined);

    // trilha de frames; correlaciona respostas (3/4) com a acao da chamada (2) pelo unique_id
    const acoes = new Map<string, string>(); // `${direcao da chamada}:${id}` -> acao
    client.on('message', ({ message, outbound }: { message: string | Buffer; outbound: boolean }) => {
      const direcao = outbound ? 'saida' : 'entrada';
      let tipo: TipoFrame | null = null;
      let uniqueId: string | null = null;
      let acao: string | null = null;
      let payload: unknown = null;
      try {
        const f = JSON.parse(message.toString()) as unknown[];
        if (f[0] === 2 || f[0] === 3 || f[0] === 4) {
          tipo = f[0];
          uniqueId = typeof f[1] === 'string' ? f[1] : null;
          if (tipo === 2) {
            acao = typeof f[2] === 'string' ? f[2] : null;
            payload = f[3] ?? null;
            if (uniqueId && acao) acoes.set(`${direcao}:${uniqueId}`, acao);
          } else {
            const chamadaVeio = outbound ? 'entrada' : 'saida';
            const chave = `${chamadaVeio}:${uniqueId}`;
            acao = acoes.get(chave) ?? null;
            acoes.delete(chave);
            payload = tipo === 3 ? (f[2] ?? null) : { codigo: f[2], descricao: f[3], detalhes: f[4] };
          }
        } else {
          payload = { bruto: message.toString().slice(0, 2000) };
        }
      } catch {
        payload = { bruto: message.toString().slice(0, 2000) };
      }
      void repo.logMensagem({
        carregador_id: carregadorId, ocpp_id: ocppId, direcao, tipo, unique_id: uniqueId, acao, payload,
      }).catch(() => undefined);
      if (!outbound) void repo.registrarContato(carregadorId).catch(() => undefined);
    });

    registrarHandlers(client as unknown as ClienteHandlers, { repo, carregadorId, ocppId, resetAceito, agora });

    client.once('close', () => {
      if (clientes.get(ocppId) !== client) return; // ja foi substituida (CP-08)
      clientes.delete(ocppId);
      void repo.marcarOffline(carregadorId).catch(() => undefined);
    });
  });

  const http = await server.listen(o.porta, o.host);
  const addr = http.address();
  const porta = typeof addr === 'object' && addr ? addr.port : o.porta;

  const timer = setInterval(() => {
    void verificarOffline(repo, agora()).catch(() => undefined);
  }, o.verificarOfflineMs ?? 30000);
  timer.unref();

  return {
    porta, clientes, resetAceito,
    async fechar() {
      clearInterval(timer);
      await server.close({ code: 1001, reason: 'CSMS encerrando' });
      http.closeAllConnections?.();
    },
  };
}
