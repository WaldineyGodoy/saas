"""Fixtures da L3b (tests/integration): emulador + CSMS (docker-compose.ocpp.yml) + Supabase LOCAL.

Os testes de integracao so rodam com SUPABASE_URL apontando para localhost/127.0.0.1 E
SUPABASE_SERVICE_ROLE_KEY definida (o `npm run test:ocpp` exporta as duas a partir de
`npx supabase status`). Qualquer outro valor, producao inclusive, pula a L3b inteira.

Fixtures:
  db              cliente service role (PostgREST) para semear e verificar o banco
  posto           eletroposto + carregador proprios do teste (apagados no fim)
  emulador(...)   fabrica de VirtualChargePoint conectado ao CSMS
  aguardar(...)   polling (nunca sleep fixo)
  recarga_paga(.) recarga paga pelo MESMO caminho do webhook da Stripe, sem Stripe:
                  fn_reservar_recarga (checkout) -> fn_marcar_recarga_paga -> fn_confirmar_inicio
                  -> idTag + ocpp_comandos start:<recarga>
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from websockets.asyncio.client import connect

from emulator import VirtualChargePoint
from emulator.charge_point import basic_auth, ws_url
from emulator.runner import SUBPROTOCOL, run_forever

RAIZ_REPO = Path(__file__).resolve().parents[2]
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
CHAVE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
CSMS_WS = os.environ.get("OCPP_CSMS_URL", "ws://127.0.0.1:9220/ocpp")
STUB_URL = os.environ.get("OCPP_ESTORNO_STUB_URL", "http://127.0.0.1:54398").rstrip("/")
COMPOSE = os.environ.get("OCPP_COMPOSE_FILE", str(RAIZ_REPO / "docker-compose.ocpp.yml"))
SENHA = "emu-local-senha"  # so do ambiente local (scripts/ocpp-seed.sql)
PLANO_SEED = "0cbb0000-0000-4000-8000-000000000001"
CP_SEED = "CP_EMU_01"
TARIFA = 2.15
RESERVA_PAGAMENTO_MIN = 10  # supabase/functions/_shared/recarga.ts

_LOCAL = re.match(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(/|$)", SUPABASE_URL)
L3B_HABILITADA = bool(_LOCAL and CHAVE)
MOTIVO_SKIP = (
    "SUPABASE_URL ausente" if not SUPABASE_URL
    else "SUPABASE_URL nao e local: recusado para nao tocar em producao" if not _LOCAL
    else "SUPABASE_SERVICE_ROLE_KEY ausente"
)


def pytest_collection_modifyitems(config, items):
    if L3B_HABILITADA:
        return
    pular = pytest.mark.skip(reason=f"L3b desligada: {MOTIVO_SKIP} (use npm run test:ocpp)")
    for item in items:
        if "integration" in Path(str(item.fspath)).parts:
            item.add_marker(pular)


# --------------------------------------------------------------------------- banco


class ErroRest(Exception):
    def __init__(self, status: int, corpo: str):
        super().__init__(f"HTTP {status}: {corpo}")
        self.status = status
        self.corpo = corpo


def _http(metodo: str, url: str, corpo=None, cabecalhos=None, timeout=15):
    dados = None if corpo is None else json.dumps(corpo).encode()
    req = urllib.request.Request(url, data=dados, method=metodo, headers=cabecalhos or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            texto = r.read().decode()
            return r.status, (json.loads(texto) if texto else None)
    except urllib.error.HTTPError as e:
        texto = e.read().decode()
        try:
            return e.code, json.loads(texto)
        except ValueError:
            return e.code, texto


class Db:
    """PostgREST com a service role. Filtros no formato do PostgREST (`id=eq.<x>&select=...`)."""

    def _cab(self, extra=None):
        c = {"apikey": CHAVE, "Authorization": f"Bearer {CHAVE}", "Content-Type": "application/json"}
        c.update(extra or {})
        return c

    def _ok(self, status, corpo):
        if status >= 300:
            raise ErroRest(status, json.dumps(corpo) if not isinstance(corpo, str) else corpo)
        return corpo

    def get(self, tabela: str, filtro: str = "") -> list[dict]:
        return self._ok(*_http("GET", f"{SUPABASE_URL}/rest/v1/{tabela}?{filtro}", cabecalhos=self._cab()))

    def um(self, tabela: str, filtro: str) -> dict | None:
        linhas = self.get(tabela, filtro)
        assert len(linhas) <= 1, f"{tabela}?{filtro}: {len(linhas)} linhas"
        return linhas[0] if linhas else None

    def insert(self, tabela: str, linhas, conflito: str | None = None, ignorar=False) -> list[dict]:
        prefer = ["return=representation"]
        url = f"{SUPABASE_URL}/rest/v1/{tabela}"
        if conflito:
            url += f"?on_conflict={conflito}"
            prefer.append("resolution=ignore-duplicates" if ignorar else "resolution=merge-duplicates")
        return self._ok(*_http("POST", url, linhas, self._cab({"Prefer": ",".join(prefer)})))

    def update(self, tabela: str, filtro: str, patch: dict) -> list[dict]:
        return self._ok(*_http("PATCH", f"{SUPABASE_URL}/rest/v1/{tabela}?{filtro}", patch,
                               self._cab({"Prefer": "return=representation"})))

    def delete(self, tabela: str, filtro: str) -> None:
        self._ok(*_http("DELETE", f"{SUPABASE_URL}/rest/v1/{tabela}?{filtro}", cabecalhos=self._cab()))

    def rpc(self, funcao: str, args: dict):
        return self._ok(*_http("POST", f"{SUPABASE_URL}/rest/v1/rpc/{funcao}", args, self._cab()))

    # ---- leituras usadas pelos testes

    def recarga(self, rid: str) -> dict:
        return self.um("recargas_eletroposto", f"id=eq.{rid}&select=*")

    def carregador(self, ocpp_id: str) -> dict:
        return self.um("eletroposto_carregadores", f"ocpp_id=eq.{ocpp_id}&select=*")

    def conector(self, carregador_id: str, connector_id: int) -> dict | None:
        return self.um("eletroposto_conectores",
                       f"carregador_id=eq.{carregador_id}&connector_id=eq.{connector_id}&select=*")

    def comandos(self, carregador_id: str, acao: str | None = None) -> list[dict]:
        f = f"carregador_id=eq.{carregador_id}&select=*&order=created_at"
        return self.get("ocpp_comandos", f + (f"&acao=eq.{acao}" if acao else ""))

    def id_tag(self, tag: str) -> dict | None:
        return self.um("ocpp_id_tags", f"id_tag=eq.{urllib.parse.quote(tag)}&select=*")

    def transacoes(self, carregador_id: str) -> list[dict]:
        return self.get("ocpp_transacoes", f"carregador_id=eq.{carregador_id}&select=*&order=id")

    def medicoes(self, transacao_id: int, measurand: str | None = "Energy.Active.Import.Register") -> list[dict]:
        f = f"transacao_id=eq.{transacao_id}&select=*&order=medido_em"
        return self.get("ocpp_medicoes", f + (f"&measurand=eq.{measurand}" if measurand else ""))

    def alertas(self, carregador_id: str, tipo: str | None = None) -> list[dict]:
        linhas = self.get("notification_logs", f"entity_id=eq.{carregador_id}&select=*&order=created_at")
        return [a for a in linhas if tipo is None or (a.get("metadata") or {}).get("tipo") == tipo]

    def frames(self, ocpp_id: str, acao: str | None = None, direcao: str | None = None,
               tipo: int | None = None) -> list[dict]:
        f = f"ocpp_id=eq.{urllib.parse.quote(ocpp_id)}&select=*&order=id"
        if acao:
            f += f"&acao=eq.{acao}"
        if direcao:
            f += f"&direcao=eq.{direcao}"
        if tipo is not None:
            f += f"&tipo=eq.{tipo}"
        return self.get("ocpp_mensagens", f)


def estornos(recarga_id: str, status: int = 200) -> list[dict]:
    """Pedidos que o CSMS fez a refund-charging (substituto local, scripts/ocpp-local/estorno-stub.mjs)."""
    st, corpo = _http("GET", f"{STUB_URL}/__stub/estornos?recarga_id={recarga_id}")
    assert st == 200, corpo
    return [p for p in corpo if p["status"] == status]


def falhar_estornos(recarga_id: str, vezes: int) -> None:
    """Os proximos `vezes` pedidos de estorno da recarga respondem 502 (Stripe fora do ar)."""
    st, corpo = _http("POST", f"{STUB_URL}/__stub/falhar?recarga_id={recarga_id}&vezes={vezes}")
    assert st == 200, corpo


def checkout(eletroposto_id: str, numero: int, valor: float = 20) -> tuple[int, dict]:
    """create-charging-checkout de verdade (edge-runtime local). Recusas acontecem antes da Stripe."""
    return _http("POST", f"{SUPABASE_URL}/functions/v1/create-charging-checkout",
                 {"eletroposto_id": eletroposto_id, "conector_numero": numero, "valor": valor},
                 {"Authorization": f"Bearer {ANON}", "apikey": ANON, "Content-Type": "application/json"},
                 timeout=90)


def reiniciar_csms() -> None:
    subprocess.run(["docker", "compose", "-f", COMPOSE, "restart", "csms"], check=True,
                   capture_output=True, timeout=120)


def agora_iso(mais_s: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=mais_s)).isoformat()


def ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


# --------------------------------------------------------------------------- espera


async def aguardar(condicao, timeout: float = 20, intervalo: float = 0.25, oque: str = "condicao"):
    """Repete `condicao()` (sincrona) ate ser verdadeira; devolve o valor. Nunca dorme um tempo fixo."""
    limite = time.monotonic() + timeout
    ultimo_erro = None
    while True:
        try:
            v = condicao()
            if v:
                return v
        except AssertionError as e:  # condicoes podem usar assert para explicar o que falta
            ultimo_erro = e
        if time.monotonic() >= limite:
            raise AssertionError(f"timeout ({timeout}s) esperando {oque}" + (f": {ultimo_erro}" if ultimo_erro else ""))
        await asyncio.sleep(intervalo)


# --------------------------------------------------------------------------- webhook sem Stripe

BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def gerar_id_tag() -> str:
    return "RC" + "".join(BASE32[b % 32] for b in secrets.token_bytes(18))


def reservar(db: Db, posto: dict, valor: float, numero: int = 1) -> dict:
    """Espelho do create-charging-checkout ate o PaymentIntent: fn_reservar_recarga + PI."""
    conector = db.um("eletroposto_conectores", f"eletroposto_id=eq.{posto['eletroposto_id']}&numero=eq.{numero}&select=*")
    assert conector, f"conector numero {numero} inexistente no posto"
    rid = db.rpc("fn_reservar_recarga", {
        "p_carregador_id": posto["carregador_id"], "p_connector_id": conector["connector_id"],
        "p_reserva_min": RESERVA_PAGAMENTO_MIN, "p_eletroposto_id": posto["eletroposto_id"],
        "p_conector_numero": numero, "p_user_id": None, "p_motorista_nome": "Motorista L3b",
        "p_motorista_email": None, "p_motorista_telefone": None, "p_valor": valor,
        "p_kwh_estimado": round(valor / TARIFA, 2), "p_tarifa_kwh_aplicada": TARIFA,
        "p_metadata": {"nome_posto": "L3b"},
    })
    assert rid, "fn_reservar_recarga recusou (conector reservado/em uso)"
    pi = f"pi_local_{uuid.uuid4().hex[:20]}"
    db.update("recargas_eletroposto", f"id=eq.{rid}", {"stripe_payment_intent_id": pi})
    return {"id": rid, "pi": pi, "valor": valor, "connector_id": conector["connector_id"]}


def _garantir_comando_inicio(db: Db, rid: str) -> str:
    """Espelho de garantirComandoInicio (stripe-charging-webhook)."""
    r = db.recarga(rid)
    existente = db.get("ocpp_id_tags", f"recarga_id=eq.{rid}&select=id_tag")
    tag_novo = False
    if existente:
        tag = existente[0]["id_tag"]
    else:
        tag = gerar_id_tag()
        db.insert("ocpp_id_tags", {"id_tag": tag, "recarga_id": rid, "expira_em": agora_iso(300)})
        tag_novo = True
    if r["ocpp_id_tag"] != tag:
        db.update("recargas_eletroposto", f"id=eq.{rid}", {"ocpp_id_tag": tag})
    if not tag_novo and not db.get("ocpp_comandos", f"chave_idempotencia=eq.start:{rid}&select=id"):
        db.update("ocpp_id_tags", f"id_tag=eq.{tag}", {"expira_em": agora_iso(300)})
    db.insert("ocpp_comandos", {
        "carregador_id": r["carregador_id"], "acao": "RemoteStartTransaction",
        "payload": {"connectorId": r["ocpp_connector_id"], "idTag": tag},
        "chave_idempotencia": f"start:{rid}", "expira_em": agora_iso(120), "recarga_id": rid,
    }, conflito="chave_idempotencia", ignorar=True)
    return tag


def webhook_pagamento_aprovado(db: Db, pi: str) -> str | None:
    """Espelho do ramo payment_intent.succeeded (supabase/functions/_shared/webhook-recarga.ts, sem a
    assinatura). Devolve o veredito: 'ok' | 'conflito' | 'sem_destino' | 'ignorada' | 'estorno_tardio' | None."""
    rid = db.rpc("fn_marcar_recarga_paga", {"p_payment_intent_id": pi})
    if not rid:
        paga = db.get("recargas_eletroposto", f"stripe_payment_intent_id=eq.{pi}&status=eq.paid&select=id")
        if not paga:
            # C1: pagamento de recarga ja encerrada sem energia -> estorno total pendente
            tardia = db.rpc("fn_marcar_estorno_pagamento_tardio", {"p_payment_intent_id": pi})
            return "estorno_tardio" if tardia else None
        rid = paga[0]["id"]
    veredito = db.rpc("fn_confirmar_inicio", {"p_recarga_id": rid, "p_reserva_min": RESERVA_PAGAMENTO_MIN})
    if veredito != "ok":
        return veredito
    _garantir_comando_inicio(db, rid)
    return "ok"


def webhook_pagamento_falhou(db: Db, pi: str) -> None:
    """Espelho do ramo payment_intent.payment_failed: so registra. A recarga segue pending_payment
    (o motorista tenta de novo no mesmo PaymentIntent; se desistir, a reserva vence sozinha)."""
    return None


PARADA_REARMAVEL = ("expirado", "rejeitado", "erro")


def parar_pelo_app(db: Db, rid: str) -> str:
    """Espelho de enfileirarParada (supabase/functions/_shared/parada-recarga.ts) depois da prova de posse:
    stop:<recarga>; parada anterior que terminou sem aceite volta a pendente (update guardado)."""
    r = db.recarga(rid)
    criado = db.insert("ocpp_comandos", {
        "carregador_id": r["carregador_id"], "acao": "RemoteStopTransaction",
        "payload": {"transactionId": int(r["ocpp_transacao_id"])},
        "chave_idempotencia": f"stop:{rid}", "recarga_id": rid,
    }, conflito="chave_idempotencia", ignorar=True)
    if criado:
        return "enfileirada"
    rearmado = db.update("ocpp_comandos",
                         f"chave_idempotencia=eq.stop:{rid}&status=in.({','.join(PARADA_REARMAVEL)})",
                         {"status": "pendente", "tentativas": 0, "proxima_tentativa_em": agora_iso(),
                          "expira_em": agora_iso(120), "erro": None, "resposta": None})
    return "rearmada" if rearmado else "existente"


def comando_operador(db: Db, carregador_id: str, acao: str, payload: dict, **extra) -> dict:
    return db.insert("ocpp_comandos", {"carregador_id": carregador_id, "acao": acao, "payload": payload, **extra})[0]


# --------------------------------------------------------------------------- fixtures


@pytest.fixture(scope="session")
def db() -> Db:
    return Db()


@pytest.fixture(scope="session")
def senha_hash(db) -> str:
    cp = db.carregador(CP_SEED)
    assert cp and cp["senha_hash"], "rode scripts/ocpp-seed.sql (npm run test:ocpp faz isso)"
    return cp["senha_hash"]


def _limpar(db: Db, posto: dict) -> None:
    cid, eid, oid = posto["carregador_id"], posto["eletroposto_id"], posto["ocpp_id"]
    db.delete("notification_logs", f"entity_id=eq.{cid}")
    recargas = [r["id"] for r in db.get("recargas_eletroposto", f"eletroposto_id=eq.{eid}&select=id")]
    db.delete("ocpp_transacoes", f"carregador_id=eq.{cid}")
    if recargas:
        lista = ",".join(recargas)
        db.delete("ocpp_id_tags", f"recarga_id=in.({lista})")
        db.delete("recargas_eletroposto", f"id=in.({lista})")
    db.delete("ocpp_mensagens", f"ocpp_id=eq.{oid}")
    db.delete("eletroposto_carregadores", f"id=eq.{cid}")
    db.delete("eletropostos", f"id=eq.{eid}")


@pytest.fixture
def novo_posto(db, senha_hash):
    """Fabrica: eletroposto operando (plano 2,15) + carregador proprio. Apaga tudo no fim."""
    criados = []

    def fabrica(heartbeat_s: int = 60) -> dict:
        ocpp_id = f"L3B_{uuid.uuid4().hex[:10].upper()}"
        e = db.insert("eletropostos", {"nome": f"Posto {ocpp_id}", "status": "operando", "plano_id": PLANO_SEED})[0]
        c = db.insert("eletroposto_carregadores", {
            "eletroposto_id": e["id"], "ocpp_id": ocpp_id, "senha_hash": senha_hash,
            "heartbeat_intervalo_s": heartbeat_s,
        })[0]
        p = {"eletroposto_id": e["id"], "carregador_id": c["id"], "ocpp_id": ocpp_id}
        criados.append(p)
        return p

    yield fabrica
    if os.environ.get("OCPP_MANTER_DADOS"):
        return
    for p in criados:
        _limpar(db, p)


@pytest.fixture
def posto(novo_posto) -> dict:
    return novo_posto()


async def _sessao_unica(cp: VirtualChargePoint, senha: str) -> None:
    """Uma conexao so, sem reconectar (CP-08: a substituida nao pode voltar e derrubar a nova)."""
    async with connect(ws_url(CSMS_WS, cp.id), subprotocols=[SUBPROTOCOL],
                       additional_headers={"Authorization": basic_auth(cp.id, senha)}) as ws:
        await cp.run_session(ws)


@pytest_asyncio.fixture
async def emulador(db, posto):
    """Fabrica de carregadores virtuais conectados ao CSMS. Por padrao usa o carregador do `posto`,
    MeterValues a cada 1 s e plug em 0,5 s. Espera Boot + StatusNotification de todos os conectores."""
    vivos: list[tuple[VirtualChargePoint, asyncio.Task]] = []

    async def fabrica(ocpp_id: str | None = None, *, reconectar: bool = True, pronto: bool = True,
                      senha: str = SENHA, **kw) -> VirtualChargePoint:
        kw.setdefault("meter_interval_s", 1.0)
        kw.setdefault("plug_delay_s", 0.5)
        kw.setdefault("finish_delay_s", 0.5)
        kw.setdefault("reset_wait_s", 1.0)
        kw.setdefault("response_timeout", 20)
        cp = VirtualChargePoint(ocpp_id or posto["ocpp_id"], **kw)
        base = len(db.frames(cp.id, acao="StatusNotification", direcao="saida", tipo=3))
        tarefa = asyncio.ensure_future(
            run_forever(cp, CSMS_WS, senha, max_backoff_s=2, log=lambda _m: None) if reconectar
            else _sessao_unica(cp, senha)
        )
        vivos.append((cp, tarefa))
        if pronto:
            n = len(cp.connectors) + 1
            await aguardar(lambda: tarefa.done() and tarefa.result() or
                           len(db.frames(cp.id, acao="StatusNotification", direcao="saida", tipo=3)) >= base + n,
                           20, oque=f"Boot + {n} StatusNotification de {cp.id}")
        return cp

    yield fabrica
    for cp, tarefa in vivos:
        tarefa.cancel()
        await cp.shutdown()
        await asyncio.gather(tarefa, return_exceptions=True)


@pytest.fixture
def recarga_paga(db, posto):
    """Fabrica: recarga reservada como no checkout e paga como no webhook (sem Stripe)."""

    def fabrica(valor: float = 50, numero: int = 1, *, p: dict | None = None) -> dict:
        alvo = p or posto
        r = reservar(db, alvo, valor, numero)
        assert webhook_pagamento_aprovado(db, r["pi"]) == "ok"
        r["id_tag"] = db.recarga(r["id"])["ocpp_id_tag"]
        return r

    return fabrica
