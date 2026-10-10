import atexit
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from zikit import calendario, calibracion, ingesta

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
DATA = Path(os.environ.get("ZIKIT_DATA") or REPO.parent / "zikit-dataset" / "data")

# Las pruebas nunca ven los kits subidos a un servidor local: cada sesión usa una carpeta vacía.
SUBIDAS = tempfile.mkdtemp(prefix="zikit-subidas-pruebas-")
os.environ["ZIKIT_SUBIDAS"] = SUBIDAS
atexit.register(shutil.rmtree, SUBIDAS, ignore_errors=True)

requiere_dataset = pytest.mark.skipif(not (DATA / "gracko" / "metricas.csv").exists(),
                                      reason=f"No se encontró el dataset en {DATA} (definir ZIKIT_DATA)")


@pytest.fixture(scope="session")
def data_dir():
    return DATA


@pytest.fixture(scope="session")
def calib():
    return calibracion.cargar(BACKEND / "config" / "calibracion.json")


@pytest.fixture(scope="session")
def cal():
    return calendario.cargar(BACKEND / "config" / "calendario.json")


@pytest.fixture(scope="session")
def corridas():
    return ingesta.corridas_de(DATA)
