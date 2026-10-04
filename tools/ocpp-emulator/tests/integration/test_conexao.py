"""L3b - Conexao e registro (spec 8.1, CP-01..CP-08)."""

from dataclasses import make_dataclass

import pytest
from ocpp.exceptions import OCPPError
from ocpp.v16 import call
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from conftest import CSMS_WS, SENHA, aguardar, ts
from emulator.charge_point import basic_auth, ws_url
from emulator.runner import SUBPROTOCOL


async def _handshake(ocpp_id, senha=SENHA, protocolo=True):
    """Tenta o handshake; devolve o status HTTP da recusa (ou 101 se aceitou)."""
    try:
        async with connect(ws_url(CSMS_WS, ocpp_id), subprotocols=[SUBPROTOCOL] if protocolo else None,
                           additional_headers={"Authorization": basic_auth(ocpp_id, senha)} if senha else None):
            return 101
    except InvalidStatus as e:
        return e.response.status_code


async def test_CP01_boot_aceito_grava_dados_e_fica_online(db, posto, emulador):
    cp = await emulador(vendor="B2W-L3B", model="EMU-CP01", firmware="fw-9.9")
    c = await aguardar(lambda: (x := db.carregador(cp.id)) and x["online"] and x, oque="carregador online")
    assert (c["vendor"], c["modelo"], c["firmware"], c["serial"]) == ("B2W-L3B", "EMU-CP01", "fw-9.9", cp.id)
    assert c["estado_registro"] == "aceito"
    boot = db.frames(cp.id, acao="BootNotification")
    assert [(f["direcao"], f["tipo"]) for f in boot] == [("entrada", 2), ("saida", 3)]
    assert boot[1]["payload"]["status"] == "Accepted"
    assert boot[1]["payload"]["interval"] == 60  # heartbeat_intervalo_s do carregador
    assert cp.heartbeat_interval_s == 60
    assert cp.erros == []


async def test_CP02_ocpp_id_nao_cadastrado_recusa_404_e_so_loga_a_recusa(db):
    desconhecido = "L3B_NAO_CADASTRADO_CP02"
    db.delete("ocpp_mensagens", f"ocpp_id=eq.{desconhecido}")
    try:
        assert await _handshake(desconhecido) == 404
        linhas = await aguardar(lambda: db.frames(desconhecido), oque="log da recusa")
        assert len(linhas) == 1
        assert linhas[0]["acao"] == "handshake_recusado" and linhas[0]["tipo"] is None
        assert linhas[0]["carregador_id"] is None and linhas[0]["payload"]["codigo"] == 404
    finally:
        db.delete("ocpp_mensagens", f"ocpp_id=eq.{desconhecido}")


async def test_CP03_senha_errada_recusa_401(db, posto):
    assert await _handshake(posto["ocpp_id"], senha="senha-errada") == 401
    assert await _handshake(posto["ocpp_id"], senha=None) == 401
    linhas = await aguardar(lambda: len(x := db.frames(posto["ocpp_id"])) >= 2 and x, oque="log das recusas")
    assert {(f["acao"], f["payload"]["codigo"], f["carregador_id"]) for f in linhas} == {
        ("handshake_recusado", 401, posto["carregador_id"])}
    assert db.carregador(posto["ocpp_id"])["online"] is False


async def test_CP04_sem_subprotocolo_ocpp16_recusa(db, posto):
    status = await _handshake(posto["ocpp_id"], protocolo=False)
    assert 400 <= status < 500
    linhas = await aguardar(lambda: db.frames(posto["ocpp_id"]), oque="log da recusa")
    assert [f["acao"] for f in linhas] == ["handshake_recusado"]
    assert db.carregador(posto["ocpp_id"])["online"] is False


async def test_CP05_heartbeat_utc_e_offline_apos_3_intervalos_mudo(db, novo_posto, emulador):
    p = novo_posto(heartbeat_s=1)
    cp = await emulador(p["ocpp_id"])
    res = await cp.heartbeat()
    instante = ts(res.current_time)
    assert instante.utcoffset().total_seconds() == 0
    hb = await aguardar(lambda: db.frames(cp.id, acao="Heartbeat", direcao="saida", tipo=3), oque="resposta do Heartbeat")
    assert hb[0]["payload"]["currentTime"].endswith("Z")
    assert db.carregador(cp.id)["online"] is True
    cp.stop_heartbeat()  # fica mudo com o socket aberto
    await aguardar(lambda: db.carregador(cp.id)["online"] is False, timeout=15, oque="online = false")
    assert cp.connected  # o CSMS marca offline sem derrubar a conexao
    assert cp.erros == []


async def test_CP06_campo_obrigatorio_faltando_callerror_e_conexao_mantida(db, posto, emulador):
    cp = await emulador()
    sem_error_code = call.StatusNotification(connector_id=1, error_code=None, status="Available")
    with pytest.raises(OCPPError) as erro:
        await cp.call(sem_error_code, suppress=False, skip_schema_validation=True)
    codigo = type(erro.value).__name__
    assert codigo in {"FormationViolationError", "PropertyConstraintViolationError",
                      "OccurenceConstraintViolationError", "OccurrenceConstraintViolationError"}, codigo
    erros = await aguardar(lambda: db.frames(cp.id, direcao="saida", tipo=4), oque="CALLERROR na trilha")
    assert erros[-1]["payload"]["codigo"] in {"FormationViolation", "PropertyConstraintViolation",
                                               "OccurenceConstraintViolation", "OccurrenceConstraintViolation"}
    entrada = await aguardar(lambda: [f for f in db.frames(cp.id, acao="StatusNotification", direcao="entrada")
                                      if "errorCode" not in f["payload"]], oque="frame invalido na trilha")
    assert len(entrada) == 1
    # conexao segue aberta: o proximo frame e atendido normalmente
    assert (await cp.heartbeat()) is not None
    assert cp.connected and cp.erros == []


async def test_CP07_acao_inexistente_notimplemented_e_conexao_mantida(db, posto, emulador):
    cp = await emulador()
    AcaoInexistente = make_dataclass("AcaoInexistente", [])
    with pytest.raises(OCPPError) as erro:
        await cp.call(AcaoInexistente(), suppress=False, skip_schema_validation=True)
    assert type(erro.value).__name__ == "NotImplementedError"
    erros = await aguardar(lambda: db.frames(cp.id, direcao="saida", tipo=4), oque="CALLERROR na trilha")
    assert erros[-1]["payload"]["codigo"] == "NotImplemented"
    assert len(await aguardar(lambda: db.frames(cp.id, acao="AcaoInexistente", direcao="entrada", tipo=2),
                              oque="frame na trilha")) == 1
    assert (await cp.heartbeat()) is not None
    assert cp.connected and cp.erros == []


async def test_CP08_segunda_conexao_derruba_a_primeira(db, posto, emulador):
    primeiro = await emulador(reconectar=False)
    segundo = await emulador()  # mesmo ocpp_id
    await aguardar(lambda: not primeiro.connected, oque="primeira conexao encerrada")
    assert segundo.connected
    assert (await segundo.heartbeat()) is not None
    assert db.carregador(posto["ocpp_id"])["online"] is True
    assert len(db.frames(posto["ocpp_id"], acao="BootNotification", direcao="saida", tipo=3)) == 2
    assert primeiro.erros == [] and segundo.erros == []
