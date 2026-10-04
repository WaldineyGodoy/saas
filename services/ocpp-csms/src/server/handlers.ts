// Mensagens iniciadas pelo carregador (spec 5.2). A Tarefa 5 acrescenta
// Authorize/StartTransaction/MeterValues/StopTransaction em registrarHandlers.
import { calcularFechamento } from '../domain/estorno.js';
import { normalizar } from '../domain/medicao.js';
import { deveCortar, kwhLimite } from '../domain/recarga.js';
import type { NovaMedicao, Recarga, Repo, Transacao } from '../repo/types.js';

const ENERGIA = 'Energy.Active.Import.Register';

interface SampledValueOcpp {
  value: string; unit?: string; measurand?: string; phase?: string; context?: string;
}
interface MeterValueOcpp { timestamp: string; sampledValue: SampledValueOcpp[] }

type StatusIdTag = 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';

export interface ContextoHandlers {
  repo: Repo;
  carregadorId: string;
  ocppId: string;
  // ocpp_id cujo Reset foi aceito e ainda nao foi seguido de um Boot (a Tarefa 6 marca)
  resetAceito: Set<string>;
  agora: () => Date;
  // avisa que o conector recebeu StatusNotification nesta conexao (status fresco)
  aoStatus?: (connectorId: number) => void;
}

// Cliente minimo que os handlers precisam (evita acoplar ao tipo interno da lib).
export interface ClienteHandlers {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(method: string, handler: (ctx: any) => unknown): void;
}

// Falhas que travam o conector ate um Reset: GroundFailure e OverCurrentFailure (seguranca eletrica)
// e qualquer Faulted que se declare parada de emergencia. "EmergencyStop" nao e ChargePointErrorCode
// valido no 1.6 (e motivo de StopTransaction), entao a parada de emergencia chega como OtherError
// com info/vendorErrorCode mencionando emergencia.
const ERROS_BLOQUEANTES = new Set(['GroundFailure', 'OverCurrentFailure']);
const RE_EMERGENCIA = /emerg/i;

export function falhaBloqueante(p: { status: string; errorCode: string; info?: string; vendorErrorCode?: string }): boolean {
  if (p.status !== 'Faulted') return false;
  if (ERROS_BLOQUEANTES.has(p.errorCode)) return true;
  return RE_EMERGENCIA.test(p.info ?? '') || RE_EMERGENCIA.test(p.vendorErrorCode ?? '');
}

export function registrarHandlers(cliente: ClienteHandlers, ctx: ContextoHandlers): void {
  const { repo, carregadorId, ocppId } = ctx;

  cliente.handle('BootNotification', async ({ params }) => {
    await repo.registrarBoot(carregadorId, {
      vendor: params.chargePointVendor, modelo: params.chargePointModel,
      serial: params.chargePointSerialNumber ?? null, firmware: params.firmwareVersion ?? null,
    });
    // so um Boot que vem depois de um Reset aceito libera o bloqueio
    if (ctx.resetAceito.delete(ocppId)) {
      for (const cn of await repo.listarConectores(carregadorId)) {
        if (cn.bloqueado_ate_reset) await repo.upsertConector(carregadorId, cn.connector_id, { bloqueado_ate_reset: false });
      }
    }
    const cp = await repo.buscarCarregador(ocppId);
    return {
      status: 'Accepted', currentTime: ctx.agora().toISOString(), interval: cp?.heartbeat_intervalo_s ?? 60,
    };
  });

  cliente.handle('Heartbeat', async () => {
    await repo.registrarContato(carregadorId);
    return { currentTime: ctx.agora().toISOString() };
  });

  cliente.handle('StatusNotification', async ({ params }) => {
    const bloqueia = falhaBloqueante(params);
    await repo.upsertConector(carregadorId, params.connectorId, {
      status: params.status, error_code: params.errorCode, info: params.info ?? null,
      vendor_error_code: params.vendorErrorCode ?? null,
      status_em: params.timestamp ?? ctx.agora().toISOString(),
      // nunca limpa aqui: so um Boot apos Reset aceito libera
      ...(bloqueia ? { bloqueado_ate_reset: true } : {}),
    });
    ctx.aoStatus?.(params.connectorId);
    if (params.status === 'Faulted') {
      await repo.alertar({
        carregador_id: carregadorId, connector_id: params.connectorId,
        tipo: bloqueia ? 'conector_falha_grave' : 'conector_falha',
        mensagem: `Conector ${params.connectorId} de ${ocppId} em Faulted (${params.errorCode})${bloqueia ? ': bloqueado ate Reset' : ''}`,
        dados: { errorCode: params.errorCode, info: params.info ?? null, vendorErrorCode: params.vendorErrorCode ?? null },
      });
    }
    return {};
  });

  const alertar = (connectorId: number | null, tipo: string, mensagem: string, dados?: Record<string, unknown>) =>
    repo.alertar({ carregador_id: carregadorId, connector_id: connectorId, tipo, mensagem, dados });

  // Avalia o idTag e a recarga vinculada. `recarga` so vem preenchida quando o status e Accepted.
  async function avaliarTag(idTag: string): Promise<{ status: StatusIdTag; recarga: Recarga | null }> {
    const tag = await repo.buscarIdTag(idTag);
    if (!tag) return { status: 'Invalid', recarga: null };
    if (tag.status !== 'Accepted') return { status: tag.status, recarga: null };
    if (tag.expira_em && new Date(tag.expira_em).getTime() <= ctx.agora().getTime()) {
      return { status: 'Expired', recarga: null };
    }
    // em uso por transacao aberta: ConcurrentTx; ja usado e encerrado: Expired
    if (await repo.buscarTransacaoAbertaPorTag(idTag)) return { status: 'ConcurrentTx', recarga: null };
    if (tag.usado_em) return { status: 'Expired', recarga: null };
    const recarga = tag.recarga_id ? await repo.buscarRecarga(tag.recarga_id) : null;
    // o idTag so autoriza no eletroposto da sua recarga
    const cp = await repo.buscarCarregador(ocppId);
    if (recarga && (!cp || recarga.eletroposto_id !== cp.eletroposto_id)) return { status: 'Invalid', recarga: null };
    // starting: RemoteStart enviado; paid: partida local no totem (RC-06)
    if (!recarga || (recarga.status !== 'starting' && recarga.status !== 'paid')) {
      return { status: 'Invalid', recarga: null };
    }
    return { status: 'Accepted', recarga };
  }

  cliente.handle('Authorize', async ({ params }) => {
    const { status } = await avaliarTag(params.idTag);
    return { idTagInfo: { status } };
  });

  cliente.handle('StartTransaction', async ({ params }) => {
    const idTag: string = params.idTag;
    const inicioEm = new Date(params.timestamp).toISOString();
    // chave de idempotencia (spec 4.4); o instante e normalizado para o mesmo momento em 2 formatos nao divergir
    const chave = `${carregadorId}|${params.connectorId}|${idTag}|${inicioEm}`;

    const existente = await repo.buscarTransacaoPorChave(chave);
    if (existente) {
      // retransmissao (RS-03): mesma transacao, sem refazer efeitos
      return { transactionId: existente.id, idTagInfo: { status: existente.recarga_id ? 'Accepted' : 'Invalid' } };
    }

    const { status, recarga } = await avaliarTag(idTag);
    const novo = await repo.criarOuObterTransacao(chave, {
      carregador_id: carregadorId, connector_id: params.connectorId, id_tag: idTag,
      meter_start_wh: params.meterStart, inicio_em: inicioEm, recarga_id: recarga?.id ?? null,
    });
    if (!novo.criada) {
      return { transactionId: novo.transacao.id, idTagInfo: { status: novo.transacao.recarga_id ? 'Accepted' : 'Invalid' } };
    }
    if (status !== 'Accepted' || !recarga) {
      // RC-07: o 1.6 exige transactionId mesmo recusando; a transacao fica sem recarga
      return { transactionId: novo.transacao.id, idTagInfo: { status } };
    }

    let kwhLim: number | null = null;
    if (recarga.tarifa_kwh_aplicada > 0) {
      kwhLim = kwhLimite(recarga.valor, recarga.tarifa_kwh_aplicada);
    } else {
      await alertar(params.connectorId, 'recarga_sem_tarifa',
        `Recarga ${recarga.id} sem foto de tarifa: kwh_limite nao calculado`, { recargaId: recarga.id });
    }
    // paid -> starting -> charging (o mapa de status proibe paid -> charging)
    let atual: Recarga | null = recarga;
    if (recarga.status === 'paid') atual = await repo.atualizarRecarga(recarga.id, { status: 'starting' }, 'paid');
    if (atual) {
      atual = await repo.atualizarRecarga(recarga.id, {
        status: 'charging', ocpp_transacao_id: novo.transacao.id, iniciada_em: inicioEm, kwh_limite: kwhLim,
      }, 'starting');
    }
    if (!atual) {
      await alertar(params.connectorId, 'recarga_inicio_conflito',
        `Recarga ${recarga.id} mudou de status durante o StartTransaction ${novo.transacao.id}`, { recargaId: recarga.id });
      return { transactionId: novo.transacao.id, idTagInfo: { status: 'Invalid' } };
    }
    await repo.atualizarIdTag(idTag, { usado_em: ctx.agora().toISOString() });
    return { transactionId: novo.transacao.id, idTagInfo: { status: 'Accepted' } };
  });

  // Grava as amostras (dedupe no repo). Energia que fica abaixo do maior registro anterior
  // (ou do meterStart) e ignorada com alerta (MV-02).
  async function persistirAmostras(t: Transacao, medicoes: MeterValueOcpp[]): Promise<void> {
    const ordenadas = [...medicoes].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    for (const mvOcpp of ordenadas) {
      const medidoEm = new Date(mvOcpp.timestamp).toISOString();
      for (const sv of mvOcpp.sampledValue) {
        let norm: { valor: number; unidade: string };
        try {
          norm = normalizar(sv);
        } catch (e) {
          await alertar(t.connector_id, 'medicao_invalida', (e as Error).message, { transacaoId: t.id });
          continue;
        }
        const measurand = sv.measurand ?? ENERGIA;
        if (measurand === ENERGIA) {
          const instante = new Date(medidoEm).getTime();
          const anteriores = (await repo.listarMedicoes(t.id))
            .filter((m) => m.measurand === ENERGIA && m.unidade === 'Wh' && new Date(m.medido_em).getTime() <= instante)
            .map((m) => m.valor);
          const piso = Math.max(t.meter_start_wh, ...anteriores);
          if (norm.valor < piso) {
            await alertar(t.connector_id, 'medicao_regrediu',
              `Registro de energia regrediu na transacao ${t.id}: ${norm.valor} Wh < ${piso} Wh; amostra ignorada`,
              { transacaoId: t.id, valor: norm.valor, piso, medidoEm });
            continue;
          }
        }
        const nova: NovaMedicao = {
          transacao_id: t.id, connector_id: t.connector_id, medido_em: medidoEm, measurand,
          phase: sv.phase ?? '', valor: norm.valor, unidade: norm.unidade, contexto: sv.context ?? null,
        };
        await repo.gravarMedicoes([nova]);
      }
    }
  }

  // kwh_consumido = (maior registro - meterStart) / 1000; monotonico e so enquanto charging
  async function atualizarConsumo(t: Transacao): Promise<void> {
    if (!t.recarga_id) return;
    const regs = (await repo.listarMedicoes(t.id))
      .filter((m) => m.measurand === ENERGIA && m.unidade === 'Wh').map((m) => m.valor);
    if (regs.length === 0) return;
    const kwh = Math.max(0, (Math.max(...regs) - t.meter_start_wh) / 1000);
    const r = await repo.buscarRecarga(t.recarga_id);
    if (!r || r.status !== 'charging' || kwh <= (r.kwh_consumido ?? 0)) return;
    await repo.atualizarRecarga(r.id, { kwh_consumido: kwh }, 'charging');
  }

  cliente.handle('MeterValues', async ({ params }) => {
    // sem transactionId no payload: usa a transacao aberta do conector
    const t = params.transactionId !== undefined
      ? await transacaoDoCarregador(params.transactionId, 'MeterValues')
      : await repo.buscarTransacaoAberta(carregadorId, params.connectorId);
    if (!t) return {}; // amostras fora de transacao (ex.: conector 0) nao sao persistidas
    await persistirAmostras(t, params.meterValue);
    await atualizarConsumo(t);
    await cortarSeNoLimite(t);
    return {};
  });

  // RC-04: energia >= kwh_limite -> um RemoteStopTransaction. A chave `stop:<recarga>` faz as amostras
  // seguintes (ou um MeterValues retransmitido) colidirem no mesmo comando: so um e enfileirado.
  async function cortarSeNoLimite(t: Transacao): Promise<void> {
    if (!t.recarga_id) return;
    const r = await repo.buscarRecarga(t.recarga_id);
    if (!r || r.status !== 'charging' || r.kwh_limite === null || r.kwh_consumido === null) return;
    if (!deveCortar(r.kwh_consumido, r.kwh_limite)) return;
    await repo.enfileirarComando({
      carregador_id: carregadorId, acao: 'RemoteStopTransaction', payload: { transactionId: t.id },
      recarga_id: r.id, chave_idempotencia: `stop:${r.id}`,
    });
  }

  // Transacao de outro carregador (ou inexistente) e tratada como desconhecida: nada e lido nem gravado.
  async function transacaoDoCarregador(id: number, acao: string): Promise<Transacao | null> {
    const t = await repo.buscarTransacao(id);
    if (t && t.carregador_id === carregadorId) return t;
    await alertar(null, 'transacao_desconhecida',
      `${acao} para transacao ${t ? 'de outro carregador' : 'inexistente'}: ${id}`, { transactionId: id });
    return null;
  }

  // Cada passo e idempotente, entao um Stop retransmitido (apos falha parcial) refaz a cauda inteira:
  // medicoes dedupam, idTag Expired se repete, a recarga so conclui de charging e o estorno
  // e pedido no maximo uma vez por recarga (o repo e idempotente por recarga).
  cliente.handle('StopTransaction', async ({ params }) => {
    if (!(await transacaoDoCarregador(params.transactionId, 'StopTransaction'))) return {};
    const motivoRecebido: string = params.reason ?? 'Local'; // default do 1.6
    // devolve a transacao como esta gravada: numa retransmissao valem os dados do 1o Stop
    const { transacao: t } = await repo.fecharTransacao(params.transactionId, {
      meter_stop_wh: params.meterStop, fim_em: new Date(params.timestamp).toISOString(), motivo_parada: motivoRecebido,
    });
    const fimEm = t.fim_em as string;
    const motivo = t.motivo_parada ?? 'Local';
    const whStop = t.meter_stop_wh as number;
    if (params.transactionData) await persistirAmostras(t, params.transactionData);

    if (await repo.buscarIdTag(t.id_tag)) await repo.atualizarIdTag(t.id_tag, { status: 'Expired' }); // uso unico (RC-08)
    if (!t.recarga_id) return {}; // transacao orfa (idTag invalido)

    let r = await repo.buscarRecarga(t.recarga_id);
    if (r && r.status === 'charging') {
      let f = calcularFechamento({ valor: r.valor, tarifa: r.tarifa_kwh_aplicada, whStart: t.meter_start_wh, whStop });
      if (!(r.tarifa_kwh_aplicada > 0)) {
        // sem tarifa nao ha proporcional: cobra o pago e manda revisar
        f = { kwh: r.kwh_consumido ?? 0, valor_final: r.valor, estorno: 0, revisar: true };
      }
      const atualizada = await repo.atualizarRecarga(r.id, {
        status: 'completed', kwh_consumido: f.revisar ? (r.kwh_consumido ?? 0) : f.kwh,
        valor_final: f.valor_final, valor_estornado: f.estorno, finalizada_em: fimEm, motivo_fim: motivo,
        ...(f.revisar ? { metadata: { ...r.metadata, revisar: true } } : {}),
      }, 'charging');
      if (atualizada && f.revisar) {
        await alertar(t.connector_id, 'medicao_revisar',
          `Recarga ${r.id} encerrada para revisao (meterStop ${whStop} < meterStart ${t.meter_start_wh}, ou sem tarifa)`,
          { recargaId: r.id });
      }
      r = atualizada ?? (await repo.buscarRecarga(r.id));
    } else if (!r || r.status !== 'completed') {
      await alertar(t.connector_id, 'recarga_fechamento_ignorado',
        `StopTransaction ${t.id}: recarga ${t.recarga_id} esta em ${r?.status ?? 'inexistente'}, nao charging`, { recargaId: t.recarga_id });
      return {};
    }
    // recarga concluida com diferenca a devolver: pede (ou repete o pedido, idempotente)
    if (r && r.status === 'completed' && (r.valor_estornado ?? 0) > 0) {
      await repo.solicitarEstorno(r.id, { valor: r.valor_estornado as number, motivo: `StopTransaction ${motivo}` });
    }
    return {};
  });

  cliente.handle('DataTransfer', () => ({ status: 'Accepted' }));
  cliente.handle('DiagnosticsStatusNotification', () => ({}));
  cliente.handle('FirmwareStatusNotification', () => ({}));
}
