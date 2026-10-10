"""Adaptación a la semana evaluada (diseño A: «el conocimiento previo se corrige con la semana»).

La calibración del kit (config/calibracion.json) es CONOCIMIENTO PREVIO: da la FORMA de lo normal
(perfil por minuto del día, forma de los errores por hora y rutina de logs). Otra semana puede venir
desplazada (otro servidor, más carga de base), con otra tasa de errores o con otra rutina de logs.
Aquí se aprende esa corrección, siempre con datos hasta cada minuto (nunca del futuro):

1. Desplazamiento de cada métrica: mediana de «medido − perfil del kit» durante el calentamiento
   (las primeras 6 h con dato). La latencia se corrige en proporción (×), los porcentajes de uso
   sumando (+). Después del calentamiento lo normal solo cambia mirando los cuatro tramos de 6 h de
   las últimas 24 h (un día completo, así no confunde la noche con el horario de oficina):
   - baja si los cuatro quedan más de 1σ por debajo (p. ej. la semana empezó en medio de una falla);
   - sube si los cuatro quedan más de 2σ por encima Y casi iguales entre sí (un nivel nuevo que ya no
     se mueve). Un nivel que sigue subiendo —un disco que se llena en dos días— o una falla que sube y
     luego baja nunca cumplen esto, así que no se aprenden como normales. Tampoco se acepta como
     normal un uso de 90 % o más.
2. Escala de los errores (ρ): errores observados / esperados por el kit, con el mismo calentamiento
   y las mismas dos reglas (en proporción). Además, ρ no sube mientras alguna métrica haya dado
   evidencia en las últimas 24 h: esos errores pueden ser parte de la falla.
3. Rutina de logs: plantillas del kit ∪ plantillas que ESTA semana ya se vieron en 2 horas distintas
   (sin distinguir mayúsculas ni acentos). Si la rutina del kit no describe esta semana (menos del 90 %
   de las líneas de 24 h son rutina del kit; en el kit nunca baja de 93 %), una línea desconocida pesa
   menos, y nada por debajo del 70 %, salvo que su texto describa una falla.
4. Eventos diarios del calendario que el kit no tenía a esa hora (p. ej. el respaldo cambió de hora):
   su efecto no está en el perfil, así que bajan el peso de las métricas como cualquier otro evento.

Interruptor: detectar(..., adaptar=False) o la variable de entorno ZIKIT_ADAPTAR=0 vuelven al
comportamiento anterior (solo conocimiento previo).
"""
import os
import re
import unicodedata
from collections import deque

import numpy as np
import pandas as pd

from .ingesta import MASCARAS

CALENTAMIENTO = 360  # minutos con dato (6 h) para aprender el desplazamiento y la escala de errores
MIN_MUESTRAS = 15  # minutos con dato antes de opinar sobre el nivel (mientras, la familia «nivel» no opina)
VENTANA = 1440  # 24 h: lo normal solo cambia mirando un día completo
TRAMO, TRAMOS = 360, 4  # cuatro tramos de 6 h (las últimas 24 h)
BAJA_SIGMAS = 1.0  # baja si los cuatro quedan más de 1σ por debajo de lo normal
SUBE_SIGMAS = 2.0  # sube si los cuatro quedan más de 2σ por encima …
ESTABLE_SIGMAS = 1.0  # … y a menos de 1σ entre el más alto y el más bajo (≈ lo que varía un día tranquilo)
TECHO_PCT = 90.0  # un uso de 90 % o más nunca se acepta como normal
PROPORCIONALES = {"latencia_ms"}  # se corrigen multiplicando; el resto (porcentajes de uso), sumando

KAPPA_ERRORES = 20.0  # errores «del kit» supuestos al inicio: evita escalas extremas con pocos datos
BAJA_ERRORES = 1.5  # ρ baja si los cuatro tramos de 6 h quedan por debajo de ρ / 1.5
SUBE_ERRORES = 1.5  # ρ sube si los cuatro tramos de 6 h superan ρ × 1.5 …
ESTABLE_ERRORES = 1.25  # … y el más alto no pasa del más bajo en más de un 25 %

HORAS_RUTINA = 2  # plantilla ya vista en ≥ 2 horas distintas de esta semana → rutina
LINEAS_PREVIAS = 5  # al inicio no se sabe si la rutina del kit vale: cuentan como líneas no comprobadas
COBERTURA_NULA, COBERTURA_PLENA = 0.7, 0.9  # fracción de líneas de rutina del kit en 24 h (en las 55 corridas del kit nunca baja de 0.93)
VENTANA_COBERTURA = pd.Timedelta(hours=24)
TOLERANCIA_DIARIO = 30  # minutos: un evento diario a ±30 min de uno del kit ya está en el perfil


def activa(adaptar=None) -> bool:
    """adaptar=None → variable de entorno ZIKIT_ADAPTAR (por omisión, activa)."""
    if adaptar is None:
        return os.environ.get("ZIKIT_ADAPTAR", "1").strip().lower() not in {"0", "false", "no", "off"}
    return bool(adaptar)


def desplazamiento(res: np.ndarray, excluir: np.ndarray, sigma: float, nivel=None) -> np.ndarray:
    """Corrección de lo normal de una métrica en cada minuto (NaN mientras no hay MIN_MUESTRAS).

    `res`: media de 15 min − perfil del kit (o medido / perfil − 1 si es proporcional), `sigma` en esas
    mismas unidades, `excluir`: minutos dentro de eventos esperados (no enseñan lo normal), `nivel`:
    valor absoluto de la métrica (media de 60 min) para no aceptar como normal un uso ≥ TECHO_PCT.
    Causal: el valor en t solo usa res hasta t."""
    r = np.where(excluir, np.nan, np.asarray(res, float))
    validos = np.isfinite(r)
    cnt = np.cumsum(validos)
    cal = validos & (cnt <= CALENTAMIENTO)
    bw = pd.Series(np.where(cal, r, np.nan)).expanding(min_periods=MIN_MUESTRAS).median().values
    s = pd.Series(r)
    q = s.rolling(TRAMO, min_periods=TRAMO // 2).median()
    tramos = np.column_stack([q.shift(k * TRAMO).values for k in range(TRAMOS)])  # NaN si falta alguno
    q_min, q_max = tramos.min(axis=1), tramos.max(axis=1)
    techo = np.zeros(len(r), bool) if nivel is None else (np.asarray(nivel, float) >= TECHO_PCT)
    b = np.full(len(r), np.nan)
    actual = np.nan
    for i in range(len(r)):
        if cnt[i] <= CALENTAMIENTO:
            actual = bw[i]
        elif np.isfinite(actual):
            if q_max[i] < actual - BAJA_SIGMAS * sigma:
                actual = float(np.median(tramos[i]))
            elif (q_min[i] > actual + SUBE_SIGMAS * sigma and q_max[i] - q_min[i] < ESTABLE_SIGMAS * sigma
                  and not techo[i]):
                actual = float(np.median(tramos[i]))
        b[i] = actual
    return b


def desplazamiento_inicial(res: np.ndarray, excluir: np.ndarray) -> np.ndarray:
    """Solo el calentamiento de `desplazamiento`: mediana de res en las primeras CALENTAMIENTO minutos con
    dato (NaN mientras no hay MIN_MUESTRAS), y después fija. Los cambios posteriores los acepta
    propio.nivel_sostenido, que mira la serie con lo normal ya corregido. Causal."""
    r = np.where(excluir, np.nan, np.asarray(res, float))
    validos = np.isfinite(r)
    cal = validos & (np.cumsum(validos) <= CALENTAMIENTO)
    return pd.Series(np.where(cal, r, np.nan)).expanding(min_periods=MIN_MUESTRAS).median().values


def escala_errores(errores: pd.Series, lam: np.ndarray, excluir: np.ndarray, congelar=None) -> np.ndarray:
    """ρ(t): errores observados / esperados por el kit; λ efectivo = λ del kit × ρ. Causal.

    `congelar[t]`: hay evidencia de anomalía reciente en otras señales; mientras tanto ρ no sube."""
    congelar = np.zeros(len(errores), bool) if congelar is None else np.asarray(congelar, bool)
    e = errores.values.astype(float)
    validos = np.isfinite(e) & ~excluir
    cnt = np.cumsum(validos)
    cal = validos & (cnt <= CALENTAMIENTO)
    rw = (np.cumsum(np.where(cal, e, 0.0)) + KAPPA_ERRORES) / (np.cumsum(np.where(cal, lam, 0.0)) + KAPPA_ERRORES)
    E = pd.Series(np.where(validos, e, 0.0))
    Lm = pd.Series(np.where(validos, lam, 0.0))
    N = pd.Series(validos.astype(float))

    def tasa(w):
        return ((E.rolling(w, min_periods=1).sum() + KAPPA_ERRORES) / (Lm.rolling(w, min_periods=1).sum() + KAPPA_ERRORES)).values

    r24 = tasa(VENTANA)
    q, nq = pd.Series(tasa(TRAMO)), N.rolling(TRAMO, min_periods=1).sum()
    tramos = np.column_stack([q.shift(k * TRAMO).values for k in range(TRAMOS)])
    llenos = np.column_stack([nq.shift(k * TRAMO).values >= TRAMO // 2 for k in range(TRAMOS)]).all(axis=1)
    q_min, q_max = tramos.min(axis=1), tramos.max(axis=1)
    rho = np.empty(len(e))
    actual = 1.0
    for i in range(len(e)):
        if cnt[i] <= CALENTAMIENTO:
            actual = rw[i]
        elif llenos[i] and q_max[i] < actual / BAJA_ERRORES:
            actual = r24[i]
        elif (llenos[i] and not congelar[i] and q_min[i] > actual * SUBE_ERRORES
              and q_max[i] < ESTABLE_ERRORES * q_min[i]):
            actual = r24[i]
        rho[i] = actual
    return rho


MASCARAS_SIN_MAYUSCULAS = [(re.compile(rx.pattern, rx.flags | re.I), rep) for rx, rep in MASCARAS]


def clave(plantilla: str) -> str:
    """Plantilla sin mayúsculas ni acentos: «CACHE HIT RATIO» y «cache hit ratio» son la misma rutina."""
    return "".join(c for c in unicodedata.normalize("NFD", plantilla) if unicodedata.category(c) != "Mn").lower()


def clave_mensaje(mensaje: str) -> str:
    """Como ingesta.plantilla, pero las máscaras no distinguen mayúsculas («334 MS» → <NUM><U>) y el
    resultado pasa por `clave`. En los 264 000 mensajes del kit da lo mismo que clave(plantilla(m))."""
    t = mensaje
    for rx, rep in MASCARAS_SIN_MAYUSCULAS:
        t = rx.sub(rep, t)
    return clave(re.sub(r"\s+", " ", t).strip())


def rutina_logs(logs: pd.DataFrame, fondo: set, clase_falla) -> tuple:
    """Para cada línea (ordenadas por tiempo): (es_rutina, factor de peso, es del kit). Solo usa líneas anteriores.

    es_rutina: plantilla del kit, o ya vista en HORAS_RUTINA horas distintas de esta semana
    (una línea grave —clase_falla(msg) == "dura"— nunca se aprende como rutina).
    factor: 1 si la rutina del kit describe bien las últimas 24 h (≥ 90 % de las líneas son del kit);
    baja a 0 si es 70 % o menos. Al empezar la semana todavía no se sabe (LINEAS_PREVIAS cuentan como
    no comprobadas), así que el factor sube a medida que aparece rutina conocida.
    Una línea con vocabulario de falla siempre vale 1."""
    kit = {clave(p) for p in fondo}
    vistas, ventana = {}, deque()
    n_kit = 0
    rutina, factor, kit_l = [], [], []
    for ts, msg in zip(logs.timestamp, logs.mensaje):
        while ventana and ventana[0][0] < ts - VENTANA_COBERTURA:
            n_kit -= ventana.popleft()[1]
        cobertura = n_kit / (len(ventana) + LINEAS_PREVIAS)
        k = clave_mensaje(msg)
        clase = clase_falla(msg)
        del_kit = k in kit
        horas = vistas.setdefault(k, set())
        rutina.append(del_kit or (clase != "dura" and len(horas) >= HORAS_RUTINA))
        kit_l.append(del_kit)
        f = float(np.clip((cobertura - COBERTURA_NULA) / (COBERTURA_PLENA - COBERTURA_NULA), 0.0, 1.0))
        factor.append(1.0 if clase else f)
        horas.add(ts.floor("h"))
        ventana.append((ts, int(del_kit)))
        n_kit += int(del_kit)
    return np.array(rutina, bool), np.array(factor, float), np.array(kit_l, bool)


def diarios_sin_perfil(ventanas: list, ce: dict) -> set:
    """Eventos diarios de esta semana que el kit no tenía a esa hora (± TOLERANCIA_DIARIO): su efecto no
    está en el perfil. Solo usa el calendario y el conocimiento previo (ce["diarios_en_perfil"], leído de
    los contexto.md de entrenamiento). Sin ese dato se supone que todos están en el perfil (como antes)."""
    if "diarios_en_perfil" not in ce:
        return set()
    kit = [int(d["inicio"][:2]) * 60 + int(d["inicio"][3:5]) for d in ce["diarios_en_perfil"]]
    out = set()
    for v in ventanas:
        if v.recurrencia != "diaria":
            continue
        ini = v.inicio_nominal.hour * 60 + v.inicio_nominal.minute
        if not any(min(abs(ini - k), 1440 - abs(ini - k)) <= TOLERANCIA_DIARIO for k in kit):
            out.add(v.evento)
    return out
