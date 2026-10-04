"""L3b - Status e falhas de hardware (spec 8.2, ST-01..ST-04)."""

from conftest import TARIFA, aguardar, checkout, comando_operador, estornos


async def test_ST01_status_do_conector_0_e_1_upsert(db, posto, emulador):
    cp = await emulador()
    cid = posto["carregador_id"]
    est, c1 = db.conector(cid, 0), db.conector(cid, 1)
    assert est["status"] == "Available" and est["numero"] is None  # 0 = a estacao, sem numero publico
    assert c1["status"] == "Available" and c1["numero"] == 1 and c1["error_code"] == "NoError"
    # novo status do mesmo conector atualiza a mesma linha (upsert)
    await cp._status_raw(1, "Unavailable", "NoError")
    await aguardar(lambda: db.conector(cid, 1)["status"] == "Unavailable", oque="upsert do conector 1")
    assert db.conector(cid, 1)["id"] == c1["id"]
    assert len(db.get("eletroposto_conectores", f"carregador_id=eq.{cid}&connector_id=eq.1&select=id")) == 1
    entradas = db.frames(cp.id, acao="StatusNotification", direcao="entrada")
    assert {f["payload"]["connectorId"] for f in entradas} >= {0, 1}
    assert cp.erros == []


async def test_ST02_parada_de_emergencia_bloqueia_fecha_proporcional_e_estorna(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(50)
    await aguardar(lambda: (db.recarga(r["id"])["kwh_consumido"] or 0) > 0, oque="recarga carregando com medicao")
    await cp.fault("EmergencyStop", 1)

    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "completed" and x, oque="recarga concluida")
    t = db.transacoes(posto["carregador_id"])[0]
    kwh = (t["meter_stop_wh"] - t["meter_start_wh"]) / 1000
    assert t["motivo_parada"] == "EmergencyStop" and fim["motivo_fim"] == "EmergencyStop"
    assert float(fim["kwh_consumido"]) == kwh
    assert float(fim["valor_final"]) == round(kwh * TARIFA, 2)
    assert float(fim["valor_estornado"]) == round(50 - float(fim["valor_final"]), 2)
    pedido = await aguardar(lambda: estornos(r["id"]), oque="pedido de estorno")
    assert pedido[0]["valor_centavos"] == round(float(fim["valor_estornado"]) * 100)

    c = db.conector(posto["carregador_id"], 1)
    assert c["status"] == "Faulted" and c["error_code"] == "OtherError" and c["bloqueado_ate_reset"] is True
    assert db.alertas(posto["carregador_id"], "conector_falha_grave")
    status, corpo = checkout(posto["eletroposto_id"], 1)
    assert status == 409 and corpo["motivo"] == "bloqueado", corpo

    faulted = [f for f in db.frames(cp.id, acao="StatusNotification", direcao="entrada") if f["payload"]["status"] == "Faulted"]
    assert faulted[0]["payload"]["errorCode"] == "OtherError" and faulted[0]["payload"]["info"] == "EmergencyStop"
    stop = db.frames(cp.id, acao="StopTransaction", direcao="entrada")
    assert stop[0]["payload"]["reason"] == "EmergencyStop"
    assert faulted[0]["id"] < stop[0]["id"]  # Faulted antes do Stop
    assert cp.erros == []


async def test_ST03_ground_failure_bloqueia_ate_reset_hard(db, posto, emulador, recarga_paga):
    cp = await emulador()
    cid = posto["carregador_id"]
    await cp.fault("GroundFailure", 1)
    await aguardar(lambda: db.conector(cid, 1)["bloqueado_ate_reset"], oque="conector bloqueado")

    # antes do Reset: checkout recusa e um RemoteStart (pagamento que ja estava em curso) e rejeitado sem envio
    status, corpo = checkout(posto["eletroposto_id"], 1)
    assert status == 409 and corpo["motivo"] == "bloqueado", corpo
    r = recarga_paga(20)
    cmd = await aguardar(lambda: (x := db.comandos(cid, "RemoteStartTransaction")) and x[0]["status"] == "rejeitado" and x[0],
                         oque="RemoteStart rejeitado")
    assert "bloqueado" in cmd["erro"]
    rec = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "failed" and x["valor_estornado"] is not None and x,
                         oque="recarga failed com estorno total")
    assert float(rec["valor_estornado"]) == 20
    assert (await aguardar(lambda: estornos(r["id"])))[0]["valor_centavos"] == 2000
    assert db.frames(cp.id, acao="RemoteStartTransaction") == []
    assert not any(a == "RemoteStartTransaction" for a, _ in cp.received_commands)

    # operador: Reset Hard -> emulador reinicia (novo Boot + Available) -> conector liberado
    comando_operador(db, cid, "Reset", {"type": "Hard"})
    await aguardar(lambda: cp.resets == 1, oque="Reset recebido")
    await aguardar(lambda: not db.conector(cid, 1)["bloqueado_ate_reset"] and db.conector(cid, 1)["status"] == "Available",
                   timeout=30, oque="conector liberado apos Reset + Boot")
    assert db.comandos(cid, "Reset")[0]["status"] == "aceito"
    boots = db.frames(cp.id, acao="BootNotification", direcao="entrada")
    reset = db.frames(cp.id, acao="Reset", direcao="saida", tipo=2)
    assert len(boots) == 2 and boots[1]["id"] > reset[0]["id"]
    status, corpo = checkout(posto["eletroposto_id"], 1)
    assert corpo.get("motivo") not in ("bloqueado", "ocupado", "offline"), corpo  # passa da checagem do conector
    assert cp.erros == []


async def test_ST04_conector_em_uso_por_outra_recarga_checkout_recusa(db, posto, emulador, recarga_paga):
    cp = await emulador()
    r = recarga_paga(30)
    await aguardar(lambda: db.recarga(r["id"])["status"] == "charging", oque="recarga A carregando")
    await aguardar(lambda: db.conector(posto["carregador_id"], 1)["status"] == "Charging", oque="conector em Charging")
    status, corpo = checkout(posto["eletroposto_id"], 1)
    assert status == 409 and corpo["motivo"] == "ocupado", corpo
    assert db.rpc("fn_reservar_recarga", {
        "p_carregador_id": posto["carregador_id"], "p_connector_id": 1, "p_reserva_min": 10,
        "p_eletroposto_id": posto["eletroposto_id"], "p_conector_numero": 1, "p_user_id": None,
        "p_motorista_nome": "B", "p_motorista_email": None, "p_motorista_telefone": None, "p_valor": 10,
        "p_kwh_estimado": 4, "p_tarifa_kwh_aplicada": TARIFA, "p_metadata": {},
    }) is None
    assert any(f["payload"]["status"] == "Charging" for f in db.frames(cp.id, acao="StatusNotification", direcao="entrada"))
    assert cp.erros == []
