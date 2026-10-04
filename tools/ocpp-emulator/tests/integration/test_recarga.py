"""L3b - Fluxo de recarga (spec 8.3, RC-01..RC-10)."""

from emulator import Faults
from emulator.charge_point import State
from emulator.scenarios import wait_idle

from conftest import (
    TARIFA, aguardar, estornos, parar_pelo_app, reservar, webhook_pagamento_aprovado, webhook_pagamento_falhou,
)


def _acoes(db, ocpp_id, direcao, tipo=2):
    return [f["acao"] for f in db.frames(ocpp_id, direcao=direcao, tipo=tipo)]


async def _carregando(db, r, n_medicoes=1):
    """Recarga em charging com pelo menos n amostras de energia gravadas."""
    def ok():
        x = db.recarga(r["id"])
        return x["status"] == "charging" and x["ocpp_transacao_id"] and \
            len(db.medicoes(x["ocpp_transacao_id"])) >= n_medicoes and x
    return await aguardar(ok, timeout=30, oque=f"charging com {n_medicoes} medicoes")


async def test_RC01_fluxo_feliz_pagamento_ao_resumo_com_estorno(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(50)
    assert db.recarga(r["id"])["status"] == "paid"
    x = await _carregando(db, r, 3)
    assert x["iniciada_em"] and float(x["kwh_limite"]) == 23.25  # floor(50 / 2,15, 2 casas): kwhLimite do CSMS
    parar_pelo_app(db, r["id"])
    fim = await aguardar(lambda: (y := db.recarga(r["id"]))["status"] == "completed" and y, oque="completed")
    await wait_idle(cp, 1, timeout=10)

    t = db.transacoes(posto["carregador_id"])[0]
    kwh = (t["meter_stop_wh"] - t["meter_start_wh"]) / 1000
    assert t["motivo_parada"] == "Remote" and t["recarga_id"] == r["id"]
    assert float(fim["kwh_consumido"]) == kwh
    assert float(fim["valor_final"]) == round(kwh * TARIFA, 2)
    assert float(fim["valor_estornado"]) == round(50 - float(fim["valor_final"]), 2)
    pedido = await aguardar(lambda: estornos(r["id"]), oque="pedido de estorno")
    assert len(pedido) == 1 and pedido[0]["valor_centavos"] == round(float(fim["valor_estornado"]) * 100)
    assert (await aguardar(lambda: db.recarga(r["id"])["stripe_refund_id"])).startswith("re_stub_")
    assert db.id_tag(r["id_tag"])["status"] == "Expired"
    cmds = {c["acao"]: c["status"] for c in db.comandos(posto["carregador_id"])}
    assert cmds == {"RemoteStartTransaction": "aceito", "RemoteStopTransaction": "aceito"}

    saida = _acoes(db, cp.id, "saida")
    entrada = _acoes(db, cp.id, "entrada")
    assert saida.count("RemoteStartTransaction") == 1 and saida.count("RemoteStopTransaction") == 1
    assert entrada.count("StartTransaction") == 1 and entrada.count("StopTransaction") == 1
    assert entrada.count("MeterValues") >= 3
    def status1():
        return [f["payload"]["status"] for f in db.frames(cp.id, acao="StatusNotification", direcao="entrada")
                if f["payload"]["connectorId"] == 1]
    await aguardar(lambda: status1()[-1] == "Available", oque="Available na trilha")
    assert status1()[-4:] == ["Preparing", "Charging", "Finishing", "Available"]
    start_res = db.frames(cp.id, acao="StartTransaction", direcao="saida", tipo=3)[0]["payload"]
    assert start_res == {"transactionId": t["id"], "idTagInfo": {"status": "Accepted"}}
    assert cp.erros == []


async def test_RC02_remote_start_rejeitado_falha_e_estorno_total(db, posto, emulador, recarga_paga):
    cp = await emulador(faults=Faults(reject={"RemoteStartTransaction": True}))
    r = recarga_paga(40)
    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "failed" and x["valor_estornado"] is not None and x,
                         oque="failed com estorno")
    assert float(fim["valor_estornado"]) == 40 and float(fim["valor_final"]) == 0
    assert db.comandos(posto["carregador_id"], "RemoteStartTransaction")[0]["status"] == "rejeitado"
    assert (await aguardar(lambda: estornos(r["id"])))[0]["valor_centavos"] == 4000
    assert db.id_tag(r["id_tag"])["status"] == "Expired"
    res = db.frames(cp.id, acao="RemoteStartTransaction", direcao="entrada", tipo=3)
    assert res[0]["payload"] == {"status": "Rejected"}
    assert "StartTransaction" not in _acoes(db, cp.id, "entrada")
    assert cp.erros == []


async def test_RC03_aceita_mas_nunca_pluga_cancela_apos_connection_timeout(db, posto, emulador, recarga_paga):
    cp = await emulador(plug_delay_s=None)
    r = recarga_paga(25)
    await aguardar(lambda: db.recarga(r["id"])["status"] == "starting", oque="starting")
    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "canceled" and x["valor_estornado"] is not None and x,
                         timeout=40, oque="canceled (CONNECTION_TIMEOUT_S=5)")
    assert fim["motivo_fim"] == "ConnectionTimeout" and float(fim["valor_estornado"]) == 25
    assert (await aguardar(lambda: estornos(r["id"])))[0]["valor_centavos"] == 2500
    assert db.id_tag(r["id_tag"])["status"] == "Expired"
    assert db.transacoes(posto["carregador_id"]) == []
    assert db.frames(cp.id, acao="RemoteStartTransaction", direcao="entrada", tipo=3)[0]["payload"] == {"status": "Accepted"}
    assert "StartTransaction" not in _acoes(db, cp.id, "entrada")
    assert cp.erros == []


async def test_RC04_limite_pre_pago_um_unico_remote_stop_sem_estorno(db, posto, emulador, recarga_paga):
    # R$ 5 / 2,15 = 2,326 kWh; cada amostra soma 7,4 kW x 1 s x 600 = 1,233 kWh
    cp = await emulador(time_scale=600)
    r = recarga_paga(5)
    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "completed" and x, timeout=40, oque="completed")
    await wait_idle(cp, 1, timeout=10)
    stops = db.comandos(posto["carregador_id"], "RemoteStopTransaction")
    assert len(stops) == 1 and stops[0]["chave_idempotencia"] == f"stop:{r['id']}" and stops[0]["status"] == "aceito"
    assert _acoes(db, cp.id, "saida").count("RemoteStopTransaction") == 1
    assert float(fim["kwh_consumido"]) >= float(fim["kwh_limite"])
    assert float(fim["valor_final"]) == 5 and float(fim["valor_estornado"]) == 0
    assert fim["stripe_refund_id"] is None and estornos(r["id"]) == []
    assert db.frames(cp.id, acao="StopTransaction", direcao="entrada")[0]["payload"]["reason"] == "Remote"
    assert cp.erros == []


async def test_RC05_parada_local_ev_disconnected_estorna_diferenca(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(50)
    await _carregando(db, r, 2)
    await cp.stop_transaction(1, reason="EVDisconnected")
    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "completed" and x, oque="completed")
    assert fim["motivo_fim"] == "EVDisconnected"
    assert float(fim["valor_estornado"]) == round(50 - float(fim["valor_final"]), 2) > 0
    assert (await aguardar(lambda: estornos(r["id"])))[0]["valor_centavos"] == round(float(fim["valor_estornado"]) * 100)
    assert db.comandos(posto["carregador_id"], "RemoteStopTransaction") == []
    assert db.frames(cp.id, acao="StopTransaction", direcao="entrada")[0]["payload"]["reason"] == "EVDisconnected"
    assert cp.erros == []


async def test_RC06_totem_authorize_e_start_local(db, posto, emulador):
    cp = await emulador(time_scale=60)
    # pagamento confirmado com idTag, sem RemoteStart: o motorista digita a tag no totem
    r = reservar(db, posto, 30)
    assert db.rpc("fn_marcar_recarga_paga", {"p_payment_intent_id": r["pi"]}) == r["id"]
    tag = "RCTOTEML3B" + r["id"][:8].upper()
    db.insert("ocpp_id_tags", {"id_tag": tag, "recarga_id": r["id"]})
    db.update("recargas_eletroposto", f"id=eq.{r['id']}", {"ocpp_id_tag": tag})

    assert await cp.start_local(1, tag) == "Accepted"
    await _carregando(db, r, 2)
    await cp.stop_transaction(1, reason="Local")
    fim = await aguardar(lambda: (x := db.recarga(r["id"]))["status"] == "completed" and x, oque="completed")
    assert float(fim["valor_final"]) == round(float(fim["kwh_consumido"]) * TARIFA, 2)
    assert db.frames(cp.id, acao="Authorize", direcao="saida", tipo=3)[0]["payload"] == {"idTagInfo": {"status": "Accepted"}}
    assert db.comandos(posto["carregador_id"]) == []
    assert db.id_tag(tag)["status"] == "Expired"
    assert cp.erros == []


async def test_RC07_tag_desconhecida_invalid_no_authorize_e_no_start(db, posto, emulador, recarga_paga):
    cp = await emulador()
    alheia = reservar(db, posto, 15, 2)  # recarga de outro motorista, que nao pode mudar
    antes = db.recarga(alheia["id"])
    assert await cp.start_local(1, "TAG_DESCONHECIDA_99") == "Invalid"
    assert cp.connectors[1].state == State.AVAILABLE
    # o carregador insiste e manda o StartTransaction mesmo assim
    assert await cp.start_local(1, "TAG_DESCONHECIDA_99", force_start=True) == "Invalid"
    await aguardar(lambda: len(db.frames(cp.id, acao="StopTransaction", direcao="saida", tipo=3)) == 1, oque="Stop DeAuthorized")
    await wait_idle(cp, 1, timeout=10)

    auth = await aguardar(lambda: len(y := db.frames(cp.id, acao="Authorize", direcao="saida", tipo=3)) == 2 and y,
                          oque="dois Authorize na trilha")
    assert [f["payload"]["idTagInfo"]["status"] for f in auth] == ["Invalid", "Invalid"]
    start = db.frames(cp.id, acao="StartTransaction", direcao="saida", tipo=3)[0]["payload"]
    assert start["idTagInfo"]["status"] == "Invalid" and isinstance(start["transactionId"], int)
    t = db.transacoes(posto["carregador_id"])
    assert len(t) == 1 and t[0]["recarga_id"] is None and t[0]["motivo_parada"] == "DeAuthorized"
    depois = db.recarga(alheia["id"])
    assert (depois["status"], depois["updated_at"]) == (antes["status"], antes["updated_at"])
    assert db.get("recargas_eletroposto", f"eletroposto_id=eq.{posto['eletroposto_id']}&status=neq.pending_payment&select=id") == []
    assert cp.erros == []


async def test_RC08_idtag_de_recarga_concluida_expired(db, posto, emulador, recarga_paga):
    cp = await emulador(time_scale=60)
    r = recarga_paga(20)
    await _carregando(db, r, 1)
    await cp.stop_transaction(1, reason="Local")
    await aguardar(lambda: db.recarga(r["id"])["status"] == "completed", oque="completed")
    await wait_idle(cp, 1, timeout=10)
    assert await cp.authorize(r["id_tag"]) == "Expired"
    # a trilha e gravada de forma assincrona pelo CSMS: espera a linha
    res = await aguardar(lambda: db.frames(cp.id, acao="Authorize", direcao="saida", tipo=3), oque="Authorize na trilha")
    assert res[-1]["payload"] == {"idTagInfo": {"status": "Expired"}}
    assert len(db.transacoes(posto["carregador_id"])) == 1
    assert cp.erros == []


async def test_RC09_pagamento_falhou_nenhum_comando(db, posto, emulador):
    cp = await emulador()
    r = reservar(db, posto, 30)
    webhook_pagamento_falhou(db, r["pi"])
    assert db.recarga(r["id"])["status"] == "failed"
    # entrega atrasada do succeeded nao ressuscita a recarga
    assert webhook_pagamento_aprovado(db, r["pi"]) is None
    assert db.recarga(r["id"])["status"] == "failed"
    assert db.comandos(posto["carregador_id"]) == []
    assert db.get("ocpp_id_tags", f"recarga_id=eq.{r['id']}&select=id_tag") == []
    assert db.frames(cp.id, acao="RemoteStartTransaction") == []
    assert cp.received_commands == []
    assert cp.erros == []


async def test_RC10_webhook_duplicado_um_unico_remote_start(db, posto, emulador):
    cp = await emulador(plug_delay_s=None)
    r = reservar(db, posto, 30)
    assert webhook_pagamento_aprovado(db, r["pi"]) == "ok"
    assert webhook_pagamento_aprovado(db, r["pi"]) in (None, "ok")  # 2a entrega
    await aguardar(lambda: db.recarga(r["id"])["status"] == "starting", oque="starting")
    assert webhook_pagamento_aprovado(db, r["pi"]) is None  # 3a entrega, ja starting
    cmds = db.comandos(posto["carregador_id"])
    assert len(cmds) == 1 and cmds[0]["chave_idempotencia"] == f"start:{r['id']}"
    assert len(db.get("ocpp_id_tags", f"recarga_id=eq.{r['id']}&select=id_tag")) == 1
    assert len(db.frames(cp.id, acao="RemoteStartTransaction", direcao="saida", tipo=2)) == 1
    assert [a for a, _ in cp.received_commands] == ["RemoteStartTransaction"]
    assert cp.erros == []
