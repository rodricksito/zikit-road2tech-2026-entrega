"""Calendario de eventos esperados (señuelos) tomado de contexto.md.

Las horas son las NOMINALES del contexto, no las observadas en los datos.
Recurrencias: "diaria", "semanal" (con `dia`: lunes..domingo) y "unica" (fecha exacta).
Los eventos diarios no suprimen métricas (el perfil por hora ya los absorbe);
solo sirven para reconocer sus líneas de log como señuelo.
"""
import json
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]

# Recursos medidos. No forman parte de las palabras fijas de un evento: se asocian a él
# solo cuando un log del propio evento los menciona (ver detector.rol_log).
MEDIDAS = {"disco", "volumen", "espacio", "cpu", "ram", "memoria", "latencia"}
RECURSOS = sorted(MEDIDAS) + ["lent", "carga", "cola", "conexiones", "trafico"]
RUTA = re.compile(r"(?<![\w/])(/[A-Za-z0-9_.-]+)")


def recursos_de(msg: str) -> set:
    """Regex de los recursos que menciona una línea de log: rutas (solo la raíz, /data)
    y palabras de RECURSOS. Ej.: «carga masiva … en /data/declaraciones» → {/data, carga}."""
    out = {re.escape(m) + r"(?![\w.-])" for m in RUTA.findall(msg)}
    out |= {rf"\b{w}" for w in RECURSOS if re.search(rf"\b{w}", msg, re.I)}
    return out


@dataclass(frozen=True)
class Ventana:
    inicio: pd.Timestamp  # incluye el margen previo
    fin: pd.Timestamp  # incluye el margen posterior
    evento: str
    palabras: str  # regex de los sistemas afectados, para los logs
    recurrencia: str
    inicio_nominal: pd.Timestamp
    fin_nominal: pd.Timestamp


def cargar(ruta: Path) -> dict:
    with open(ruta, encoding="utf-8-sig") as fh:
        return json.load(fh)


def ventanas(cal: dict, tenant: str, t0: pd.Timestamp, t1: pd.Timestamp) -> list:
    antes = pd.Timedelta(minutes=cal.get("margen_antes_min", 10))
    despues = pd.Timedelta(minutes=cal.get("margen_despues_min", 30))
    out = []
    dias = pd.date_range(pd.Timestamp(t0).normalize(), pd.Timestamp(t1).normalize(), freq="D")
    for ev in cal["empresas"].get(tenant, []):
        rec = ev["recurrencia"]
        dur = pd.Timedelta(minutes=ev["duracion_min"])
        if rec == "unica":
            inicios = [pd.Timestamp(ev["inicio"])]
        elif rec == "diaria":
            inicios = [d + pd.Timedelta(ev["inicio"] + ":00") for d in dias]
        elif rec == "semanal":
            dow = DIAS.index(ev["dia"])
            inicios = [d + pd.Timedelta(ev["inicio"] + ":00") for d in dias if d.dayofweek == dow]
        else:
            raise ValueError(f"Recurrencia desconocida: {rec}")
        for i in inicios:
            out.append(Ventana(i - antes, i + dur + despues, ev["evento"], ev["palabras"], rec, i, i + dur))
    return out


def unicas_fuera(cal: dict, tenant: str, t0, t1) -> list:
    """Eventos de fecha única que no caen dentro de [t0, t1]: señal de que el calendario no corresponde a la corrida."""
    out = []
    for ev in cal["empresas"].get(tenant, []):
        if ev["recurrencia"] == "unica":
            i = pd.Timestamp(ev["inicio"])
            f = i + pd.Timedelta(minutes=ev["duracion_min"])
            if f < pd.Timestamp(t0) or i > pd.Timestamp(t1):
                out.append(f"{ev['evento']} {i:%Y-%m-%d %H:%M}")
    return out
