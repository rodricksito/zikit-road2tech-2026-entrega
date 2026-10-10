"""Detector de reglas explicables + calendario de negocio.

Cada minuto se calculan cinco familias de evidencia con datos hasta ese minuto:
nivel frente al perfil de esa hora, tendencia de 3 h, tiempo hasta saturación,
errores frente a lo esperado y líneas de log nuevas. Se combinan con un OR ruidoso,
conf = 1 − Π(1 − c_i), y se emite UNA alerta por caso cuando conf ≥ 0.5.
Dentro de un evento del calendario, las métricas pesan 0.25× y los logs del evento no cuentan.

Dos modos para «lo normal» (interruptor: parámetro `adaptar` o variable ZIKIT_ADAPTAR=0):
- adaptable (por omisión): perfil, ruido, errores esperados y rutina de logs se aprenden del pasado
  de la corrida (propio.py), por bloques de un día; lo que pasa con un caso abierto o en un evento
  no se aprende. Mientras a una hora del día aún no le precede un día aprendible (arranque en frío),
  lo normal es la forma del kit corregida con lo visto de la semana (adaptacion.py), y en las
  primeras 24 h la rutina de logs es la del kit ∪ la aprendida. Después, solo la propia semana.
- kit: todo sale de calibracion.json (las 44 corridas de entrenamiento), como el prototipo.
"""
import os
import re

import numpy as np
import pandas as pd

from . import acciones, adaptacion, calendario, calibracion, propio
from .senales import HORAS_TEND, MET, SAT_PCT, log10_p_errores, minuto_del_dia, suavizar, visible

UMBRAL_ALERTA = 0.5
UMBRAL_FAMILIA = 0.3
RETENCION_MET = 60  # minutos que dura la evidencia de una métrica
CIERRE_MIN = 120  # minutos con conf < 0.3 para cerrar un caso
ENFRIAMIENTO_MIN = 120  # tras una resolución del operador
PASADAS_BLOQUE = 8  # modo adaptable: recálculos de un día antes de dejar de aprender por prudencia
PESO_CALENDARIO = 0.25
# Modo adaptable (ver propio.py y peso_log_propio)
FACTOR_NOVEDAD_PROPIA = 0.75  # una plantilla nueva esta semana puede ser rutina poco frecuente
CAPA_SIMPLES = UMBRAL_FAMILIA  # varias líneas nuevas sin palabras de alarma = una sola pista débil
PESO_GRAVE = 0.6  # «no space», «OutOfMemory», «abortado», «fallida», «no se liberó»
APRENDIZAJE_LOGS_H = 24  # primeras horas en que las líneas nuevas solo enseñan la rutina

RE_RES = re.compile(r"reinici|restablec|liberad|manualmente|reconfigurad|limpieza manual|normalizad|retirad|rate-limit aplicado|rangos bloqueados", re.I)
RE_SEN = re.compile(r"esperado|programad|reintentad|promocion|campana|nomina|snapshot|reindexado|mantenimiento|carga masiva|mysqldump|respaldo", re.I)
RE_DURA = re.compile(r"no space|sin espacio|outofmemory|agotad|abortad|fallida", re.I)
RE_KW = re.compile(r"tendencia|en aumento|sostenido|por encima de lo habitual|lo normal|umbral|al \d+%|intentos fallidos|fallo la autenticacion|consultas lentas|sin datos|pool|heap|cache|espera de bloqueo|cola de", re.I)
RE_FIN = re.compile(r"completad|finalizad", re.I)
RE_LIBERA = re.compile(r"liber[oó]\b", re.I)  # «limpieza de temporales liberó 9.8 GB»: buena noticia, no falla
# «no se liberó», «sin completar», «fallo al reiniciar»: lo contrario de un cierre o una resolución
RE_NEGADA = re.compile(r"\b(?:no|sin)\s+(?:se\s+|fue\s+|ha\s+|pudo\s+)?(?:liber|complet|finaliz|restablec|reinici|normaliz)"
                       r"|\b(?:fall[oó]|error)\s+al\s+(?:liber|complet|finaliz|restablec|reinici|normaliz)", re.I)

PESO_NIVEL_LOG = {"DEBUG": 0.2, "INFO": 0.2, "WARN": 0.4, "ERROR": 0.6}
DURACION_LOG = {"DEBUG": 720, "INFO": 720, "WARN": 360, "ERROR": 120}


def rol_log(ts: pd.Timestamp, msg: str, ventanas: list, con_calendario: bool, aprendido: dict | None = None) -> str:
    """Papel de una línea de log. Dentro de un evento esperado es señuelo si nombra al
    evento (sus palabras) o un recurso que un log ANTERIOR del mismo evento ya mencionó.

    `aprendido` (ventana → regex de recursos) se va llenando al leer los logs en orden:
    «carga masiva … en /data/declaraciones» asocia /data a esa carga masiva, y después
    «disco /data al 66%» dentro de la misma ventana se atribuye a ella. En otro evento
    (p. ej. la nómina) un aviso de /data sigue siendo novedad. Solo usa el pasado.

    Una falla grave (RE_DURA) o un cierre negado («no se liberó») se revisa antes que todo:
    nunca cuenta como fin, resolución, buena noticia ni señuelo, y no enseña recursos al evento."""
    dura = bool(RE_DURA.search(msg) or RE_NEGADA.search(msg))
    if not dura:
        if RE_FIN.search(msg):
            return "fin_programado"
        if RE_RES.search(msg):
            return "resolucion"
        if RE_LIBERA.search(msg):
            return "fin_programado"
    activas = [k for k, v in enumerate(ventanas) if v.inicio <= ts <= v.fin]
    propias = [k for k in activas if ventanas[k].palabras and re.search(ventanas[k].palabras, msg, re.I)]
    asociada = aprendido is not None and any(
        aprendido.get(k) and re.search("|".join(sorted(aprendido[k])), msg, re.I) for k in activas)
    if aprendido is not None and not dura:
        for k in propias:
            aprendido.setdefault(k, set()).update(calendario.recursos_de(msg))
    if not dura and ((RE_SEN.search(msg) and con_calendario) or propias or asociada):
        return "senuelo"
    return "novedad"


def clase_falla(msg: str) -> str:
    """«dura» si la línea describe una falla grave o un cierre negado; «kw» si usa vocabulario de falla; «» si no."""
    if RE_DURA.search(msg) or RE_NEGADA.search(msg):
        return "dura"
    return "kw" if RE_KW.search(msg) else ""


def peso_log(nivel: str, msg: str):
    b = PESO_NIVEL_LOG.get(nivel, 0.2)
    if nivel != "ERROR" and RE_KW.search(msg):
        b += 0.15
    return b, DURACION_LOG.get(nivel, 360)


def tipo_incidente(fams: set, txt: str) -> str:
    txt = txt.lower()
    if any(f.endswith("disco") for f in fams) or re.search(r"disco|espacio|/data|volumen", txt):
        return "capacidad_disco"
    if re.search(r"vpn|autenticacion|intentos fallidos|cuentas bloqueadas", txt):
        return "seguridad_acceso"
    if re.search(r"syn|conn/s|conexiones entrantes|por encima de lo habitual|lo normal", txt):
        return "trafico_anomalo"
    if re.search(r"pool|conexiones abiertas", txt):
        return "agotamiento_conexiones"
    if any(f.endswith("ram") for f in fams) or re.search(r"heap|memoria|gc|outofmemory|cache", txt):
        return "memoria"
    if re.search(r"bloqueo|deadlock|consultas lentas|bd", txt):
        return "base_de_datos"
    if re.search(r"gps|unidades|enlace", txt) or ({"nivel_latencia_ms", "err"} <= fams and "nivel_cpu" not in fams):
        return "red_enlace"
    if {"nivel_cpu", "nivel_latencia_ms"} & fams:
        return "degradacion_rendimiento"
    return "anomalia_generica"


def _retener(c: np.ndarray, h: int = RETENCION_MET) -> np.ndarray:
    return pd.Series(c).rolling(h, min_periods=1).max().values


def adaptar_por_omision() -> bool:
    """Modo por omisión: adaptable. ZIKIT_ADAPTAR=0 vuelve al comportamiento calibrado con el kit."""
    return os.environ.get("ZIKIT_ADAPTAR", "1").strip().lower() not in {"0", "no", "false", "off"}


def peso_log_propio(nivel: str, msg: str, aprendiendo: bool):
    """Peso de una línea con plantilla nueva en el modo adaptable.

    Lo que DICE la línea pesa igual que con el kit; lo que solo es «nuevo» pesa menos, porque una
    plantilla que aún no vimos esta semana puede ser rutina poco frecuente (con el kit, «nueva»
    quería decir «nunca vista en 44 semanas»).
    - Falla grave (sin espacio, memoria agotada, abortado, fallida, «no se liberó»): 0.6, siempre.
    - Con palabras de alarma (umbral, al 99 %, intentos fallidos, tendencia…): como el kit.
    - ERROR sin palabras de alarma: 0.45 (×3/4); solo, no basta para avisar.
    - Simple (INFO/DEBUG/WARN sin palabras de alarma): ×3/4, y juntas cuentan como una sola pista
      (ver CAPA_SIMPLES).
    - Primeras 24 h (se aprende la rutina): las INFO/DEBUG y las simples solo enseñan."""
    b, h = peso_log(nivel, msg)
    if RE_DURA.search(msg) or RE_NEGADA.search(msg):
        return max(b, PESO_GRAVE), h
    if aprendiendo and (nivel not in ("WARN", "ERROR") or es_simple(nivel, msg)):
        return 0.0, h
    if RE_KW.search(msg):
        return b, h
    return b * FACTOR_NOVEDAD_PROPIA, h


def es_simple(nivel: str, msg: str) -> bool:
    """Línea sin palabras de alarma, que no es ERROR ni describe una falla grave."""
    return nivel != "ERROR" and not (RE_KW.search(msg) or RE_DURA.search(msg) or RE_NEGADA.search(msg))


def _una_vez_en_eventos(fam: dict, incal: np.ndarray) -> dict:
    """Modo adaptable: durante un evento esperado (y la hora siguiente), las señales menores de
    métricas —ya rebajadas por el calendario— las explica el mismo evento: cuenta solo la más fuerte.
    Las que superan UMBRAL_FAMILIA (evidencia propia, no rebajada) se conservan."""
    ev = _retener(incal.astype(float), 60) > 0
    if not ev.any():
        return fam
    nombres = list(fam)
    M = np.vstack([fam[f] for f in nombres])
    menor = M < UMBRAL_FAMILIA
    top = np.argmax(np.where(menor, M, -1.0), axis=0)
    quitar = menor & ev & (np.arange(len(nombres))[:, None] != top[None, :])
    M = np.where(quitar, 0.0, M)
    return {f: M[k] for k, f in enumerate(nombres)}


def _familias(z, zt, eta, ep, incal, th):
    """Cinco familias de evidencia (sin logs) a partir de las señales por minuto. Todo mira hacia atrás."""
    fam, detalle = _familias_met(z, zt, eta, incal, th)
    fam["err"], detalle["err"] = _familia_err(ep, incal, th)
    return fam, detalle


def _familia_err(ep, incal, th):
    """Errores frente a lo esperado (rebajada dentro de eventos)."""
    incal_tend = _retener(incal.astype(float), 60) > 0
    eps = pd.Series(ep).rolling(10, min_periods=7).min().values
    k = th["err:errores"]
    c = np.where(eps >= 2 * k, 0.5, np.where(eps >= k, 0.35, 0.0))
    c = np.where(incal_tend, c * PESO_CALENDARIO, c)
    return _retener(c), eps


def _familias_met(z, zt, eta, incal, th):
    """Familias de métricas: nivel, tendencia y saturación."""
    incal_nivel = _retener(incal.astype(float), 20) > 0
    incal_tend = _retener(incal.astype(float), 60) > 0
    fam, detalle = {}, {}
    for m in ["cpu", "ram", "latencia_ms", "disco"]:
        zs = pd.Series(z[m]).rolling(10, min_periods=7).min().values
        k = th[f"nivel:{m}"]
        c = np.where(zs >= 2 * k, 0.5, np.where(zs >= k, 0.35, 0.0))
        c = np.where(incal_nivel, c * PESO_CALENDARIO, c)
        fam[f"nivel_{m}"] = _retener(c)
        detalle[f"nivel_{m}"] = zs
    for m in ["ram", "latencia_ms", "disco"]:
        zts = pd.Series(zt[m]).rolling(30, min_periods=20).min().values
        c = np.where(zts >= th[f"tend:{m}"], 0.35, 0.0)
        c = np.where(incal_tend, c * PESO_CALENDARIO, c)
        fam[f"tend_{m}"] = _retener(c)
        detalle[f"tend_{m}"] = zts
    for m in ["ram", "disco"]:
        e30 = pd.Series(eta[m]).rolling(30, min_periods=20).max().values
        ok = (e30 < 24) & (zt[m] >= 2)
        c = np.where(ok, 0.55, 0.0)
        c = np.where(incal_tend, c * PESO_CALENDARIO, c)
        fam[f"eta_{m}"] = _retener(c)
        detalle[f"eta_{m}"] = e30
    return fam, detalle


def _eta(s60: pd.Series) -> np.ndarray:
    slope = (s60 - s60.shift(HORAS_TEND)) / 3.0
    return ((SAT_PCT - s60) / slope.where(slope > 0)).values


def _senales_kit(met, ce, mod, hr):
    """Modo kit (ZIKIT_ADAPTAR=0): lo normal y el ruido memorizados en calibracion.json."""
    z, zt, eta, normal = {}, {}, {}, {}
    for m in MET:
        s15, s60 = suavizar(met[m])
        r15 = s15.values - np.asarray(ce["perfil15"][m])[mod]
        r60 = pd.Series(s60.values - np.asarray(ce["perfil60"][m])[mod])
        d = (r60 - r60.shift(HORAS_TEND)).values
        z[m] = r15 / ce["sigma_nivel"][m]
        zt[m] = d / ce["sigma_tendencia"][m]
        if m in ("disco", "ram"):
            eta[m] = _eta(s60)
        normal[m] = np.asarray(ce["perfil15"][m])[mod]
    lam = np.asarray(ce["lambda_hora"])[hr]
    ep, obs, mu = log10_p_errores(met["errores"], lam)
    return z, zt, eta, normal, ep, obs.values, mu.values


def _errores_propios(met, prep, aprender, congelar):
    """Modo adaptable: errores esperados del pasado de la corrida (propio.lambda_errores) y su
    prueba de Poisson. Devuelve ep, obs, mu, λ, si λ vino de días anteriores, la escala ρ del kit y
    cuánto pesa el kit en λ (0 con días anteriores)."""
    b = len(aprender)
    lam, lam_dias, rho, peso_kit = propio.lambda_errores(prep, aprender, congelar)
    ep, obs, mu = log10_p_errores(met["errores"].iloc[:b], lam)
    # Sin λ para toda la última hora, la prueba no es justa: se deja sin evidencia
    lam_hora = pd.Series(np.isfinite(lam).astype(float)).rolling(60, min_periods=60).min().values == 1
    ep = np.where(lam_hora, ep, np.nan)
    mu = np.where(lam_hora, mu.values, np.nan)
    return ep, obs.values, mu, lam, lam_dias, rho, peso_kit


def detectar(met: pd.DataFrame, logs: pd.DataFrame, calib: dict, cal: dict, tenant: str, modo: str = "completo",
             adaptar: bool | None = None) -> dict:
    """Detecta sobre UNA serie (una empresa en una corrida).

    `modo`: completo | sin_calendario | solo_metricas | solo_logs (para las ablaciones).
    `adaptar` (por omisión, True salvo ZIKIT_ADAPTAR=0): «lo normal» de cada métrica, la escala del
    ruido, los errores esperados y la rutina de los logs se aprenden del pasado de esta corrida (en el
    arranque en frío, la forma del kit corregida con la semana). Con False, todo sale de
    calibracion.json, exactamente como el detector sin adaptación.
    Devuelve las alertas, sus explicaciones y señales auxiliares.
    """
    if adaptar is None:
        adaptar = adaptar_por_omision()
    th = calib["umbrales"]
    ts = pd.DatetimeIndex(met["timestamp"])
    n = len(ts)
    mod = minuto_del_dia(ts)
    hr = ts.hour.values
    con_cal = modo != "sin_calendario"
    cal_usado = cal if con_cal else {**cal, "empresas": {tenant: []}}
    vents = calendario.ventanas(cal_usado, tenant, ts[0], ts[-1])

    # Ventanas del calendario que suprimen métricas. Las diarias no: las absorbe el perfil de días
    # anteriores (o el del kit). En el modo adaptable, mientras aún no hay día anterior, también suprime
    # la diaria que el perfil del kit no tenía a esa hora (p. ej. el respaldo cambió de hora).
    ce = calibracion.de_empresa(calib, tenant)  # genérica si la empresa no está calibrada
    sin_perfil = adaptacion.diarios_sin_perfil(vents, ce) if adaptar else set()
    incal = np.zeros(n, bool)
    diaria = np.zeros(n, bool)
    nombre_cal = np.array([""] * n, dtype=object)
    nombre_diaria = np.array([""] * n, dtype=object)
    for v in vents:
        mk = (ts >= v.inicio) & (ts <= v.fin)
        if v.recurrencia == "diaria":
            if v.evento in sin_perfil:
                nombre_diaria[mk & ~diaria] = v.evento
                diaria |= mk
            continue
        nombre_cal[mk] = v.evento
        incal |= mk

    # Para explicar: la media de 15 min solo en minutos con medición real, y lo que muestra la pantalla
    s15_obs = {m: suavizar(met[m])[0].where(met[m].notna()) for m in MET}
    vis = visible(met)

    # Señales por minuto. En el modo adaptable se calculan por bloques de un día: cada bloque usa lo
    # aprendido hasta su inicio (los minutos de casos abiertos y de eventos no enseñan).
    Z = {m: np.full(n, np.nan) for m in MET}
    ZT = {m: np.full(n, np.nan) for m in MET}
    ETA = {m: np.full(n, np.nan) for m in ("disco", "ram")}
    NORMAL = {m: np.full(n, np.nan) for m in MET}
    KIT = {m: np.full(n, np.nan) for m in MET}  # forma del kit en cada minuto (para explicar el ajuste)
    SIG = {m: np.full(n, np.nan) for m in MET}  # margen (σ) usado en cada minuto
    CAMBIO = {m: np.zeros(n) for m in MET}  # cambio de nivel sostenido ya aceptado (acumulado)
    CAMBIO_DESDE = {m: np.full(n, -1) for m in MET}  # minuto en que empezó el último cambio aceptado
    DE_DIAS = {m: np.zeros(n, bool) for m in MET}
    EP, OBS, MU = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
    LAM, LAM_DIAS, RHO, PESO_KIT = np.full(n, np.nan), np.zeros(n, bool), np.ones(n), np.zeros(n)
    incal_ef = incal.copy()
    if adaptar:
        bloques = [(a, min(a + propio.DIA, n)) for a in range(0, n, propio.DIA)]
        prep = propio.preparar(met, ce, mod, hr)
        calentando = np.cumsum(met[MET].notna().any(axis=1).values) <= adaptacion.CALENTAMIENTO
        for m in ETA:
            ETA[m] = _eta(prep[m]["s60"])  # no depende de lo aprendido
    else:
        z, zt, eta, normal, ep, obs, mu = _senales_kit(met, ce, mod, hr)
        Z, ZT, ETA, NORMAL, EP, OBS, MU = z, zt, eta, normal, ep, obs, mu
        bloques = [(0, n)]
    aprender = np.ones(n, bool)

    # Logs ordenados; cada línea cuenta desde ceil(marca): el mismo minuto si cae en :00, el siguiente si no.
    fondo = set(ce["plantillas_fondo"])
    if adaptar:
        L = logs.sort_values("timestamp", kind="stable").reset_index(drop=True)
        # Rutina de la bitácora = plantillas de fondo del kit (conocimiento previo, como el modo kit) ∪ las
        # vistas esta semana fuera de un caso abierto. En las primeras 24 h, además, las vistas en 2 horas
        # distintas, y una línea nueva pesa según cuánto describe el kit las últimas 24 h (adaptacion.rutina_logs).
        rutina_kit, factor_kit, del_kit = adaptacion.rutina_logs(L, fondo, clase_falla)
    else:
        L = logs[~logs.plantilla.isin(fondo)].sort_values("timestamp", kind="stable").reset_index(drop=True)
    idx_min = (((L.timestamp.dt.ceil("min") - ts[0]) / pd.Timedelta(minutes=1)).astype(int).values
               if len(L) else np.zeros(0, int))
    fin_aprendizaje = ts[0] + pd.Timedelta(hours=APRENDIZAJE_LOGS_H)
    # Rutina de la bitácora (modo adaptable): plantillas ya vistas esta semana FUERA de un caso abierto.
    # Lo que aparece durante un incidente no se aprende como rutina.
    vistas = set()
    clog = np.zeros(n)
    # Modo adaptable: las líneas nuevas «simples» (sin palabras de alarma, no ERROR, no graves) se
    # acumulan aparte y juntas cuentan como UNA pista débil (máx. CAPA_SIMPLES).
    simples, alarma = np.zeros(n), np.zeros(n)
    aporte = [[] for _ in range(n)]  # líneas que pesan en cada minuto
    resol = np.zeros(n, bool)
    roles, aprendido = [], {}
    sin_logs = modo == "solo_metricas"
    estado = {"abierto": False}

    filas = list(L.itertuples())

    def procesar(k: int):
        row = filas[k]
        frio = adaptar and row.timestamp < fin_aprendizaje  # primeras 24 h: rutina del kit ∪ aprendida
        # Una falla grave («no space», «OutOfMemory», «no se liberó»…) nunca es rutina ni se aprende como
        # tal: su primera aparición llega antes de que se abra su caso, y si se aprendiera, la misma falla
        # repetida después de resolverla ya no avisaría.
        grave = clase_falla(row.mensaje) == "dura"
        if adaptar and not grave and (del_kit[k] or row.plantilla in vistas or (frio and rutina_kit[k])):
            roles.append("rutina")
            if frio and not estado["abierto"]:
                vistas.add(row.plantilla)  # también enseña la rutina de los días siguientes
            return
        rol = rol_log(row.timestamp, row.mensaje, vents, con_cal, aprendido)
        roles.append(rol)
        if adaptar and rol == "novedad" and not estado["abierto"] and not grave:
            vistas.add(row.plantilla)
        i = int(idx_min[k])
        if i < 0 or i >= n or sin_logs:
            return
        if rol == "resolucion":
            resol[i] = True
            clog[i:] = 0.0
            simples[i:] = 0.0
            alarma[i:] = 0.0
            for j in range(i, n):
                aporte[j] = []
            return
        if rol in ("senuelo", "fin_programado"):
            return
        if frio:
            b, h = peso_log(row.nivel, row.mensaje)
            b *= factor_kit[k]
        elif adaptar:
            b, h = peso_log_propio(row.nivel, row.mensaje, row.timestamp < fin_aprendizaje)
        else:
            b, h = peso_log(row.nivel, row.mensaje)
        if b <= 0:
            return
        acc = simples if adaptar and not frio and es_simple(row.nivel, row.mensaje) else alarma
        acc[i:i + h] = 1 - (1 - acc[i:i + h]) * (1 - b)
        for j in range(i, min(n, i + h)):
            aporte[j].append(row.Index)

    por_minuto = [[] for _ in range(n)]
    k = 0
    while k < len(filas) and idx_min[k] < 0:  # anteriores a la primera métrica: solo enseñan
        procesar(k)
        k += 1
    for kk in range(k, len(filas)):
        if idx_min[kk] < n:
            por_minuto[idx_min[kk]].append(kk)
    resto = [kk for kk in range(k, len(filas)) if idx_min[kk] >= n]

    F = {}
    DET = {}
    met_prod = np.ones(n)
    score = np.zeros(n)
    alertas, explicaciones, cierres = [], [], []
    caso = np.full(n, -1)  # índice de la alerta abierta en cada minuto
    abierto, bajo, enfr = False, 0, -1
    for a, b in bloques:
        if adaptar:
            # Lo que pase en este bloque aún no se sabe: en una primera pasada todo el bloque puede enseñar.
            # Después, los minutos del bloque con evidencia de métricas o errores (y los 120 min de calma que
            # mantendrían su caso abierto) dejan de enseñar y se recalcula, para no aprender como «normal»
            # una falla que sigue en curso. Cada pasada solo usa minutos anteriores: sigue siendo causal.
            # Durante el calentamiento (primeras 6 h con datos) todo enseña: si la semana entera está
            # desplazada, al principio todo parece evidencia hasta aprender el desplazamiento.
            def calcular(excl):
                apr = np.concatenate([aprender[:a], ~excl]) & ~incal[:b]
                sp = propio.metricas(prep, apr, incal[:b])
                for m in MET:
                    for dst, campo in ((Z, "z"), (ZT, "zt"), (NORMAL, "normal"), (DE_DIAS, "de_dias"), (KIT, "kit"),
                                       (SIG, "sigma"), (CAMBIO, "cambio"), (CAMBIO_DESDE, "cambio_desde")):
                        dst[m][a:b] = sp[m][campo][a:]
                sin_ayer = ~np.logical_and.reduce([DE_DIAS[m][a:b] for m in MET])
                nuevas = diaria[a:b] & sin_ayer & ~incal[a:b]
                incal_ef[a:b] = incal[a:b] | nuevas
                nombre_cal[a:b] = np.where(nuevas, nombre_diaria[a:b], nombre_cal[a:b])
                fam, det = _familias_met({m: Z[m][:b] for m in MET}, {m: ZT[m][:b] for m in MET},
                                         {m: ETA[m][:b] for m in ETA}, incal_ef[:b], th)
                # La escala de errores del kit no sube mientras alguna métrica dio evidencia en las últimas
                # 24 h: esos errores pueden ser parte de una falla en curso, no la nueva normalidad.
                congelar = _retener((np.max([fam[f] for f in fam], axis=0) >= UMBRAL_FAMILIA).astype(float), propio.DIA) > 0
                ep, obs, mu, lam, lam_dias, rho, peso_kit = _errores_propios(met, prep, apr, congelar)
                EP[a:b], OBS[a:b], MU[a:b] = ep[a:], obs[a:], mu[a:]
                LAM[a:b], LAM_DIAS[a:b], RHO[a:b], PESO_KIT[a:b] = lam[a:], lam_dias[a:], rho[a:], peso_kit[a:]
                fam["err"], det["err"] = _familia_err(EP[:b], incal_ef[:b], th)
                evid = np.max([fam[f][a:b] for f in fam], axis=0) >= UMBRAL_FAMILIA
                return fam, det, (_retener(evid.astype(float), CIERRE_MIN) > 0) & ~calentando[a:b]

            # Cada pasada deja fijo todo lo anterior al primer minuto en que la máscara cambió (lo que se
            # calcula en t solo usa minutos anteriores), así que ese primer desacuerdo avanza en cada pasada.
            # Si se acaban las pasadas, desde ese minuto nada enseña: nunca se aprende de una falla activa.
            excl = np.zeros(b - a, bool)
            for pasada in range(PASADAS_BLOQUE + 1):
                fam, det, nuevo = calcular(excl)
                dif = np.flatnonzero(nuevo & ~excl)
                if dif.size == 0:  # ningún minuto con evidencia enseñó: máscara consistente (o más prudente)
                    break
                if pasada == PASADAS_BLOQUE - 1:
                    excl = excl.copy()
                    excl[dif[0]:] = True
                else:
                    excl = np.concatenate([excl[:dif[0]], nuevo[dif[0]:]])
        else:
            fam, det = _familias(Z, ZT, ETA, EP, incal_ef, th)
        if adaptar:
            fam = _una_vez_en_eventos(fam, incal_ef[:b])
        for f, v in fam.items():
            F.setdefault(f, np.zeros(n))[a:b] = 0 * v[a:b] if modo == "solo_logs" else v[a:b]
        for f, v in det.items():
            DET.setdefault(f, np.full(n, np.nan))[a:b] = v[a:b]
        nombres = list(fam)
        prod = 1 - F[nombres[0]][a:b]
        for f in nombres[1:]:
            prod = prod * (1 - F[f][a:b])
        met_prod[a:b] = prod
        F["logs"] = clog
        cols = nombres + ["logs"]

        # Casos: una alerta al abrir; se cierra por resolución del operador o tras 120 min en calma.
        for i in range(a, b):
            for kk in por_minuto[i]:
                procesar(kk)
            clog[i] = 1 - (1 - min(simples[i], CAPA_SIMPLES)) * (1 - alarma[i]) if adaptar else alarma[i]
            score[i] = 1 - met_prod[i] * (1 - clog[i])
            if resol[i]:
                if abierto:
                    cierres[-1] = dict(timestamp=ts[i].isoformat(), motivo="resolucion")
                abierto, bajo, enfr = False, 0, i + ENFRIAMIENTO_MIN
            if i >= enfr:
                if not abierto and score[i] >= UMBRAL_ALERTA:
                    fs = {c for c in cols if F[c][i] >= UMBRAL_FAMILIA}
                    lineas = L.loc[aporte[i]]
                    tipo = tipo_incidente(fs, " ".join(lineas.mensaje))
                    al = dict(tenant=tenant, timestamp=ts[i], confianza=round(float(score[i]), 3), tipo=tipo,
                              familias="+".join(sorted(fs)), en_calendario=nombre_cal[i])
                    alertas.append(al)
                    explicaciones.append(_explicar(al, i, fs, F, cols, DET, s15_obs, vis, NORMAL,
                                                   (DE_DIAS, KIT, LAM_DIAS, RHO, PESO_KIT, CAMBIO, CAMBIO_DESDE) if adaptar else None,
                                                   ts, OBS, MU,
                                                   lineas, vents, con_cal))
                    cierres.append(None)
                    abierto, bajo = True, 0
                elif abierto:
                    bajo = bajo + 1 if score[i] < UMBRAL_FAMILIA else 0
                    if bajo >= CIERRE_MIN:
                        abierto = False
                        cierres[-1] = dict(timestamp=ts[i].isoformat(), motivo="calma")
            caso[i] = len(alertas) - 1 if abierto else -1
            estado["abierto"] = abierto
            aprender[i] = not abierto and i >= enfr
    for kk in resto:
        procesar(kk)
    r = {"alertas": alertas, "explicaciones": explicaciones, "cierres": cierres, "caso": caso,
         "score": score, "ventanas": vents, "logs_roles": roles}
    if adaptar:  # con el kit, exactamente las mismas claves que el detector sin adaptación
        r["adaptar"] = True
        # Señales por minuto (las que se usaron, para auditar y probar la causalidad)
        r["adaptacion"] = dict(normal=NORMAL, de_dias=DE_DIAS, kit=KIT, sigma=SIG, cambio=CAMBIO, cambio_desde=CAMBIO_DESDE,
                               z=Z, zt=ZT, familias=F,
                               lambda_errores=LAM, errores_esperados_dias=LAM_DIAS, escala_errores=RHO, peso_kit_errores=PESO_KIT,
                               mu_errores=MU,
                               diarios_sin_perfil=sorted(sin_perfil))
    return r


def _ultimo_valido(serie: pd.Series, i: int):
    """Último valor válido en o antes del minuto i: (valor, índice) o (None, None)."""
    pasado = serie.iloc[:i + 1]
    j = pasado.last_valid_index()
    return (None, None) if j is None else (float(pasado.loc[j]), int(j))


def _explicar(a, i, fs, F, cols, detalle, s15, vis, normal15, origen, ts, obs_err, mu_err, lineas, vents,
              con_cal) -> dict:
    """Explicación de una alerta. Solo usa datos hasta su minuto i.

    `s15` (media de 15 min) solo cuenta en minutos con medición real, así que la hora del pico
    nunca cae dentro de un apagón. `vis` es lo que muestra la pantalla: el «valor actual».
    `normal15` es el «normal» que se usó en cada minuto (del kit o aprendido de la corrida).
    `origen` (solo modo adaptable; None con el kit, y entonces no se agregan campos):
    (de_dias, kit, lam_dias, rho, peso_kit, cambio, cambio_desde) dice si lo normal y los errores
    esperados vinieron de los días anteriores o del arranque en frío (forma del kit corregida con la
    semana, y con qué ajuste), y si incluye un cambio de nivel sostenido ya aceptado."""
    de_dias, kit15, lam_dias, rho, peso_kit, cambio, cambio_desde = origen if origen is not None else (None,) * 7
    t = a["timestamp"]
    desde = max(0, i - RETENCION_MET + 1)
    fams, partes = [], []
    for f in sorted(fs):
        c = round(float(F[f][i]), 3)
        if f.startswith("nivel_"):
            m = f[6:]
            w = np.asarray(detalle[f][desde:i + 1], float)
            hay = np.isfinite(w).any()
            j = desde + int(np.nanargmax(w)) if hay else i
            zmax = float(w[j - desde]) if hay else float("nan")
            vp, jp = _ultimo_valido(s15[m], j)  # media de 15 min en el pico de la última hora (con medición)
            va = vis[m].iloc[i]  # lo que muestra la pantalla en este minuto
            va = None if pd.isna(va) else float(va)
            jn = jp if jp is not None else j
            normal = float(normal15[m][jn])
            u = _unidad(m)
            extra = {}
            if de_dias is None:
                de = "normal a {} hora"
            else:
                if de_dias[m][jn]:
                    de = "normal a {} hora en los días anteriores"
                    extra = dict(normal_de=propio.DIAS_ANTERIORES, ajuste=None)
                else:
                    ajuste = normal - float(kit15[m][jn])
                    de = f"normal a {{}} hora según el kit, con un ajuste de {ajuste:+.1f}{u} aprendido de esta semana"
                    extra = dict(normal_de=propio.KIT_AJUSTADO, ajuste=_r(ajuste))
                cn = float(cambio[m][jn])
                desde_c = int(cambio_desde[m][jn])
                extra.update(cambio_nivel=_r(cn) if desde_c >= 0 else None,
                             cambio_nivel_desde=ts[desde_c].isoformat() if desde_c >= 0 else None)
                if desde_c >= 0:
                    de += (f" (incluye un cambio de nivel de {cn:+.1f}{u} sostenido desde el "
                           f"{ts[desde_c]:%d/%m %H:%M} y aceptado como nuevo normal)")
            fams.append(dict(familia="nivel", senal=m, unidad=u.strip(), ventana_min=15, valor=_r(vp), normal=_r(normal),
                             z=_r(zmax), hora=None if jp is None else ts[jp].isoformat(), valor_actual=_r(va),
                             confianza=c, **extra))
            ahora = f"; lectura actual {va:.1f}{u}" if va is not None else "; sin datos de métricas en este momento"
            if vp is None:
                partes.append(f"{_senal(m)} {zmax:.1f}σ por encima de lo normal, sin datos de métricas")
            elif jp == i:
                partes.append(f"{_senal(m)} promedió {vp:.1f}{u} en los últimos 15 min contra {normal:.1f}{u} "
                              f"{de.format('esta')} ({zmax:.1f}σ){ahora}")
            else:
                partes.append(f"{_senal(m)} promedió {vp:.1f}{u} en 15 min hasta las {ts[jp]:%H:%M} contra "
                              f"{normal:.1f}{u} {de.format('esa')} ({zmax:.1f}σ){ahora}")
        elif f.startswith("tend_"):
            m = f[5:]
            zmax = _nanmax(detalle[f][desde:i + 1])
            fams.append(dict(familia="tendencia", senal=m, z=_r(zmax), confianza=c))
            partes.append(f"{_senal(m)} subiendo de forma sostenida en las últimas 3 h ({zmax:.1f}σ)")
        elif f.startswith("eta_"):
            m = f[4:]
            h = _nanmin(detalle[f][desde:i + 1])
            va, ja = _ultimo_valido(s15[m], i)
            ya = (np.isfinite(h) and h <= 0) or (va is not None and va >= SAT_PCT)
            fams.append(dict(familia="saturacion", senal=m, horas_para_95=0.0 if ya else _r(h), confianza=c))
            if ya:
                partes.append(f"{_senal(m)} ya superó el {SAT_PCT:.0f} %")
            elif not np.isfinite(h):
                partes.append(f"{_senal(m)} cerca de saturarse")
            elif h < 1:
                partes.append(f"{_senal(m)} llegaría al {SAT_PCT:.0f} % en menos de 1 h")
            else:
                partes.append(f"{_senal(m)} llegaría al {SAT_PCT:.0f} % en unas {h:.0f} h")
        elif f == "err":
            o, mu = obs_err[i], mu_err[i]
            extra, nota_e = {}, ""
            if lam_dias is not None:
                if lam_dias[i]:
                    extra = dict(esperados_de=propio.DIAS_ANTERIORES)
                    nota_e = ", según los días anteriores"
                else:
                    extra = dict(esperados_de=propio.ULTIMAS_24H, peso_kit=_r(peso_kit[i], 2), escala_kit=_r(rho[i], 2))
                    nota_e = (f", según las últimas 24 h de esta semana; el kit (×{rho[i]:.1f}) pesa "
                              f"{100 * peso_kit[i]:.0f} %")
            fams.append(dict(familia="errores", unidad="errores en 60 min", errores_60min=None if pd.isna(o) else int(o),
                             esperados_60min=None if pd.isna(mu) else round(float(mu), 1), confianza=c, **extra))
            esperados = "?" if pd.isna(mu) else f"{mu:.0f}"
            partes.append(f"{int(o) if not pd.isna(o) else '?'} errores en 60 min (se esperan unos {esperados}{nota_e})")
        elif f == "logs":
            fams.append(dict(familia="logs", lineas=int(len(lineas)), confianza=c))
            partes.append(f"{len(lineas)} {'línea' if len(lineas) == 1 else 'líneas'} de log fuera de lo habitual")
    menores = [(f, round(float(F[f][i]), 3)) for f in cols if 0 < F[f][i] < UMBRAL_FAMILIA]
    otras = [dict(familia=_familia(f), senal=_senal_de(f), confianza=c) for f, c in menores]
    if menores:
        partes.append("además, señales menores: " + ", ".join(_nombre_familia(f) for f, _ in menores))

    activos = [v.evento for v in vents if v.inicio_nominal <= t < v.fin_nominal]
    if not con_cal:
        nota = " Calendario desactivado (modo de comparación)."
    elif a["en_calendario"]:
        nota = f" Ocurre durante «{a['en_calendario']}», un evento esperado."
    elif activos:
        nota = f" Ocurre durante «{activos[0]}», un evento diario cuyo efecto habitual ya está incluido en lo normal de esa hora; esta desviación lo supera."
    else:
        nota = " Fuera de los eventos esperados del calendario."
    # Eventos (no diarios) de las últimas 24 h ya iniciados: los que pudieron bajar el peso de las señales.
    hace24 = t - pd.Timedelta(hours=24)
    descartados = [dict(evento=v.evento, inicio=v.inicio_nominal.isoformat(), fin=v.fin_nominal.isoformat())
                   for v in vents if v.recurrencia != "diaria" and v.fin >= hace24 and v.inicio_nominal <= t]
    texto = "; ".join(partes)
    texto = texto[:1].upper() + texto[1:]
    return dict(
        id=f"{a['tenant']}-{t:%Y-%m-%dT%H:%M}",
        tenant=a["tenant"],
        timestamp=t.isoformat(),
        confianza=a["confianza"],
        nivel=_nivel(a["confianza"]),
        tipo=a["tipo"],
        titulo=acciones.NOMBRES[a["tipo"]],
        resumen=texto + "." + nota,
        familias=fams,
        otras_evidencias=otras,
        logs=[dict(timestamp=r.timestamp.isoformat(), seccion=r.seccion, nivel=r.nivel, mensaje=r.mensaje) for r in lineas.itertuples()],
        calendario_descartado=descartados,
        actualizaciones=[],
        accion_sugerida=acciones.ACCIONES[a["tipo"]],
    )


def _r(x, nd: int = 1):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def _familia(f: str) -> str:
    return {"nivel": "nivel", "tend": "tendencia", "eta": "saturacion", "err": "errores", "logs": "logs"}[f.split("_")[0]]


def _senal_de(f: str):
    return f.split("_", 1)[1] if "_" in f else None


def _nombre_familia(f: str) -> str:
    s = _senal_de(f)
    base = {"nivel": "nivel de", "tendencia": "tendencia de", "saturacion": "saturación de"}.get(_familia(f))
    return f"{base} {_senal(s)}" if base and s else _familia(f)


def _nivel(c: float) -> str:
    return "alta" if c >= 0.85 else "media" if c >= 0.7 else "baja"


def _senal(m: str) -> str:
    return {"cpu": "CPU", "ram": "RAM", "disco": "disco", "latencia_ms": "latencia"}[m]


def _unidad(m: str) -> str:
    return " ms" if m == "latencia_ms" else " %"


def _nanmax(v) -> float:
    v = np.asarray(v, float)
    return float(np.nanmax(v)) if np.isfinite(v).any() else float("nan")


def _nanmin(v) -> float:
    v = np.asarray(v, float)
    return float(np.nanmin(v)) if np.isfinite(v).any() else float("nan")
