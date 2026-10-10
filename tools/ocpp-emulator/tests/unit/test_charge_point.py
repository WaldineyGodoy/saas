"""Testes unitarios do emulador (sem rede).

Conexao fake: `send` grava frames, `recv` entrega frames injetados e responde
automaticamente aos Calls do carregador como um CSMS permissivo. O tempo e
controlado por `StepSleep`: cada `sleep` fica bloqueado ate o teste liberar.
"""

import asyncio
import base64
import json

import pytest
import pytest_asyncio
from websockets.exceptions import ConnectionClosedOK

from emulator import Faults, InvalidTransition, VirtualChargePoint
from emulator.charge_point import State, basic_auth, ws_url


class FakeConnection:
    def __init__(self, auto_reply=True):
        self.sent = []
        self.closed = False
        self.auto_reply = auto_reply
        self._in = asyncio.Queue()
        self._tx = 100

    def _reply(self, action, payload):
        if action == "BootNotification":
            return {"status": "Accepted", "currentTime": "2026-10-04T12:00:00Z", "interval": 300}
        if action == "Heartbeat":
            return {"currentTime": "2026-10-04T12:00:00Z"}
        if action == "StartTransaction":
            self._tx += 1
            return {"transactionId": self._tx, "idTagInfo": {"status": "Accepted"}}
        if action == "Authorize":
            return {"idTagInfo": {"status": "Accepted"}}
        return {}

    async def send(self, raw):
        if self.closed:
            raise ConnectionClosedOK(None, None)
        frame = json.loads(raw)
        self.sent.append(frame)
        if frame[0] == 2 and self.auto_reply:
            self._in.put_nowait(json.dumps([3, frame[1], self._reply(frame[2], frame[3])]))

    async def recv(self):
        item = await self._in.get()
        if item is None:
            raise ConnectionClosedOK(None, None)
        return item

    async def close(self):
        self.drop()

    def drop(self):
        self.closed = True
        self._in.put_nowait(None)

    def inject(self, frame):
        self._in.put_nowait(json.dumps(frame))

    def calls(self, action=None):
        return [f for f in self.sent if f[0] == 2 and (action is None or f[2] == action)]

    def results(self):
        return [f for f in self.sent if f[0] == 3]

    def result_for(self, unique_id):
        for f in self.sent:
            if f[0] == 3 and f[1] == unique_id:
                return f[2]
        return None


class StepSleep:
    def __init__(self):
        self.calls = []
        self._sem = asyncio.Semaphore(0)

    async def __call__(self, seconds):
        self.calls.append(seconds)
        await self._sem.acquire()

    def release(self, n=1):
        for _ in range(n):
            self._sem.release()


async def settle(pred=lambda: False, timeout=3.0):
    """Espera o predicado ficar verdadeiro (a validacao de schema da lib roda
    em thread, entao precisa de tempo real, nao so de yields)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if pred():
            return True
        await asyncio.sleep(0.002)
    return pred()


class Rig:
    def __init__(self, cp, conn, sleep):
        self.cp, self.conn, self.sleep = cp, conn, sleep
        self.session = None

    async def connect(self, conn=None):
        conn = conn or self.conn
        self.conn = conn
        self.session = asyncio.create_task(self.cp.run_session(conn))
        assert await settle(lambda: len(conn.calls("StatusNotification")) >= 3)

    async def remote_start(self, uid="rs1", id_tag="TAG1", connector=1):
        self.conn.inject([2, uid, "RemoteStartTransaction", {"idTag": id_tag, "connectorId": connector}])
        assert await settle(lambda: self.conn.result_for(uid) is not None or uid in self.cp.silenced)

    async def start_charging(self, connector=1):
        await self.remote_start(connector=connector)
        self.sleep.release()  # plug delay
        assert await settle(lambda: self.cp.connectors[connector].state == State.CHARGING)
        # o estado muda antes do envio: espera a StatusNotification(Charging) sair
        assert await settle(
            lambda: any(f[3]["status"] == "Charging" for f in self.conn.calls("StatusNotification"))
        )


@pytest_asyncio.fixture
async def make_rig():
    rigs = []

    def factory(**kw):
        conn = FakeConnection()
        sleep = StepSleep()
        kw.setdefault("plug_delay_s", 5.0)
        kw.setdefault("sleep", sleep)
        cp = VirtualChargePoint("CP_EMU_01", **kw)
        rig = Rig(cp, conn, kw["sleep"])
        rigs.append(rig)
        return rig

    yield factory
    for rig in rigs:
        rig.sleep.release(1000)
        await rig.cp.shutdown()
        if rig.session:
            rig.conn.drop()
            await asyncio.gather(rig.session, return_exceptions=True)


# --------------------------------------------------------------- estado


def test_connector_state_machine_valid_path():
    cp = VirtualChargePoint("X")
    c = cp.connectors[1]
    assert c.state == State.AVAILABLE
    for nxt in (State.PREPARING, State.CHARGING, State.FINISHING, State.AVAILABLE):
        c.transition(nxt)
        assert c.state == nxt
    c.transition(State.FAULTED)
    assert c.state == State.FAULTED


def test_connector_invalid_transition_raises():
    c = VirtualChargePoint("X").connectors[1]
    with pytest.raises(InvalidTransition):
        c.transition(State.CHARGING)  # Available -> Charging nao existe
    assert c.state == State.AVAILABLE
    c.transition(State.PREPARING)
    with pytest.raises(InvalidTransition):
        c.transition(State.FINISHING)


def test_url_and_basic_auth():
    assert ws_url("ws://localhost:9220/ocpp/", "CP_EMU_01") == "ws://localhost:9220/ocpp/CP_EMU_01"
    assert ws_url("ws://h:1/ocpp", "A B") == "ws://h:1/ocpp/A%20B"
    assert basic_auth("CP", "pw") == "Basic " + base64.b64encode(b"CP:pw").decode()


# ------------------------------------------------------------- conexao


async def test_boot_then_status_for_connector_zero_and_each_connector(make_rig):
    rig = make_rig()
    await rig.connect()
    actions = [f[2] for f in rig.conn.calls()]
    assert actions[0] == "BootNotification"
    status = [f[3] for f in rig.conn.calls("StatusNotification")]
    assert [s["connectorId"] for s in status[:3]] == [0, 1, 2]
    assert all(s["status"] == "Available" and s["errorCode"] == "NoError" for s in status[:3])


# --------------------------------------------------------- RemoteStart


async def test_remote_start_accepted_schedules_start_after_plug_delay(make_rig):
    rig = make_rig(plug_delay_s=5.0)
    await rig.connect()
    await rig.remote_start()
    assert rig.conn.result_for("rs1") == {"status": "Accepted"}
    assert await settle(lambda: 5.0 in rig.sleep.calls)
    await settle(timeout=0.1)
    assert rig.conn.calls("StartTransaction") == []  # cabo ainda nao plugado
    assert rig.cp.connectors[1].state == State.PREPARING
    rig.sleep.release()
    assert await settle(lambda: len(rig.conn.calls("StartTransaction")) == 1)
    start = rig.conn.calls("StartTransaction")[0][3]
    assert start["idTag"] == "TAG1" and start["connectorId"] == 1
    assert isinstance(start["meterStart"], int)
    assert await settle(lambda: rig.cp.connectors[1].state == State.CHARGING)
    assert rig.cp.connectors[1].transaction_id == 101


async def test_plug_delay_none_never_plugs(make_rig):
    rig = make_rig(plug_delay_s=None)
    await rig.connect()
    await rig.remote_start()
    assert rig.conn.result_for("rs1") == {"status": "Accepted"}
    rig.sleep.release(10)
    await settle(timeout=0.15)
    assert rig.conn.calls("StartTransaction") == []
    assert rig.cp.connectors[1].state == State.PREPARING


async def test_reject_remote_start(make_rig):
    rig = make_rig(faults=Faults(reject={"RemoteStartTransaction": True}))
    await rig.connect()
    await rig.remote_start()
    assert rig.conn.result_for("rs1") == {"status": "Rejected"}
    rig.sleep.release(10)
    await settle(timeout=0.15)
    assert rig.conn.calls("StartTransaction") == []
    assert rig.cp.connectors[1].state == State.AVAILABLE


# --------------------------------------------------------- MeterValues


def _energy_sample(frame):
    sv = frame[3]["meterValue"][0]["sampledValue"]
    return next(s for s in sv if s.get("measurand", "Energy.Active.Import.Register") == "Energy.Active.Import.Register")


async def test_meter_values_in_kwh(make_rig):
    # 7.2 kW durante 5 s = 10 Wh -> "0.01" kWh
    rig = make_rig(power_kw=7.2, meter_interval_s=5, meter_start_wh=0, faults=Faults(meter_unit="kWh"))
    await rig.connect()
    await rig.start_charging()
    rig.sleep.release()  # um tick de medicao
    assert await settle(lambda: len(rig.conn.calls("MeterValues")) == 1)
    frame = rig.conn.calls("MeterValues")[0]
    sample = _energy_sample(frame)
    assert sample["value"] == "0.01" and sample["unit"] == "kWh"
    assert frame[3]["transactionId"] == 101 and frame[3]["connectorId"] == 1


async def test_meter_values_in_wh_default(make_rig):
    rig = make_rig(power_kw=7.2, meter_interval_s=5, meter_start_wh=0)
    await rig.connect()
    await rig.start_charging()
    rig.sleep.release()
    assert await settle(lambda: len(rig.conn.calls("MeterValues")) == 1)
    sample = _energy_sample(rig.conn.calls("MeterValues")[0])
    assert sample["value"] == "10" and sample["unit"] == "Wh"


async def test_meter_regress_sends_lower_value(make_rig):
    rig = make_rig(power_kw=7.2, meter_interval_s=5, meter_start_wh=10000, faults=Faults(meter_regress=True))
    await rig.connect()
    await rig.start_charging()
    start = rig.conn.calls("StartTransaction")[0][3]["meterStart"]
    rig.sleep.release(2)
    assert await settle(lambda: len(rig.conn.calls("MeterValues")) == 2)
    values = [float(_energy_sample(f)["value"]) for f in rig.conn.calls("MeterValues")]
    assert values[0] < start
    assert values[1] < values[0]


async def test_stop_after_wh_stops_transaction_locally(make_rig):
    rig = make_rig(power_kw=7.2, meter_interval_s=5, meter_start_wh=0, stop_after_wh=20, finish_delay_s=1)
    await rig.connect()
    await rig.start_charging()
    rig.sleep.release(2)
    assert await settle(lambda: len(rig.conn.calls("StopTransaction")) == 1)
    stop = rig.conn.calls("StopTransaction")[0][3]
    assert stop["meterStop"] == 20 and stop["transactionId"] == 101
    assert stop["reason"] == "Local"


async def test_remote_stop_closes_transaction_and_returns_to_available(make_rig):
    rig = make_rig()
    await rig.connect()
    await rig.start_charging()
    rig.conn.inject([2, "st1", "RemoteStopTransaction", {"transactionId": 101}])
    assert await settle(lambda: rig.conn.result_for("st1") is not None)
    assert rig.conn.result_for("st1") == {"status": "Accepted"}
    assert await settle(lambda: len(rig.conn.calls("StopTransaction")) == 1)
    assert rig.conn.calls("StopTransaction")[0][3]["reason"] == "Remote"
    assert await settle(lambda: rig.cp.connectors[1].state == State.FINISHING)
    rig.sleep.release(5)
    assert await settle(lambda: rig.cp.connectors[1].state == State.AVAILABLE)


async def test_remote_stop_unknown_transaction_rejected(make_rig):
    rig = make_rig()
    await rig.connect()
    rig.conn.inject([2, "st1", "RemoteStopTransaction", {"transactionId": 999}])
    assert await settle(lambda: rig.conn.result_for("st1") is not None)
    assert rig.conn.result_for("st1") == {"status": "Rejected"}


# ----------------------------------------------------------- fila offline


async def test_offline_queue_flushed_in_order_on_reconnect(make_rig):
    rig = make_rig(power_kw=7.2, meter_interval_s=5, meter_start_wh=0, finish_delay_s=1)
    await rig.connect()
    await rig.start_charging()
    first = rig.conn
    first.drop()
    await asyncio.gather(rig.session)
    sent_before = len(first.sent)
    assert not rig.cp.connected

    # offline: duas medicoes, um heartbeat (descartado) e o Stop
    rig.sleep.release(2)
    assert await settle(lambda: len(rig.cp.offline_queue) == 2)
    await rig.cp.heartbeat()
    assert len(rig.cp.offline_queue) == 2
    await rig.cp.stop_transaction(1, reason="Local")
    assert [type(p).__name__ for p, _ in rig.cp.offline_queue] == ["MeterValues", "MeterValues", "StopTransaction"]
    assert len(first.sent) == sent_before  # nada saiu pelo socket morto

    second = FakeConnection()
    await rig.connect(second)
    assert await settle(lambda: len(second.calls("StopTransaction")) == 1)
    actions = [f[2] for f in second.calls()]
    assert actions[0] == "BootNotification"
    tail = [a for a in actions if a in ("MeterValues", "StopTransaction")]
    assert tail == ["MeterValues", "MeterValues", "StopTransaction"]
    assert "Heartbeat" not in actions[:6]
    mv = [float(_energy_sample(f)["value"]) for f in second.calls("MeterValues")]
    assert mv == sorted(mv) and mv[0] < mv[1]
    assert await settle(lambda: rig.cp.offline_queue == [])  # sai da fila so apos o ACK


# ------------------------------------------------------ injecao de falhas


async def test_delay_response_get_configuration_does_not_block_other_messages(make_rig):
    rig = make_rig(faults=Faults(delay_response_s={"GetConfiguration": 10}))
    await rig.connect()
    rig.conn.inject([2, "gc1", "GetConfiguration", {}])
    assert await settle(lambda: 10 in rig.sleep.calls)
    rig.conn.inject([2, "cc1", "ChangeConfiguration", {"key": "HeartbeatInterval", "value": "60"}])
    assert await settle(lambda: rig.conn.result_for("cc1") is not None)
    assert rig.conn.result_for("cc1") == {"status": "Accepted"}
    assert rig.conn.result_for("gc1") is None  # ainda atrasada
    rig.sleep.release()
    assert await settle(lambda: rig.conn.result_for("gc1") is not None)
    keys = {k["key"] for k in rig.conn.result_for("gc1")["configurationKey"]}
    assert "HeartbeatInterval" in keys


async def test_no_response_never_answers_but_keeps_serving(make_rig):
    rig = make_rig(faults=Faults(no_response={"RemoteStartTransaction"}))
    await rig.connect()
    rig.conn.inject([2, "rs1", "RemoteStartTransaction", {"idTag": "TAG1", "connectorId": 1}])
    rig.conn.inject([2, "cc1", "ChangeConfiguration", {"key": "HeartbeatInterval", "value": "60"}])
    assert await settle(lambda: rig.conn.result_for("cc1") is not None)
    rig.sleep.release(10)
    await settle(timeout=0.2)
    assert rig.conn.result_for("rs1") is None
    assert not [f for f in rig.conn.sent if f[0] == 4 and f[1] == "rs1"]
    assert rig.conn.calls("StartTransaction") == []
    assert rig.cp.connectors[1].state == State.AVAILABLE


async def test_emergency_stop_sends_faulted_other_error_then_stop_reason(make_rig):
    rig = make_rig(meter_start_wh=0)
    await rig.connect()
    await rig.start_charging()
    n = len(rig.conn.sent)
    await rig.cp.fault("EmergencyStop")
    new = rig.conn.sent[n:]
    new_calls = [f for f in new if f[0] == 2]
    assert new_calls[0][2] == "StatusNotification"
    assert new_calls[0][3]["status"] == "Faulted"
    assert new_calls[0][3]["errorCode"] == "OtherError"
    assert new_calls[0][3]["info"] == "EmergencyStop"
    assert new_calls[1][2] == "StopTransaction"
    assert new_calls[1][3]["reason"] == "EmergencyStop"
    assert rig.cp.connectors[1].state == State.FAULTED


async def test_ground_failure_fault(make_rig):
    rig = make_rig()
    await rig.connect()
    await rig.cp.fault("GroundFailure")
    last = rig.conn.calls("StatusNotification")[-1][3]
    assert last["status"] == "Faulted" and last["errorCode"] == "GroundFailure"
    # com falha, RemoteStart e rejeitado
    await rig.remote_start()
    assert rig.conn.result_for("rs1") == {"status": "Rejected"}


# ----------------------------------------------------------- outros comandos


async def test_reset_hard_closes_socket_and_asks_two_seconds_before_reconnect(make_rig):
    rig = make_rig()
    await rig.connect()
    await rig.cp.fault("GroundFailure")
    rig.conn.inject([2, "rst1", "Reset", {"type": "Hard"}])
    assert await settle(lambda: rig.conn.result_for("rst1") == {"status": "Accepted"})
    assert await settle(lambda: rig.conn.closed)
    assert rig.cp.consume_reconnect_delay() == 2.0
    assert rig.cp.consume_reconnect_delay() is None
    assert all(c.state == State.AVAILABLE for c in rig.cp.connectors.values())  # falha limpa


async def test_reset_soft_reboots_without_closing(make_rig):
    rig = make_rig()
    await rig.connect()
    rig.conn.inject([2, "rst1", "Reset", {"type": "Soft"}])
    assert await settle(lambda: len(rig.conn.calls("BootNotification")) == 2)
    assert not rig.conn.closed


async def test_change_availability_inoperative_and_back(make_rig):
    rig = make_rig()
    await rig.connect()
    rig.conn.inject([2, "ca1", "ChangeAvailability", {"connectorId": 1, "type": "Inoperative"}])
    assert await settle(lambda: rig.cp.connectors[1].state == State.UNAVAILABLE)
    assert rig.conn.result_for("ca1") == {"status": "Accepted"}
    rig.conn.inject([2, "ca2", "ChangeAvailability", {"connectorId": 1, "type": "Operative"}])
    assert await settle(lambda: rig.cp.connectors[1].state == State.AVAILABLE)


async def test_change_configuration_unknown_key_not_supported(make_rig):
    rig = make_rig()
    await rig.connect()
    rig.conn.inject([2, "cc1", "ChangeConfiguration", {"key": "NaoExiste", "value": "1"}])
    assert await settle(lambda: rig.conn.result_for("cc1") is not None)
    assert rig.conn.result_for("cc1") == {"status": "NotSupported"}


async def test_unlock_connector(make_rig):
    rig = make_rig()
    await rig.connect()
    rig.conn.inject([2, "u1", "UnlockConnector", {"connectorId": 1}])
    assert await settle(lambda: rig.conn.result_for("u1") is not None)
    assert rig.conn.result_for("u1") == {"status": "Unlocked"}


async def test_trigger_message_status_notification(make_rig):
    rig = make_rig()
    await rig.connect()
    n = len(rig.conn.calls("StatusNotification"))
    rig.conn.inject([2, "t1", "TriggerMessage", {"requestedMessage": "StatusNotification", "connectorId": 1}])
    assert await settle(lambda: len(rig.conn.calls("StatusNotification")) == n + 1)
    assert rig.conn.result_for("t1") == {"status": "Accepted"}
    rig.conn.inject([2, "t2", "TriggerMessage", {"requestedMessage": "FirmwareStatusNotification"}])
    assert await settle(lambda: rig.conn.result_for("t2") is not None)
    assert rig.conn.result_for("t2") == {"status": "NotImplemented"}


async def test_local_start_authorizes_then_starts(make_rig):
    rig = make_rig(plug_delay_s=0)
    await rig.connect()
    status = await rig.cp.start_local(1, "TAG_TOTEM")
    assert status == "Accepted"
    assert [f[2] for f in rig.conn.calls() if f[2] in ("Authorize", "StartTransaction")] == ["Authorize", "StartTransaction"]
    assert rig.cp.connectors[1].state == State.CHARGING


async def test_invalid_tag_does_not_start_charging(make_rig):
    rig = make_rig(plug_delay_s=0)
    await rig.connect()

    orig = rig.conn._reply

    def reply(action, payload):
        if action in ("Authorize",):
            return {"idTagInfo": {"status": "Invalid"}}
        if action == "StartTransaction":
            return {"transactionId": 7, "idTagInfo": {"status": "Invalid"}}
        return orig(action, payload)

    rig.conn._reply = reply
    status = await rig.cp.start_local(1, "TAG_DESCONHECIDA_99", force_start=True)
    assert status == "Invalid"
    assert rig.cp.connectors[1].transaction_id is None
    stops = rig.conn.calls("StopTransaction")
    assert stops and stops[0][3]["reason"] == "DeAuthorized" and stops[0][3]["transactionId"] == 7


# ------------------------------------------------ rodada de correcao 1


async def test_validation_error_is_recorded_and_does_not_raise(make_rig):
    rig = make_rig(plug_delay_s=0)
    await rig.connect()
    status = await rig.cp.start_local(1, "X" * 30)  # idTag > 20 chars: schema invalido
    assert status is None
    assert rig.cp.erros, "erro de protocolo deve ficar observavel"
    assert rig.cp.connectors[1].state == State.AVAILABLE


async def test_meter_loop_survives_malformed_csms_response(make_rig):
    rig = make_rig(meter_interval_s=5, meter_start_wh=0)
    await rig.connect()
    await rig.start_charging()
    orig = rig.conn._reply
    rig.conn._reply = lambda a, p: {"bogus": 1} if a == "MeterValues" else orig(a, p)
    n = len(rig.conn.calls("MeterValues"))
    rig.sleep.release(2)
    assert await settle(lambda: len(rig.conn.calls("MeterValues")) >= n + 2)
    assert rig.cp.erros
    assert rig.cp.connectors[1].meter_task is not None and not rig.cp.connectors[1].meter_task.done()


async def test_drop_after_is_one_shot(make_rig):
    rig = make_rig(faults=Faults(drop_connection_after_s=0.05))
    await rig.connect()
    first = rig.conn
    assert await settle(lambda: first.closed)
    await asyncio.gather(rig.session)
    second = FakeConnection()
    await rig.connect(second)
    await asyncio.sleep(0.4)
    assert not second.closed


async def test_inoperative_during_pending_flow_aborts_start(make_rig):
    rig = make_rig()
    await rig.connect()
    await rig.remote_start()
    assert rig.cp.connectors[1].state == State.PREPARING
    rig.conn.inject([2, "ca9", "ChangeAvailability", {"connectorId": 1, "type": "Inoperative"}])
    assert await settle(lambda: rig.cp.connectors[1].state == State.UNAVAILABLE)
    rig.sleep.release()  # termina o atraso de plugar
    await asyncio.sleep(0.3)
    c = rig.cp.connectors[1]
    assert not rig.conn.calls("StartTransaction")
    assert c.meter_task is None and not c.in_transaction
    assert c.state == State.UNAVAILABLE


async def test_enter_charging_invalid_transition_leaves_no_meter_task(make_rig):
    rig = make_rig()
    await rig.connect()
    c = rig.cp.connectors[1]
    await rig.cp._set_state(c, State.UNAVAILABLE)
    await rig.cp._enter_charging(c)
    assert c.meter_task is None and not c.in_transaction
    assert rig.cp.erros


async def test_stop_heartbeat_silences_periodic_heartbeat_keeping_socket(make_rig):
    # CP-05: carregador mudo (sem Heartbeat) com a conexao aberta
    rig = make_rig()
    await rig.connect()
    # connect() volta quando as StatusNotification saem; o loop de Heartbeat so
    # nasce depois da resposta da ultima (fim do _announce). Espera por ele.
    assert await settle(lambda: rig.cp._heartbeat_task is not None)
    task = rig.cp._heartbeat_task
    assert not task.done()
    rig.cp.stop_heartbeat()
    assert await settle(task.done)
    assert rig.cp.connected
    assert rig.conn.calls("Heartbeat") == []
