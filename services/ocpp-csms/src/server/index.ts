// Servidor OCPP 1.6-J do CSMS: handshake com auth, mapa de conexoes, trilha de frames e handlers.
// A Tarefa 6 usa `clientes` (ocpp_id -> cliente conectado) para despachar comandos e marca
// `resetAceito` quando um Reset e aceito; a Tarefa 7 liga tudo em main.ts com o repo do Supabase.
import { RPCServer } from 'ocpp-rpc';
import type { RPCClient } from 'ocpp-rpc';
import type { Repo } from '../repo/types.js';
import { criarAuth, type ModoAuth, type OnErro } from './auth.js';
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
  // falhas de trilha/offline nunca derrubam a conexao, mas sao reportadas aqui (padrao: console.error)
  onErro?: OnErro;
}

export interface Servidor {
  porta: number;
  // ocpp_id -> conexao vigente
  clientes: Map<string, ClienteConectado>;
  // ocpp_id com Reset aceito aguardando o proximo Boot (a Tarefa 6 adiciona; o Boot consome)
  resetAceito: Set<string>;
  // avisa quando um carregador (re)conecta nesta instancia; devolve o cancelamento
  // ocpp_id -> conectores que ja mandaram StatusNotification na conexao vigente (status fresco)
  statusFresco: Map<string, Set<number>>;
  aoConectar(cb: (ocppId: string) => void): () => void;
  fechar(): Promise<void>;
}

type TipoFrame = 2 | 3 | 4;

export async function criarServidor(o: OpcoesServidor): Promise<Servidor> {
  const { repo } = o;
  const agora = o.agora ?? (() => new Date());
  const onErro: OnErro = o.onErro ?? ((ctx, err) => console.error(`[ocpp-csms] ${ctx}:`, err));
  const clientes = new Map<string, ClienteConectado>();
  const resetAceito = new Set<string>();
  const statusFresco = new Map<string, Set<number>>();
  const ouvintesConexao = new Set<(ocppId: string) => void>();

  const server = new RPCServer({
    protocols: ['ocpp1.6'], strictMode: true, callTimeoutMs: o.callTimeoutMs ?? 30000,
  });
  server.auth(criarAuth(repo, o.auth, onErro) as Parameters<typeof server.auth>[0]);

  server.on('client', (client: ClienteConectado) => {
    const ocppId = client.identity as string;
    const carregadorId = client.session.carregadorId as string;

    // CP-08: a nova conexao derruba a anterior. O mapa e trocado ANTES do close, para o
    // evento 'close' da antiga reconhecer que ja nao e a vigente.
    const antiga = clientes.get(ocppId);
    clientes.set(ocppId, client);
    const frescos = new Set<number>();
    statusFresco.set(ocppId, frescos);
    if (antiga) antiga.close({ code: 4000, reason: 'substituida por nova conexao' }).catch(() => undefined);

    // trilha de frames; correlaciona respostas (3/4) com a acao da chamada (2) pelo unique_id
    // Chamadas sem resposta (timeout) deixariam entradas para sempre: cada insercao descarta as vencidas.
    const acoes = new Map<string, { acao: string; em: number }>(); // `${direcao da chamada}:${id}` -> acao
    const validadeAcaoMs = (o.callTimeoutMs ?? 30000) + 60000;
    const purgarAcoes = () => {
      const limite = agora().getTime() - validadeAcaoMs;
      for (const [k, v] of acoes) if (v.em < limite) acoes.delete(k);
    };
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
            if (uniqueId && acao) {
              purgarAcoes();
              acoes.set(`${direcao}:${uniqueId}`, { acao, em: agora().getTime() });
            }
          } else {
            const chamadaVeio = outbound ? 'entrada' : 'saida';
            const chave = `${chamadaVeio}:${uniqueId}`;
            acao = acoes.get(chave)?.acao ?? null;
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
      }).catch((e) => onErro('logMensagem', e));
      if (!outbound) void repo.registrarContato(carregadorId).catch((e) => onErro('registrarContato', e));
    });

    registrarHandlers(client as unknown as ClienteHandlers, { repo, carregadorId, ocppId, resetAceito, agora, aoStatus: (n) => { frescos.add(n); } });
    for (const cb of ouvintesConexao) {
      try { cb(ocppId); } catch (e) { onErro('aoConectar', e); }
    }

    client.once('close', () => {
      acoes.clear();
      if (clientes.get(ocppId) !== client) return; // ja foi substituida (CP-08)
      clientes.delete(ocppId);
      statusFresco.delete(ocppId);
      void repo.marcarOffline(carregadorId).catch((e) => onErro('marcarOffline', e));
    });
  });

  const http = await server.listen(o.porta, o.host);
  // O ocpp-rpc responde 404 a tudo que nao e upgrade; aqui entra so o GET /health (sonda do orquestrador).
  http.removeAllListeners('request');
  http.on('request', (req, res) => {
    const caminho = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && caminho === '/health') {
      const corpo = JSON.stringify({ status: 'ok', carregadores_conectados: clientes.size });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) });
      res.end(corpo);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const addr = http.address();
  const porta = typeof addr === 'object' && addr ? addr.port : o.porta;

  const timer = setInterval(() => {
    void verificarOffline(repo, agora(), onErro).catch((e) => onErro('verificarOffline', e));
  }, o.verificarOfflineMs ?? 30000);
  timer.unref();

  return {
    porta, clientes, resetAceito, statusFresco,
    aoConectar(cb) {
      ouvintesConexao.add(cb);
      return () => { ouvintesConexao.delete(cb); };
    },
    async fechar() {
      clearInterval(timer);
      await server.close({ code: 1001, reason: 'CSMS encerrando' });
      http.closeAllConnections?.();
    },
  };
}
