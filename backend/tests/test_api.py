"""Pruebas de la API web: rutas, formato y causalidad (nada posterior a `hasta`)."""
import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from conftest import DATA, requiere_dataset
from zikit.detector import adaptar_por_omision

pytestmark = requiere_dataset
# Primera alerta (disco) de corrida_01. Cambia con el modo: adaptable (por omisión) aprende lo normal
# de la propia semana y avisa a las 12:16; con ZIKIT_ADAPTAR=0 (calibración del kit), a las 10:52.
DISCO_C01 = "2026-10-10T12:16:00" if adaptar_por_omision() else "2026-10-10T10:52:00"
ANTES_C01 = (pd.Timestamp(DISCO_C01) - pd.Timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S")


@pytest.fixture(scope="module")
def cliente():
    from zikit import api
    api.configurar(DATA)
    return TestClient(api.app)


def _get(cliente, ruta, **params):
    r = cliente.get(ruta, params=params)
    assert r.status_code == 200, (ruta, r.status_code, r.text)
    json.loads(r.text, parse_constant=lambda c: pytest.fail(f"{ruta} devolvió {c}"))  # JSON estricto, sin NaN
    return r.json()


def test_corridas_y_calendario(cliente):
    corr = _get(cliente, "/api/gracko/corridas")
    assert corr[0] == "raiz" and len(corr) == 55 and len(set(corr)) == 55
    cal = _get(cliente, "/api/gracko/calendario")
    nombres = {e["evento"] for e in cal}  # salen del contexto.md de la corrida
    assert {"carga masiva de declaraciones", "cierre de nomina quincenal", "respaldo nocturno"} <= nombres
    for e in cal:
        assert pd.Timestamp(e["fin"]) > pd.Timestamp(e["inicio"]) and e["origen"].startswith("contexto.md")
        assert e["suprime"] == (e["recurrencia"] != "diaria")
    s = _get(cliente, "/api/gracko/serie", corrida="corrida_05", hasta="2026-10-08T09:00:00")
    assert s["calendario_fuente"] == "contexto.md" and s["avisos"] == []


@pytest.mark.parametrize("ficha", [None, "## Eventos de negocio\n\n- **Algun dia:** evento sin hora.\n"])
def test_avisa_si_usa_el_calendario_manual(tmp_path, ficha):
    """Revisión de Codex en #23: si falta la ficha o no se entiende, la pantalla debe saberlo."""
    from zikit import api
    (tmp_path / "gracko").mkdir()
    for f in ("metricas.csv", "logs.md"):
        (tmp_path / "gracko" / f).symlink_to(DATA / "gracko" / f)
    if ficha:
        (tmp_path / "gracko" / "contexto.md").write_text(ficha, encoding="utf-8")
    try:
        api.configurar(tmp_path)
        c = TestClient(api.app)
        s = _get(c, "/api/gracko/serie", corrida="raiz", hasta="2026-10-08T09:00:00")
        assert s["calendario_fuente"] == "manual"
        assert s["avisos"] and "calendario manual" in s["avisos"][-1]
        assert all(e["origen"].startswith("calendario manual") for e in s["calendario"])
        assert all(e["origen"].startswith("calendario manual") for e in _get(c, "/api/gracko/calendario"))
    finally:
        api.configurar(DATA)


def test_serie_no_pasa_de_hasta_y_recorta_apagones(cliente):
    hasta = "2026-10-10T11:20:00"  # corrida_10 tiene un apagón que empieza a las 11:17 y sigue
    s = _get(cliente, "/api/gracko/serie", corrida="corrida_10", desde="2026-10-10T05:20:00", hasta=hasta)
    ts = [pd.Timestamp(p["t"]) for p in s["serie"]]
    assert ts == sorted(ts) and ts[-1] == pd.Timestamp(hasta) and ts[0] >= pd.Timestamp("2026-10-10T05:20:00")
    assert s["serie"][-1]["disco"] is None  # dentro del apagón: null, no cero
    ap = s["apagones"][-1]
    assert ap["inicio"] == "2026-10-10T11:17:00" and ap["fin"] == "2026-10-10T11:21:00"  # no revela cuándo vuelve
    assert all(pd.Timestamp(a["fin"]) <= pd.Timestamp(hasta) + pd.Timedelta(minutes=1) for a in s["apagones"])


def test_alertas_solo_hasta_el_reloj(cliente):
    assert _get(cliente, "/api/gracko/alertas", corrida="corrida_01", hasta=ANTES_C01) == []
    a = _get(cliente, "/api/gracko/alertas", corrida="corrida_01", hasta=DISCO_C01)
    assert [x["id"] for x in a] == [f"gracko-{DISCO_C01[:16]}"] and a[0]["cierre"] is None
    todas = _get(cliente, "/api/gracko/alertas", corrida="corrida_01", hasta="2026-10-14T17:19:00")
    assert len(todas) == 3
    for x in todas:
        assert x["accion_sugerida"] and x["titulo"] and 0 <= x["confianza"] <= 1
        assert all(pd.Timestamp(l["timestamp"]) <= pd.Timestamp(x["timestamp"]) for l in x["logs"])
        if x["cierre"]:
            assert pd.Timestamp(x["cierre"]["timestamp"]) <= pd.Timestamp("2026-10-14T17:19:00")


def test_estado(cliente):
    e = lambda c, h: _get(cliente, "/api/gracko/estado", corrida=c, hasta=h)["estado"]
    assert e("corrida_01", DISCO_C01) == "Alerta: Disco cerca de llenarse"
    assert e("corrida_01", ANTES_C01) == "Normal"
    assert e("corrida_01", "2026-10-09T09:00:00") == "Normal"
    assert e("corrida_01", "2026-10-09T18:00:00") == "Evento esperado: carga masiva de declaraciones"
    assert e("corrida_10", "2026-10-08T21:55:00") == "Sin datos"  # apagón sin ningún caso abierto
    # En el apagón del sábado: en modo adaptable el caso de disco ya está abierto (desde la 01:56) y el
    # estado muestra la alerta, que tiene prioridad; la marca de «sin datos» sigue presente.
    s = _get(cliente, "/api/gracko/estado", corrida="corrida_10", hasta="2026-10-10T11:20:00")
    assert s["sin_datos"] is True
    assert s["estado"] == ("Sin datos" if s["alerta_abierta"] is None else "Alerta: Disco cerca de llenarse")


def test_referencias_por_corrida_rotuladas_como_hipotesis(cliente):
    refs = _get(cliente, "/api/gracko/referencias", corrida="corrida_01")
    assert len(refs) == 3 and all("hipótesis" in r["fuente"] and r["corrida"] == "corrida_01" for r in refs)
    alertas = {a["id"]: a for a in _get(cliente, "/api/gracko/alertas", corrida="corrida_01", hasta="2026-10-14T17:19:00")}
    for r in refs:  # cada impacto hipotético tiene la alerta de SU tipo que lo anticipó
        assert r["alerta_id"] in alertas and alertas[r["alerta_id"]]["tipo"] == r["tipo_alerta"]
        assert pd.Timestamp(alertas[r["alerta_id"]]["timestamp"]) <= pd.Timestamp(r["timestamp"])
    assert _get(cliente, "/api/gracko/referencias", corrida="corrida_01", hasta="2026-10-11T22:59:00") == []


def test_referencias_vacias_si_la_semana_no_coincide(cliente, tmp_path, monkeypatch):
    from zikit import api
    datos = json.loads((api.HIPOTESIS / "hipotesis_gracko.json").read_text(encoding="utf-8"))
    datos["semana"] = {"inicio": "2026-10-15T08:00:00", "fin": "2026-10-21T17:19:00"}
    (tmp_path / "hipotesis_gracko.json").write_text(json.dumps(datos), encoding="utf-8")
    monkeypatch.setattr(api, "HIPOTESIS", tmp_path)
    assert _get(cliente, "/api/gracko/referencias", corrida="corrida_01") == []


def _con_alertas(monkeypatch, alertas):
    """Sustituye el detector por alertas sintéticas en la semana del kit."""
    from zikit import api
    met = pd.DataFrame({"timestamp": pd.date_range("2026-10-08T08:00", "2026-10-14T17:19", freq="min")})
    r = {"explicaciones": [{"id": i, "tipo": t, "timestamp": ts} for i, t, ts in alertas]}
    monkeypatch.setattr(api, "_res", lambda tenant, corrida: (met, r, None, None))  # lo que piden las rutas


def test_referencia_se_enlaza_solo_con_alertas_de_su_tipo(cliente, monkeypatch):
    """Revisión de Codex en #25: una alerta de disco no puede ser el aviso de la falla de VPN."""
    _con_alertas(monkeypatch, [("disco-ajeno", "capacidad_disco", "2026-10-12T19:00:00"),
                               ("vpn-1", "seguridad_acceso", "2026-10-12T22:10:00"),
                               ("vpn-2", "seguridad_acceso", "2026-10-12T23:40:00"),
                               ("vpn-tarde", "seguridad_acceso", "2026-10-13T00:40:00")])
    refs = {r["tipo_alerta"]: r["alerta_id"] for r in _get(cliente, "/api/gracko/referencias", corrida="raiz")}
    assert refs == {"capacidad_disco": None,  # la de disco llega después del impacto de disco (11 oct 23:00)
                    "seguridad_acceso": "vpn-1",  # la primera de su tipo antes del impacto (13 oct 00:31)
                    "degradacion_rendimiento": None}


def test_referencia_sin_tipo_valido_no_se_enlaza(cliente, monkeypatch, tmp_path):
    from zikit import api
    datos = json.loads((api.HIPOTESIS / "hipotesis_gracko.json").read_text(encoding="utf-8"))
    datos["hipotesis"][0].pop("tipo_alerta")
    datos["hipotesis"][1]["tipo_alerta"] = "vpn"  # fuera del catálogo
    (tmp_path / "hipotesis_gracko.json").write_text(json.dumps(datos), encoding="utf-8")
    monkeypatch.setattr(api, "HIPOTESIS", tmp_path)
    _con_alertas(monkeypatch, [("disco", "capacidad_disco", "2026-10-10T11:32:00"),
                               ("vpn", "seguridad_acceso", "2026-10-12T23:47:00")])
    refs = _get(cliente, "/api/gracko/referencias", corrida="raiz")
    assert [r["alerta_id"] for r in refs[:2]] == [None, None]


def test_rango_y_unidades_por_corrida(cliente):
    r = _get(cliente, "/api/gracko/rango", corrida="corrida_10")
    assert r == {"tenant": "gracko", "corrida": "corrida_10", "inicio": "2026-10-08T08:00:00",
                 "fin": "2026-10-14T17:19:00", "unidades": r["unidades"],
                 "calendario_fuente": "contexto.md", "avisos": []}
    assert r["unidades"]["errores"] == "errores/min"
    s = _get(cliente, "/api/gracko/serie", corrida="corrida_10", hasta="2026-10-12T23:47:00")
    assert s["corrida"] == "corrida_10" and s["unidades"]["errores"] == "errores/min"
    assert max(p["errores"] for p in s["serie"] if p["errores"] is not None) < 10  # por minuto, no la suma de 5
    assert cliente.get("/api/gracko/rango", params={"corrida": "corrida_99"}).status_code == 404


def test_errores_claros(cliente):
    assert cliente.get("/api/gracko/serie", params={"corrida": "corrida_01", "hasta": "2026-10-10 10:52"}).status_code == 422
    assert cliente.get("/api/gracko/alertas", params={"corrida": "corrida_99", "hasta": "2026-10-10T10:52:00"}).status_code == 404
    assert cliente.get("/api/Acme!/corridas").status_code == 404  # nombre no válido
    assert cliente.get("/api/acme/corridas").json() == []  # válido, pero no está en el kit oficial


# Revisión cruzada del #24: defectos del backend que la pantalla dejaba ver.
SENALES = ["cpu", "ram", "disco", "latencia_ms", "errores"]


def test_descripcion_del_impacto_no_adelanta_el_reloj(cliente):
    """A las 23:00 no puede decir «+ 23:01 exportacion fallida»."""
    def desc(hasta):
        return {r["tipo_alerta"]: r["descripcion"]
                for r in _get(cliente, "/api/gracko/referencias", corrida="raiz", hasta=hasta)}
    assert desc("2026-10-11T23:00:00")["capacidad_disco"] == "2026-10-11T23:00 respaldo abortado por falta de espacio"
    assert "23:01 exportacion fallida" in desc("2026-10-11T23:01:00")["capacidad_disco"]
    assert desc("2026-10-13T00:32:00")["seguridad_acceso"] == "2026-10-13T00:31 ERROR 37 cuentas bloqueadas"
    assert "00:33 WARN" in desc("2026-10-13T00:33:00")["seguridad_acceso"]
    assert "WARN previo 05:30" in desc("2026-10-14T09:20:00")["degradacion_rendimiento"]  # lo anterior sí se muestra


@pytest.mark.parametrize("corrida", ["raiz", "corrida_01", "corrida_10"])
def test_evidencia_dice_lo_mismo_que_la_pantalla_y_no_cae_en_apagones(cliente, corrida):
    alertas = _get(cliente, "/api/gracko/alertas", corrida=corrida, hasta="2026-10-14T17:19:00")
    assert alertas
    for a in alertas:
        s = _get(cliente, "/api/gracko/serie", corrida=corrida, hasta=a["timestamp"])
        pantalla = s["serie"][-1]
        assert pantalla["t"] == a["timestamp"]
        for f in a["familias"]:
            if f["familia"] != "nivel":
                continue
            assert f["ventana_min"] == 15
            assert f["valor_actual"] == pantalla[f["senal"]], (a["id"], f)  # mismo número que la tarjeta
            assert f["hora"] is None or not any(ap["inicio"] <= f["hora"] < ap["fin"] for ap in s["apagones"]), (a["id"], f)


def test_serie_completa_desde_el_inicio_y_nula_en_apagones(cliente):
    inicio = _get(cliente, "/api/gracko/serie", corrida="raiz", hasta="2026-10-08T08:00:00")["serie"][-1]
    assert all(inicio[k] is not None for k in SENALES), inicio  # sin «4 señales sin datos» al abrir
    s = _get(cliente, "/api/gracko/serie", corrida="corrida_10", desde="2026-10-10T11:10:00", hasta="2026-10-10T11:36:00")
    dentro = [p for p in s["serie"] if "2026-10-10T11:17:00" <= p["t"] < "2026-10-10T11:37:00"]
    assert dentro and all(p[k] is None for p in dentro for k in SENALES)  # errores también en null
