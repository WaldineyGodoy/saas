// Fila de comandos CSMS -> carregador (L3a, spec 5.3). `criarFila(...).processar()` e idempotente e
// pode ser disparado de qualquer lugar: evento do repo (Realtime), (re)conexao do carregador e
// varredura periodica. A trava `pendente -> enviado` no repo impede dois envios do mesmo comando.
import { RPCError, TimeoutError } from 'ocpp-rpc';
import { proximoAtrasoMs } from '../domain/backoff.js';
import type { Comando, Repo } from '../repo/types.js';
import { falharRecargaDoComando, reconciliarEstornos } from './efeitos.js';
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
  // um comando `enviado` ha mais que callTimeoutMs + esta margem (padrao 30 s) e tratado como tentativa perdida
  margemEnviadoMs?: number;
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
  const margemEnviadoMs = o.margemEnviadoMs ?? 30000;
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

  // tentativa perdida (timeout, conexao caida, ou `enviado` esquecido): reagenda com backoff ou expira.
  // Com `guarda` (atualizado_em lido), so age se o comando continua `enviado` e inalterado: duas instancias nao agem juntas.
  async function reagendarOuExpirar(cmd: Comando, motivo: string, guarda?: string) {
    const tentativas = cmd.tentativas + 1;
    const atraso = backoff(tentativas);
    const agoraMs = agora().getTime();
    const expira = atraso === null || new Date(cmd.expira_em).getTime() <= agoraMs + atraso;
    const patch = expira
      ? { status: 'expirado' as const, tentativas, erro: `${motivo}; sem mais tentativas` }
      : {
        status: 'pendente' as const, tentativas, erro: motivo,
        proxima_tentativa_em: new Date(agoraMs + (atraso as number)).toISOString(),
      };
    const c = guarda === undefined
      ? await repo.atualizarComando(cmd.id, patch)
      : await repo.atualizarComandoSe(cmd.id, { status: 'enviado', atualizado_em: guarda }, patch);
    if (c && expira) await falharRecargaDoComando(repo, c, 'RemoteStart expirado', agora());
  }

  async function recuperarEnviados(): Promise<void> {
    const limite = new Date(agora().getTime() - callTimeoutMs - margemEnviadoMs).toISOString();
    for (const cmd of await repo.listarComandosEnviadosAntigos(limite)) {
      await reagendarOuExpirar(cmd, 'tentativa perdida (sem resultado gravado)', cmd.atualizado_em);
    }
  }

  // O status do conector so vale se chegou numa StatusNotification desta conexao; antes disso
  // (reconexao, ainda sem Boot/Status) o RemoteStart espera pendente em vez de ser julgado por dado velho.
  function statusFresco(ocppId: string, cmd: Comando): boolean {
    if (cmd.acao !== 'RemoteStartTransaction' || typeof cmd.payload.connectorId !== 'number') return true;
    return servidor.statusFresco.get(ocppId)?.has(cmd.payload.connectorId) ?? false;
  }

  async function enviar(cmd: Comando, ocppId: string): Promise<void> {
    const cliente = servidor.clientes.get(ocppId);
    if (!cliente || cliente.state !== OPEN) return;
    if (!statusFresco(ocppId, cmd)) return; // segue pendente ate o status chegar (ou expirar)
    const travado = await repo.reivindicarComando(cmd.id);
    if (!travado) return; // outra rodada/instancia pegou
    const recusa = await motivoDeRecusa(travado);
    if (recusa) return concluir(travado, 'rejeitado', { erro: recusa });

    // So a chamada esta no try: falha do repo ao gravar o resultado NAO e "chamada perdida"
    // (nao reenvia nem reseta um status terminal); o comando fica `enviado` e a varredura o recupera.
    let resposta: { status?: unknown } | null;
    try {
      resposta = await cliente.call(travado.acao, travado.payload, { callTimeoutMs }) as { status?: unknown } | null;
    } catch (e) {
      if (e instanceof TimeoutError) return reagendarOuExpirar(travado, `sem resposta em ${callTimeoutMs} ms`);
      if (e instanceof RPCError) return concluir(travado, 'erro', { erro: `${e.rpcErrorCode ?? e.name}: ${e.message}` });
      // conexao caiu no meio da chamada (ou falha local): trata como tentativa perdida
      return reagendarOuExpirar(travado, (e as Error).message ?? String(e));
    }
    const status = resposta && typeof resposta === 'object' ? resposta.status : undefined;
    if (typeof status === 'string' && REJEICOES.has(status)) {
      return concluir(travado, 'rejeitado', { resposta, erro: `carregador respondeu ${status}` });
    }
    if (travado.acao === 'Reset' && status === 'Accepted') servidor.resetAceito.add(ocppId);
    return concluir(travado, 'aceito', { resposta });
  }

  async function ciclo(): Promise<void> {
    if (parado) return;
    const t = agora();
    try { await expirarComandos(repo, t); } catch (e) { onErro('expirarComandos', e); }
    try { await recuperarEnviados(); } catch (e) { onErro('recuperarEnviados', e); }
    try { await reconciliarEstornos(repo); } catch (e) { onErro('reconciliarEstornos', e); }
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
