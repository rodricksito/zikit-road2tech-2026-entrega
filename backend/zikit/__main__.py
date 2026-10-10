"""Línea de comandos del detector.

    python -m zikit calibrar         --data ../../zikit-dataset/data
    python -m zikit detectar         --corrida ../../zikit-dataset/data/corridas/corrida_01 --salida salida/corrida_01
    python -m zikit detectar-todas   --data ../../zikit-dataset/data --salida salida
    python -m zikit servir           # interfaz + API en http://127.0.0.1:8000
"""
import argparse
import csv
import os
import sys
import time
from pathlib import Path

from . import calendario, calibracion, contexto, ingesta, jsonutil
from .detector import detectar
from .serie import exportar

BACKEND = Path(__file__).resolve().parents[1]
CONFIG = BACKEND / "config"
DATA_POR_DEFECTO = Path(os.environ.get("ZIKIT_DATA") or BACKEND.parents[1] / "zikit-dataset" / "data")


def _escribir_alertas(ruta: Path, alertas: list, corrida: str = None, detalle: bool = False):
    cols = (["corrida"] if corrida is not None else []) + ["tenant", "timestamp", "confianza", "tipo"]
    if detalle:
        cols += ["familias", "en_calendario"]
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for a in alertas:
            fila = ([corrida] if corrida is not None else []) + [a["tenant"], a["timestamp"].strftime("%Y-%m-%dT%H:%M:%S"), a["confianza"], a["tipo"]]
            if detalle:
                fila += [a["familias"], a["en_calendario"]]
            w.writerow(fila)


def _correr(carpeta: Path, tenant: str, calib: dict, cal: dict, modo: str, fuente_cal: str = "contexto"):
    met = ingesta.leer_metricas(carpeta, tenant)
    cal, avisos = contexto.elegir(carpeta, tenant, met.timestamp.iloc[0], cal, fuente_cal)
    for aviso in avisos:
        print(f"AVISO: {aviso}", file=sys.stderr)
    fuera = calendario.unicas_fuera(cal, tenant, met.timestamp.iloc[0], met.timestamp.iloc[-1])
    if fuera:
        print(f"AVISO: el calendario de {tenant} no coincide con las fechas de {carpeta} "
              f"({', '.join(fuera)}); esos señuelos no se suprimirán.", file=sys.stderr)
    logs = ingesta.leer_logs(carpeta, tenant)
    return met, detectar(met, logs, calib, cal, tenant, modo)


def cmd_calibrar(a):
    t0 = time.perf_counter()
    cal = calibracion.calibrar(Path(a.data), tenants=a.tenants)
    calibracion.guardar(cal, Path(a.salida))
    print(f"Calibración guardada en {a.salida} ({time.perf_counter() - t0:.1f} s)")
    for k, v in cal["umbrales"].items():
        print(f"  umbral {k}: {v:.2f}")


def cmd_detectar(a):
    calib, cal = calibracion.cargar(Path(a.calibracion)), calendario.cargar(Path(a.calendario))
    t0 = time.perf_counter()
    met, r = _correr(Path(a.corrida), a.tenant, calib, cal, a.modo, a.calendario_fuente)
    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    _escribir_alertas(salida / "alertas.csv", r["alertas"])
    jsonutil.escribir(salida / "explicaciones.json", r["explicaciones"], indent=2)
    jsonutil.escribir(salida / "serie.json", exportar(met, r["ventanas"], a.tenant, a.paso_serie))
    print(f"{len(r['alertas'])} alertas en {time.perf_counter() - t0:.2f} s -> {salida}")
    for e in r["explicaciones"]:
        print(f"  {e['timestamp']}  {e['confianza']:.2f}  {e['tipo']}")


def cmd_detectar_todas(a):
    calib, cal = calibracion.cargar(Path(a.calibracion)), calendario.cargar(Path(a.calendario))
    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    todas = []
    t0 = time.perf_counter()
    for nombre, carpeta in ingesta.corridas_de(Path(a.data)).items():
        _, r = _correr(carpeta, a.tenant, calib, cal, a.modo, a.calendario_fuente)
        todas += [(nombre, x) for x in r["alertas"]]
    sufijo = "" if a.calendario_fuente == "contexto" else f"_cal-{a.calendario_fuente}"
    ruta = salida / f"alertas_{a.tenant}_{a.modo}{sufijo}.csv"
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["corrida", "tenant", "timestamp", "confianza", "tipo", "familias", "en_calendario"])
        for c, x in todas:
            w.writerow([c, x["tenant"], x["timestamp"].strftime("%Y-%m-%dT%H:%M:%S"), x["confianza"], x["tipo"], x["familias"], x["en_calendario"]])
    print(f"{len(todas)} alertas en {len({c for c, _ in todas})} corridas, {time.perf_counter() - t0:.1f} s -> {ruta}")


def cmd_servir(a):
    os.environ["ZIKIT_DATA"] = str(a.data)
    if a.web:
        os.environ["ZIKIT_WEB"] = str(a.web)
    import uvicorn

    from . import api  # se importa aquí para que lea ZIKIT_DATA y ZIKIT_WEB
    print(f"ZIKIT en http://{a.host}:{a.puerto}  (datos: {a.data}; interfaz: {api.WEB_POR_DEFECTO})")
    uvicorn.run(api.app, host=a.host, port=a.puerto, log_level="warning")


def main(argv=None):
    p = argparse.ArgumentParser(prog="zikit", description="Detector de alerta temprana ZIKIT")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("calibrar", help="Calcula la calibración con las corridas 11–54")
    c.add_argument("--data", default=DATA_POR_DEFECTO)
    c.add_argument("--salida", default=CONFIG / "calibracion.json")
    c.add_argument("--tenants", nargs="*", default=None)
    c.set_defaults(f=cmd_calibrar)

    for nombre, ayuda, fn in [("detectar", "Detecta en una corrida", cmd_detectar),
                              ("detectar-todas", "Detecta en la raíz y en las 54 corridas", cmd_detectar_todas)]:
        d = sub.add_parser(nombre, help=ayuda)
        if nombre == "detectar":
            d.add_argument("--corrida", required=True, help="Carpeta con <tenant>/metricas.csv y logs.md")
            d.add_argument("--paso-serie", type=int, default=5)
        else:
            d.add_argument("--data", default=DATA_POR_DEFECTO)
        d.add_argument("--tenant", default="gracko", choices=ingesta.TENANTS)
        d.add_argument("--salida", default=BACKEND / "salida")
        d.add_argument("--modo", default="completo", choices=["completo", "sin_calendario", "solo_metricas", "solo_logs"])
        d.add_argument("--calibracion", default=CONFIG / "calibracion.json")
        d.add_argument("--calendario", default=CONFIG / "calendario.json")
        d.add_argument("--calendario-fuente", default="contexto", choices=["contexto", "manual"],
                       help="contexto (por omisión): se lee el contexto.md de la corrida; manual: config/calendario.json")
        d.set_defaults(f=fn)

    sv = sub.add_parser("servir", help="Servidor web: interfaz y API en el mismo origen")
    sv.add_argument("--data", default=DATA_POR_DEFECTO)
    sv.add_argument("--web", default=None, help="Carpeta de la interfaz (por omisión, web/ del repo)")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--puerto", type=int, default=8000)
    sv.set_defaults(f=cmd_servir)

    a = p.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    sys.exit(main())
