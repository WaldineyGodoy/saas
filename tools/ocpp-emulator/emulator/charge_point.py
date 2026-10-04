"""Carregador virtual OCPP 1.6-J.

Diferente de um script que so envia mensagens, o `VirtualChargePoint` tambem
recebe e obedece comandos do CSMS (handlers `@on`), mantem uma maquina de
estados por conector, uma fila offline e injecao de falhas (`Faults`).

Implementacao independente do CSMS (spec D3): so usa a lib `ocpp` e o protocolo.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Awaitable, Callable
from urllib.parse import quote

from ocpp.routing import after, on
from ocpp.v16 import ChargePoint, call, call_result
from websockets.exceptions import ConnectionClosed

from .faults import EMERGENCY_STOP, Faults, fault_notification

LOGGER = logging.getLogger("emulator")

PENDING_TX = -1  # transactionId ainda desconhecido (StartTransaction offline)


class State(StrEnum):
    AVAILABLE = "Available"
    PREPARING = "Preparing"
    CHARGING = "Charging"
    SUSPENDED_EV = "SuspendedEV"
    SUSPENDED_EVSE = "SuspendedEVSE"
    FINISHING = "Finishing"
    UNAVAILABLE = "Unavailable"
    FAULTED = "Faulted"


class InvalidTransition(Exception):
    """Transicao de estado de conector que a maquina nao permite."""


_TRANSITIONS: dict[State, set[State]] = {
    State.AVAILABLE: {State.PREPARING, State.UNAVAILABLE, State.FAULTED},
    State.PREPARING: {State.CHARGING, State.AVAILABLE, State.UNAVAILABLE, State.FAULTED},
    State.CHARGING: {State.FINISHING, State.SUSPENDED_EV, State.SUSPENDED_EVSE, State.FAULTED},
    State.SUSPENDED_EV: {State.CHARGING, State.FINISHING, State.FAULTED},
    State.SUSPENDED_EVSE: {State.CHARGING, State.FINISHING, State.FAULTED},
    State.FINISHING: {State.AVAILABLE, State.PREPARING, State.UNAVAILABLE, State.FAULTED},
    State.UNAVAILABLE: {State.AVAILABLE, State.FAULTED},
    State.FAULTED: {State.AVAILABLE, State.UNAVAILABLE},
}


@dataclass
class Connector:
    id: int
    state: State = State.AVAILABLE
    error_code: str = "NoError"
    id_tag: str | None = None
    transaction_id: int | None = None  # None ate o CSMS responder o Start
    last_tx_id: int | None = None
    in_transaction: bool = False
    register_wh: float = 0.0  # registro de energia do medidor
    tx_start_wh: float = 0.0
    last_sent_wh: float = 0.0
    pending_inoperative: bool = False
    flow_pending: bool = False
    meter_task: asyncio.Task | None = field(default=None, repr=False)
    flow_task: asyncio.Task | None = field(default=None, repr=False)
    finish_task: asyncio.Task | None = field(default=None, repr=False)

    def transition(self, new: State) -> None:
        if new not in _TRANSITIONS[self.state]:
            raise InvalidTransition(f"conector {self.id}: {self.state} -> {new}")
        self.state = State(new)


def ws_url(base: str, charge_point_id: str) -> str:
    return f"{base.rstrip('/')}/{quote(charge_point_id, safe='')}"


def basic_auth(charge_point_id: str, password: str) -> str:
    token = base64.b64encode(f"{charge_point_id}:{password}".encode()).decode()
    return f"Basic {token}"


def _fmt_kwh(wh: float) -> str:
    return (f"{wh / 1000:.6f}".rstrip("0").rstrip(".")) or "0"


class VirtualChargePoint(ChargePoint):
    def __init__(
        self,
        id: str,
        connection: Any = None,
        *,
        connectors: int = 2,
        plug_delay_s: float | None = 5.0,
        power_kw: float = 7.4,
        meter_interval_s: float = 10.0,
        time_scale: float = 1.0,
        meter_start_wh: float = 10000.0,
        stop_after_wh: float | None = None,
        finish_delay_s: float = 1.0,
        reset_wait_s: float = 2.0,
        faults: Faults | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], datetime] | None = None,
        vendor: str = "B2W",
        model: str = "EMU-1",
        firmware: str = "emu-0.1.0",
        response_timeout: float = 30,
        frame_logger: Callable[[str, str], None] | None = None,
    ):
        super().__init__(id, connection, response_timeout=response_timeout)
        self.connectors = {
            n: Connector(n, register_wh=meter_start_wh, last_sent_wh=meter_start_wh)
            for n in range(1, connectors + 1)
        }
        self.plug_delay_s = plug_delay_s  # None = nunca pluga (RC-03)
        self.power_kw = power_kw
        self.meter_interval_s = meter_interval_s
        self.time_scale = time_scale
        self.stop_after_wh = stop_after_wh
        self.finish_delay_s = finish_delay_s
        self.reset_wait_s = reset_wait_s
        self.faults = faults or Faults()
        self._sleep = sleep
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.vendor, self.model, self.firmware = vendor, model, firmware
        self.frame_logger = frame_logger

        self.heartbeat_interval_s = 300.0
        self.config: dict[str, list] = {  # chave -> [valor, somente leitura]
            "HeartbeatInterval": ["300", False],
            "ConnectionTimeOut": ["60", False],
            "MeterValueSampleInterval": [str(int(meter_interval_s)), False],
            "NumberOfConnectors": [str(connectors), True],
            "GetConfigurationMaxKeys": ["50", True],
            "AuthorizeRemoteTxRequests": ["true", True],
            "SupportedFeatureProfiles": ["Core,RemoteTrigger", True],
        }

        self.connected = False
        self._booted = False
        self.offline_queue: list[tuple[Any, Callable | None]] = []
        self.received_commands: list[tuple[str, dict]] = []
        self.silenced: set[str] = set()  # unique ids deliberadamente sem resposta
        self.resets = 0
        self._send_lock = asyncio.Lock()
        self._closed = asyncio.Event()
        self._closed.set()
        self._reconnect_delay: float | None = None
        self._deferred: dict[str, Callable[[], Awaitable[None]]] = {}
        self._conn_tasks: set[asyncio.Task] = set()  # morrem com a conexao
        self._flows: set[asyncio.Task] = set()  # sobrevivem a queda (offline)
        self._heartbeat_task: asyncio.Task | None = None
        self._drop_task: asyncio.Task | None = None

    # ----------------------------------------------------------- utilidades

    def now(self) -> str:
        dt = self._clock().astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"

    def _spawn(self, coro, bucket: set[asyncio.Task]) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        bucket.add(task)
        task.add_done_callback(bucket.discard)
        task.add_done_callback(self._log_task_failure)
        return task

    @staticmethod
    def _log_task_failure(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception() is not None:
            LOGGER.error("tarefa do emulador falhou: %r", task.exception())

    @property
    def ready(self) -> bool:
        """Conectado e com Boot aceito (o CSMS ja pode mandar comandos)."""
        return self.connected and self._booted

    def consume_reconnect_delay(self) -> float | None:
        delay, self._reconnect_delay = self._reconnect_delay, None
        return delay

    async def wait_until(self, predicate: Callable[[], bool], timeout: float | None = None) -> bool:
        loop = asyncio.get_running_loop()
        deadline = None if timeout is None else loop.time() + timeout
        while not predicate():
            if deadline is not None and loop.time() >= deadline:
                return False
            await asyncio.sleep(0.02)
        return True

    # ------------------------------------------------------------- conexao

    def attach(self, connection: Any) -> None:
        self._connection = connection
        self._response_queue = asyncio.Queue()  # descarta respostas velhas
        self._closed = asyncio.Event()
        self.connected = True
        self._booted = False

    def detach(self) -> None:
        self.connected = False
        self._closed.set()
        for task in (self._heartbeat_task, self._drop_task):
            if task:
                task.cancel()
        for task in list(self._conn_tasks):
            task.cancel()

    async def _send(self, message):
        if self.frame_logger:
            self.frame_logger("->", message)
        await self._connection.send(message)

    async def start(self):
        """Laco de recepcao: cada frame vira uma tarefa, entao uma resposta
        atrasada (RS-04) ou ausente (RS-05) nao trava as demais mensagens."""
        try:
            while True:
                raw = await self._connection.recv()
                if self.frame_logger:
                    self.frame_logger("<-", raw)
                self._spawn(self._safe_route(raw), self._conn_tasks)
        except ConnectionClosed:
            self.connected = False
            self._closed.set()

    async def _safe_route(self, raw: str) -> None:
        try:
            await self.route_message(raw)
        except ConnectionClosed:
            self.connected = False
            self._closed.set()

    async def run_session(self, connection: Any) -> None:
        """Vida de uma conexao: recepcao + Boot/Status + descarga da fila."""
        self.attach(connection)
        recv = asyncio.ensure_future(self.start())
        try:
            try:
                await self.on_connected()
            except ConnectionClosed:
                pass
            await recv
        finally:
            recv.cancel()
            self.detach()

    async def on_connected(self) -> None:
        await self._announce()
        self._heartbeat_task = asyncio.ensure_future(self._heartbeat_loop())
        if self.faults.drop_connection_after_s is not None:
            self._drop_task = asyncio.ensure_future(self._drop_later())
        await self._flush()

    async def _announce(self) -> None:
        """Boot e depois StatusNotification do conector 0 e de cada conector
        (o CSMS espera isso antes de mandar RemoteStart)."""
        while True:
            res = await self.request(
                call.BootNotification(
                    charge_point_model=self.model,
                    charge_point_vendor=self.vendor,
                    firmware_version=self.firmware,
                    charge_point_serial_number=self.id,
                ),
                announce=True,
            )
            if res is None or res.status == "Accepted":
                self._booted = True
                if res is not None and res.interval:
                    self.heartbeat_interval_s = float(res.interval)
                break
            await asyncio.sleep(max(float(res.interval or 1), 1.0))
        station = (
            State.UNAVAILABLE
            if all(c.state == State.UNAVAILABLE for c in self.connectors.values())
            else State.AVAILABLE
        )
        await self._status_raw(0, station.value, "NoError", announce=True)
        for c in self.connectors.values():
            await self._status_raw(c.id, c.state.value, c.error_code, announce=True)

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self.heartbeat_interval_s)
            await self.heartbeat()

    async def _drop_later(self) -> None:
        await asyncio.sleep(self.faults.drop_connection_after_s)
        await self.drop_connection(self.faults.offline_for_s)

    async def drop_connection(self, offline_for_s: float | None = None) -> None:
        """Derruba o socket (queda injetada). A fila offline junta o trafego."""
        self._reconnect_delay = offline_for_s
        await self._connection.close()

    async def shutdown(self) -> None:
        self.detach()
        tasks = list(self._flows) + list(self._conn_tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------- envio

    async def request(self, payload, *, transactional: bool = False, on_result=None, announce: bool = False):
        """Envia um Call. Desconectado: transacional entra na fila, o resto cai."""
        follow: list = []
        result = None
        async with self._send_lock:
            if not self.connected or not (announce or self._booted):
                # sem conexao, ou ainda sem Boot aceito: nada sai antes do Boot
                if transactional:
                    self._queue(payload, on_result)
            elif announce:
                result = (await self._try_send(payload, on_result, follow))[1]
            elif not await self._flush_locked(follow):
                if transactional:
                    self._queue(payload, on_result)
            else:
                result = await self._deliver(payload, transactional, on_result, follow)
        await self._run_follow(follow)
        return result

    def _queue(self, payload, on_result) -> None:
        self.offline_queue.append((payload, on_result))

    async def _flush(self) -> None:
        follow: list = []
        async with self._send_lock:
            await self._flush_locked(follow)
        await self._run_follow(follow)

    @staticmethod
    async def _run_follow(follow: list) -> None:
        # `on_result` e sincrono (so contabilidade) e devolve, se precisar,
        # uma corrotina que envia mensagens: roda fora do lock de envio.
        for coro in follow:
            await coro

    async def _flush_locked(self, follow: list) -> bool:
        """Reenvia a fila em ordem. False se travou (segue offline/sem resposta)."""
        while self.offline_queue:
            if not self.connected:
                return False
            payload, on_result = self.offline_queue[0]
            self._patch_transaction_id(payload)
            ok, _ = await self._try_send(payload, on_result, follow)
            if not ok:
                return False
            self.offline_queue.pop(0)
        return True

    def _patch_transaction_id(self, payload) -> None:
        cid = getattr(payload, "_connector", None)
        if cid is None or getattr(payload, "transaction_id", 0) not in (None, PENDING_TX):
            return
        known = self.connectors[cid].last_tx_id
        if known is not None:
            payload.transaction_id = known

    async def _deliver(self, payload, transactional, on_result, follow):
        ok, result = await self._try_send(payload, on_result, follow)
        if not ok and transactional:
            self._queue(payload, on_result)
        return result

    async def _try_send(self, payload, on_result, follow):
        """(entregue_ou_recusado, resposta). (False, None) = tentar de novo depois."""
        call_task = asyncio.ensure_future(self.call(payload))
        closed_task = asyncio.ensure_future(self._closed.wait())
        try:
            await asyncio.wait({call_task, closed_task}, return_when=asyncio.FIRST_COMPLETED)
            if not call_task.done():  # conexao caiu esperando a resposta
                return False, None
            try:
                result = call_task.result()
            except ConnectionClosed:
                self.connected = False
                self._closed.set()
                return False, None
            except asyncio.TimeoutError:
                LOGGER.warning("sem resposta para %s", type(payload).__name__)
                return False, None
        finally:
            for task in (call_task, closed_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(call_task, closed_task, return_exceptions=True)
        if result is not None and on_result is not None:
            extra = on_result(result)
            if extra is not None:
                follow.append(extra)
        return True, result  # CallError (result None) nao e reenviado

    # --------------------------------------------------- mensagens de saida

    async def heartbeat(self):
        return await self.request(call.Heartbeat())

    async def _status_raw(self, connector_id, status, error_code="NoError", info=None, announce=False):
        return await self.request(
            call.StatusNotification(
                connector_id=connector_id,
                error_code=error_code,
                status=status,
                timestamp=self.now(),
                info=info,
            ),
            announce=announce,
        )

    async def _notify(self, c: Connector, info: str | None = None):
        return await self._status_raw(c.id, c.state.value, c.error_code, info)

    async def _set_state(self, c: Connector, new: State, *, error_code="NoError", info=None):
        c.transition(new)
        c.error_code = error_code
        await self._notify(c, info)

    async def authorize(self, id_tag: str) -> str | None:
        res = await self.request(call.Authorize(id_tag=id_tag))
        return None if res is None else res.id_tag_info["status"]

    def _sample(self, wh: float) -> dict:
        unit = self.faults.meter_unit
        value = _fmt_kwh(wh) if unit == "kWh" else str(int(round(wh)))
        samples = []
        if self.faults.meter_omit_measurand:
            samples.append({"value": value, "unit": unit})
        else:
            samples.append(
                {
                    "value": value,
                    "context": "Sample.Periodic",
                    "measurand": "Energy.Active.Import.Register",
                    "unit": unit,
                }
            )
            samples.append(
                {
                    "value": str(int(round(self.power_kw * 1000))),
                    "context": "Sample.Periodic",
                    "measurand": "Power.Active.Import",
                    "unit": "W",
                }
            )
        return {"timestamp": self.now(), "sampledValue": samples}

    async def send_meter_values(self, connector_id: int, wh: float | None = None):
        c = self.connectors[connector_id]
        wh = c.register_wh if wh is None else wh
        payload = call.MeterValues(
            connector_id=connector_id,
            meter_value=[self._sample(wh)],
            transaction_id=c.transaction_id if c.in_transaction else None,
        )
        payload._connector = connector_id
        return await self.request(payload, transactional=c.in_transaction)

    # ------------------------------------------------------------ transacoes

    async def _begin_transaction(self, c: Connector, id_tag: str) -> None:
        c.id_tag = id_tag
        c.last_tx_id = None
        c.tx_start_wh = c.register_wh
        c.last_sent_wh = c.register_wh

        def on_result(res):
            return self._on_start_result(c, id_tag, res)

        if not self.connected:  # offline: carrega localmente, avisa depois
            await self._enter_charging(c)
        payload = call.StartTransaction(
            connector_id=c.id,
            id_tag=id_tag,
            meter_start=int(round(c.register_wh)),
            timestamp=self.now(),
        )
        await self.request(payload, transactional=True, on_result=on_result)

    async def _enter_charging(self, c: Connector) -> None:
        c.in_transaction = True
        c.meter_task = self._spawn(self._meter_loop(c), self._flows)
        await self._set_state(c, State.CHARGING)

    def _on_start_result(self, c: Connector, id_tag: str, res):
        """Contabilidade sincrona da resposta do Start; devolve (se precisar)
        a corrotina de follow-up, executada fora do lock de envio."""
        tx_id = res.transaction_id
        c.last_tx_id = tx_id
        if res.id_tag_info["status"] == "Accepted":
            c.transaction_id = tx_id
            return None if c.in_transaction else self._enter_charging(c)
        c.in_transaction = False  # CSMS recusou a tag
        c.transaction_id = None
        return self._deauthorize(c, id_tag, tx_id)

    async def _deauthorize(self, c: Connector, id_tag: str, tx_id: int) -> None:
        # 1.6: tag recusada no Start -> StopTransaction(reason=DeAuthorized)
        await self._cancel_meter(c)
        stop = call.StopTransaction(
            meter_stop=int(round(c.register_wh)),
            timestamp=self.now(),
            transaction_id=tx_id,
            reason="DeAuthorized",
            id_tag=id_tag,
        )
        stop._connector = c.id
        await self.request(stop, transactional=True)
        if c.state == State.CHARGING:
            await self._set_state(c, State.FINISHING)
        if c.state in (State.FINISHING, State.PREPARING):
            await self._set_state(c, State.AVAILABLE)

    async def _cancel_meter(self, c: Connector) -> None:
        task, c.meter_task = c.meter_task, None
        if task and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _meter_loop(self, c: Connector) -> None:
        while c.in_transaction:
            await self._sleep(self.meter_interval_s)
            if not c.in_transaction:
                break
            await self.meter_tick(c.id)

    async def meter_tick(self, connector_id: int) -> None:
        c = self.connectors[connector_id]
        c.register_wh += self.power_kw * 1000 * self.meter_interval_s * self.time_scale / 3600
        if self.faults.meter_regress:
            sent = max(0.0, c.last_sent_wh - self.faults.meter_regress_step_wh)
        else:
            sent = c.register_wh
        c.last_sent_wh = sent
        await self.send_meter_values(connector_id, sent)
        if (
            self.stop_after_wh is not None
            and round(c.register_wh - c.tx_start_wh, 6) >= self.stop_after_wh
        ):
            await self.stop_transaction(connector_id, reason="Local")

    async def stop_transaction(self, connector_id: int, reason: str = "Local") -> bool:
        c = self.connectors[connector_id]
        if not c.in_transaction:
            return False
        c.in_transaction = False  # antes de qualquer await: evita parada dupla
        await self._cancel_meter(c)
        tx_id = c.transaction_id if c.transaction_id is not None else PENDING_TX
        c.transaction_id = None
        stop = call.StopTransaction(
            meter_stop=int(round(c.register_wh)),
            timestamp=self.now(),
            transaction_id=tx_id,
            reason=reason,
            id_tag=c.id_tag,
            transaction_data=[self._sample(c.register_wh)] if self.faults.stop_transaction_data else None,
        )
        stop._connector = c.id
        await self.request(stop, transactional=True)
        if c.state in (State.CHARGING, State.SUSPENDED_EV, State.SUSPENDED_EVSE):
            await self._set_state(c, State.FINISHING)
            c.finish_task = self._spawn(self._finish(c), self._flows)
        return True

    async def _finish(self, c: Connector) -> None:
        await self._sleep(self.finish_delay_s)
        if c.state != State.FINISHING:
            return
        if c.pending_inoperative:
            c.pending_inoperative = False
            await self._set_state(c, State.UNAVAILABLE)
        else:
            await self._set_state(c, State.AVAILABLE)

    async def start_local(self, connector_id: int, id_tag: str, *, force_start: bool = False):
        """Inicio local (totem, RC-06/RC-07): Authorize e depois StartTransaction."""
        c = self.connectors[connector_id]
        if c.state == State.AVAILABLE:
            await self._set_state(c, State.PREPARING)
        elif c.state != State.PREPARING:
            raise InvalidTransition(f"conector {c.id} nao pode iniciar em {c.state}")
        status = await self.authorize(id_tag)
        if status != "Accepted" and not force_start:
            await self._set_state(c, State.AVAILABLE)
            return status
        await self._begin_transaction(c, id_tag)
        return status

    async def fault(self, error_code: str = "GroundFailure", connector_id: int = 1) -> None:
        """Falha de hardware. "EmergencyStop" manda Faulted/OtherError(info) e
        StopTransaction(reason=EmergencyStop); outros codigos seguem como estao."""
        code, info, reason = fault_notification(error_code)
        c = self.connectors[connector_id]
        if c.state == State.FAULTED:
            c.error_code = code
            await self._notify(c, info)
        else:
            await self._set_state(c, State.FAULTED, error_code=code, info=info)
        if c.in_transaction:
            await self.stop_transaction(connector_id, reason=reason)

    async def clear_fault(self, connector_id: int = 1) -> None:
        c = self.connectors[connector_id]
        if c.state == State.FAULTED:
            await self._set_state(c, State.AVAILABLE)

    # --------------------------------------------------------------- comandos

    async def _gate(self, action: str, call_unique_id: str | None, payload: dict) -> bool:
        """Aplica atraso/silencio da injecao de falhas. True = deve rejeitar."""
        self.received_commands.append((action, payload))
        if self.faults.silences(action):
            self.silenced.add(call_unique_id)
            await asyncio.Event().wait()  # nunca responde; cancelado ao desconectar
        delay = self.faults.delay_for(action)
        if delay:
            await self._sleep(delay)
        return self.faults.rejects(action)

    def _defer(self, call_unique_id: str, job: Callable[[], Awaitable[None]]) -> None:
        self._deferred[call_unique_id] = job

    async def _run_deferred(self, call_unique_id: str | None) -> None:
        job = self._deferred.pop(call_unique_id, None)
        if job:
            self._spawn(job(), self._flows)

    @on("RemoteStartTransaction")
    async def on_remote_start(self, id_tag, connector_id=None, call_unique_id=None, **kw):
        rejected = await self._gate(
            "RemoteStartTransaction", call_unique_id, {"id_tag": id_tag, "connector_id": connector_id}
        )
        c = self._pick_connector(connector_id)
        if (
            rejected
            or c is None
            or c.state not in (State.AVAILABLE, State.PREPARING)
            or c.flow_pending
            or c.in_transaction
        ):
            return call_result.RemoteStartTransaction(status="Rejected")
        announce = c.state == State.AVAILABLE
        if announce:
            c.transition(State.PREPARING)
        c.id_tag = id_tag
        c.flow_pending = True

        async def flow():
            try:
                if announce:
                    await self._notify(c)
                if self.plug_delay_s is None:
                    return  # cabo nunca plugado (RC-03)
                if self.plug_delay_s > 0:
                    await self._sleep(self.plug_delay_s)
                await self._begin_transaction(c, id_tag)
            finally:
                c.flow_pending = False

        async def start_flow():  # roda depois que a resposta Accepted saiu
            c.flow_task = self._spawn(flow(), self._flows)

        self._defer(call_unique_id, start_flow)
        return call_result.RemoteStartTransaction(status="Accepted")

    @after("RemoteStartTransaction")
    async def after_remote_start(self, call_unique_id=None, **kw):
        await self._run_deferred(call_unique_id)

    def _pick_connector(self, connector_id) -> Connector | None:
        if connector_id:
            return self.connectors.get(connector_id)
        return next((c for c in self.connectors.values() if c.state == State.AVAILABLE), None)

    @on("RemoteStopTransaction")
    async def on_remote_stop(self, transaction_id, call_unique_id=None, **kw):
        rejected = await self._gate("RemoteStopTransaction", call_unique_id, {"transaction_id": transaction_id})
        c = next((x for x in self.connectors.values() if x.in_transaction and x.transaction_id == transaction_id), None)
        if rejected or c is None:
            return call_result.RemoteStopTransaction(status="Rejected")
        self._defer(call_unique_id, lambda: self.stop_transaction(c.id, reason="Remote"))
        return call_result.RemoteStopTransaction(status="Accepted")

    @after("RemoteStopTransaction")
    async def after_remote_stop(self, call_unique_id=None, **kw):
        await self._run_deferred(call_unique_id)

    @on("Reset")
    async def on_reset(self, type, call_unique_id=None, **kw):
        if await self._gate("Reset", call_unique_id, {"type": type}):
            return call_result.Reset(status="Rejected")
        self._defer(call_unique_id, lambda: self._do_reset(type))
        return call_result.Reset(status="Accepted")

    @after("Reset")
    async def after_reset(self, call_unique_id=None, **kw):
        await self._run_deferred(call_unique_id)

    async def _do_reset(self, reset_type: str) -> None:
        self.resets += 1
        reason = "HardReset" if reset_type == "Hard" else "SoftReset"
        for c in self.connectors.values():
            if c.in_transaction:
                await self.stop_transaction(c.id, reason=reason)
        for c in self.connectors.values():  # reboot: volta tudo ao estado inicial
            for task in (c.finish_task, c.flow_task):
                if isinstance(task, asyncio.Task):
                    task.cancel()
            c.state, c.error_code, c.id_tag = State.AVAILABLE, "NoError", None
            c.flow_task, c.flow_pending = None, False
            c.pending_inoperative = False
        if reset_type == "Hard":
            await self.drop_connection(self.reset_wait_s)  # fecha, espera, reconecta (ST-03)
        else:
            await self._announce()

    @on("ChangeAvailability")
    async def on_change_availability(self, connector_id, type, call_unique_id=None, **kw):
        rejected = await self._gate("ChangeAvailability", call_unique_id, {"connector_id": connector_id, "type": type})
        targets = list(self.connectors.values()) if connector_id == 0 else [self.connectors.get(connector_id)]
        if rejected or targets == [None]:
            return call_result.ChangeAvailability(status="Rejected")
        scheduled = False
        for c in targets:
            if type == "Inoperative" and c.in_transaction:
                c.pending_inoperative = True
                scheduled = True
        self._defer(call_unique_id, lambda: self._apply_availability(targets, type))
        return call_result.ChangeAvailability(status="Scheduled" if scheduled else "Accepted")

    @after("ChangeAvailability")
    async def after_change_availability(self, call_unique_id=None, **kw):
        await self._run_deferred(call_unique_id)

    async def _apply_availability(self, targets, type) -> None:
        for c in targets:
            if c.state == State.FAULTED:
                continue
            if type == "Inoperative" and not c.in_transaction and c.state != State.UNAVAILABLE:
                await self._set_state(c, State.UNAVAILABLE)
            elif type == "Operative":
                c.pending_inoperative = False
                if c.state == State.UNAVAILABLE:
                    await self._set_state(c, State.AVAILABLE)

    @on("GetConfiguration")
    async def on_get_configuration(self, key=None, call_unique_id=None, **kw):
        await self._gate("GetConfiguration", call_unique_id, {"key": key})
        wanted = key or list(self.config)
        known = [{"key": k, "readonly": self.config[k][1], "value": self.config[k][0]} for k in wanted if k in self.config]
        unknown = [k for k in wanted if k not in self.config]
        return call_result.GetConfiguration(configuration_key=known, unknown_key=unknown or None)

    @on("ChangeConfiguration")
    async def on_change_configuration(self, key, value, call_unique_id=None, **kw):
        rejected = await self._gate("ChangeConfiguration", call_unique_id, {"key": key, "value": value})
        if key not in self.config:
            return call_result.ChangeConfiguration(status="NotSupported")
        if rejected or self.config[key][1]:
            return call_result.ChangeConfiguration(status="Rejected")
        if key in ("HeartbeatInterval", "MeterValueSampleInterval"):
            try:
                seconds = float(value)
            except ValueError:
                seconds = 0
            if seconds <= 0:
                return call_result.ChangeConfiguration(status="Rejected")
            if key == "HeartbeatInterval":
                self.heartbeat_interval_s = seconds
            else:
                self.meter_interval_s = seconds
        self.config[key][0] = str(value)
        return call_result.ChangeConfiguration(status="Accepted")

    @on("UnlockConnector")
    async def on_unlock_connector(self, connector_id, call_unique_id=None, **kw):
        rejected = await self._gate("UnlockConnector", call_unique_id, {"connector_id": connector_id})
        c = self.connectors.get(connector_id)
        if rejected or c is None:
            return call_result.UnlockConnector(status="UnlockFailed" if c else "NotSupported")
        if c.in_transaction:
            self._defer(call_unique_id, lambda: self.stop_transaction(c.id, reason="UnlockCommand"))
        return call_result.UnlockConnector(status="Unlocked")

    @after("UnlockConnector")
    async def after_unlock_connector(self, call_unique_id=None, **kw):
        await self._run_deferred(call_unique_id)

    @on("TriggerMessage")
    async def on_trigger_message(self, requested_message, connector_id=None, call_unique_id=None, **kw):
        rejected = await self._gate(
            "TriggerMessage", call_unique_id, {"requested_message": requested_message, "connector_id": connector_id}
        )
        if rejected:
            return call_result.TriggerMessage(status="Rejected")
        if requested_message not in ("BootNotification", "Heartbeat", "StatusNotification", "MeterValues"):
            return call_result.TriggerMessage(status="NotImplemented")
        if connector_id is not None and connector_id not in self.connectors and not (
            connector_id == 0 and requested_message == "StatusNotification"
        ):
            return call_result.TriggerMessage(status="Rejected")
        self._defer(call_unique_id, lambda: self._do_trigger(requested_message, connector_id))
        return call_result.TriggerMessage(status="Accepted")

    @after("TriggerMessage")
    async def after_trigger_message(self, call_unique_id=None, **kw):
        await self._run_deferred(call_unique_id)

    async def _do_trigger(self, message: str, connector_id: int | None) -> None:
        if message == "BootNotification":
            await self._announce()
        elif message == "Heartbeat":
            await self.heartbeat()
        elif message == "StatusNotification":
            ids = [connector_id] if connector_id is not None else [0, *self.connectors]
            for cid in ids:
                if cid == 0:
                    await self._status_raw(0, State.AVAILABLE.value)
                else:
                    await self._notify(self.connectors[cid])
        elif message == "MeterValues":
            ids = [connector_id] if connector_id else list(self.connectors)
            for cid in ids:
                await self.send_meter_values(cid)


def frame_printer(direction: str, raw: str) -> None:
    """Imprime cada frame [2,...]/[3,...]/[4,...] (--log-frames)."""
    try:
        text = json.dumps(json.loads(raw), separators=(",", ":"), ensure_ascii=False)
    except ValueError:
        text = raw
    print(f"{direction} {text}", flush=True)
