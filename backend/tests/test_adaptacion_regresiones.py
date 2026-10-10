"""Regresiones del modo adaptable encontradas en la revisión cruzada de Codex (#27).

Datos sintéticos: no necesitan el dataset.
"""
import pandas as pd
import pytest

from zikit.detector import detectar
from zikit.ingesta import plantilla
from zikit.senales import MET

SIN_CALENDARIO = {"empresas": {"gracko": []}}


def _calib(valores, sigma, lam, err):
    ce = {"perfil15": {m: [valores[m]] * 1440 for m in MET}, "perfil60": {m: [valores[m]] * 1440 for m in MET},
          "sigma_nivel": {m: sigma for m in MET}, "sigma_tendencia": {m: sigma for m in MET},
          "lambda_hora": [lam] * 24, "plantillas_fondo": [], "diarios_en_perfil": []}
    return {"empresas": {"gracko": ce},
            "umbrales": {**{f"nivel:{m}": 3.0 for m in MET}, **{f"tend:{m}": 3.0 for m in MET}, "err:errores": err}}


@pytest.mark.parametrize("adaptar", [False, True])
def test_falla_grave_repetida_tras_resolverla_vuelve_a_avisar(adaptar):
    """La primera línea grave llega antes de abrir su caso: no debe aprenderse como rutina."""
    n = 2500
    ts = pd.date_range("2027-02-01", periods=n, freq="min")
    valores = {"cpu": 30.0, "ram": 50.0, "disco": 40.0, "latencia_ms": 40.0}
    met = pd.DataFrame({"timestamp": ts, **valores, "errores": 0.0})
    filas = [(1800, "ERROR", "disco /data: no space left on device"),
             (1810, "INFO", "operador: limpieza manual y servicio restablecido"),
             (2100, "ERROR", "disco /data: no space left on device")]
    logs = pd.DataFrame([{"timestamp": ts[i], "seccion": "servidor", "nivel": nv, "mensaje": msg,
                          "plantilla": plantilla(msg)} for i, nv, msg in filas])
    r = detectar(met, logs, _calib(valores, 1.0, 0.01, 7.0), SIN_CALENDARIO, "gracko", adaptar=adaptar)
    assert [str(a["timestamp"]) for a in r["alertas"]] == ["2027-02-02 06:00:00", "2027-02-02 11:00:00"]
    assert r["logs_roles"] == ["novedad", "resolucion", "novedad"]
    assert r["score"][2100] >= 0.5


@pytest.mark.parametrize("inicio", [400, 600, 900, 1500, 2000])
def test_errores_persistentes_no_se_aprenden_como_normales_dentro_del_dia(inicio):
    """Con un caso abierto por errores que no paran, el caso no se cierra «por calma» ni se reabre,
    empiece donde empiece la falla dentro del día (revisión de Codex: 400 y 600)."""
    n = 3000
    ts = pd.date_range("2026-11-01", periods=n, freq="min")
    valores = {m: (40.0 if m == "latencia_ms" else 20.0) for m in MET}
    met = pd.DataFrame({"timestamp": ts, **{m: [v] * n for m, v in valores.items()}, "errores": [0.0] * n})
    met.loc[inicio:, "errores"] = 1.0
    logs = pd.DataFrame({"timestamp": pd.Series([], dtype="datetime64[ns]"), "seccion": [], "nivel": [],
                         "mensaje": [], "plantilla": []})
    r = detectar(met, logs, _calib(valores, 2.0, 0.01, 3.0), SIN_CALENDARIO, "gracko", adaptar=True)
    assert len(r["alertas"]) == 1 and r["cierres"] == [None], (r["alertas"], r["cierres"])
    assert r["caso"][-1] == 0  # el mismo caso sigue abierto al final
    # Los errores del caso abierto no se volvieron «lo esperado» (1/min): solo enseñan los pocos minutos
    # anteriores a la primera evidencia, que el detector todavía no podía distinguir.
    assert r["adaptacion"]["lambda_errores"][-1] < 0.25
    assert r["adaptacion"]["familias"]["err"][-1] >= 0.3


def test_si_se_acaban_las_pasadas_no_se_aprende_de_la_falla(monkeypatch):
    """Con una sola pasada por día, el camino prudente (nada enseña desde el primer desacuerdo)
    tampoco deja que la falla en curso se vuelva normal."""
    from zikit import detector
    monkeypatch.setattr(detector, "PASADAS_BLOQUE", 1)
    test_errores_persistentes_no_se_aprenden_como_normales_dentro_del_dia(400)
