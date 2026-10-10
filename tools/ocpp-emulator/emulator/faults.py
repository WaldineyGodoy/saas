"""Injecao de falhas do emulador (spec 6).

`Faults` e so dados; quem aplica e o `VirtualChargePoint`. Os valores sao
mutaveis em tempo de execucao (os cenarios ligam/desligam falhas).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

# ChargePointErrorCode valido do OCPP 1.6 (EmergencyStop NAO esta aqui).
VALID_ERROR_CODES = frozenset(
    {
        "ConnectorLockFailure",
        "EVCommunicationError",
        "GroundFailure",
        "HighTemperature",
        "InternalError",
        "LocalListConflict",
        "NoError",
        "OtherError",
        "OverCurrentFailure",
        "OverVoltage",
        "PowerMeterFailure",
        "PowerSwitchFailure",
        "ReaderFailure",
        "ResetFailure",
        "UnderVoltage",
        "WeakSignal",
    }
)

# Em 1.6, "EmergencyStop" e um `reason` do StopTransaction, nao um errorCode.
EMERGENCY_STOP = "EmergencyStop"


@dataclass
class Faults:
    # acao -> segundos de atraso antes de responder (RS-04)
    delay_response_s: dict[str, float] = field(default_factory=dict)
    # acao -> True: responde "Rejected" (RC-02). Aceita tambem um set de acoes.
    reject: dict[str, bool] | set[str] = field(default_factory=dict)
    # acoes que nunca recebem resposta (RS-05)
    no_response: set[str] | dict[str, bool] = field(default_factory=set)
    # derruba o socket N segundos depois de conectar (RS-01)
    drop_connection_after_s: float | None = None
    # tempo offline antes de reconectar apos uma queda injetada
    offline_for_s: float | None = None
    # "Wh" ou "kWh" (MV-01)
    meter_unit: str = "Wh"
    # registro de energia regride a cada amostra (MV-02)
    meter_regress: bool = False
    meter_regress_step_wh: float = 1000.0
    # MeterValues sem `measurand` (MV-04); tambem omite a amostra de potencia
    meter_omit_measurand: bool = False
    # StopTransaction leva `transactionData` com a leitura final (RS-02)
    stop_transaction_data: bool = False

    def rejects(self, action: str) -> bool:
        return _flag(self.reject, action)

    def silences(self, action: str) -> bool:
        return _flag(self.no_response, action)

    def delay_for(self, action: str) -> float:
        return float(self.delay_response_s.get(action) or 0)


def _flag(collection, action: str) -> bool:
    if isinstance(collection, Mapping):
        return bool(collection.get(action))
    return action in collection


def fault_notification(error_code: str) -> tuple[str, str | None, str]:
    """Traduz `fault(error_code)` em (errorCode, info, reason do Stop).

    EmergencyStop vira Faulted/OtherError com info="EmergencyStop" e o Stop
    leva reason=EmergencyStop. Codigos validos do 1.6 seguem como estao.
    """
    if error_code == EMERGENCY_STOP:
        return "OtherError", EMERGENCY_STOP, EMERGENCY_STOP
    if error_code not in VALID_ERROR_CODES:
        raise ValueError(f"errorCode invalido no OCPP 1.6: {error_code!r}")
    return error_code, None, "Other"
