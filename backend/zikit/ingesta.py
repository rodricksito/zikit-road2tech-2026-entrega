"""Lectura de la carpeta cruda de una corrida: metricas.csv y logs.md.

Nunca lee carpetas _solucion ni scripts/ del kit.
"""
import re
from pathlib import Path

import numpy as np

import pandas as pd

METRICAS = ["cpu", "ram", "disco", "latencia_ms", "errores"]
TENANTS = ["gracko", "gramo", "kaiku", "ttr"]
# Una corrida se completa con una fila por minuto: 31 días son 44 640 filas (el kit trae 7 días).
# Sin este tope, un metricas.csv de 2 filas con un año de distancia pedía 525 600 filas y más de 1 GB.
MAX_DIAS = 31

LINEA_LOG = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+([A-Z]+)\s+(.*)$")

# Plantilla de un mensaje de log: se enmascaran los valores variables.
# El orden importa: de lo más específico a lo más general.
MASCARAS = [
    (re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?\b"), "<TS>"),
    (re.compile(r"\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b"), "<IP>"),
    (re.compile(r"\b[0-9a-f]{8,}\b", re.I), "<HEX>"),
    (re.compile(r"\b(KB)\d+\b"), r"\1<N>"),
    (re.compile(r"\b(u|vpn|usr|user|pid|job|id|lote|pedido|unidad|ped|ord)[-_]?\d+\b", re.I), r"\1<ID>"),
    (re.compile(r"(?<=/)\d+(?=/|\b)"), "<N>"),
    (re.compile(r"-?\d+(\.\d+)?\s?(ms|s|seg|min|h|MB|GB|KB|kB|%)\b"), "<NUM><U>"),
    (re.compile(r"-?\d+(\.\d+)?%"), "<PCT>"),
    (re.compile(r"-?\b\d+(\.\d+)?\b"), "<N>"),
]


def plantilla(mensaje: str) -> str:
    t = mensaje
    for rx, rep in MASCARAS:
        t = rx.sub(rep, t)
    return re.sub(r"\s+", " ", t).strip()


def carpeta_tenant(corrida_dir: Path, tenant: str) -> Path:
    d = Path(corrida_dir) / tenant
    if not d.is_dir():
        raise FileNotFoundError(f"No existe la carpeta {d}")
    return d


def _fechas(crudo: pd.Series, ruta: Path) -> pd.Series:
    """Columna timestamp. Si una celda no es una fecha, dice cuál, en español (no el error de pandas)."""
    try:
        ts = pd.to_datetime(crudo)
        if not ts.isna().any():
            return ts
    except (ValueError, TypeError, OverflowError):
        pass
    try:
        malas = pd.to_datetime(crudo, errors="coerce", format="mixed").isna().values
    except (ValueError, TypeError, OverflowError):  # p. ej., unas con zona horaria y otras sin ella
        malas = np.zeros(len(crudo), dtype=bool)
    if malas.any():
        i = int(np.flatnonzero(malas)[0])
        texto = "" if pd.isna(crudo.iloc[i]) else str(crudo.iloc[i]).strip()
        dato = f"«{texto}» no es una fecha" if texto else "está vacía"
        raise ValueError(f"{ruta}: la fila {i + 2}, columna «timestamp», {dato}; "
                         "se espera una fecha sin zona, como 2026-10-08T08:00:00")
    raise ValueError(f"{ruta}: los timestamps mezclan formatos o zonas horarias; "
                     "se esperan todos sin zona, como 2026-10-08T08:00:00")


def leer_metricas(corrida_dir: Path, tenant: str) -> pd.DataFrame:
    """Una fila por minuto. Las celdas vacías quedan como NaN (no como cero)."""
    ruta = carpeta_tenant(corrida_dir, tenant) / "metricas.csv"
    df = pd.read_csv(ruta, encoding="utf-8")
    faltan = {"timestamp", *METRICAS} - set(df.columns)
    if faltan:
        raise ValueError(f"{ruta}: faltan columnas {sorted(faltan)}")
    ts = _fechas(df["timestamp"], ruta)
    if ts.dt.tz is not None:  # logs.md y contexto.md no traen zona: mezclarlas movería las horas
        raise ValueError(f"{ruta}: los timestamps traen zona horaria (por ejemplo «Z» o «-06:00»); "
                         "se esperan sin zona, como 2026-10-08T08:00:00")
    df["timestamp"] = ts.dt.floor("min")
    for m in METRICAS:
        crudo = df[m]
        num = pd.to_numeric(crudo, errors="coerce").astype(float)
        vacio = crudo.isna() | (crudo.astype(str).str.strip() == "")
        # Lo mismo que exige la pantalla: números finitos y >= 0. Una celda vacía es un dato faltante.
        malo = (~vacio & (num.isna() | ~np.isfinite(num) | (num < 0))).values
        if malo.any():
            i = int(np.flatnonzero(malo)[0])
            texto = pd.read_csv(ruta, encoding="utf-8", dtype=str, usecols=[m], keep_default_na=False).iloc[i, 0]
            raise ValueError(f"{ruta}: valor no válido en la fila {i + 2}, columna «{m}»: «{texto}» "
                             "(se esperan números ≥ 0; deja la celda vacía si falta el dato)")
        df[m] = num
    df = df.drop_duplicates("timestamp", keep="last").set_index("timestamp").sort_index()
    if df.empty:
        raise ValueError(f"{ruta}: no trae filas")
    dias = (df.index[-1] - df.index[0]) / pd.Timedelta(days=1)
    if dias > MAX_DIAS:  # se revisa antes de crear las filas de cada minuto
        raise ValueError(f"{ruta}: va del {df.index[0]:%Y-%m-%d} al {df.index[-1]:%Y-%m-%d} ({dias:.0f} días); "
                         f"una corrida puede cubrir como máximo {MAX_DIAS} días")
    # Una fila por minuto: los minutos que falten quedan como dato faltante (NaN), igual que un apagón.
    completo = pd.date_range(df.index[0], df.index[-1], freq="min", name="timestamp")
    return df.reindex(completo)[METRICAS].reset_index()


def leer_logs(corrida_dir: Path, tenant: str) -> pd.DataFrame:
    """Líneas `timestamp NIVEL mensaje` con su sección (servidor, firewall, app)."""
    ruta = carpeta_tenant(corrida_dir, tenant) / "logs.md"
    filas, seccion = [], None
    with open(ruta, encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.rstrip("\r\n")
            if ln.startswith("## "):
                seccion = ln[3:].strip()
                continue
            m = LINEA_LOG.match(ln)
            if m:
                filas.append((pd.Timestamp(m.group(1)), seccion, m.group(2), m.group(3)))
    df = pd.DataFrame(filas, columns=["timestamp", "seccion", "nivel", "mensaje"])
    df["plantilla"] = df["mensaje"].map(plantilla)
    return df.sort_values("timestamp", kind="stable").reset_index(drop=True)


def corridas_de(data_dir: Path) -> dict:
    """Nombre → carpeta: 'raiz' (data/) y 'corrida_NN' (data/corridas/corrida_NN)."""
    data_dir = Path(data_dir)
    out = {"raiz": data_dir}
    for c in sorted((data_dir / "corridas").glob("corrida_*")):
        if c.is_dir():
            out[c.name] = c
    return out
