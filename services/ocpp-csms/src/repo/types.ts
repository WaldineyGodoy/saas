// Contrato de persistencia do CSMS. Duas implementacoes: memory.ts (testes L1/L3a)
// e a do Supabase (service role). Ambas seguem o schema de
// supabase/migrations/20261004b_ocpp_estrutura.sql. Datas sempre ISO 8601 (UTC).

export type RecargaStatus =
  | 'pending_payment' | 'paid' | 'starting' | 'charging' | 'completed' | 'failed' | 'canceled';

export interface Carregador {
  id: string;
  eletroposto_id: string;
  ocpp_id: string;
  senha_hash: string | null;
  vendor: string | null;
  modelo: string | null;
  serial: string | null;
  firmware: string | null;
  heartbeat_intervalo_s: number;
  online: boolean;
  ultimo_boot_em: string | null;
  ultimo_contato_em: string | null;
  estado_registro: 'pendente' | 'aceito' | 'rejeitado';
}

export interface DadosBoot {
  vendor: string;
  modelo: string;
  serial?: string | null;
  firmware?: string | null;
}

export interface Conector {
  id: string;
  carregador_id: string;
  connector_id: number;
  status: string;
  error_code: string;
  info: string | null;
  vendor_error_code: string | null;
  status_em: string | null;
  bloqueado_ate_reset: boolean;
}

export type ConectorPatch = Partial<Omit<Conector, 'id' | 'carregador_id' | 'connector_id'>>;

export interface IdTag {
  id_tag: string;
  recarga_id: string | null;
  status: 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';
  expira_em: string | null;
  usado_em: string | null;
}

export interface Recarga {
  id: string;
  eletroposto_id: string;
  status: RecargaStatus;
  valor: number;
  // foto da tarifa no checkout (spec §4.9)
  tarifa_kwh_aplicada: number;
  ocpp_id_tag: string | null;
  ocpp_transacao_id: number | null;
  kwh_limite: number | null;
  kwh_consumido: number | null;
  valor_final: number | null;
  valor_estornado: number | null;
  stripe_refund_id: string | null;
  iniciada_em: string | null;
  finalizada_em: string | null;
  motivo_fim: string | null;
  metadata: Record<string, unknown>;
}

// Marca em recargas.metadata: a recarga virou failed/canceled e o estorno total ainda nao foi confirmado.
// Gravada na MESMA escrita da transicao, entao uma falha posterior e refeita pela varredura (restart-safe).
export const META_ESTORNO_PENDENTE = 'estorno_total_pendente';

export type RecargaPatch = Partial<Omit<Recarga, 'id'>>;

export interface Transacao {
  id: number;
  carregador_id: string;
  connector_id: number;
  recarga_id: string | null;
  id_tag: string;
  meter_start_wh: number;
  meter_stop_wh: number | null;
  inicio_em: string;
  fim_em: string | null;
  motivo_parada: string | null;
  chave_idempotencia: string;
}

export type NovaTransacao = Pick<
  Transacao,
  'carregador_id' | 'connector_id' | 'recarga_id' | 'id_tag' | 'meter_start_wh' | 'inicio_em'
>;

export interface FimTransacao {
  meter_stop_wh: number;
  fim_em: string;
  motivo_parada?: string | null;
}

export interface Medicao {
  transacao_id: number;
  connector_id: number;
  medido_em: string;
  measurand: string;
  phase: string; // '' = sem fase
  valor: number;
  unidade: string;
  contexto: string | null;
}

// measurand e phase opcionais na entrada; o repo aplica os defaults do banco.
export type NovaMedicao = Omit<Medicao, 'measurand' | 'phase' | 'contexto'> &
  Partial<Pick<Medicao, 'measurand' | 'phase' | 'contexto'>>;

export type AcaoComando =
  | 'RemoteStartTransaction' | 'RemoteStopTransaction' | 'Reset' | 'ChangeAvailability'
  | 'GetConfiguration' | 'ChangeConfiguration' | 'UnlockConnector' | 'TriggerMessage';

export type StatusComando = 'pendente' | 'enviado' | 'aceito' | 'rejeitado' | 'erro' | 'expirado';

export interface Comando {
  id: string;
  carregador_id: string;
  acao: AcaoComando;
  payload: Record<string, unknown>;
  status: StatusComando;
  tentativas: number;
  proxima_tentativa_em: string;
  expira_em: string;
  resposta: unknown | null;
  erro: string | null;
  recarga_id: string | null;
  chave_idempotencia: string | null;
  // ultima alteracao (updated_at); para RemoteStart aceito marca o instante da aceitacao (RC-03)
  atualizado_em: string;
}

export interface NovoComando {
  carregador_id: string;
  acao: AcaoComando;
  payload?: Record<string, unknown>;
  recarga_id?: string | null;
  chave_idempotencia?: string | null;
  proxima_tentativa_em?: string;
  expira_em?: string;
}

export type ComandoPatch = Partial<
  Pick<Comando, 'status' | 'tentativas' | 'proxima_tentativa_em' | 'resposta' | 'erro'>
>;

export interface Mensagem {
  carregador_id: string | null;
  ocpp_id: string;
  direcao: 'entrada' | 'saida';
  tipo: 2 | 3 | 4 | null;
  unique_id: string | null;
  acao: string | null;
  payload: unknown | null;
}

// Alerta interno (no Supabase vira uma linha em notification_logs).
export interface Alerta {
  carregador_id: string;
  connector_id: number | null;
  tipo: string; // ex.: 'conector_falha_grave'
  mensagem: string;
  dados?: Record<string, unknown>;
}

export interface Repo {
  // carregador
  // carregadores com online = true (verificador de contato)
  listarOnline(): Promise<Carregador[]>;
  buscarCarregador(ocppId: string): Promise<Carregador | null>;
  registrarBoot(carregadorId: string, dados: DadosBoot): Promise<void>;
  registrarContato(carregadorId: string): Promise<void>;
  marcarOffline(carregadorId: string): Promise<void>;

  // conector
  buscarConector(carregadorId: string, connectorId: number): Promise<Conector | null>;
  listarConectores(carregadorId: string): Promise<Conector[]>;
  upsertConector(carregadorId: string, connectorId: number, patch: ConectorPatch): Promise<Conector>;

  // idTag
  buscarIdTag(idTag: string): Promise<IdTag | null>;
  atualizarIdTag(idTag: string, patch: Partial<Omit<IdTag, 'id_tag'>>): Promise<void>;

  // recarga
  buscarRecarga(id: string): Promise<Recarga | null>;
  // `deStatus` torna o update condicional: se o status atual for outro, nao aplica e devolve null.
  // Transicao proibida pela maquina de status lanca erro (como o gatilho SQL).
  atualizarRecarga(id: string, patch: RecargaPatch, deStatus?: RecargaStatus): Promise<Recarga | null>;

  // transacao
  buscarTransacao(id: number): Promise<Transacao | null>;
  // retransmissao do StartTransaction (mesma chave) devolve a mesma transacao
  criarOuObterTransacao(chave: string, dados: NovaTransacao): Promise<{ transacao: Transacao; criada: boolean }>;
  // StopTransaction retransmitido e idempotente: se ja estava fechada, NAO sobrescreve e devolve fechada = false.
  fecharTransacao(id: number, fim: FimTransacao): Promise<{ transacao: Transacao; fechada: boolean }>;
  buscarTransacaoPorChave(chave: string): Promise<Transacao | null>;
  // transacao sem fim_em do conector (MeterValues sem transactionId)
  buscarTransacaoAberta(carregadorId: string, connectorId: number): Promise<Transacao | null>;
  // transacao sem fim_em que usa o idTag (ConcurrentTx)
  buscarTransacaoAbertaPorTag(idTag: string): Promise<Transacao | null>;

  // medicao: devolve quantas linhas entraram (duplicadas sao ignoradas)
  gravarMedicoes(medicoes: NovaMedicao[]): Promise<number>;
  listarMedicoes(transacaoId: number): Promise<Medicao[]>;

  // fila de comandos
  // pendentes, vencidos (proxima_tentativa_em <= agora), nao expirados, dos carregadores indicados
  proximosComandos(ocppIds: string[]): Promise<Comando[]>;
  atualizarComando(id: string, patch: ComandoPatch): Promise<Comando>;
  // trava por comando: `pendente -> enviado` somente se ainda estiver pendente (update ... where status='pendente').
  // Devolve o comando travado, ou null se outra instancia/rodada ja o pegou.
  reivindicarComando(id: string): Promise<Comando | null>;
  // pendentes cujo expira_em ja passou (a varredura os marca como expirado)
  listarComandosExpirados(): Promise<Comando[]>;
  // update condicional: so aplica se o comando ainda esta em `status` (e, se informado, com o mesmo atualizado_em);
  // senao devolve null (outra instancia ja agiu)
  atualizarComandoSe(id: string, cond: { status: StatusComando; atualizado_em?: string }, patch: ComandoPatch): Promise<Comando | null>;
  // comandos `enviado` cujo atualizado_em e anterior a `antesDe` (ISO): tentativa perdida (queda entre a trava e a resposta)
  listarComandosEnviadosAntigos(antesDe: string): Promise<Comando[]>;
  // recargas em paid|starting com RemoteStart aceito, com o instante da aceitacao (base do RC-03, sobrevive a restart)
  listarRecargasComPartidaAceita(): Promise<{ recarga: Recarga; aceito_em: string }[]>;
  // recargas failed/canceled com metadata[META_ESTORNO_PENDENTE] = true
  listarRecargasComEstornoPendente(): Promise<Recarga[]>;
  // opcional: avisa quando um comando e inserido (Realtime no Supabase / callback na memoria). Devolve o cancelamento.
  assinarComandos?(cb: () => void): () => void;
  // mesma chave_idempotencia nao duplica; chave nula sempre cria
  enfileirarComando(dados: NovoComando): Promise<{ comando: Comando; criado: boolean }>;

  // pede o estorno parcial/total da recarga (no Supabase: Edge Function refund-charging). `valor` em reais.
  // Idempotente por recarga: um segundo pedido para a mesma recarga nao duplica.
  solicitarEstorno(recargaId: string, e: { valor: number; motivo: string }): Promise<void>;

  // alerta interno
  alertar(a: Alerta): Promise<void>;

  // trilha de frames
  logMensagem(m: Mensagem): Promise<void>;
}
