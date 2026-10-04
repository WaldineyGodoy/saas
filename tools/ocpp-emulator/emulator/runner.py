"""Conexao com o CSMS: conecta, reconecta com backoff e entrega o socket ao
`VirtualChargePoint`. Separado de `charge_point.py` so por tamanho."""

from __future__ import annotations

import asyncio
from typing import Callable

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidHandshake, InvalidStatus

from .charge_point import VirtualChargePoint, basic_auth, ws_url

SUBPROTOCOL = "ocpp1.6"
FATAL_HTTP = {401, 403, 404}  # handshake recusado de proposito: repetir nao adianta


class ConnectError(Exception):
    """Falha de conexao que o emulador nao vai tentar de novo."""


async def run_forever(
    cp: VirtualChargePoint,
    base_url: str,
    password: str | None = None,
    *,
    max_retries: int | None = None,
    max_backoff_s: float = 30.0,
    log: Callable[[str], None] = print,
) -> None:
    """Mantem o carregador conectado. Reconecta com backoff exponencial; a fila
    offline do `cp` e reenviada a cada reconexao. `max_retries` limita tentativas
    seguidas sem sucesso (None = infinito)."""
    url = ws_url(base_url, cp.id)
    headers = {"Authorization": basic_auth(cp.id, password)} if password else None
    backoff = 1.0
    failures = 0
    while True:
        try:
            async with connect(
                url,
                subprotocols=[SUBPROTOCOL],
                additional_headers=headers,
                open_timeout=10,
            ) as ws:
                log(f"conectado a {url}")
                backoff, failures = 1.0, 0
                await cp.run_session(ws)
            log("conexao encerrada")
        except InvalidStatus as exc:
            code = exc.response.status_code
            if code in FATAL_HTTP:
                raise ConnectError(f"CSMS recusou o handshake (HTTP {code}) em {url}") from None
            failures += 1
            log(f"handshake recusado (HTTP {code})")
        except (OSError, InvalidHandshake, asyncio.TimeoutError) as exc:
            failures += 1
            reason = str(exc) or type(exc).__name__
            log(f"falha ao conectar em {url}: {reason}")
        if max_retries is not None and failures > max_retries:
            raise ConnectError(f"sem conexao com {url} apos {failures} tentativa(s)")
        delay = cp.consume_reconnect_delay()
        if delay is None:
            delay = backoff
            backoff = min(backoff * 2, max_backoff_s)
        log(f"reconectando em {delay:g}s")
        await asyncio.sleep(delay)
