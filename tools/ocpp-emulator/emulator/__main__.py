"""CLI: python -m emulator --id CP_EMU_01 --url ws://localhost:9220/ocpp --scenario happy_path"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys

from .charge_point import VirtualChargePoint, frame_printer
from .faults import Faults
from .runner import ConnectError, run_forever
from .scenarios import SCENARIOS, run_scenario


def _num(text: str):
    for cast in (int, float):
        try:
            return cast(text)
        except ValueError:
            pass
    return {"true": True, "false": False}.get(text.lower(), text)


def _kv(items: list[str], what: str) -> dict:
    out = {}
    for item in items or []:
        if "=" not in item:
            raise SystemExit(f"erro: {what} espera chave=valor, recebi {item!r}")
        key, value = item.split("=", 1)
        out[key] = _num(value)
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m emulator", description="Emulador de carregador OCPP 1.6-J")
    p.add_argument("--id", default="CP_EMU_01", help="ocpp_id (vira o ultimo segmento da URL)")
    p.add_argument("--url", default="ws://localhost:9220/ocpp", help="base da URL; conecta em <url>/<id>")
    p.add_argument("--password", help="senha Basic Auth (usuario = --id)")
    p.add_argument("--scenario", choices=sorted(SCENARIOS), help="cenario a executar (sem ele, so fica conectado)")
    p.add_argument("--opt", action="append", metavar="CHAVE=VALOR", help="opcao do cenario (repetivel)")
    p.add_argument("--keep-running", action="store_true", help="nao sair quando o cenario terminar")
    p.add_argument("--list-scenarios", action="store_true")
    p.add_argument("--log-frames", action="store_true", help="imprime cada frame [2,...]/[3,...]/[4,...]")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--max-retries", type=int, help="falhas seguidas de conexao antes de desistir (padrao: infinito)")
    g = p.add_argument_group("carregador")
    g.add_argument("--connectors", type=int, default=2)
    g.add_argument("--power-kw", type=float, default=7.4)
    g.add_argument("--plug-delay", default="5", help="segundos ate plugar o cabo, ou 'never' (RC-03)")
    g.add_argument("--meter-interval", type=float, default=10.0, help="segundos entre MeterValues")
    g.add_argument("--time-scale", type=float, default=1.0, help="acelera a energia simulada")
    g.add_argument("--meter-start-wh", type=float, default=10000.0)
    g.add_argument("--stop-after-wh", type=float, help="para localmente apos N Wh")
    g.add_argument("--finish-delay", type=float, default=1.0)
    f = p.add_argument_group("falhas")
    f.add_argument("--reject", action="append", default=[], metavar="ACAO", help="responde Rejected a ACAO")
    f.add_argument("--no-response", action="append", default=[], metavar="ACAO", help="nunca responde ACAO")
    f.add_argument("--delay", action="append", default=[], metavar="ACAO=SEG", help="atrasa a resposta de ACAO")
    f.add_argument("--drop-after", type=float, help="derruba o socket N s apos conectar")
    f.add_argument("--offline-for", type=float, help="tempo offline apos a queda")
    f.add_argument("--meter-unit", choices=["Wh", "kWh"], default="Wh")
    f.add_argument("--meter-regress", action="store_true")
    return p


def build_charge_point(args) -> VirtualChargePoint:
    plug = None if args.plug_delay.lower() in ("never", "none", "inf") else float(args.plug_delay)
    faults = Faults(
        delay_response_s={k: float(v) for k, v in _kv(args.delay, "--delay").items()},
        reject={a: True for a in args.reject},
        no_response=set(args.no_response),
        drop_connection_after_s=args.drop_after,
        offline_for_s=args.offline_for,
        meter_unit=args.meter_unit,
        meter_regress=args.meter_regress,
    )
    return VirtualChargePoint(
        args.id,
        connectors=args.connectors,
        plug_delay_s=plug,
        power_kw=args.power_kw,
        meter_interval_s=args.meter_interval,
        time_scale=args.time_scale,
        meter_start_wh=args.meter_start_wh,
        stop_after_wh=args.stop_after_wh,
        finish_delay_s=args.finish_delay,
        faults=faults,
        frame_logger=frame_printer if args.log_frames else None,
    )


async def amain(args) -> int:
    cp = build_charge_point(args)

    def log(msg: str) -> None:
        print(f"[{args.id}] {msg}", flush=True)

    conn = asyncio.ensure_future(run_forever(cp, args.url, args.password, max_retries=args.max_retries, log=log))
    scenario = None
    if args.scenario:
        scenario = asyncio.ensure_future(run_scenario(args.scenario, cp, **_kv(args.opt, "--opt")))
    pending = {t for t in (conn, scenario) if t}
    try:
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task is conn:
                    task.result()  # ConnectError sobe
                    return 0
                log(f"cenario {args.scenario} concluido: {json.dumps(task.result(), ensure_ascii=False)}")
                if not args.keep_running:
                    return 0
    finally:
        tasks = [t for t in (conn, scenario) if t]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await cp.shutdown()
    return 0


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.list_scenarios:
        for name, fn in SCENARIOS.items():
            doc = (fn.__doc__ or "").strip().splitlines()
            print(f"{name:22} {doc[0] if doc else ''}")
        return 0
    logging.basicConfig(level=logging.INFO if args.verbose else logging.ERROR, format="%(levelname)s %(name)s: %(message)s")
    try:
        return asyncio.run(amain(args))
    except ConnectError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # cenario falhou (timeout etc.): mensagem curta, sem traceback
        if args.verbose:
            raise
        print(f"erro: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
