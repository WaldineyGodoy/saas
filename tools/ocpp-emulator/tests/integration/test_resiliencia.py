"""L3b - Resiliencia (spec 8.4, RS-01..RS-07)."""

import asyncio

from ocpp.v16 import call

from emulator import Faults
from emulator.scenarios import wait_idle

from conftest import aguardar, comando_operador, estornos, parar_pelo_app, reiniciar_csms, ts


async def _carregando(db, r, n=1):
    def ok():
        x = db.recarga(r["id"])
        return x["status"] == "charging" and x["ocpp_transacao_id"] and len(db.medicoes(x["ocpp_transacao_id"])) >= n and x
    return await aguardar(ok, timeout=30, oque=f"charging com {n} medicoes")


def _boots(db, ocpp_id):
    return db.frames(ocpp_id, acao="BootNotification", direcao="saida", tipo=3)


def _instantes_energia(db, ocpp_id):
    """Instantes distintos de energia que o carregador mandou (MeterValues e transactionData)."""
    vistos = set()
    for f in db.frames(ocpp_id, direcao="entrada", tipo=2):
        if f["acao"] == "MeterValues":
            mvs = f["payload"]["meterValue"]
        elif f["acao"] == "StopTransaction":
            mvs = f["payload"].get("transactionData") or []
        else:
            continue
        for mv in mvs:
            if any(sv.get("measurand", "Energy.Active.Import.Register") == "Energy.Active.Import.Register"
                   for sv in mv["sampledValue"]):
                vistos.add(ts(mv["timestamp"]))
    return vistos


async def test_RS01_queda_durante_recarga_nao_duplica_medicoes(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(50)
    x = await _carregando(db, r, 2)
    tid = x["ocpp_transacao_id"]
    await cp.drop_connection(offline_for_s=10)  # ~10 MeterValues acumulados offline
    await aguardar(lambda: not cp.connected, oque="queda")
    await aguardar(lambda: len(cp.offline_queue) >= 5, oque="fila offline com medicoes")
    await aguardar(lambda: len(_boots(db, cp.id)) == 2, timeout=30, oque="reconexao")
    await aguardar(lambda: not cp.offline_queue, oque="fila offline descarregada")
    depois_da_fila = len(db.medicoes(tid))
    await aguardar(lambda: len(db.medicoes(tid)) >= depois_da_fila + 2, oque="telemetria retomada")

    meds = db.medicoes(tid)
    instantes = [ts(m["medido_em"]) for m in meds]
    assert len(instantes) == len(set(instantes))  # sem duplicar
    assert set(instantes) == _instantes_energia(db, cp.id)  # retroativas aceitas, todas
    t = db.transacoes(posto["carregador_id"])
    assert len(t) == 1 and t[0]["fim_em"] is None
    rec = db.recarga(r["id"])
    assert rec["status"] == "charging"
    assert float(rec["kwh_consumido"]) == (max(m["valor"] for m in meds) - t[0]["meter_start_wh"]) / 1000
    assert cp.erros == []


async def test_RS02_stop_offline_com_transaction_data_usa_timestamp_do_carregador(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60, faults=Faults(stop_transaction_data=True))
    r = recarga_paga(50)
    x = await _carregando(db, r, 2)
    await cp.drop_connection(offline_for_s=4)
    await aguardar(lambda: not cp.connected, oque="queda")
    await cp.stop_transaction(1, reason="Local")  # gerado offline: vai para a fila
    stop_offline = next(p for p, _ in cp.offline_queue if type(p).__name__ == "StopTransaction")
    fim = await aguardar(lambda: (y := db.recarga(r["id"]))["status"] == "completed" and y, timeout=30, oque="completed")
    await wait_idle(cp, 1, timeout=15)

    t = db.transacoes(posto["carregador_id"])[0]
    assert ts(t["fim_em"]) == ts(stop_offline.timestamp)
    assert ts(fim["finalizada_em"]) == ts(stop_offline.timestamp)
    frame = db.frames(cp.id, acao="StopTransaction", direcao="entrada")[0]
    assert (ts(frame["criado_em"]) - ts(stop_offline.timestamp)).total_seconds() >= 2  # chegou depois da reconexao
    assert frame["payload"]["transactionData"]
    final = ts(frame["payload"]["transactionData"][0]["timestamp"])
    assert final in {ts(m["medido_em"]) for m in db.medicoes(x["ocpp_transacao_id"])}
    assert float(fim["kwh_consumido"]) == (t["meter_stop_wh"] - t["meter_start_wh"]) / 1000
    assert await aguardar(lambda: estornos(r["id"]), oque="estorno da diferenca")
    assert cp.erros == []


async def test_RS03_start_retransmitido_devolve_o_mesmo_transaction_id(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(50)
    x = await _carregando(db, r, 1)
    original = db.frames(cp.id, acao="StartTransaction", direcao="entrada")[0]["payload"]
    await cp.drop_connection(offline_for_s=1)
    await aguardar(lambda: len(_boots(db, cp.id)) == 2 and cp.ready, timeout=30, oque="reconexao")
    res = await cp.call(call.StartTransaction(
        connector_id=original["connectorId"], id_tag=original["idTag"],
        meter_start=original["meterStart"], timestamp=original["timestamp"],
    ))
    assert res.transaction_id == x["ocpp_transacao_id"]
    assert res.id_tag_info["status"] == "Accepted"
    assert len(db.transacoes(posto["carregador_id"])) == 1
    respostas = await aguardar(lambda: len(y := db.frames(cp.id, acao="StartTransaction", direcao="saida", tipo=3)) == 2 and y,
                               oque="duas respostas ao Start")
    assert {f["payload"]["transactionId"] for f in respostas} == {x["ocpp_transacao_id"]}
    assert db.recarga(r["id"])["status"] == "charging"
    assert cp.erros == []


async def test_RS04_resposta_lenta_de_10s_csms_espera_sem_fechar_o_socket(db, posto, emulador):
    cp = await emulador(faults=Faults(delay_response_s={"GetConfiguration": 10, "ChangeAvailability": 10}))
    cid = posto["carregador_id"]
    comando_operador(db, cid, "GetConfiguration", {"key": ["HeartbeatInterval"]})
    comando_operador(db, cid, "ChangeAvailability", {"connectorId": 1, "type": "Operative"})
    cmds = await aguardar(lambda: len(y := db.comandos(cid)) == 2 and all(c["status"] == "aceito" for c in y) and y,
                          timeout=60, oque="dois comandos aceitos")
    assert all(c["tentativas"] == 0 for c in cmds)
    for acao in ("GetConfiguration", "ChangeAvailability"):
        ida = db.frames(cp.id, acao=acao, direcao="saida", tipo=2)
        volta = db.frames(cp.id, acao=acao, direcao="entrada", tipo=3)
        assert len(ida) == 1 and len(volta) == 1
        assert (ts(volta[0]["criado_em"]) - ts(ida[0]["criado_em"])).total_seconds() >= 9.5
    assert db.frames(cp.id, acao="GetConfiguration", direcao="entrada", tipo=3)[0]["payload"]["configurationKey"][0]["key"] == "HeartbeatInterval"
    assert cp.connected and len(_boots(db, cp.id)) == 1
    assert cp.erros == []


async def test_RS05_comando_sem_resposta_reenvia_3_vezes_e_expira(db, posto, emulador, recarga_paga):
    # CALL_TIMEOUT_S=12: 1 envio + 3 reenvios (2/4/8 s), decisao do dono (spec 4.6)
    cp = await emulador(faults=Faults(no_response={"RemoteStartTransaction"}))
    r = recarga_paga(30)
    cid = posto["carregador_id"]
    cmd = await aguardar(lambda: (y := db.comandos(cid, "RemoteStartTransaction")) and y[0]["status"] == "expirado" and y[0],
                         timeout=150, intervalo=1, oque="RemoteStart expirado")
    assert cmd["tentativas"] == 4
    assert len(db.frames(cp.id, acao="RemoteStartTransaction", direcao="saida", tipo=2)) == 4
    assert len(cp.silenced) == 4
    fim = await aguardar(lambda: (y := db.recarga(r["id"]))["status"] == "failed" and y["valor_estornado"] is not None and y,
                         oque="failed com estorno total")
    assert float(fim["valor_estornado"]) == 30
    assert (await aguardar(lambda: estornos(r["id"])))[0]["valor_centavos"] == 3000
    assert cp.connected and len(_boots(db, cp.id)) == 1  # socket nunca fechado por timeout
    assert cp.erros == []


async def test_RS06_comando_criado_offline_e_enviado_na_reconexao(db, posto, emulador):
    cid = posto["carregador_id"]
    cmd = comando_operador(db, cid, "GetConfiguration", {"key": ["MeterValueSampleInterval"]})
    # janela para provar que nada sai com o carregador offline (uma varredura da fila = 5 s)
    await asyncio.sleep(6)
    assert db.comandos(cid)[0]["status"] == "pendente"
    cp = await emulador()
    final = await aguardar(lambda: (y := db.comandos(cid)[0])["status"] == "aceito" and y, oque="comando entregue")
    assert final["id"] == cmd["id"] and final["tentativas"] == 0
    envio = db.frames(cp.id, acao="GetConfiguration", direcao="saida", tipo=2)
    assert len(envio) == 1 and envio[0]["id"] > db.frames(cp.id, acao="BootNotification")[0]["id"]
    assert ("GetConfiguration", {"key": ["MeterValueSampleInterval"]}) in cp.received_commands
    assert cp.erros == []


async def test_RS07_csms_reinicia_no_meio_da_recarga(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(50)
    x = await _carregando(db, r, 2)
    tid = x["ocpp_transacao_id"]
    await asyncio.to_thread(reiniciar_csms)
    await aguardar(lambda: len(_boots(db, cp.id)) == 2, timeout=60, oque="reconexao ao CSMS reiniciado")
    antes = len(db.medicoes(tid))
    await aguardar(lambda: len(db.medicoes(tid)) >= antes + 2, timeout=30, oque="MeterValues apos o restart")
    parar_pelo_app(db, r["id"])
    fim = await aguardar(lambda: (y := db.recarga(r["id"]))["status"] == "completed" and y, timeout=40, oque="completed")
    t = db.transacoes(posto["carregador_id"])
    assert len(t) == 1 and t[0]["id"] == tid and fim["ocpp_transacao_id"] == tid
    mv = db.frames(cp.id, acao="MeterValues", direcao="entrada")
    assert {f["payload"].get("transactionId") for f in mv} == {tid}
    assert db.frames(cp.id, acao="StopTransaction", direcao="entrada")[0]["payload"]["transactionId"] == tid
    assert cp.erros == []
