"""Cenarios nomeados (spec 8). Reutilizados pela CLI e pelos testes L3b.

Cada cenario e `async def nome(cp, **opts) -> dict`: dirige um
`VirtualChargePoint` ja conectado e devolve um resumo. Os comandos do CSMS
(RemoteStart/Stop, Reset) chegam pelos handlers do proprio carregador; o
cenario so espera ou provoca eventos locais. `run_scenario` espera o Boot.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

from .charge_point import State, VirtualChargePoint


class ScenarioTimeout(Exception):
    pass


async def _until(cp: VirtualChargePoint, predicate, timeout: float | None, what: str) -> None:
    if not await cp.wait_until(predicate, timeout):
        raise ScenarioTimeout(f"timeout esperando {what}")


async def wait_started(cp, connector=1, timeout=None):
    await _until(cp, lambda: cp.connectors[connector].in_transaction, timeout, "inicio da transacao")


async def wait_ended(cp, connector=1, timeout=None):
    c = cp.connectors[connector]
    await _until(cp, lambda: not c.in_transaction and not c.flow_pending, timeout, "fim da transacao")


async def wait_idle(cp, connector=1, timeout=None):
    """Transacao encerrada, conector de volta a Available e fila offline vazia."""
    c = cp.connectors[connector]
    await _until(
        cp,
        lambda: not c.in_transaction and c.state == State.AVAILABLE and not cp.offline_queue,
        timeout,
        "conector disponivel",
    )


def summary(cp: VirtualChargePoint, connector: int = 1) -> dict:
    c = cp.connectors[connector]
    return {
        "connector": connector,
        "state": c.state.value,
        "transaction_id": c.last_tx_id,
        "energy_wh": round(c.register_wh - c.tx_start_wh, 3),
        "register_wh": round(c.register_wh, 3),
        "offline_queue": len(cp.offline_queue),
    }


async def happy_path(cp, connector=1, id_tag=None, timeout=900):
    """RC-01 (ou RC-06 com id_tag): espera o RemoteStart (ou inicia local), mede e
    segue ate o fim (RemoteStop do app ou limite de energia)."""
    if id_tag:
        await cp.start_local(connector, id_tag)
    await wait_started(cp, connector, timeout)
    await wait_ended(cp, connector, timeout)
    await wait_idle(cp, connector, timeout)
    return summary(cp, connector)


async def local_start(cp, connector=1, id_tag="TAG_TOTEM", timeout=900):
    """RC-06: Authorize + StartTransaction locais (totem)."""
    return await happy_path(cp, connector, id_tag=id_tag, timeout=timeout)


async def local_stop(cp, connector=1, after_s=5.0, reason="EVDisconnected", timeout=900):
    """RC-05: espera a recarga comecar e para sem comando do CSMS."""
    await wait_started(cp, connector, timeout)
    await asyncio.sleep(after_s)
    await cp.stop_transaction(connector, reason=reason)
    await wait_idle(cp, connector, timeout)
    return summary(cp, connector)


async def emergency_stop(cp, connector=1, after_s=5.0, timeout=900):
    """ST-02: Faulted/OtherError(info=EmergencyStop) + StopTransaction(EmergencyStop)."""
    await wait_started(cp, connector, timeout)
    await asyncio.sleep(after_s)
    await cp.fault("EmergencyStop", connector)
    return summary(cp, connector)


async def ground_failure(cp, connector=1, wait_reset=True, timeout=900):
    """ST-03: Faulted/GroundFailure e espera o `Reset` do operador."""
    await cp.fault("GroundFailure", connector)
    if wait_reset:
        await _until(cp, lambda: cp.resets > 0, timeout, "Reset")
        await _until(cp, lambda: cp.ready, timeout, "reconexao apos o Reset")
        await _until(cp, lambda: cp.connectors[connector].state == State.AVAILABLE, timeout, "conector Available")
    return summary(cp, connector)


async def invalid_tag(cp, connector=1, id_tag="TAG_DESCONHECIDA_99"):
    """RC-07: Authorize e StartTransaction com tag desconhecida (esperado: Invalid)."""
    authorize = await cp.authorize(id_tag)
    start = await cp.start_local(connector, id_tag, force_start=True)
    return {"authorize": authorize, "start": start, **summary(cp, connector)}


async def drop_during_charge(cp, connector=1, after_s=10.0, offline_s=30.0, timeout=900):
    """RS-01: derruba o socket no meio da recarga; as medicoes acumulam offline
    e sao enviadas na reconexao."""
    await wait_started(cp, connector, timeout)
    await asyncio.sleep(after_s)
    await cp.drop_connection(offline_s)
    await _until(cp, lambda: not cp.connected, 10, "queda da conexao")
    await _until(cp, lambda: cp.ready, offline_s + 60, "reconexao")
    await wait_ended(cp, connector, timeout)
    await wait_idle(cp, connector, timeout)
    return summary(cp, connector)


async def offline_stop(cp, connector=1, after_s=10.0, offline_s=10.0, timeout=900):
    """RS-02: StopTransaction gerado offline (com transactionData), enviado na reconexao."""
    await wait_started(cp, connector, timeout)
    await asyncio.sleep(after_s)
    cp.faults.stop_transaction_data = True
    await cp.drop_connection(offline_s)
    await _until(cp, lambda: not cp.connected, 10, "queda da conexao")
    await cp.stop_transaction(connector, reason="Local")
    await _until(cp, lambda: cp.ready, offline_s + 60, "reconexao")
    await wait_idle(cp, connector, timeout)
    return summary(cp, connector)


def _received(cp, action) -> int:
    return sum(1 for a, _ in cp.received_commands if a == action)


async def never_plug(cp, connector=1, timeout=900):
    """RC-03: aceita o RemoteStart mas nunca pluga o cabo."""
    cp.plug_delay_s = None
    await _until(cp, lambda: _received(cp, "RemoteStartTransaction") >= 1, timeout, "RemoteStart")
    return summary(cp, connector)


async def reject_remote_start(cp, connector=1, timeout=900):
    """RC-02: responde Rejected ao RemoteStart."""
    cp.faults.reject["RemoteStartTransaction"] = True
    await _until(cp, lambda: _received(cp, "RemoteStartTransaction") >= 1, timeout, "RemoteStart")
    return summary(cp, connector)


async def no_response(cp, action="RemoteStartTransaction", attempts=3, timeout=900):
    """RS-05: nunca responde a `action` (o CSMS deve tentar 3x e expirar)."""
    cp.faults.no_response = set(cp.faults.no_response) | {action}
    await _until(cp, lambda: _received(cp, action) >= attempts, timeout, f"{attempts} tentativas de {action}")
    return {"action": action, "attempts": _received(cp, action)}


async def delayed_response(cp, action="GetConfiguration", delay_s=10.0, timeout=900):
    """RS-04: demora `delay_s` para responder `action` (o CSMS deve esperar)."""
    cp.faults.delay_response_s[action] = float(delay_s)
    await _until(cp, lambda: _received(cp, action) >= 1, timeout, action)
    await asyncio.sleep(float(delay_s) + 1)
    return {"action": action, "delay_s": float(delay_s)}


async def meter_kwh(cp, connector=1, **kw):
    """MV-01: reporta energia em kWh."""
    cp.faults.meter_unit = "kWh"
    return await happy_path(cp, connector, **kw)


async def meter_regress(cp, connector=1, **kw):
    """MV-02: o registro de energia regride a cada amostra."""
    cp.faults.meter_regress = True
    return await happy_path(cp, connector, **kw)


async def meter_no_measurand(cp, connector=1, **kw):
    """MV-04: MeterValues sem `measurand`."""
    cp.faults.meter_omit_measurand = True
    return await happy_path(cp, connector, **kw)


SCENARIOS: dict[str, Callable[..., Awaitable[dict]]] = {
    fn.__name__: fn
    for fn in (
        happy_path,
        local_start,
        local_stop,
        emergency_stop,
        ground_failure,
        invalid_tag,
        drop_during_charge,
        offline_stop,
        never_plug,
        reject_remote_start,
        no_response,
        delayed_response,
        meter_kwh,
        meter_regress,
        meter_no_measurand,
    )
}


async def run_scenario(name: str, cp: VirtualChargePoint, **opts) -> dict:
    try:
        fn = SCENARIOS[name]
    except KeyError:
        raise ValueError(f"cenario desconhecido: {name!r} (disponiveis: {', '.join(SCENARIOS)})") from None
    await cp.wait_until(lambda: cp.ready)
    return await fn(cp, **opts)
