"""Serie para la línea de tiempo de la interfaz (serie.json): métricas suavizadas, apagones y calendario."""
import numpy as np
import pandas as pd

from .ingesta import METRICAS
from .senales import MET, visible


def apagones(met: pd.DataFrame) -> list:
    """Tramos en los que faltan las cinco métricas a la vez (fin exclusivo). Son falta de dato, no una falla."""
    vacio = met[METRICAS].isna().all(axis=1).values
    out, i, n = [], 0, len(vacio)
    while i < n:
        if vacio[i]:
            j = i
            while j + 1 < n and vacio[j + 1]:
                j += 1
            fin = met.timestamp.iloc[j] + pd.Timedelta(minutes=1)  # fin exclusivo
            out.append(dict(inicio=met.timestamp.iloc[i].isoformat(), fin=fin.isoformat(), minutos=j - i + 1))
            i = j + 1
        else:
            i += 1
    return out


UNIDADES = {"cpu": "%", "ram": "%", "disco": "%", "latencia_ms": "ms", "errores": "errores/min"}


def exportar(met: pd.DataFrame, ventanas: list, tenant: str, paso: int = 5) -> dict:
    """Un punto cada `paso` minutos con lo que muestra la pantalla (senales.visible): mediana de
    5 min de cada métrica y errores/min (promedio de 5 min); null en apagones."""
    vis = visible(met)
    suav, err = {m: vis[m] for m in MET}, vis["errores"]
    puntos = []
    for i in range(0, len(met), paso):
        p = {"t": met.timestamp.iloc[i].isoformat()}
        for m in MET:
            v = suav[m].iloc[i]
            p[m] = None if pd.isna(v) else round(float(v), 1)
        v = err.iloc[i]
        p["errores"] = None if pd.isna(v) else round(float(v), 2)
        puntos.append(p)
    # suprime=True: dentro de la banda las métricas pesan menos. Los eventos diarios no suprimen:
    # su efecto ya está en el perfil de esa hora y solo se reconocen sus logs.
    cal = [dict(evento=v.evento, recurrencia=v.recurrencia, inicio=v.inicio_nominal.isoformat(), fin=v.fin_nominal.isoformat(),
                suprime=v.recurrencia != "diaria") for v in ventanas]
    return {"tenant": tenant, "paso_min": paso, "unidades": UNIDADES, "serie": puntos, "apagones": apagones(met),
            "calendario": cal}
