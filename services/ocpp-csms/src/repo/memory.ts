// Repo em memoria com as mesmas regras de unicidade e transicao do banco
// (supabase/migrations/20261004b_ocpp_estrutura.sql). Usado pelos testes L1/L3a.
import { randomUUID } from 'node:crypto';
import { META_ESTORNO_PENDENTE } from './types.js';
import { transicaoValida } from '../domain/recarga.js';
import type {
  Alerta, Carregador, Comando, ComandoPatch, Conector, ConectorPatch, DadosBoot, FimTransacao, IdTag,
  Medicao, Mensagem, NovaMedicao, NovaTransacao, NovoComando, Recarga, RecargaPatch,
  RecargaStatus, Repo, StatusComando, Transacao,
} from './types.js';

const EXPIRA_COMANDO_MS = 2 * 60 * 1000;

export class MemoryRepo implements Repo {
  carregadores: Carregador[] = [];
  conectores: Conector[] = [];
  idTags: IdTag[] = [];
  recargas: Recarga[] = [];
  transacoes: Transacao[] = [];
  medicoes: Medicao[] = [];
  comandos: Comando[] = [];
  mensagens: Mensagem[] = [];
  alertas: Alerta[] = [];
  estornos: { recarga_id: string; valor: number; motivo: string }[] = [];
  private proximaTransacao = 1;
  private ouvintesComandos = new Set<() => void>();
  private agora: () => Date;

  constructor(opts: { agora?: () => Date } = {}) {
    this.agora = opts.agora ?? (() => new Date());
  }

  private iso = (): string => this.agora().toISOString();

  // --- semeadura (o app/Edge Function faz isso no banco real) ---

  semearCarregador(p: { ocppId: string } & Partial<Carregador>): Carregador {
    if (this.carregadores.some((c) => c.ocpp_id === p.ocppId)) {
      throw new Error(`violacao de unicidade: ocpp_id ${p.ocppId}`);
    }
    const { ocppId, ...resto } = p;
    const c: Carregador = {
      id: randomUUID(), eletroposto_id: randomUUID(), ocpp_id: ocppId, senha_hash: null,
      vendor: null, modelo: null, serial: null, firmware: null, heartbeat_intervalo_s: 60,
      online: false, ultimo_boot_em: null, ultimo_contato_em: null, estado_registro: 'pendente',
      ...resto,
    };
    this.carregadores.push(c);
    return c;
  }

  semearIdTag(p: Partial<IdTag> & { id_tag: string }): IdTag {
    if (p.id_tag.length < 1 || p.id_tag.length > 20) throw new Error('id_tag deve ter de 1 a 20 caracteres');
    if (this.idTags.some((t) => t.id_tag === p.id_tag)) throw new Error('violacao de unicidade: id_tag');
    const t: IdTag = { recarga_id: null, status: 'Accepted', expira_em: null, usado_em: null, ...p };
    this.idTags.push(t);
    return t;
  }

  semearRecarga(p: Partial<Recarga> = {}): Recarga {
    const r: Recarga = {
      id: randomUUID(), eletroposto_id: randomUUID(), status: 'pending_payment', valor: 0, tarifa_kwh_aplicada: 0,
      ocpp_id_tag: null, ocpp_transacao_id: null, kwh_limite: null, kwh_consumido: null,
      valor_final: null, valor_estornado: null, stripe_refund_id: null, iniciada_em: null,
      finalizada_em: null, motivo_fim: null, metadata: {}, ...p,
    };
    this.recargas.push(r);
    return r;
  }

  // --- carregador ---

  async buscarCarregador(ocppId: string) {
    return this.carregadores.find((c) => c.ocpp_id === ocppId) ?? null;
  }

  private carregador(id: string): Carregador {
    const c = this.carregadores.find((x) => x.id === id);
    if (!c) throw new Error(`carregador inexistente: ${id}`);
    return c;
  }

  async listarOnline() {
    return this.carregadores.filter((c) => c.online);
  }

  async registrarBoot(carregadorId: string, d: DadosBoot) {
    const c = this.carregador(carregadorId);
    const t = this.iso();
    Object.assign(c, {
      vendor: d.vendor, modelo: d.modelo, serial: d.serial ?? null, firmware: d.firmware ?? null,
      online: true, ultimo_boot_em: t, ultimo_contato_em: t, estado_registro: 'aceito',
    });
  }

  async registrarContato(carregadorId: string) {
    const c = this.carregador(carregadorId);
    c.ultimo_contato_em = this.iso();
    c.online = true;
  }

  async marcarOffline(carregadorId: string) {
    this.carregador(carregadorId).online = false;
  }

  // --- conector ---

  async buscarConector(carregadorId: string, connectorId: number) {
    return this.conectores.find((c) => c.carregador_id === carregadorId && c.connector_id === connectorId) ?? null;
  }

  async listarConectores(carregadorId: string) {
    return this.conectores.filter((c) => c.carregador_id === carregadorId);
  }

  async upsertConector(carregadorId: string, connectorId: number, patch: ConectorPatch) {
    this.carregador(carregadorId);
    if (connectorId < 0) throw new Error('connector_id deve ser >= 0');
    let c = await this.buscarConector(carregadorId, connectorId);
    if (!c) {
      c = {
        id: randomUUID(), carregador_id: carregadorId, connector_id: connectorId,
        status: 'Unavailable', error_code: 'NoError', info: null, vendor_error_code: null,
        status_em: null, bloqueado_ate_reset: false,
      };
      this.conectores.push(c);
    }
    Object.assign(c, patch);
    return c;
  }

  // --- idTag ---

  async buscarIdTag(idTag: string) {
    return this.idTags.find((t) => t.id_tag === idTag) ?? null;
  }

  async atualizarIdTag(idTag: string, patch: Partial<Omit<IdTag, 'id_tag'>>) {
    const t = await this.buscarIdTag(idTag);
    if (!t) throw new Error(`id_tag inexistente: ${idTag}`);
    Object.assign(t, patch);
  }

  // --- recarga ---

  async buscarRecarga(id: string) {
    return this.recargas.find((r) => r.id === id) ?? null;
  }

  async atualizarRecarga(id: string, patch: RecargaPatch, deStatus?: RecargaStatus) {
    const r = await this.buscarRecarga(id);
    if (!r) throw new Error(`recarga inexistente: ${id}`);
    if (deStatus !== undefined && r.status !== deStatus) return null;
    if (patch.status !== undefined && patch.status !== r.status && !transicaoValida(r.status, patch.status)) {
      throw new Error(`Transicao de status da recarga invalida: ${r.status} -> ${patch.status}.`);
    }
    Object.assign(r, patch);
    return r;
  }

  // --- transacao ---

  async buscarTransacao(id: number) {
    return this.transacoes.find((t) => t.id === id) ?? null;
  }

  async criarOuObterTransacao(chave: string, dados: NovaTransacao) {
    const existente = this.transacoes.find((t) => t.chave_idempotencia === chave);
    if (existente) return { transacao: existente, criada: false };
    this.carregador(dados.carregador_id);
    if (dados.connector_id <= 0) throw new Error('connector_id da transacao deve ser > 0');
    const t: Transacao = {
      id: this.proximaTransacao++, meter_stop_wh: null, fim_em: null, motivo_parada: null,
      chave_idempotencia: chave, ...dados,
    };
    this.transacoes.push(t);
    return { transacao: t, criada: true };
  }

  async fecharTransacao(id: number, fim: FimTransacao) {
    const t = await this.buscarTransacao(id);
    if (!t) throw new Error(`transacao inexistente: ${id}`);
    if (t.fim_em !== null) return { transacao: t, fechada: false };
    t.meter_stop_wh = fim.meter_stop_wh;
    t.fim_em = fim.fim_em;
    t.motivo_parada = fim.motivo_parada ?? null;
    return { transacao: t, fechada: true };
  }

  async buscarTransacaoPorChave(chave: string) {
    return this.transacoes.find((t) => t.chave_idempotencia === chave) ?? null;
  }

  async buscarTransacaoAberta(carregadorId: string, connectorId: number) {
    return this.transacoes.find((t) =>
      t.carregador_id === carregadorId && t.connector_id === connectorId && t.fim_em === null) ?? null;
  }

  async buscarTransacaoAbertaPorTag(idTag: string) {
    return this.transacoes.find((t) => t.id_tag === idTag && t.fim_em === null) ?? null;
  }

  // --- medicao ---

  async gravarMedicoes(novas: NovaMedicao[]) {
    let inseridas = 0;
    for (const n of novas) {
      if (!this.transacoes.some((t) => t.id === n.transacao_id)) {
        throw new Error(`violacao de FK: transacao ${n.transacao_id}`);
      }
      const m: Medicao = {
        measurand: 'Energy.Active.Import.Register', phase: '', contexto: null, ...n,
      };
      const dup = this.medicoes.some((x) =>
        x.transacao_id === m.transacao_id && new Date(x.medido_em).getTime() === new Date(m.medido_em).getTime() &&
        x.measurand === m.measurand && x.phase === m.phase);
      if (dup) continue; // on conflict do nothing
      this.medicoes.push(m);
      inseridas++;
    }
    return inseridas;
  }

  async listarMedicoes(transacaoId: number) {
    return this.medicoes.filter((m) => m.transacao_id === transacaoId);
  }

  // --- comandos ---

  async proximosComandos(ocppIds: string[]) {
    const ids = new Set(this.carregadores.filter((c) => ocppIds.includes(c.ocpp_id)).map((c) => c.id));
    const agora = this.agora().getTime();
    return this.comandos
      .filter((c) =>
        ids.has(c.carregador_id) && c.status === 'pendente' &&
        new Date(c.proxima_tentativa_em).getTime() <= agora &&
        new Date(c.expira_em).getTime() > agora)
      .sort((a, b) => new Date(a.proxima_tentativa_em).getTime() - new Date(b.proxima_tentativa_em).getTime());
  }

  async atualizarComando(id: string, patch: ComandoPatch) {
    const c = this.comandos.find((x) => x.id === id);
    if (!c) throw new Error(`comando inexistente: ${id}`);
    Object.assign(c, patch, { atualizado_em: this.iso() });
    return c;
  }

  async reivindicarComando(id: string) {
    const c = this.comandos.find((x) => x.id === id);
    if (!c || c.status !== 'pendente') return null;
    c.status = 'enviado';
    c.atualizado_em = this.iso();
    return c;
  }

  async listarComandosExpirados() {
    const agora = this.agora().getTime();
    return this.comandos.filter((c) => c.status === 'pendente' && new Date(c.expira_em).getTime() <= agora);
  }

  async atualizarComandoSe(id: string, cond: { status: StatusComando; atualizado_em?: string }, patch: ComandoPatch) {
    const c = this.comandos.find((x) => x.id === id);
    if (!c || c.status !== cond.status) return null;
    if (cond.atualizado_em !== undefined && c.atualizado_em !== cond.atualizado_em) return null;
    Object.assign(c, patch, { atualizado_em: this.iso() });
    return c;
  }

  async listarComandosEnviadosAntigos(antesDe: string) {
    const limite = new Date(antesDe).getTime();
    return this.comandos.filter((c) => c.status === 'enviado' && new Date(c.atualizado_em).getTime() < limite);
  }

  async listarRecargasComEstornoPendente() {
    return this.recargas.filter((r) =>
      (r.status === 'failed' || r.status === 'canceled') && r.metadata[META_ESTORNO_PENDENTE] === true);
  }

  async listarRecargasComPartidaAceita() {
    const saida: { recarga: Recarga; aceito_em: string }[] = [];
    for (const r of this.recargas.filter((x) => x.status === 'starting' || x.status === 'paid')) {
      const aceitos = this.comandos
        .filter((c) => c.recarga_id === r.id && c.acao === 'RemoteStartTransaction' && c.status === 'aceito')
        .map((c) => c.atualizado_em).sort();
      const aceito = aceitos[aceitos.length - 1];
      if (aceito) saida.push({ recarga: r, aceito_em: aceito });
    }
    return saida;
  }

  assinarComandos(cb: () => void) {
    this.ouvintesComandos.add(cb);
    return () => { this.ouvintesComandos.delete(cb); };
  }

  async enfileirarComando(d: NovoComando) {
    if (d.chave_idempotencia != null) {
      const existente = this.comandos.find((c) => c.chave_idempotencia === d.chave_idempotencia);
      if (existente) return { comando: existente, criado: false };
    }
    this.carregador(d.carregador_id);
    const agora = this.agora();
    const c: Comando = {
      id: randomUUID(), carregador_id: d.carregador_id, acao: d.acao, payload: d.payload ?? {},
      status: 'pendente', tentativas: 0,
      proxima_tentativa_em: d.proxima_tentativa_em ?? agora.toISOString(),
      expira_em: d.expira_em ?? new Date(agora.getTime() + EXPIRA_COMANDO_MS).toISOString(),
      resposta: null, erro: null, recarga_id: d.recarga_id ?? null,
      chave_idempotencia: d.chave_idempotencia ?? null, atualizado_em: agora.toISOString(),
    };
    this.comandos.push(c);
    for (const cb of this.ouvintesComandos) cb();
    return { comando: c, criado: true };
  }

  // --- estorno ---

  async solicitarEstorno(recargaId: string, e: { valor: number; motivo: string }) {
    if (!this.recargas.some((r) => r.id === recargaId)) throw new Error(`recarga inexistente: ${recargaId}`);
    if (!(e.valor > 0)) throw new Error('valor do estorno deve ser maior que zero');
    if (this.estornos.some((x) => x.recarga_id === recargaId)) return;
    this.estornos.push({ recarga_id: recargaId, ...e });
  }

  // --- alerta ---

  async alertar(a: Alerta) {
    this.carregador(a.carregador_id);
    this.alertas.push(a);
  }

  // --- trilha ---

  async logMensagem(m: Mensagem) {
    this.mensagens.push(m);
  }
}
