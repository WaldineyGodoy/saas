// Mensagens iniciadas pelo carregador (spec 5.2). A Tarefa 5 acrescenta
// Authorize/StartTransaction/MeterValues/StopTransaction em registrarHandlers.
import type { Repo } from '../repo/types.js';

export interface ContextoHandlers {
  repo: Repo;
  carregadorId: string;
  ocppId: string;
  // ocpp_id cujo Reset foi aceito e ainda nao foi seguido de um Boot (a Tarefa 6 marca)
  resetAceito: Set<string>;
  agora: () => Date;
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

  cliente.handle('DataTransfer', () => ({ status: 'Accepted' }));
  cliente.handle('DiagnosticsStatusNotification', () => ({}));
  cliente.handle('FirmwareStatusNotification', () => ({}));
}
