"""Pruebas del detector de gracko.

- Modo kit (ZIKIT_ADAPTAR=0): reproduce las alertas del prototipo validado (docs/ejemplos/), sin
  campos nuevos en el resultado ni en las explicaciones.
- Modo adaptable (por omisión): 3 alertas por corrida, del tipo correcto y a tiempo. Con días propios,
  lo normal no depende del kit; en el arranque en frío, la forma del kit corregida con la semana.
- Arranque en frío: una semana que empieza el domingo o el lunes sigue avisando a tiempo y sin falsas.
- Un escalón de carga sostenido se acepta como nuevo normal en ~24 h; la falla lenta del disco no.
- Invariancia de prefijo en los dos modos: cortar la entrada en t no cambia las alertas ≤ t ni
  sus explicaciones (no mira el futuro).
- Un apagón al inicio de una rampa no rompe la detección.
"""
import copy
import json
import re

import numpy as np
import pandas as pd
import pytest

from zikit import ingesta, propio
from zikit.detector import adaptar_por_omision, detectar, rol_log
from zikit.senales import minuto_del_dia

from conftest import REPO, requiere_dataset

pytestmark = requiere_dataset
CLAVE = ["timestamp", "confianza", "tipo", "familias", "en_calendario"]


def _alertas(r):
    df = pd.DataFrame(r["alertas"], columns=["tenant", *CLAVE])
    return df.astype({"timestamp": "datetime64[us]", "confianza": float, "tipo": str, "familias": str, "en_calendario": str})


def _correr(corridas, nombre, calib, cal, met=None, logs=None, modo="completo", adaptar=None):
    """`nombre` solo se usa para leer la corrida si no se pasan met y logs."""
    met = ingesta.leer_metricas(corridas[nombre], "gracko") if met is None else met
    logs = ingesta.leer_logs(corridas[nombre], "gracko") if logs is None else logs
    return detectar(met, logs, calib, cal, "gracko", modo, adaptar=adaptar)


def test_reproduce_prototipo_en_las_55_corridas(corridas, calib, cal):
    """Modo kit: las mismas alertas exactas que el prototipo (el modo adaptable avisa a otras horas)."""
    esperado = pd.read_csv(REPO / "docs" / "ejemplos" / "alertas_prototipo_gracko_55_corridas.csv")
    esperado["timestamp"] = pd.to_datetime(esperado.timestamp)
    esperado["en_calendario"] = esperado.en_calendario.fillna("")
    for nombre in corridas:
        obtenido = _alertas(_correr(corridas, nombre, calib, cal, adaptar=False))
        exp = esperado[esperado.corrida == nombre].reset_index(drop=True)
        assert len(obtenido) == len(exp) == 3, nombre
        for c in CLAVE:
            assert obtenido[c].astype(str).tolist() == exp[c].astype(str).tolist(), (nombre, c)


def _hipotesis():
    d = json.loads((REPO / "docs" / "ejemplos" / "hipotesis_gracko.json").read_text(encoding="utf-8"))
    hora = lambda s: pd.Timestamp(re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s).group(0))
    return [(h["tipo_alerta"], hora(h["primer_indicio"]), hora(h["impacto"])) for h in d["hipotesis"]]


def test_modo_adaptable_en_las_55_corridas(corridas, calib, cal):
    """Modo adaptable: en cada corrida, una alerta por incidente hipotético, de su tipo, entre el
    primer indicio − 3 h y el impacto, y ninguna otra (hipótesis del equipo, no etiquetas oficiales)."""
    hips = _hipotesis()
    for nombre in corridas:
        r = _correr(corridas, nombre, calib, cal, adaptar=True)
        assert r["adaptar"] is True
        obtenido = [(a["tipo"], a["timestamp"]) for a in r["alertas"]]
        assert len(obtenido) == len(hips), (nombre, obtenido)
        for (tipo, t), (tipo_h, indicio, impacto) in zip(obtenido, hips):
            assert tipo == tipo_h and indicio - pd.Timedelta(hours=3) <= t <= impacto, (nombre, tipo, t)


def _kit_roto(calib):
    roto = copy.deepcopy(calib)
    e = roto["empresas"]["gracko"]
    for m in e["perfil15"]:
        e["perfil15"][m] = [1.0] * 1440
        e["perfil60"][m] = [1.0] * 1440
        e["sigma_nivel"][m] = e["sigma_tendencia"][m] = 1e-3
    e["lambda_hora"] = [50.0] * 24
    return roto


def test_con_dias_propios_lo_normal_no_depende_del_kit(corridas, calib):
    """Donde hay días anteriores aprendibles, lo normal, su margen y los errores esperados salen solo de
    la semana: con un kit absurdo dan exactamente lo mismo. El kit solo entra en el arranque en frío."""
    met = ingesta.leer_metricas(corridas["raiz"], "gracko")
    ts = pd.DatetimeIndex(met.timestamp)
    mod, hr = minuto_del_dia(ts), ts.hour.values
    aprender = np.ones(len(met), bool)
    sanos = propio.preparar(met, calib["empresas"]["gracko"], mod, hr)
    rotos = propio.preparar(met, _kit_roto(calib)["empresas"]["gracko"], mod, hr)
    a, b = propio.metricas(sanos, aprender), propio.metricas(rotos, aprender)
    for m in a:
        dias = a[m]["de_dias"]
        assert dias[:propio.DIA].sum() == 0 and dias[2 * propio.DIA:].mean() > 0.95  # frío solo el 1.er día
        assert (a[m]["cambio_desde"] == -1).all()  # en la semana del kit no hay escalones que aceptar
        for k in ("normal", "sigma", "z"):
            np.testing.assert_array_equal(a[m][k][dias], b[m][k][dias], err_msg=f"{m} {k}")
        assert not np.allclose(a[m]["normal"][~dias], b[m]["normal"][~dias], equal_nan=True)
    la, da, _, _ = propio.lambda_errores(sanos, aprender)
    lb, db, _, _ = propio.lambda_errores(rotos, aprender)
    np.testing.assert_array_equal(da, db)
    np.testing.assert_array_equal(la[da], lb[da])


def _semana_desde(corridas, nombre, inicio):
    met = ingesta.leer_metricas(corridas[nombre], "gracko")
    logs = ingesta.leer_logs(corridas[nombre], "gracko")
    return (met[met.timestamp >= inicio].reset_index(drop=True), logs[logs.timestamp >= inicio].reset_index(drop=True))


@pytest.mark.parametrize("inicio", ["2026-10-11 06:00", "2026-10-12 08:00"], ids=["domingo", "lunes"])
@pytest.mark.parametrize("nombre", ["raiz", "corrida_01"])
def test_arranque_en_frio(corridas, calib, cal, nombre, inicio):
    """La semana empieza el domingo (en plena falla del disco) o el lunes (la VPN cae la primera noche):
    cada incidente que aún no ocurrió se avisa a tiempo y de su tipo, y no hay otras alertas."""
    met, logs = _semana_desde(corridas, nombre, inicio)
    r = detectar(met, logs, calib, cal, "gracko", adaptar=True)
    hips = [h for h in _hipotesis() if h[2] > pd.Timestamp(inicio) + pd.Timedelta(hours=1)]
    obtenido = [(a["tipo"], a["timestamp"]) for a in r["alertas"]]
    assert len(obtenido) == len(hips), obtenido
    for (tipo, t), (tipo_h, indicio, impacto) in zip(obtenido, hips):
        assert tipo == tipo_h and indicio - pd.Timedelta(hours=3) <= t <= impacto, (tipo, t)


def test_explicacion_dice_de_donde_sale_lo_normal(corridas, calib, cal):
    """El «normal» de la explicación es el usado: el primer día, la forma del kit con el ajuste de la
    semana; después, los días anteriores."""
    met = ingesta.leer_metricas(corridas["raiz"], "gracko")
    logs = ingesta.leer_logs(corridas["raiz"], "gracko")
    pico = (met.timestamp >= "2026-10-08 15:00") & (met.timestamp < "2026-10-08 15:40")
    met.loc[pico, "cpu"] = 95.0
    r = detectar(met, logs, calib, cal, "gracko", adaptar=True)
    nivel = [(e, f) for e in r["explicaciones"] for f in e["familias"] if f["familia"] == "nivel"]
    frio = [(e, f) for e, f in nivel if f["normal_de"] == propio.KIT_AJUSTADO]
    assert frio and all(pd.Timestamp(e["timestamp"]) < pd.Timestamp("2026-10-09 08:00") for e, _ in frio)
    e, f = frio[0]
    assert f["senal"] == "cpu" and f["ajuste"] is not None and "según el kit, con un ajuste de" in e["resumen"]
    i = int((pd.Timestamp(f["hora"]) - met.timestamp.iloc[0]) / pd.Timedelta(minutes=1))
    assert f["normal"] == round(float(r["adaptacion"]["normal"]["cpu"][i]), 1)  # el mismo que usó
    tarde = [f for e, f in nivel if pd.Timestamp(e["timestamp"]) > pd.Timestamp("2026-10-10")]
    assert tarde and all(f["normal_de"] == propio.DIAS_ANTERIORES for f in tarde)


def test_escalon_sostenido_se_acepta_y_la_falla_lenta_no(corridas, calib, cal):
    """CPU +10 permanente desde el jueves 20:00 (más carga, sin falla): tras un día parejo se acepta
    como nuevo normal y deja de dar evidencia; los 3 incidentes siguen avisándose a tiempo y no hay
    alertas de otro tipo ni fuera de su ventana. En la semana original (disco llenándose dos días) no
    se acepta ningún cambio de nivel.

    Límite conocido: antes de aceptarlo (el viernes), el escalón aún suma evidencia; con la carga
    masiva y el primer aviso real del disco (log de las 07:12) da una alerta temprana de disco."""
    met = ingesta.leer_metricas(corridas["raiz"], "gracko")
    logs = ingesta.leer_logs(corridas["raiz"], "gracko")
    base = detectar(met, logs, calib, cal, "gracko", adaptar=True)
    assert all((v == -1).all() for v in base["adaptacion"]["cambio_desde"].values())
    paso = met.timestamp >= "2026-10-08 20:00"
    met.loc[paso, "cpu"] = (met.loc[paso, "cpu"] + 10).clip(upper=100)
    r = detectar(met, logs, calib, cal, "gracko", adaptar=True)
    ts = pd.DatetimeIndex(met.timestamp)
    cambio = pd.Series(r["adaptacion"]["cambio"]["cpu"], index=ts)
    aceptado = cambio[cambio > 0].index[0]
    assert pd.Timestamp("2026-10-09 16:00") <= aceptado <= pd.Timestamp("2026-10-09 22:00")  # ~1 día parejo
    assert 8 <= cambio.iloc[-1] <= 12
    desde = ts[r["adaptacion"]["cambio_desde"]["cpu"][-1]]
    assert pd.Timestamp("2026-10-08 19:30") <= desde <= pd.Timestamp("2026-10-08 21:00")
    ev = pd.Series(r["adaptacion"]["familias"]["nivel_cpu"], index=ts)
    assert ev["2026-10-10":"2026-10-12"].max() < 0.3  # ya no es evidencia (a lo sumo, rebajada en un evento)
    ventanas = {t: (i - pd.Timedelta(hours=3), f) for t, i, f in _hipotesis()}
    for a in r["alertas"]:
        desde_h, impacto = ventanas[a["tipo"]]
        assert desde_h <= a["timestamp"] <= impacto, (a["tipo"], a["timestamp"])
    assert {a["tipo"] for a in r["alertas"]} == set(ventanas)


CAMPOS_ADAPTABLES = {"normal_de", "ajuste", "cambio_nivel", "cambio_nivel_desde", "esperados_de", "escala_kit", "peso_kit"}


def test_modo_kit_sin_campos_nuevos(corridas, calib, cal):
    """Con el interruptor apagado, el resultado y las explicaciones tienen exactamente la forma del
    detector sin adaptación (ni claves ni campos nuevos)."""
    for nombre in ["raiz", "corrida_01", "corrida_10"]:
        r = _correr(corridas, nombre, calib, cal, adaptar=False)
        assert set(r) == {"alertas", "explicaciones", "cierres", "caso", "score", "ventanas", "logs_roles"}
        for e in r["explicaciones"]:
            for f in e["familias"]:
                assert not CAMPOS_ADAPTABLES & set(f), (nombre, f)
            assert "días anteriores" not in e["resumen"] and "según el kit" not in e["resumen"]


def test_interruptor_zikit_adaptar(corridas, calib, cal, monkeypatch):
    """ZIKIT_ADAPTAR=0 vuelve al comportamiento calibrado con el kit; sin la variable, adaptable."""
    met = ingesta.leer_metricas(corridas["corrida_01"], "gracko")
    logs = ingesta.leer_logs(corridas["corrida_01"], "gracko")
    monkeypatch.delenv("ZIKIT_ADAPTAR", raising=False)
    assert adaptar_por_omision() and detectar(met, logs, calib, cal, "gracko")["adaptar"] is True
    monkeypatch.setenv("ZIKIT_ADAPTAR", "0")
    assert not adaptar_por_omision()
    pd.testing.assert_frame_equal(_alertas(detectar(met, logs, calib, cal, "gracko")),
                                  _alertas(detectar(met, logs, calib, cal, "gracko", adaptar=False)))
    assert detectar(met, logs, calib, cal, "gracko", adaptar=True)["adaptar"] is True  # el parámetro manda


def _escalon_cpu(met):
    met = met.copy()
    paso = met.timestamp >= "2026-10-08 20:00"
    met.loc[paso, "cpu"] = (met.loc[paso, "cpu"] + 10).clip(upper=100)
    return met


@pytest.mark.parametrize("adaptar", [True, False], ids=["adaptable", "kit"])
@pytest.mark.parametrize("nombre", ["raiz", "corrida_01", "corrida_37", "escalon_cpu", "inicio_domingo"])
def test_invariancia_de_prefijo(corridas, calib, cal, nombre, adaptar):
    """Cortar la entrada en t no cambia las alertas ≤ t, sus explicaciones, los casos, el puntaje ni (en
    el modo adaptable) las señales internas por minuto (lo normal, su origen, el margen, el escalón)."""
    if nombre == "escalon_cpu":
        met, logs = _escalon_cpu(ingesta.leer_metricas(corridas["raiz"], "gracko")), ingesta.leer_logs(corridas["raiz"], "gracko")
    elif nombre == "inicio_domingo":
        met, logs = _semana_desde(corridas, "raiz", "2026-10-11 06:00")
    else:
        met, logs = ingesta.leer_metricas(corridas[nombre], "gracko"), ingesta.leer_logs(corridas[nombre], "gracko")
    rc = _correr(corridas, nombre, calib, cal, met, logs, adaptar=adaptar)
    completo = _alertas(rc)
    cortes = set(pd.date_range(met.timestamp.iloc[400], met.timestamp.iloc[-1], freq="11h"))
    if nombre == "escalon_cpu":  # alrededor de la aceptación del escalón y del cambio de bloque
        cortes |= set(pd.date_range("2026-10-09 17:00", "2026-10-09 19:00", freq="20min")) | {pd.Timestamp("2026-10-09 08:00")}
    for t in completo.timestamp:
        cortes |= {t - pd.Timedelta(minutes=1), t, t + pd.Timedelta(minutes=1)}
    for t in sorted(cortes):
        rp = _correr(corridas, nombre, calib, cal, met[met.timestamp <= t], logs[logs.timestamp <= t], adaptar=adaptar)
        parcial = _alertas(rp)
        esperado = completo[completo.timestamp <= t].reset_index(drop=True)
        pd.testing.assert_frame_equal(parcial[CLAVE], esperado[CLAVE], obj=f"corte en {t}")
        # Las explicaciones tampoco pueden cambiar al quitar el futuro.
        exp_completas = [e for e in rc["explicaciones"] if pd.Timestamp(e["timestamp"]) <= t]
        assert rp["explicaciones"] == exp_completas, f"explicaciones distintas con corte en {t}"
        k = len(rp["score"])
        np.testing.assert_array_equal(rp["caso"], rc["caso"][:k])
        np.testing.assert_array_equal(rp["score"], rc["score"][:k])
        if adaptar:
            for clave in ("normal", "de_dias", "sigma", "cambio", "cambio_desde", "z"):
                for m, v in rc["adaptacion"][clave].items():
                    np.testing.assert_array_equal(rp["adaptacion"][clave][m], v[:k], err_msg=f"{clave} {m} corte {t}")
            np.testing.assert_array_equal(rp["adaptacion"]["lambda_errores"], rc["adaptacion"]["lambda_errores"][:k])


def test_apagon_al_inicio_de_la_rampa_de_disco(corridas, calib, cal):
    met = ingesta.leer_metricas(corridas["corrida_01"], "gracko")
    hueco = (met.timestamp >= "2026-10-10 10:30") & (met.timestamp < "2026-10-10 10:55")
    met.loc[hueco, ingesta.METRICAS] = np.nan
    alertas = _alertas(_correr(corridas, "corrida_01", calib, cal, met=met))
    assert len(alertas) == 3
    disco = alertas[alertas.tipo == "capacidad_disco"].timestamp
    assert len(disco) == 1 and disco.iloc[0] < pd.Timestamp("2026-10-11 23:00")  # antes del impacto


def test_explicaciones_completas(corridas, calib, cal):
    r = _correr(corridas, "corrida_01", calib, cal)
    assert len(r["explicaciones"]) == len(r["alertas"])
    for e in r["explicaciones"]:
        assert e["id"].startswith("gracko-") and e["accion_sugerida"] and e["resumen"].endswith(".")
        assert e["nivel"] in {"baja", "media", "alta"}
        assert all(pd.Timestamp(l["timestamp"]) <= pd.Timestamp(e["timestamp"]) for l in e["logs"])


def test_explicaciones_json_estricto_en_las_55_corridas(corridas, calib, cal):
    """Nunca NaN en el JSON ni «nan» en los textos (la corrida 10 tiene una alerta dentro de un apagón)."""
    for nombre in corridas:
        for e in _correr(corridas, nombre, calib, cal)["explicaciones"]:
            json.dumps(e, allow_nan=False)
            assert "nan" not in e["resumen"].lower(), (nombre, e["resumen"])
            for f in e["familias"]:
                if f["familia"] == "saturacion":
                    assert f["horas_para_95"] is None or f["horas_para_95"] >= 0
                if f["familia"] == "nivel" and f["valor"] is not None:
                    assert f["valor"] >= f["normal"], (nombre, f)  # el pico supera lo normal


def test_casos_y_cierres(corridas, calib, cal):
    r = _correr(corridas, "corrida_01", calib, cal)
    assert len(r["cierres"]) == len(r["alertas"])
    abiertos = set(r["caso"].tolist())
    assert all(k in abiertos for k in range(len(r["alertas"])))  # cada alerta abrió un caso
    assert all(c is None or c["motivo"] in {"resolucion", "calma"} for c in r["cierres"])


@pytest.mark.parametrize("msg, rol", [
    ("no se liberó memoria; OutOfMemory", "novedad"),          # revisión de Codex en #23
    ("se liberó memoria pero sigue OutOfMemory", "novedad"),
    ("no se liberó memoria", "novedad"),
    ("fallo al reiniciar el servicio de impresion", "novedad"),
    ("job respaldo-nocturno abortado: no space left on device", "novedad"),
    ("limpieza de temporales liberó 9.8 GB", "fin_programado"),  # mensajes reales del kit
    ("limpieza manual de /data liberó 31 GB", "resolucion"),
    ("respaldo-nocturno completado (reintento 2/3)", "fin_programado"),
])
def test_falla_grave_o_negada_nunca_es_buena_noticia(msg, rol):
    assert rol_log(pd.Timestamp("2026-10-09T11:00"), msg, [], False, {}) == rol


@pytest.mark.parametrize("msg", ["no se liberó memoria; OutOfMemory", "OutOfMemory en el ERP"])
def test_falla_de_memoria_inyectada_genera_alerta(corridas, calib, cal, msg):
    met = ingesta.leer_metricas(corridas["raiz"], "gracko")
    logs = ingesta.leer_logs(corridas["raiz"], "gracko")
    falla = pd.DataFrame([{**logs.iloc[0].to_dict(), "timestamp": pd.Timestamp("2026-10-09T11:00:30"),
                           "nivel": "ERROR", "mensaje": msg}])
    falla["plantilla"] = ingesta.plantilla(msg)
    r = detectar(met, pd.concat([logs, falla], ignore_index=True), calib, cal, "gracko")
    ts = [a["timestamp"] for a in r["alertas"]]
    assert any(pd.Timestamp("2026-10-09T11:00") <= t <= pd.Timestamp("2026-10-09T11:05") for t in ts), ts
    assert len(ts) == 4
