"""Calibración: perfiles, sigmas, λ de errores, umbrales y catálogo de logs de fondo.

Se calcula una sola vez con las corridas de ENTRENAMIENTO (11–54) y se guarda en JSON.
Solo usa metricas.csv y logs.md; nunca etiquetas ni _solucion. Los umbrales se fijan
con los minutos "tranquilos" (sin episodios), para que el ruido normal no alerte.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import contexto, ingesta
from .senales import MET, HORAS_TEND, log10_p_errores, minuto_del_dia, perfil, sigma_robusta, suavizar

ENTRENAMIENTO = [f"corrida_{i:02d}" for i in range(11, 55)]


def _tablas(data_dir: Path, tenant: str, corridas: list):
    corr = ingesta.corridas_de(data_dir)
    series = [ingesta.leer_metricas(corr[c], tenant) for c in corridas]
    ts = pd.DatetimeIndex(series[0]["timestamp"])
    for c, s in zip(corridas, series):
        if not ts.equals(pd.DatetimeIndex(s["timestamp"])):
            raise ValueError(f"{tenant} {c}: los timestamps no coinciden con {corridas[0]}")
    W = {m: pd.DataFrame({c: s[m].values for c, s in zip(corridas, series)}) for m in ingesta.METRICAS}
    return ts, W


def calibrar_tenant(data_dir: Path, tenant: str, corridas: list) -> tuple:
    ts, W = _tablas(data_dir, tenant, corridas)
    mod = minuto_del_dia(ts)
    hr = ts.hour.values
    out = {"perfil15": {}, "perfil60": {}, "sigma_nivel": {}, "sigma_tendencia": {}}
    Z, ZT = {}, {}
    for m in MET:
        s15, s60 = suavizar(W[m])
        p15, p60 = perfil(s15, mod), perfil(s60, mod)
        r15 = s15.sub(p15[mod], axis=0)
        r60 = s60.sub(p60[mod], axis=0)
        d = r60 - r60.shift(HORAS_TEND)
        s1, s2 = sigma_robusta(r15.values), sigma_robusta(d.values)
        out["perfil15"][m], out["perfil60"][m] = p15.tolist(), p60.tolist()
        out["sigma_nivel"][m], out["sigma_tendencia"][m] = s1, s2
        Z[m], ZT[m] = r15 / s1, d / s2

    # Minutos tranquilos (solo para calibrar): la mediana entre corridas está cerca del perfil.
    tranquilo = np.ones(len(ts), bool)
    for m in MET:
        tranquilo &= (Z[m].median(axis=1).abs() < 1).values
    e = W["errores"]
    lam_h = pd.DataFrame(e.values[tranquilo]).assign(h=hr[tranquilo]).groupby("h").mean().mean(axis=1)
    lam_h = lam_h.reindex(range(24)).ffill().bfill()
    ep, _, _ = log10_p_errores(e, lam_h.values[hr])
    ep = pd.DataFrame(ep, columns=e.columns)
    tranquilo &= (ep.median(axis=1) < 2).values
    tranquilo3h = pd.Series(tranquilo.astype(float)).rolling(180, min_periods=1).min().values > 0.5
    out["lambda_hora"] = lam_h.tolist()

    maximos = []  # (familia, métrica, máximos por corrida en minutos tranquilos)
    for m in MET:
        zs = Z[m].rolling(10, min_periods=7).min()
        maximos.append(("nivel", m, np.nanmax(zs.values[tranquilo], axis=0)))
        zt = ZT[m].rolling(30, min_periods=20).min()
        maximos.append(("tend", m, np.nanmax(zt.values[tranquilo3h], axis=0)))
    epm = ep.rolling(10, min_periods=7).min()
    maximos.append(("err", "errores", np.nanmax(epm.values[tranquilo], axis=0)))

    # Catálogo de fondo: plantillas que en entrenamiento aparecen en 6 o más horas distintas.
    corr = ingesta.corridas_de(data_dir)
    L = pd.concat([ingesta.leer_logs(corr[c], tenant) for c in corridas], ignore_index=True)
    horas = L.assign(h=L.timestamp.dt.hour).groupby("plantilla").h.nunique()
    out["plantillas_fondo"] = sorted(horas[horas >= 6].index.tolist())
    out["minutos_tranquilos"] = int(tranquilo.sum())
    out["diarios_en_perfil"] = diarios_del_kit(data_dir, tenant, corridas, ts[0])
    return out, maximos


def diarios_del_kit(data_dir: Path, tenant: str, corridas: list, inicio) -> list:
    """Eventos diarios que el perfil ya absorbe: los del contexto.md de las corridas de entrenamiento
    (los que aparecen en al menos la mitad). La adaptación los usa para saber si un evento diario de
    otra semana está a la misma hora que en el kit o se movió (ver adaptacion.diarios_sin_perfil)."""
    corr = ingesta.corridas_de(data_dir)
    vistos = {}
    for c in corridas:
        ruta = Path(corr[c]) / tenant / "contexto.md"
        if not ruta.exists():
            continue
        for ev in contexto.leer(ruta.read_text(encoding="utf-8"), inicio)["eventos"]:
            if ev["recurrencia"] == "diaria":
                k = (ev["inicio"], ev["duracion_min"])
                vistos[k] = vistos.get(k, 0) + 1
    return [{"inicio": i, "duracion_min": d} for (i, d), k in sorted(vistos.items()) if k >= len(corridas) / 2]


def calibrar(data_dir: Path, tenants=None, corridas=None) -> dict:
    tenants = tenants or ingesta.TENANTS
    corridas = corridas or ENTRENAMIENTO
    cal = {"corridas_entrenamiento": corridas, "empresas": {}, "umbrales": {}}
    todos = []
    for t in tenants:
        cal["empresas"][t], maximos = calibrar_tenant(Path(data_dir), t, corridas)
        todos += maximos
    # Umbral = p99 de los máximos en minutos tranquilos × 1.1, con mínimo 3 (agrupando empresas).
    for fam in ["nivel", "tend", "err"]:
        for m in MET + ["errores"]:
            vals = [v for f, mm, v in todos if f == fam and mm == m]
            if not vals:
                continue
            vals = np.concatenate(vals)
            if np.all(np.isnan(vals)):
                continue
            cal["umbrales"][f"{fam}:{m}"] = float(max(3.0, np.nanquantile(vals, 0.99) * 1.1))
    return cal


def guardar(cal: dict, ruta: Path):
    Path(ruta).parent.mkdir(parents=True, exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump(cal, fh, ensure_ascii=False)


def cargar(ruta: Path) -> dict:
    with open(ruta, encoding="utf-8-sig") as fh:
        return json.load(fh)


PROPORCIONALES = {"latencia_ms"}  # su forma del día se combina en proporción, no sumando


def generica(calib: dict, excluir=()) -> dict:
    """Punto de partida para una empresa SIN calibración propia, a partir de las empresas del kit.

    - Forma del día: mediana de las formas de las empresas (sin su nivel; en proporción para la
      latencia). El nivel de la empresa nueva se aprende de su propia semana (modo adaptable).
    - Ruido y tendencia: el MAYOR de las empresas (sin calibración, el arranque es más prudente:
      una rutina nocturna desconocida no debe parecer falla antes de tener un día propio).
    - Errores esperados por hora: mediana de las empresas.
    - Rutina de logs: la unión de las plantillas de fondo. Sin eventos diarios conocidos.
    Solo sirve de arranque: con ZIKIT_ADAPTAR=0 no se aprende nada de la semana y una empresa
    nueva queda con lo genérico (resultados poco fiables)."""
    emp = [ce for t, ce in calib["empresas"].items() if t not in excluir]
    out = {"perfil15": {}, "perfil60": {}, "sigma_nivel": {}, "sigma_tendencia": {}}
    for m in MET:
        for clave in ("perfil15", "perfil60"):
            P = np.array([ce[clave][m] for ce in emp], float)
            nivel = np.nanmedian(P, axis=1, keepdims=True)
            if m in PROPORCIONALES:
                out[clave][m] = (np.nanmedian(P / nivel, axis=0) * np.nanmedian(nivel)).tolist()
            else:
                out[clave][m] = (np.nanmedian(P - nivel, axis=0) + np.nanmedian(nivel)).tolist()
        for s in ("sigma_nivel", "sigma_tendencia"):
            out[s][m] = float(np.max([ce[s][m] for ce in emp]))
    out["lambda_hora"] = np.median([ce["lambda_hora"] for ce in emp], axis=0).tolist()
    out["plantillas_fondo"] = sorted(set().union(*[set(ce["plantillas_fondo"]) for ce in emp]))
    out["diarios_en_perfil"] = []
    out["generica"] = True
    return out


def de_empresa(calib: dict, tenant: str) -> dict:
    """Calibración de la empresa; si no tiene (empresa nueva en un kit), el punto de partida genérico."""
    ce = calib["empresas"].get(tenant)
    return ce if ce is not None else generica(calib)
