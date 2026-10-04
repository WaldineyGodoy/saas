// Fila de comandos CSMS -> carregador (L3a, spec 5.3). `criarFila(...).processar()` e idempotente e
// pode ser disparado de qualquer lugar: evento do repo (Realtime), (re)conexao do carregador e
// varredura periodica. A trava `pendente -> enviado` no repo impede dois envios do mesmo comando.
import { RPCError, TimeoutError } from 'ocpp-rpc';
import { proximoAtrasoMs } from '../domain/backoff.js';
import type { Comando, Repo } from '../repo/types.js';
import { falharRecargaDoComando } from './efeitos.js';
import type { Servidor } from './index.js';
import { cancelarStartingSemPlug, expirarComandos } from './timers.js';

export interface OpcoesFila {
  repo: Repo;
  servidor: Servidor;
  agora?: () => Date;
  // espera pela resposta do carregador (padrao 30 s; nunca fecha o socket por timeout)
  callTimeoutMs?: number;
  // atraso antes de reenviar apos o n-esimo timeout (padrao 2/4/8 s; null = desiste e expira)
  backoff?: (tentativa: number) => number | null;
  // varredura de seguranca (padrao 5 s)
  varreduraMs?: number;
  // RC-03 (padrao 120 s)
  connectionTimeoutS?: number;
  onErro?: (contexto: string, err: unknown) => void;
}

export interface Fila {
  // um ciclo: expira vencidos, cancela starting sem plug e envia os pendentes dos carregadores conectados
  processar(): Promise<void>;
  // para varredura e assinaturas (nao fecha conexoes)
  parar(): void;
}

const OPEN = 1; // WebSocket.OPEN
const REJEICOES = new Set(['Rejected', 'NotSupported', 'UnlockFailed']);
const CONECTOR_LIVRE = new Set(['Available', 'Preparing']);

export function criarFila(o: OpcoesFila): Fila {
  const { repo, servidor } = o;
  const agora = o.agora ?? (() => new Date());
  const callTimeoutMs = o.callTimeoutMs ?? 30000;
  const backoff = o.backoff ?? proximoAtrasoMs;
  const connectionTimeoutS = o.connectionTimeoutS ?? 120;
  const onErro = o.onErro ?? ((ctx, err) => console.error(`[ocpp-csms] ${ctx}:`, err));
  let parado = false;

  async function motivoDeRecusa(cmd: Comando): Promise<string | null> {
    if (cmd.acao !== 'RemoteStartTransaction') return null;
    const connectorId = cmd.payload.connectorId;
    if (typeof connectorId !== 'number') return null;
    const conector = await repo.buscarConector(cmd.carregador_id, connectorId);
    if (!conector) return `conector ${connectorId} desconhecido`;
    if (conector.bloqueado_ate_reset) return `conector ${connectorId} bloqueado ate Reset`;
    if (!CONECTOR_LIVRE.has(conector.status)) return `conector ${connectorId} em ${conector.status} (esperado Available/Preparing)`;
    return null;
  }

  async function concluir(cmd: Comando, status: 'aceito' | 'rejeitado' | 'erro', extra: { resposta?: unknown; erro?: string }) {
    const c = await repo.atualizarComando(cmd.id, { status, ...extra });
    if (status === 'aceito') {
      // RemoteStart aceito: paid -> starting (guardado: se o StartTransaction ja chegou, nada a fazer)
      if (c.acao === 'RemoteStartTransaction' && c.recarga_id) {
        await repo.atualizarRecarga(c.recarga_id, { status: 'starting' }, 'paid');
      }
      return;
    }
    await falharRecargaDoComando(repo, c, `RemoteStart ${status}`, agora());
  }

  // timeout ou queda da conexao: reagenda com backoff ou expira
  async function reagendarOuExpirar(cmd: Comando, motivo: string) {
    const tentativas = cmd.tentativas + 1;
    const atraso = backoff(tentativas);
    const agoraMs = agora().getTime();
    if (atraso === null || new Date(cmd.expira_em).getTime() <= agoraMs + atraso) {
      const c = await repo.atualizarComando(cmd.id, { status: 'expirado', tentativas, erro: `${motivo}; sem mais tentativas` });
      await falharRecargaDoComando(repo, c, 'RemoteStart expirado', agora());
      return;
    }
    await repo.atualizarComando(cmd.id, {
      status: 'pendente', tentativas, erro: motivo,
      proxima_tentativa_em: new Date(agoraMs + atraso).toISOString(),
    });
  }

  async function enviar(cmd: Comando, ocppId: string): Promise<void> {
    const cliente = servidor.clientes.get(ocppId);
    if (!cliente || cliente.state !== OPEN) return;
    const travado = await repo.reivindicarComando(cmd.id);
    if (!travado) return; // outra rodada/instancia pegou
    const recusa = await motivoDeRecusa(travado);
    if (recusa) return concluir(travado, 'rejeitado', { erro: recusa });
    try {
      const resposta = await cliente.call(travado.acao, travado.payload, { callTimeoutMs }) as { status?: unknown } | null;
      const status = resposta && typeof resposta === 'object' ? resposta.status : undefined;
      if (typeof status === 'string' && REJEICOES.has(status)) {
        return await concluir(travado, 'rejeitado', { resposta, erro: `carregador respondeu ${status}` });
      }
      if (travado.acao === 'Reset' && status === 'Accepted') servidor.resetAceito.add(ocppId);
      return await concluir(travado, 'aceito', { resposta });
    } catch (e) {
      if (e instanceof TimeoutError) return reagendarOuExpirar(travado, `sem resposta em ${callTimeoutMs} ms`);
      if (e instanceof RPCError) return concluir(travado, 'erro', { erro: `${e.rpcErrorCode ?? e.name}: ${e.message}` });
      // conexao caiu no meio da chamada (ou falha local): trata como tentativa perdida
      return reagendarOuExpirar(travado, (e as Error).message ?? String(e));
    }
  }

  async function ciclo(): Promise<void> {
    if (parado) return;
    const t = agora();
    try { await expirarComandos(repo, t); } catch (e) { onErro('expirarComandos', e); }
    try { await cancelarStartingSemPlug(repo, t, connectionTimeoutS); } catch (e) { onErro('cancelarStartingSemPlug', e); }

    const conectados = [...servidor.clientes.keys()];
    if (conectados.length === 0) return;
    const idParaOcpp = new Map<string, string>();
    for (const ocppId of conectados) {
      const cp = await repo.buscarCarregador(ocppId);
      if (cp) idParaOcpp.set(cp.id, ocppId);
    }
    const pendentes = await repo.proximosComandos(conectados);
    // por carregador em ordem; carregadores diferentes em paralelo
    const porCarregador = new Map<string, Comando[]>();
    for (const cmd of pendentes) {
      const lista = porCarregador.get(cmd.carregador_id) ?? [];
      lista.push(cmd);
      porCarregador.set(cmd.carregador_id, lista);
    }
    await Promise.all([...porCarregador].map(async ([carregadorId, lista]) => {
      const ocppId = idParaOcpp.get(carregadorId);
      if (!ocppId) return;
      for (const cmd of lista) {
        try { await enviar(cmd, ocppId); } catch (e) { onErro(`comando ${cmd.id} (${cmd.acao})`, e); }
      }
    }));
  }

  // Ciclos disparados em paralelo (evento, conexao, varredura) travam comandos diferentes; processar()
  // so resolve quando todos os que estao em voo terminam (quem chama enxerga o resultado final).
  const emVoo = new Set<Promise<void>>();
  async function processar(): Promise<void> {
    const p = ciclo().finally(() => { emVoo.delete(p); });
    emVoo.add(p);
    while (emVoo.size > 0) await Promise.allSettled([...emVoo]);
    await p;
  }

  const disparar = () => { void processar().catch((e) => onErro('processar', e)); };
  const timer = setInterval(disparar, o.varreduraMs ?? 5000);
  timer.unref();
  const cancelarConexao = servidor.aoConectar(disparar);
  const cancelarRepo = repo.assinarComandos?.(disparar);

  return {
    processar,
    parar() {
      parado = true;
      clearInterval(timer);
      cancelarConexao();
      cancelarRepo?.();
    },
  };
}
