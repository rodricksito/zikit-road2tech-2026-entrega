"""Calendario automático leído del contexto.md.

- En la semana original da las mismas ventanas y las mismas alertas que el calendario manual.
- Con una semana desplazada (y su ficha actualizada) da las mismas alertas, desplazadas;
  el calendario manual, con fechas fijas, se equivoca. Es lo que pidió el mentor: no memorizar.
"""
import re

import pandas as pd
import pytest

from zikit import calendario, contexto, ingesta
from zikit.detector import detectar, rol_log

from conftest import requiere_dataset



def _claves(alertas):
    return [(a["timestamp"], a["confianza"], a["tipo"], a["familias"]) for a in alertas]


@requiere_dataset
@pytest.mark.parametrize("tenant", ingesta.TENANTS)
def test_mismas_ventanas_que_el_calendario_manual(corridas, cal, tenant):
    met = ingesta.leer_metricas(corridas["raiz"], tenant)
    t0, t1 = met.timestamp.iloc[0], met.timestamp.iloc[-1]
    auto, avisos = contexto.elegir(corridas["raiz"], tenant, t0, cal)
    assert avisos == []
    llave = lambda c: {(v.inicio, v.fin, v.recurrencia) for v in calendario.ventanas(c, tenant, t0, t1)}
    assert llave(auto) == llave(cal)


@requiere_dataset
def test_mismas_alertas_que_el_manual_en_las_55_corridas(corridas, calib, cal):
    for nombre, carpeta in corridas.items():
        met = ingesta.leer_metricas(carpeta, "gracko")
        logs = ingesta.leer_logs(carpeta, "gracko")
        auto, _ = contexto.elegir(carpeta, "gracko", met.timestamp.iloc[0], cal)
        assert _claves(detectar(met, logs, calib, auto, "gracko")["alertas"]) == \
               _claves(detectar(met, logs, calib, cal, "gracko")["alertas"]), nombre


@requiere_dataset
@pytest.mark.parametrize("dias", [1, 7])
@pytest.mark.parametrize("nombre", ["raiz", "corrida_01", "corrida_37"])
def test_semana_desplazada_mismas_alertas(corridas, calib, cal, nombre, dias):
    met = ingesta.leer_metricas(corridas[nombre], "gracko")
    logs = ingesta.leer_logs(corridas[nombre], "gracko")
    texto = (corridas[nombre] / "gracko" / "contexto.md").read_text(encoding="utf-8")
    original = detectar(met, logs, calib, cal, "gracko")["alertas"]

    d = pd.Timedelta(days=dias)
    met2, logs2 = met.assign(timestamp=met.timestamp + d), logs.assign(timestamp=logs.timestamp + d)
    texto2 = re.sub(r"(\d{1,2}) de octubre", lambda m: f"{int(m.group(1)) + dias} de octubre", texto)
    auto = {**cal, "empresas": {"gracko": contexto.leer(texto2, met2.timestamp.iloc[0])["eventos"]}}

    esperado = [(a["timestamp"] + d, a["tipo"]) for a in original]
    con_contexto = [(a["timestamp"], a["tipo"]) for a in detectar(met2, logs2, calib, auto, "gracko")["alertas"]]
    con_manual = [(a["timestamp"], a["tipo"]) for a in detectar(met2, logs2, calib, cal, "gracko")["alertas"]]
    assert con_contexto == esperado
    assert con_manual != esperado  # con fechas fijas se equivoca: por eso el calendario sale de la ficha


def test_avisa_lo_que_no_entiende():
    texto = """## Eventos de negocio

- **Viernes 9 de octubre:** carga masiva (17:00–19:30).
- **Algun dia:** evento sin hora.
"""
    r = contexto.leer(texto, 2026)
    assert [e["inicio"] for e in r["eventos"]] == ["2026-10-09T17:00"]
    assert r["no_reconocidas"] == ["- **Algun dia:** evento sin hora."]


FICHA = """## Eventos de negocio

- **Viernes 9 de octubre:** carga masiva de declaraciones del cliente de mayor volumen (17:00–19:30).
- **Lunes 12 de octubre:** cierre de nomina quincenal, 10:00–14:00 (carga alta en el ERP).
"""


def _ventanas(texto, inicio="2026-10-08T08:00"):
    t0 = pd.Timestamp(inicio)
    cal = {"margen_antes_min": 10, "margen_despues_min": 30, "empresas": {"gracko": contexto.leer(texto, t0)["eventos"]}}
    return calendario.ventanas(cal, "gracko", t0, t0 + pd.Timedelta(days=7))


def test_falla_de_otro_recurso_durante_un_evento_no_se_descarta():
    """Revisión de Codex en #23: la nómina no debe tragarse un aviso de disco."""
    v, ts = _ventanas(FICHA), pd.Timestamp
    aviso = "WARN disco /data al 99%"
    assert rol_log(ts("2026-10-12T11:00"), aviso, v, True, {}) == "novedad"
    # En la carga masiva, /data se asocia solo cuando el propio evento lo anuncia en el log
    assert rol_log(ts("2026-10-09T18:10"), aviso, v, True, {}) == "novedad"
    aprendido = {}
    assert rol_log(ts("2026-10-09T17:05"), "INFO carga masiva de declaraciones en /data/declaraciones (3.1 GB)",
                   v, True, aprendido) == "senuelo"
    assert rol_log(ts("2026-10-09T18:10"), "WARN disco /data al 66% (crecimiento de 9 GB desde las 17:00)",
                   v, True, aprendido) == "senuelo"
    assert rol_log(ts("2026-10-09T18:20"), "WARN disco /database al 90%", v, True, aprendido) == "novedad"
    assert rol_log(ts("2026-10-09T18:30"), "ERROR /data: no space left on device", v, True, aprendido) == "novedad"
    # Lo aprendido vale solo dentro de esa ventana: en la nómina, /data sigue siendo novedad
    assert rol_log(ts("2026-10-12T11:00"), aviso, v, True, aprendido) == "novedad"


def test_mensaje_negado_durante_un_evento_no_ensena_ni_se_descarta():
    """Revisión de Codex en #23: «nomina: no se liberó memoria» no debe asociar memoria a la nómina."""
    v, ts, aprendido = _ventanas(FICHA), pd.Timestamp, {}
    assert rol_log(ts("2026-10-12T11:00"), "nomina: no se liberó memoria", v, True, aprendido) == "novedad"
    assert rol_log(ts("2026-10-12T11:00"), "nomina: OutOfMemory en el ERP", v, True, aprendido) == "novedad"
    assert aprendido == {}
    assert rol_log(ts("2026-10-12T11:01"), "memoria al 99%", v, True, aprendido) == "novedad"


@requiere_dataset
def test_falla_de_disco_durante_la_nomina_genera_alerta(corridas, calib, cal):
    met = ingesta.leer_metricas(corridas["raiz"], "gracko")
    logs = ingesta.leer_logs(corridas["raiz"], "gracko")
    falla = pd.DataFrame([{**logs.iloc[0].to_dict(), "timestamp": pd.Timestamp("2026-10-12T11:00:30"),
                           "nivel": "WARN", "mensaje": "disco /data al 99%"}])
    falla["plantilla"] = ingesta.plantilla(falla.mensaje.iloc[0])
    logs2 = pd.concat([logs, falla], ignore_index=True)
    auto, _ = contexto.elegir(corridas["raiz"], "gracko", met.timestamp.iloc[0], cal)
    for c in (auto, cal):
        ts = [a["timestamp"] for a in detectar(met, logs2, calib, c, "gracko")["alertas"]]
        assert any(pd.Timestamp("2026-10-12T11:00") <= t <= pd.Timestamp("2026-10-12T11:05") for t in ts), ts


def test_recurrencias_con_todos_y_cada():
    texto = """## Eventos
- **Todos los viernes 17:00:** copia (30 min)
- **Cada sabado, 03:00–04:30:** snapshot
- **Todos los dias 03:00:** respaldo (30 min)
- **Todos los meses 03:00:** cierre
"""
    r = contexto.leer(texto, 2026)
    assert [(e["recurrencia"], e.get("dia"), e["inicio"], e["duracion_min"]) for e in r["eventos"]] == [
        ("semanal", "viernes", "17:00", 30), ("semanal", "sabado", "03:00", 90), ("diaria", None, "03:00", 30)]
    assert r["no_reconocidas"] == ["- **Todos los meses 03:00:** cierre"]


def test_anio_escrito_y_semana_que_cruza_de_anio():
    texto = """## Eventos
- **Viernes 1 de enero de 2027:** tarea (17:00–19:30)
- **Jueves 31 de diciembre:** cierre anual (10:00–12:00)
- **Sabado 2 de enero:** inventario (09:00–10:00)
- **Lunes 31 de febrero:** imposible (09:00–10:00)
"""
    r = contexto.leer(texto, pd.Timestamp("2026-12-28T08:00"))
    assert [e["inicio"] for e in r["eventos"]] == ["2027-01-01T17:00", "2026-12-31T10:00", "2027-01-02T09:00"]
    assert r["no_reconocidas"] == ["- **Lunes 31 de febrero:** imposible (09:00–10:00)"]
    assert contexto.leer(texto, 2026)["eventos"][0]["inicio"] == "2027-01-01T17:00"  # el año escrito manda


def test_palabras_del_evento_sin_recursos_medidos():
    eventos = contexto.leer(FICHA + "\n## Sistemas\n| Respaldo nocturno | Copia de /data a NAS, 23:00 | Diario |\n",
                            2026)["eventos"]
    for e in eventos:
        assert not any(w in e["palabras"] for w in ("disco", "/data", "volumen", "cpu")), e
    assert [e["evento"] for e in eventos] == ["carga masiva de declaraciones", "cierre de nomina quincenal",
                                              "respaldo nocturno"]
