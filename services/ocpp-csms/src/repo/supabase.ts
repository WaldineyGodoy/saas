// Repo sobre o Supabase (service role: ignora RLS). Schema em
// supabase/migrations/20261004b_ocpp_estrutura.sql; recargas em public.recargas_eletroposto.
//
// Regras que este arquivo garante (o MemoryRepo e o teste de contrato espelham todas):
//  * Transicao guardada = UM UPDATE condicional (`update ... where id = ? and status = ?` + `returning`),
//    nunca ler e depois gravar: atualizarRecarga, reivindicarComando, atualizarComandoSe, fecharTransacao.
//  * Datas voltam do PostgREST como texto ISO 8601 com precisao de microssegundos e sao devolvidas SEM
//    reformatar. `atualizado_em` (updated_at) e usado como guarda de versao: o valor lido e comparado
//    por igualdade exata; passar por Date perderia os microssegundos e a guarda nunca casaria.
//  * `metadata` de recarga e mesclado por chave. PostgREST nao tem merge de jsonb no UPDATE, entao o
//    merge e uma troca otimista (le metadata + updated_at, grava com `where updated_at = <lido>`, repete
//    se outra escrita passou no meio). Quem chama manda so as chaves que quer mudar.
//  * Contrato do estorno (solicitarEstorno): `supabase.functions.invoke('refund-charging',
//    { body: { recarga_id, valor_centavos, motivo } })` com a service role. A Edge Function (Tarefa 9) e
//    idempotente por recarga: `idempotencyKey: 'refund:<recarga_id>'` na Stripe e checagem de
//    `stripe_refund_id`. Resposta nao-2xx ou `error` LANCA: quem chama depende de lancar para tentar de novo.
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Alerta, Carregador, Comando, ComandoPatch, Conector, ConectorPatch, DadosBoot, FimTransacao, IdTag,
  Medicao, Mensagem, NovaMedicao, NovaTransacao, NovoComando, Recarga, RecargaPatch, RecargaStatus,
  Repo, StatusComando, Transacao,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Linha = Record<string, any>;
type ErroPg = { message: string; code?: string } | null;

const EXPIRA_COMANDO_MS = 2 * 60 * 1000;
const MEDICAO_PADRAO = 'Energy.Active.Import.Register';
const TENTATIVAS_METADATA = 8;
const STATUS_REARMAVEIS: StatusComando[] = ['expirado', 'rejeitado', 'erro'];

const COLS_CARREGADOR = 'id,eletroposto_id,ocpp_id,senha_hash,vendor,modelo,serial,firmware,heartbeat_intervalo_s,online,ultimo_boot_em,ultimo_contato_em,estado_registro';
const COLS_CONECTOR = 'id,carregador_id,connector_id,status,error_code,info,vendor_error_code,status_em,bloqueado_ate_reset';
const COLS_ID_TAG = 'id_tag,recarga_id,status,expira_em,usado_em';
const COLS_RECARGA = 'id,eletroposto_id,status,valor,tarifa_kwh_aplicada,ocpp_id_tag,ocpp_transacao_id,kwh_limite,kwh_consumido,valor_final,valor_estornado,stripe_refund_id,iniciada_em,finalizada_em,motivo_fim,metadata,updated_at';
const COLS_TRANSACAO = 'id,carregador_id,connector_id,recarga_id,id_tag,meter_start_wh,meter_stop_wh,inicio_em,fim_em,motivo_parada,chave_idempotencia';
const COLS_MEDICAO = 'transacao_id,connector_id,medido_em,measurand,phase,valor,unidade,contexto';
const COLS_COMANDO = 'id,carregador_id,acao,payload,status,tentativas,proxima_tentativa_em,expira_em,resposta,erro,recarga_id,chave_idempotencia,updated_at';

const T = {
  carregadores: 'eletroposto_carregadores', conectores: 'eletroposto_conectores', idTags: 'ocpp_id_tags',
  recargas: 'recargas_eletroposto', transacoes: 'ocpp_transacoes', medicoes: 'ocpp_medicoes',
  comandos: 'ocpp_comandos', mensagens: 'ocpp_mensagens', notificacoes: 'notification_logs',
} as const;

function falha(contexto: string, e: NonNullable<ErroPg>): Error {
  const err = new Error(`${contexto}: ${e.message}`) as Error & { code?: string };
  err.code = e.code;
  return err;
}

function ok<D>(contexto: string, r: { data: D; error: ErroPg }): D {
  if (r.error) throw falha(contexto, r.error);
  return r.data;
}

const mapCarregador = (r: Linha): Carregador => ({
  id: r.id, eletroposto_id: r.eletroposto_id, ocpp_id: r.ocpp_id, senha_hash: r.senha_hash ?? null,
  vendor: r.vendor ?? null, modelo: r.modelo ?? null, serial: r.serial ?? null, firmware: r.firmware ?? null,
  heartbeat_intervalo_s: r.heartbeat_intervalo_s, online: r.online, ultimo_boot_em: r.ultimo_boot_em ?? null,
  ultimo_contato_em: r.ultimo_contato_em ?? null, estado_registro: r.estado_registro,
});

const mapConector = (r: Linha): Conector => ({
  id: r.id, carregador_id: r.carregador_id, connector_id: r.connector_id, status: r.status,
  error_code: r.error_code, info: r.info ?? null, vendor_error_code: r.vendor_error_code ?? null,
  status_em: r.status_em ?? null, bloqueado_ate_reset: r.bloqueado_ate_reset,
});

const mapIdTag = (r: Linha): IdTag => ({
  id_tag: r.id_tag, recarga_id: r.recarga_id ?? null, status: r.status,
  expira_em: r.expira_em ?? null, usado_em: r.usado_em ?? null,
});

const mapRecarga = (r: Linha): Recarga => ({
  id: r.id, eletroposto_id: r.eletroposto_id, status: r.status, valor: r.valor,
  tarifa_kwh_aplicada: r.tarifa_kwh_aplicada ?? 0, ocpp_id_tag: r.ocpp_id_tag ?? null,
  ocpp_transacao_id: r.ocpp_transacao_id ?? null, kwh_limite: r.kwh_limite ?? null,
  kwh_consumido: r.kwh_consumido ?? null, valor_final: r.valor_final ?? null,
  valor_estornado: r.valor_estornado ?? null, stripe_refund_id: r.stripe_refund_id ?? null,
  iniciada_em: r.iniciada_em ?? null, finalizada_em: r.finalizada_em ?? null, motivo_fim: r.motivo_fim ?? null,
  metadata: r.metadata ?? {},
});

const mapTransacao = (r: Linha): Transacao => ({
  id: r.id, carregador_id: r.carregador_id, connector_id: r.connector_id, recarga_id: r.recarga_id ?? null,
  id_tag: r.id_tag, meter_start_wh: r.meter_start_wh, meter_stop_wh: r.meter_stop_wh ?? null,
  inicio_em: r.inicio_em, fim_em: r.fim_em ?? null, motivo_parada: r.motivo_parada ?? null,
  chave_idempotencia: r.chave_idempotencia,
});

const mapMedicao = (r: Linha): Medicao => ({
  transacao_id: r.transacao_id, connector_id: r.connector_id, medido_em: r.medido_em, measurand: r.measurand,
  phase: r.phase, valor: r.valor, unidade: r.unidade, contexto: r.contexto ?? null,
});

const mapComando = (r: Linha): Comando => ({
  id: r.id, carregador_id: r.carregador_id, acao: r.acao, payload: r.payload ?? {}, status: r.status,
  tentativas: r.tentativas, proxima_tentativa_em: r.proxima_tentativa_em, expira_em: r.expira_em,
  resposta: r.resposta ?? null, erro: r.erro ?? null, recarga_id: r.recarga_id ?? null,
  chave_idempotencia: r.chave_idempotencia ?? null, atualizado_em: r.updated_at,
});

export interface OpcoesSupabaseRepo {
  agora?: () => Date;
  // chama uma Edge Function com a service role; lanca em qualquer falha (padrao: supabase.functions.invoke)
  invocarFuncao?: (nome: string, body: Record<string, unknown>) => Promise<void>;
  // falhas assincronas (Realtime) que nao tem quem receba o erro
  onErro?: (contexto: string, err: unknown) => void;
}

export class SupabaseRepo implements Repo {
  private agora: () => Date;
  private invocarFuncao: (nome: string, body: Record<string, unknown>) => Promise<void>;
  private onErro: (contexto: string, err: unknown) => void;

  constructor(private c: SupabaseClient, opts: OpcoesSupabaseRepo = {}) {
    this.agora = opts.agora ?? (() => new Date());
    this.onErro = opts.onErro ?? ((ctx, err) => console.error(`[ocpp-csms] ${ctx}:`, err));
    this.invocarFuncao = opts.invocarFuncao ?? (async (nome, body) => {
      const { data, error } = await this.c.functions.invoke(nome, { body });
      if (error) throw new Error(`${nome} falhou: ${error.message}`);
      const corpo = data as { error?: unknown } | null;
      if (corpo && typeof corpo === 'object' && corpo.error) throw new Error(`${nome} falhou: ${String(corpo.error)}`);
    });
  }

  // encerra as assinaturas Realtime (shutdown)
  async fechar(): Promise<void> {
    await this.c.removeAllChannels();
  }

  private iso = (): string => this.agora().toISOString();

  // --- carregador ---

  async listarOnline() {
    const r = ok('listarOnline', await this.c.from(T.carregadores).select(COLS_CARREGADOR).eq('online', true));
    return (r as Linha[]).map(mapCarregador);
  }

  async buscarCarregador(ocppId: string) {
    const r = ok('buscarCarregador', await this.c.from(T.carregadores).select(COLS_CARREGADOR).eq('ocpp_id', ocppId).maybeSingle());
    return r ? mapCarregador(r as Linha) : null;
  }

  private async atualizarCarregador(id: string, patch: Linha, ctx: string) {
    const r = ok(ctx, await this.c.from(T.carregadores).update(patch).eq('id', id).select('id')) as Linha[];
    if (r.length === 0) throw new Error(`carregador inexistente: ${id}`);
  }

  async registrarBoot(carregadorId: string, d: DadosBoot) {
    const t = this.iso();
    await this.atualizarCarregador(carregadorId, {
      vendor: d.vendor, modelo: d.modelo, serial: d.serial ?? null, firmware: d.firmware ?? null,
      online: true, ultimo_boot_em: t, ultimo_contato_em: t, estado_registro: 'aceito',
    }, 'registrarBoot');
  }

  async registrarContato(carregadorId: string) {
    await this.atualizarCarregador(carregadorId, { ultimo_contato_em: this.iso(), online: true }, 'registrarContato');
  }

  async marcarOffline(carregadorId: string) {
    await this.atualizarCarregador(carregadorId, { online: false }, 'marcarOffline');
  }

  // --- conector ---

  async buscarConector(carregadorId: string, connectorId: number) {
    const r = ok('buscarConector', await this.c.from(T.conectores).select(COLS_CONECTOR)
      .eq('carregador_id', carregadorId).eq('connector_id', connectorId).maybeSingle());
    return r ? mapConector(r as Linha) : null;
  }

  async listarConectores(carregadorId: string) {
    const r = ok('listarConectores', await this.c.from(T.conectores).select(COLS_CONECTOR)
      .eq('carregador_id', carregadorId).order('connector_id'));
    return (r as Linha[]).map(mapConector);
  }

  async upsertConector(carregadorId: string, connectorId: number, patch: ConectorPatch) {
    const r = ok('upsertConector', await this.c.from(T.conectores)
      .upsert({ ...patch, carregador_id: carregadorId, connector_id: connectorId }, { onConflict: 'carregador_id,connector_id' })
      .select(COLS_CONECTOR).single());
    return mapConector(r as Linha);
  }

  // --- idTag ---

  async buscarIdTag(idTag: string) {
    const r = ok('buscarIdTag', await this.c.from(T.idTags).select(COLS_ID_TAG).eq('id_tag', idTag).maybeSingle());
    return r ? mapIdTag(r as Linha) : null;
  }

  async atualizarIdTag(idTag: string, patch: Partial<Omit<IdTag, 'id_tag'>>) {
    const r = ok('atualizarIdTag', await this.c.from(T.idTags).update(patch).eq('id_tag', idTag).select('id_tag')) as Linha[];
    if (r.length === 0) throw new Error(`id_tag inexistente: ${idTag}`);
  }

  // --- recarga ---

  async buscarRecarga(id: string) {
    const r = await this.lerRecarga(id);
    return r ? mapRecarga(r) : null;
  }

  private async lerRecarga(id: string): Promise<Linha | null> {
    return ok('buscarRecarga', await this.c.from(T.recargas).select(COLS_RECARGA).eq('id', id).maybeSingle()) as Linha | null;
  }

  async atualizarRecarga(id: string, patch: RecargaPatch, deStatus?: RecargaStatus): Promise<Recarga | null> {
    const { metadata, ...resto } = patch;
    for (let tentativa = 0; tentativa < TENTATIVAS_METADATA; tentativa++) {
      const corpo: Linha = { ...resto };
      let versao: string | undefined;
      if (metadata !== undefined) {
        // merge por troca otimista (ver cabecalho): a gravacao so vale se updated_at e o que lemos agora
        const atual = await this.lerRecarga(id);
        if (!atual) throw new Error(`recarga inexistente: ${id}`);
        if (deStatus !== undefined && atual.status !== deStatus) return null;
        corpo.metadata = { ...(atual.metadata ?? {}), ...metadata };
        versao = atual.updated_at;
      }
      if (Object.keys(corpo).length === 0) {
        const atual = await this.lerRecarga(id);
        if (!atual) throw new Error(`recarga inexistente: ${id}`);
        return deStatus !== undefined && atual.status !== deStatus ? null : mapRecarga(atual);
      }
      let q = this.c.from(T.recargas).update(corpo).eq('id', id);
      if (deStatus !== undefined) q = q.eq('status', deStatus);
      if (versao !== undefined) q = q.eq('updated_at', versao);
      const linhas = ok('atualizarRecarga', await q.select(COLS_RECARGA)) as Linha[];
      if (linhas[0]) return mapRecarga(linhas[0]);
      // nenhuma linha: recarga inexistente, status diferente da guarda ou (so com metadata) versao trocada
      const atual = await this.lerRecarga(id);
      if (!atual) throw new Error(`recarga inexistente: ${id}`);
      if (deStatus !== undefined && atual.status !== deStatus) return null;
      if (versao === undefined) throw new Error(`atualizarRecarga: nenhuma linha atualizada para ${id}`);
    }
    throw new Error(`atualizarRecarga: conflito de versao persistente em ${id}`);
  }

  // --- transacao ---

  async buscarTransacao(id: number) {
    const r = ok('buscarTransacao', await this.c.from(T.transacoes).select(COLS_TRANSACAO).eq('id', id).maybeSingle());
    return r ? mapTransacao(r as Linha) : null;
  }

  async buscarTransacaoPorChave(chave: string) {
    const r = ok('buscarTransacaoPorChave', await this.c.from(T.transacoes).select(COLS_TRANSACAO)
      .eq('chave_idempotencia', chave).maybeSingle());
    return r ? mapTransacao(r as Linha) : null;
  }

  async criarOuObterTransacao(chave: string, d: NovaTransacao) {
    // caminho rapido (evita gastar id da sequencia na retransmissao); quem decide e o unique da chave
    const existente = await this.buscarTransacaoPorChave(chave);
    if (existente) return { transacao: existente, criada: false };
    const { data, error } = await this.c.from(T.transacoes).insert({
      carregador_id: d.carregador_id, connector_id: d.connector_id, recarga_id: d.recarga_id,
      id_tag: d.id_tag, meter_start_wh: d.meter_start_wh, inicio_em: d.inicio_em, chave_idempotencia: chave,
    }).select(COLS_TRANSACAO).single();
    if (error) {
      if (error.code === '23505') {
        const outra = await this.buscarTransacaoPorChave(chave);
        if (outra) return { transacao: outra, criada: false };
      }
      throw falha('criarOuObterTransacao', error);
    }
    return { transacao: mapTransacao(data as Linha), criada: true };
  }

  async fecharTransacao(id: number, fim: FimTransacao) {
    // atomico: so a primeira chamada acha `fim_em is null`
    const r = ok('fecharTransacao', await this.c.from(T.transacoes)
      .update({ meter_stop_wh: fim.meter_stop_wh, fim_em: fim.fim_em, motivo_parada: fim.motivo_parada ?? null })
      .eq('id', id).is('fim_em', null).select(COLS_TRANSACAO)) as Linha[];
    if (r[0]) return { transacao: mapTransacao(r[0]), fechada: true };
    const atual = await this.buscarTransacao(id);
    if (!atual) throw new Error(`transacao inexistente: ${id}`);
    return { transacao: atual, fechada: false };
  }

  async buscarTransacaoAberta(carregadorId: string, connectorId: number) {
    const r = ok('buscarTransacaoAberta', await this.c.from(T.transacoes).select(COLS_TRANSACAO)
      .eq('carregador_id', carregadorId).eq('connector_id', connectorId).is('fim_em', null)
      .order('id').limit(1)) as Linha[];
    return r[0] ? mapTransacao(r[0]) : null;
  }

  async buscarTransacaoAbertaPorTag(idTag: string) {
    const r = ok('buscarTransacaoAbertaPorTag', await this.c.from(T.transacoes).select(COLS_TRANSACAO)
      .eq('id_tag', idTag).is('fim_em', null).order('id').limit(1)) as Linha[];
    return r[0] ? mapTransacao(r[0]) : null;
  }

  // --- medicao ---

  async gravarMedicoes(novas: NovaMedicao[]) {
    if (novas.length === 0) return 0;
    // todos os campos explicitos: o upsert em lote manda `null` para colunas ausentes em alguma linha
    const linhas = novas.map((n) => ({
      transacao_id: n.transacao_id, connector_id: n.connector_id, medido_em: n.medido_em,
      measurand: n.measurand ?? MEDICAO_PADRAO, phase: n.phase ?? '', valor: n.valor,
      unidade: n.unidade, contexto: n.contexto ?? null,
    }));
    // on conflict do nothing: so as linhas realmente inseridas voltam
    const r = ok('gravarMedicoes', await this.c.from(T.medicoes)
      .upsert(linhas, { onConflict: 'transacao_id,medido_em,measurand,phase', ignoreDuplicates: true })
      .select('id')) as Linha[];
    return r.length;
  }

  async listarMedicoes(transacaoId: number) {
    const r = ok('listarMedicoes', await this.c.from(T.medicoes).select(COLS_MEDICAO)
      .eq('transacao_id', transacaoId).order('id'));
    return (r as Linha[]).map(mapMedicao);
  }

  // --- comandos ---

  async proximosComandos(ocppIds: string[]) {
    if (ocppIds.length === 0) return [];
    const cps = ok('proximosComandos', await this.c.from(T.carregadores).select('id').in('ocpp_id', ocppIds)) as Linha[];
    if (cps.length === 0) return [];
    const agora = this.iso();
    const r = ok('proximosComandos', await this.c.from(T.comandos).select(COLS_COMANDO)
      .in('carregador_id', cps.map((x) => x.id)).eq('status', 'pendente')
      .lte('proxima_tentativa_em', agora).gt('expira_em', agora).order('proxima_tentativa_em'));
    return (r as Linha[]).map(mapComando);
  }

  async atualizarComando(id: string, patch: ComandoPatch) {
    const r = ok('atualizarComando', await this.c.from(T.comandos).update(patch).eq('id', id).select(COLS_COMANDO)) as Linha[];
    if (!r[0]) throw new Error(`comando inexistente: ${id}`);
    return mapComando(r[0]);
  }

  async reivindicarComando(id: string) {
    const r = ok('reivindicarComando', await this.c.from(T.comandos).update({ status: 'enviado' })
      .eq('id', id).eq('status', 'pendente').select(COLS_COMANDO)) as Linha[];
    return r[0] ? mapComando(r[0]) : null;
  }

  async listarComandosExpirados() {
    const r = ok('listarComandosExpirados', await this.c.from(T.comandos).select(COLS_COMANDO)
      .eq('status', 'pendente').lte('expira_em', this.iso()));
    return (r as Linha[]).map(mapComando);
  }

  async atualizarComandoSe(id: string, cond: { status: StatusComando; atualizado_em?: string }, patch: ComandoPatch) {
    let q = this.c.from(T.comandos).update(patch).eq('id', id).eq('status', cond.status);
    // valor exato lido do banco (microssegundos): igualdade textual do timestamptz
    if (cond.atualizado_em !== undefined) q = q.eq('updated_at', cond.atualizado_em);
    const r = ok('atualizarComandoSe', await q.select(COLS_COMANDO)) as Linha[];
    return r[0] ? mapComando(r[0]) : null;
  }

  async listarComandosEnviadosAntigos(antesDe: string) {
    const r = ok('listarComandosEnviadosAntigos', await this.c.from(T.comandos).select(COLS_COMANDO)
      .eq('status', 'enviado').lt('updated_at', antesDe));
    return (r as Linha[]).map(mapComando);
  }

  async listarRecargasComPartidaAceita() {
    const recargas = ok('listarRecargasComPartidaAceita', await this.c.from(T.recargas).select(COLS_RECARGA)
      .in('status', ['paid', 'starting'])) as Linha[];
    if (recargas.length === 0) return [];
    const aceitos = ok('listarRecargasComPartidaAceita', await this.c.from(T.comandos).select('recarga_id,updated_at')
      .in('recarga_id', recargas.map((x) => x.id)).eq('acao', 'RemoteStartTransaction').eq('status', 'aceito')) as Linha[];
    const ultimo = new Map<string, string>();
    for (const a of aceitos) {
      const atual = ultimo.get(a.recarga_id);
      if (!atual || new Date(a.updated_at).getTime() > new Date(atual).getTime()) ultimo.set(a.recarga_id, a.updated_at);
    }
    return recargas.filter((x) => ultimo.has(x.id)).map((x) => ({ recarga: mapRecarga(x), aceito_em: ultimo.get(x.id) as string }));
  }

  async listarRecargasComEstornoPendente() {
    const totais = ok('listarRecargasComEstornoPendente', await this.c.from(T.recargas).select(COLS_RECARGA)
      .in('status', ['failed', 'canceled']).eq('metadata->>estorno_total_pendente', 'true')) as Linha[];
    const parciais = ok('listarRecargasComEstornoPendente', await this.c.from(T.recargas).select(COLS_RECARGA)
      .eq('status', 'completed').not('ocpp_transacao_id', 'is', null).gt('valor_estornado', 0)
      .is('stripe_refund_id', null)) as Linha[];
    return [...totais, ...parciais].map(mapRecarga);
  }

  async rearmarComando(chave: string, expiraEm: string) {
    // um UPDATE guardado pelo status: dois chamadores simultaneos nao rearmam duas vezes
    const r = ok('rearmarComando', await this.c.from(T.comandos).update({
      status: 'pendente', tentativas: 0, proxima_tentativa_em: this.iso(), expira_em: expiraEm, erro: null, resposta: null,
    }).eq('chave_idempotencia', chave).in('status', STATUS_REARMAVEIS).select(COLS_COMANDO)) as Linha[];
    return r[0] ? mapComando(r[0]) : null;
  }

  assinarComandos(cb: () => void): () => void {
    const canal = this.c.channel(`ocpp-comandos-${randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: T.comandos }, () => {
        try { cb(); } catch (e) { this.onErro('assinarComandos callback', e); }
      })
      .subscribe((status, err) => {
        // o Realtime reconecta sozinho; a varredura periodica cobre qualquer aviso perdido
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.onErro('realtime ocpp_comandos', err ?? new Error(status));
        }
      });
    return () => { void this.c.removeChannel(canal); };
  }

  async enfileirarComando(d: NovoComando) {
    if (d.chave_idempotencia != null) {
      const existente = await this.comandoPorChave(d.chave_idempotencia);
      if (existente) return { comando: existente, criado: false };
    }
    // vencimento e expiracao sempre do relogio do repo (o mesmo que proximosComandos usa para filtrar)
    const agora = this.agora();
    const { data, error } = await this.c.from(T.comandos).insert({
      carregador_id: d.carregador_id, acao: d.acao, payload: d.payload ?? {}, recarga_id: d.recarga_id ?? null,
      chave_idempotencia: d.chave_idempotencia ?? null,
      proxima_tentativa_em: d.proxima_tentativa_em ?? agora.toISOString(),
      expira_em: d.expira_em ?? new Date(agora.getTime() + EXPIRA_COMANDO_MS).toISOString(),
    }).select(COLS_COMANDO).single();
    if (error) {
      if (error.code === '23505' && d.chave_idempotencia != null) {
        const outro = await this.comandoPorChave(d.chave_idempotencia);
        if (outro) return { comando: outro, criado: false };
      }
      throw falha('enfileirarComando', error);
    }
    return { comando: mapComando(data as Linha), criado: true };
  }

  private async comandoPorChave(chave: string): Promise<Comando | null> {
    const r = ok('enfileirarComando', await this.c.from(T.comandos).select(COLS_COMANDO)
      .eq('chave_idempotencia', chave).maybeSingle());
    return r ? mapComando(r as Linha) : null;
  }

  // --- estorno ---

  async solicitarEstorno(recargaId: string, e: { valor: number; motivo: string }) {
    if (!(e.valor > 0)) throw new Error('valor do estorno deve ser maior que zero');
    const recarga = await this.buscarRecarga(recargaId);
    if (!recarga) throw new Error(`recarga inexistente: ${recargaId}`);
    if (recarga.stripe_refund_id) return; // ja estornada: nada a pedir
    // idempotente do lado da Edge Function (ver cabecalho); falha lanca para quem chama tentar de novo
    await this.invocarFuncao('refund-charging', {
      recarga_id: recargaId, valor_centavos: Math.round(e.valor * 100), motivo: e.motivo,
    });
  }

  // --- alerta ---

  async alertar(a: Alerta) {
    const cp = ok('alertar', await this.c.from(T.carregadores).select('id,ocpp_id,eletroposto_id').eq('id', a.carregador_id).maybeSingle()) as Linha | null;
    if (!cp) throw new Error(`carregador inexistente: ${a.carregador_id}`);
    // Canal 'sistema' (nao e whatsapp/email): o gatilho fn_dispatch_notification ignora e nada e enviado;
    // a linha serve de trilha interna para o painel/CRM.
    ok('alertar', await this.c.from(T.notificacoes).insert({
      entity_type: 'eletroposto_carregador', entity_id: a.carregador_id, channel: 'sistema',
      recipient: 'operacao', body: a.mensagem, status: 'pending',
      metadata: {
        tipo: a.tipo, connector_id: a.connector_id, ocpp_id: cp.ocpp_id, eletroposto_id: cp.eletroposto_id,
        dados: a.dados ?? {},
      },
    }));
  }

  // --- trilha ---

  async logMensagem(m: Mensagem) {
    ok('logMensagem', await this.c.from(T.mensagens).insert({
      carregador_id: m.carregador_id, ocpp_id: m.ocpp_id, direcao: m.direcao, tipo: m.tipo,
      unique_id: m.unique_id, acao: m.acao, payload: m.payload,
    }));
  }
}

export function criarSupabaseRepo(url: string, serviceRoleKey: string, opts: OpcoesSupabaseRepo = {}): SupabaseRepo {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return new SupabaseRepo(client, opts);
}
