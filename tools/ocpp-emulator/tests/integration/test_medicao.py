"""L3b - Medicao (spec 8.5, MV-01..MV-04).

O medidor e dirigido a mao (`meter_tick`): MeterValues automatico so a cada 1 h, e cada tick soma
7,4 kW x 3600 s x 0,1 = 740 Wh.
"""

from emulator import Faults

from conftest import aguardar, estornos

ENERGIA = "Energy.Active.Import.Register"
MANUAL = {"meter_interval_s": 3600, "time_scale": 0.1}


async def _transacao(db, r, cp):
    """charging no banco E o emulador ja com o transactionId da resposta do Start (antes disso um
    Stop/MeterValues local sairia sem transacao)."""
    x = await aguardar(lambda: (y := db.recarga(r["id"]))["status"] == "charging" and y, oque="charging")
    await aguardar(lambda: cp.connectors[1].in_transaction and cp.connectors[1].transaction_id == x["ocpp_transacao_id"],
                   oque="emulador com o transactionId")
    return x["ocpp_transacao_id"]


def _amostras(db, ocpp_id):
    return [sv for f in db.frames(ocpp_id, acao="MeterValues", direcao="entrada")
            for mv in f["payload"]["meterValue"] for sv in mv["sampledValue"]]


async def test_MV01_energia_em_kwh_e_em_wh_gravada_em_wh(db, posto, emulador, recarga_paga):
    cp = await emulador(**MANUAL)
    r = recarga_paga(50)
    tid = await _transacao(db, r, cp)
    c = cp.connectors[1]
    await cp.meter_tick(1)
    em_wh = c.register_wh
    cp.faults.meter_unit = "kWh"
    await cp.meter_tick(1)
    em_kwh = c.register_wh
    meds = await aguardar(lambda: len(y := db.medicoes(tid)) == 2 and y, oque="duas medicoes")
    assert [(m["valor"], m["unidade"]) for m in meds] == [(em_wh, "Wh"), (em_kwh, "Wh")]
    unidades = [sv["unit"] for sv in _amostras(db, cp.id) if sv.get("measurand") == ENERGIA]
    assert unidades == ["Wh", "kWh"]
    kwh = await aguardar(lambda: float(db.recarga(r["id"])["kwh_consumido"] or 0) == (em_kwh - c.tx_start_wh) / 1000,
                         oque="kwh_consumido da amostra em kWh")
    assert kwh
    assert cp.erros == []


async def test_MV02_registro_que_regride_e_ignorado_com_alerta(db, posto, emulador, recarga_paga):
    cp = await emulador(**MANUAL)
    r = recarga_paga(50)
    tid = await _transacao(db, r, cp)
    await cp.meter_tick(1)
    await cp.meter_tick(1)
    await aguardar(lambda: len(db.medicoes(tid)) == 2, oque="duas medicoes")
    kwh_antes = await aguardar(lambda: float(db.recarga(r["id"])["kwh_consumido"] or 0), oque="kwh_consumido")
    cp.faults.meter_regress = True
    await cp.meter_tick(1)  # manda 1000 Wh a menos que a ultima amostra
    alerta = await aguardar(lambda: db.alertas(posto["carregador_id"], "medicao_regrediu"), oque="alerta de regressao")
    assert alerta[0]["metadata"]["dados"]["transacaoId"] == tid
    assert len(db.medicoes(tid)) == 2
    assert float(db.recarga(r["id"])["kwh_consumido"]) == kwh_antes
    assert len(db.frames(cp.id, acao="MeterValues", direcao="entrada")) == 3
    assert cp.erros == []


async def test_MV03_meter_stop_menor_que_meter_start_marca_revisao_sem_estorno(db, posto, emulador, recarga_paga):
    cp = await emulador(**MANUAL)
    r = recarga_paga(40)
    await _transacao(db, r, cp)
    c = cp.connectors[1]
    c.register_wh = c.tx_start_wh - 500  # contador regrediu (troca de medidor, defeito)
    await cp.stop_transaction(1, reason="Local")
    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "completed" and x, oque="completed")
    assert float(fim["valor_final"]) == 40 and float(fim["valor_estornado"]) == 0
    assert fim["metadata"].get("revisar") is True
    assert db.alertas(posto["carregador_id"], "medicao_revisar")
    assert fim["stripe_refund_id"] is None and estornos(r["id"]) == []
    stop = db.frames(cp.id, acao="StopTransaction", direcao="entrada")[0]["payload"]
    t = db.transacoes(posto["carregador_id"])[0]
    assert stop["meterStop"] == t["meter_stop_wh"] < t["meter_start_wh"]
    assert cp.erros == []


async def test_MV04_sem_measurand_tratado_como_energia(db, posto, emulador, recarga_paga):
    cp = await emulador(faults=Faults(meter_omit_measurand=True), **MANUAL)
    r = recarga_paga(50)
    tid = await _transacao(db, r, cp)
    await cp.meter_tick(1)
    meds = await aguardar(lambda: db.medicoes(tid, measurand=None), oque="medicao gravada")
    assert [(m["measurand"], m["unidade"], m["valor"]) for m in meds] == [(ENERGIA, "Wh", cp.connectors[1].register_wh)]
    assert all("measurand" not in sv for sv in _amostras(db, cp.id))
    await aguardar(lambda: float(db.recarga(r["id"])["kwh_consumido"] or 0) == 0.74, oque="kwh_consumido")
    assert cp.erros == []
