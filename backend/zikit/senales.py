"""Cálculos de señales compartidos por la calibración y el detector.

Todas las ventanas móviles miran hacia atrás: el valor en el minuto t
solo depende de datos hasta t.
"""
import numpy as np
import pandas as pd
from scipy.stats import poisson

MET = ["cpu", "ram", "disco", "latencia_ms"]
SAT_PCT = 95.0  # umbral de saturación para la ETA de disco y RAM
HORAS_TEND = 180  # la tendencia compara t con t - 3 h


def suavizar(x):
    """Serie o tabla por minuto → (media de 15 min, media de 60 min) sobre la mediana de 5 min."""
    med5 = x.rolling(5, min_periods=3).median()
    return med5.rolling(15, min_periods=8).mean(), med5.rolling(60, min_periods=30).mean()


def mediana5(x):
    return x.rolling(5, min_periods=3).median()


def visible(met: pd.DataFrame) -> pd.DataFrame:
    """Lo que muestra la pantalla en cada minuto: mediana de 5 min de cada métrica y errores/min
    (promedio de 5 min), desde el primer minuto de la corrida. En un apagón (ninguna métrica)
    todo queda en NaN, también los errores. Lo usan la API, serie.json y el «valor actual» de la
    evidencia, para que digan lo mismo."""
    vis = pd.DataFrame({m: met[m].rolling(5, min_periods=1).median() for m in MET}, index=met.index)
    vis["errores"] = met["errores"].rolling(5, min_periods=1).mean()
    vis.loc[met[MET + ["errores"]].isna().all(axis=1)] = np.nan
    return vis


def minuto_del_dia(ts: pd.DatetimeIndex) -> np.ndarray:
    return (ts.hour * 60 + ts.minute).values


def perfil(tabla: pd.DataFrame, mod: np.ndarray) -> np.ndarray:
    """Perfil por minuto del día: mediana de todas las celdas de ese minuto, suavizada 15 min de forma circular."""
    v = tabla.values
    p = pd.Series([np.nanmedian(v[mod == k]) for k in range(1440)])
    ext = pd.concat([p.iloc[-7:], p, p.iloc[:7]])
    return ext.rolling(15, center=True, min_periods=5).median().iloc[7:-7].values


def sigma_robusta(v: np.ndarray) -> float:
    return float(1.4826 * np.nanmedian(np.abs(v - np.nanmedian(v))))


def log10_p_errores(errores, lam_por_fila: np.ndarray):
    """−log10 de la probabilidad de ver al menos esos errores en 60 min si siguen un Poisson con λ por hora."""
    nn = errores.notna()
    mu = nn.mul(lam_por_fila, axis=0).rolling(60, min_periods=30).sum()
    obs = errores.rolling(60, min_periods=30).sum()
    ep = -poisson.logsf(obs.values - 1, mu.values) / np.log(10)
    return ep, obs, mu
