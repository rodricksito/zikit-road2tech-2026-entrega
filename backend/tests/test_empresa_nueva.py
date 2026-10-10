"""Empresa sin calibración propia (kit diferente): punto de partida genérico de las demás empresas.

Para medirlo con honestidad, cada empresa se trata como desconocida quitando su calibración: el
punto de partida sale solo de las OTRAS tres.
"""
import copy

import pytest

from zikit import calibracion, contexto, ingesta
from zikit.detector import detectar

from conftest import requiere_dataset


def test_generica_es_prudente_y_conoce_la_rutina(calib):
    g = calibracion.generica(calib, excluir=("gracko",))
    otras = [calib["empresas"][t] for t in ("gramo", "kaiku", "ttr")]
    for m in g["sigma_nivel"]:
        assert g["sigma_nivel"][m] == max(ce["sigma_nivel"][m] for ce in otras)  # arranque prudente
        assert len(g["perfil15"][m]) == 1440
    assert set(g["plantillas_fondo"]) == set().union(*[set(ce["plantillas_fondo"]) for ce in otras])
    assert g["diarios_en_perfil"] == [] and g["generica"] is True
    assert calibracion.de_empresa(calib, "empresa_nueva")["generica"] is True
    assert calibracion.de_empresa(calib, "gracko") is calib["empresas"]["gracko"]


@requiere_dataset
@pytest.mark.parametrize("tenant", ingesta.TENANTS)
def test_empresa_desconocida_da_las_mismas_alertas_en_la_raiz(corridas, calib, cal, tenant):
    """Solo en modo adaptable: sin aprender de la semana, lo genérico no puede ajustarse a la empresa."""
    met, logs = ingesta.leer_metricas(corridas["raiz"], tenant), ingesta.leer_logs(corridas["raiz"], tenant)
    c, _ = contexto.elegir(corridas["raiz"], tenant, met.timestamp.iloc[0], cal)
    sin = copy.deepcopy(calib)
    del sin["empresas"][tenant]
    conocida = [(a["timestamp"], a["tipo"]) for a in detectar(met, logs, calib, c, tenant, adaptar=True)["alertas"]]
    nueva = [(a["timestamp"], a["tipo"]) for a in detectar(met, logs, sin, c, tenant, adaptar=True)["alertas"]]
    assert [t for _, t in nueva] == [t for _, t in conocida], (conocida, nueva)
