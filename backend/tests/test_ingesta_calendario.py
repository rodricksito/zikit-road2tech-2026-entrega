import pandas as pd

from zikit import calendario, ingesta

from conftest import requiere_dataset


def test_plantilla_enmascara_valores_variables():
    assert ingesta.plantilla("VPN: usuario vpn17 fallo la autenticacion") == "VPN: usuario vpn<ID> fallo la autenticacion"
    assert ingesta.plantilla("disco /data al 77% (umbral 80%)") == "disco /data al <PCT> (umbral <PCT>)"
    assert ingesta.plantilla("bloqueado 45.146.164.3 -> 22/tcp") == "bloqueado <IP> -> <N>/tcp"


def test_ventanas_de_gracko(cal):
    v = calendario.ventanas(cal, "gracko", pd.Timestamp("2026-10-08 08:00"), pd.Timestamp("2026-10-14 17:19"))
    diarias = [x for x in v if x.recurrencia == "diaria"]
    unicas = {x.evento: x for x in v if x.recurrencia == "unica"}
    assert len(diarias) == 7  # del jueves 8 al miércoles 14
    assert unicas["cierre de nomina"].inicio_nominal == pd.Timestamp("2026-10-12 10:00")
    assert unicas["cierre de nomina"].fin_nominal == pd.Timestamp("2026-10-12 14:00")
    # márgenes: 10 min antes y 30 después
    assert unicas["carga masiva"].inicio == pd.Timestamp("2026-10-09 16:50")
    assert unicas["carga masiva"].fin == pd.Timestamp("2026-10-09 20:00")


@requiere_dataset
def test_leer_corrida_raiz(corridas):
    met = ingesta.leer_metricas(corridas["raiz"], "gracko")
    assert len(met) == 9200
    assert list(met.columns) == ["timestamp", *ingesta.METRICAS]
    assert met.timestamp.is_monotonic_increasing
    logs = ingesta.leer_logs(corridas["raiz"], "gracko")
    assert len(logs) == 1200
    assert logs.seccion.value_counts().to_dict() == {"servidor": 400, "firewall": 400, "app": 400}
