"""Subida de un kit (.zip) desde la app, descarga de alertas.csv y entrega.csv.

Los zips se arman en memoria con archivos del dataset local (gracko y corrida_01). Las entradas
de «_solucion», «etiquetas.csv» y «generar.py» son texto inventado aquí: nunca se lee el kit real.
"""
import csv
import io
import re
import stat
import threading
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import DATA, requiere_dataset
from zikit import adaptacion, api, kits
from zikit.__main__ import main as cli

pytestmark = requiere_dataset
ARCHIVOS = ("metricas.csv", "logs.md", "contexto.md")
C01 = DATA / "corridas" / "corrida_01"


def _zip(entradas: dict) -> bytes:
    """{ruta dentro del zip: Path del dataset | bytes | str | ZipInfo-con-texto}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for nombre, contenido in entradas.items():
            if isinstance(contenido, Path):
                z.write(contenido, nombre)
            elif isinstance(contenido, tuple):  # (ZipInfo, datos)
                z.writestr(contenido[0], contenido[1])
            else:
                z.writestr(nombre, contenido)
    return buf.getvalue()


def _empresa(prefijo: str, carpeta: Path = DATA, tenant: str = "gracko") -> dict:
    return {f"{prefijo}{tenant}/{f}": carpeta / tenant / f for f in ARCHIVOS}


@pytest.fixture
def subidas(tmp_path):
    d = tmp_path / "subidas"
    api.configurar(DATA, subidas=d)
    yield d
    api.configurar(DATA)


@pytest.fixture
def cliente(subidas):
    return TestClient(api.app)


def _subir(cliente, datos: bytes, nombre: str = "kit.zip", headers=None):
    return cliente.post("/api/kit", files={"archivo": (nombre, datos, "application/zip")}, headers=headers)


def _ok(cliente, datos: bytes) -> dict:
    r = _subir(cliente, datos)
    assert r.status_code == 200, r.text
    return r.json()


def _get(cliente, ruta, **params):
    r = cliente.get(ruta, params=params)
    assert r.status_code == 200, (ruta, r.status_code, r.text)
    return r.json()


def _sin_restos(subidas: Path):
    """Tras un rechazo no queda nada en disco: ni el kit ni la carpeta de extracción."""
    assert not subidas.exists() or list(subidas.iterdir()) == []


def _cli_csv(carpeta: Path, tenant: str, salida: Path) -> bytes:
    cli(["detectar", "--corrida", str(carpeta), "--tenant", tenant, "--salida", str(salida)])
    return (salida / "alertas.csv").read_bytes()


def _metricas(*timestamps: str) -> str:
    return "timestamp,cpu,ram,disco,latencia_ms,errores\n" + "".join(f"{t},10,40,50,30,0\n" for t in timestamps)


def _como_tras_reiniciar():
    """Sin el análisis que guardó la subida (como tras reiniciar el servidor, o para un par que la subida
    solo leyó): la primera vista vuelve a analizar los datos del disco."""
    api._precalculados.clear()


def _kit_pequeno() -> bytes:
    pequeno = "\n".join((DATA / "gracko" / "metricas.csv").read_text().splitlines()[:600]) + "\n"
    return _zip({"data/gracko/metricas.csv": pequeno, "data/gracko/logs.md": "",
                 "data/gracko/contexto.md": DATA / "gracko" / "contexto.md"})


# --- Subida correcta --------------------------------------------------------------------------

def test_subida_con_raiz_y_corrida_como_el_repo(cliente, subidas):
    """El zip que da GitHub: la carpeta del repo arriba, luego data/ y data/corridas/corrida_NN."""
    res = _ok(cliente, _zip({**_empresa("zikit-dataset-main/data/"),
                             **_empresa("zikit-dataset-main/data/corridas/corrida_01/", C01),
                             "zikit-dataset-main/README.md": "kit", "zikit-dataset-main/data/todos_metricas.csv": "x"}))
    k = res["id"]
    assert res["corridas"] == [f"kit-{k}", f"kit-{k}-corrida_01"]
    assert res["empresas"] == ["gracko"] and res["ignorados"] == 0 and res["avisos"] == []
    assert res["empresas_por_corrida"] == {f"kit-{k}": ["gracko"], f"kit-{k}-corrida_01": ["gracko"]}
    assert (subidas / f"kit-{k}" / "kit.json").exists()
    assert _get(cliente, f"/api/kit/{k}") == res  # la pantalla lo recupera con el identificador
    assert cliente.get("/api/kaiku/rango", params={"corrida": f"kit-{k}"}).status_code == 404  # solo trae gracko

    for kit, oficial in [(f"kit-{k}", "raiz"), (f"kit-{k}-corrida_01", "corrida_01")]:
        rango = _get(cliente, "/api/gracko/rango", corrida=kit)
        assert rango == {**_get(cliente, "/api/gracko/rango", corrida=oficial), "corrida": kit}
        assert rango["calendario_fuente"] == "contexto.md"
        q = {"hasta": "2026-10-11T12:00:00", "desde": "2026-10-11T06:00:00"}
        assert _get(cliente, "/api/gracko/serie", corrida=kit, **q) == {
            **_get(cliente, "/api/gracko/serie", corrida=oficial, **q), "corrida": kit}
        assert (_get(cliente, "/api/gracko/alertas", corrida=kit, hasta=rango["fin"])
                == _get(cliente, "/api/gracko/alertas", corrida=oficial, hasta=rango["fin"]))
        assert _get(cliente, "/api/gracko/estado", corrida=kit, hasta=rango["inicio"])["estado"]
        # Las hipótesis del equipo son del kit oficial: un kit subido nunca las recibe, aunque coincida la semana.
        assert _get(cliente, "/api/gracko/referencias", corrida=kit) == []
    assert _get(cliente, "/api/gracko/referencias", corrida="raiz") != []


def test_subida_con_las_empresas_arriba(cliente):
    res = _ok(cliente, _zip(_empresa("")))
    assert res["corridas"] == [f"kit-{res['id']}"]
    assert _get(cliente, "/api/gracko/rango", corrida=res["corridas"][0])["inicio"] == "2026-10-08T08:00:00"


def test_subida_solo_con_corridas(cliente):
    res = _ok(cliente, _zip({**_empresa("corridas/corrida_01/", C01),
                             **_empresa("corridas/corrida_02/", DATA / "corridas" / "corrida_02")}))
    assert res["corridas"] == [f"kit-{res['id']}-corrida_01", f"kit-{res['id']}-corrida_02"]


def test_los_kits_sobreviven_a_un_reinicio(cliente, subidas):
    res = _ok(cliente, _zip(_empresa("data/")))
    api.configurar(DATA, subidas=subidas)
    assert _get(cliente, f"/api/kit/{res['id']}")["corridas"] == [f"kit-{res['id']}"]
    assert _get(cliente, "/api/gracko/rango", corrida=f"kit-{res['id']}")["inicio"] == "2026-10-08T08:00:00"


def test_empresa_nueva_se_analiza_con_punto_de_partida_generico(cliente, subidas):
    """La evaluación puede traer empresas que no son las 4 del kit: se aceptan y se avisa."""
    otra = {f"data/acme/{f}": DATA / "gracko" / f for f in ARCHIVOS}  # los datos de gracko con otro nombre
    res = _ok(cliente, _zip({**otra, **_empresa("data/")}))
    kit = res["corridas"][0]
    assert res["empresas"] == ["acme", "gracko"]
    assert any("sin calibración previa" in a and "acme" in a for a in res["avisos"])
    assert _get(cliente, "/api/empresas", corrida=kit) == [
        {"tenant": "acme", "giro": _get(cliente, "/api/empresas")[0]["giro"], "calibrada": False},
        {"tenant": "gracko", "giro": _get(cliente, "/api/empresas")[0]["giro"], "calibrada": True}]
    fin = _get(cliente, "/api/acme/rango", corrida=kit)["fin"]
    nueva = [a["tipo"] for a in _get(cliente, "/api/acme/alertas", corrida=kit, hasta=fin)]
    conocida = [a["tipo"] for a in _get(cliente, "/api/gracko/alertas", corrida=kit, hasta=fin)]
    if adaptacion.activa(None):  # aprende «lo normal» de su propia semana: como si estuviera calibrada
        assert nueva == conocida == ["capacidad_disco", "seguridad_acceso", "degradacion_rendimiento"]
    else:  # sin aprender, lo genérico no se ajusta: la API lo avisa
        assert any("poco fiables" in a for a in _get(cliente, "/api/acme/rango", corrida=kit)["avisos"])
    filas = cliente.get("/api/entrega.csv", params={"corrida": kit}).text.splitlines()
    assert {f.split(",")[0] for f in filas[1:]} == {"acme", "gracko"}
    assert _get(cliente, "/api/acme/referencias", corrida=kit) == []
    assert cliente.get("/api/acme/rango", params={"corrida": "raiz"}).status_code == 404  # no está en el kit oficial


def test_nombre_de_empresa_no_valido(cliente, subidas):
    r = _subir(cliente, _zip({f"data/Mi Empresa/{f}": DATA / "gracko" / f for f in ARCHIVOS}))
    assert r.status_code == 422 and "no son válidos" in r.json()["detail"]
    _sin_restos(subidas)


def test_sin_logs_ni_contexto_avisa(cliente):
    res = _ok(cliente, _zip({"data/gracko/metricas.csv": DATA / "gracko" / "metricas.csv"}))
    assert any("Sin logs.md" in a for a in res["avisos"]) and any("Sin contexto.md" in a for a in res["avisos"])
    rango = _get(cliente, "/api/gracko/rango", corrida=res["corridas"][0])
    assert rango["calendario_fuente"] == "manual" and rango["avisos"]
    assert _get(cliente, "/api/gracko/alertas", corrida=res["corridas"][0], hasta=rango["fin"]) is not None


# --- alertas.csv y entrega.csv ----------------------------------------------------------------

def test_alertas_csv_igual_a_la_linea_de_comandos(cliente, tmp_path):
    res = _ok(cliente, _zip({**_empresa("data/"), **_empresa("data/corridas/corrida_01/", C01)}))
    for kit, carpeta in [(res["corridas"][0], DATA), (res["corridas"][1], C01)]:
        r = cliente.get("/api/gracko/alertas.csv", params={"corrida": kit})
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        assert r.headers["content-disposition"] == f'attachment; filename="alertas_gracko_{kit}.csv"'
        assert r.content == _cli_csv(carpeta, "gracko", tmp_path / kit)
        assert r.text.splitlines()[0] == "tenant,timestamp,confianza,tipo"
    oficial = cliente.get("/api/gracko/alertas.csv", params={"corrida": "corrida_01"})
    assert oficial.content == _cli_csv(C01, "gracko", tmp_path / "oficial")
    assert cliente.get("/api/gracko/alertas.csv", params={"corrida": "kit-00000000"}).status_code == 404


def test_entrega_csv_junta_las_empresas_ordenadas(cliente, tmp_path):
    filas = []
    for t in sorted(api.Config.calib["empresas"]):
        texto = _cli_csv(C01, t, tmp_path / t).decode()
        filas += list(csv.reader(io.StringIO(texto)))[1:]
    filas.sort(key=lambda f: f[1])  # estable: a la misma hora, por empresa
    r = cliente.get("/api/entrega.csv", params={"corrida": "corrida_01"})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert list(csv.reader(io.StringIO(r.text))) == [["tenant", "timestamp", "confianza", "tipo"], *filas]
    assert {f[0] for f in filas} == set(api.Config.calib["empresas"])

    res = _ok(cliente, _zip(_empresa("data/")))
    kit = res["corridas"][0]
    assert (cliente.get("/api/entrega.csv", params={"corrida": kit}).content
            == cliente.get("/api/gracko/alertas.csv", params={"corrida": kit}).content)
    assert cliente.get("/api/entrega.csv", params={"corrida": "no-existe"}).status_code == 404


# --- Seguridad --------------------------------------------------------------------------------

@pytest.mark.parametrize("ruta", ["../fuera/gracko/metricas.csv", "data/../../fuera/gracko/metricas.csv",
                                  "/tmp/zikit-fuera/gracko/metricas.csv", "C:\\fuera\\gracko\\metricas.csv",
                                  "data\\..\\..\\fuera\\gracko\\metricas.csv"])
def test_rechaza_rutas_que_salen_de_la_carpeta(cliente, subidas, ruta):
    # ZipInfo conserva el nombre tal cual (ZipFile.write lo limpiaría y la prueba no probaría nada).
    malo = (zipfile.ZipInfo(ruta), (DATA / "gracko" / "metricas.csv").read_bytes())
    r = _subir(cliente, _zip({**_empresa("data/"), ruta: malo}))
    assert r.status_code == 422 and "seguridad" in r.json()["detail"]
    _sin_restos(subidas)
    assert not (subidas.parent / "fuera").exists() and not Path("/tmp/zikit-fuera").exists()


def test_ignora_soluciones_y_etiquetas_sin_abrirlas(cliente, subidas, monkeypatch):
    prohibidos = {"data/corridas/corrida_01/_solucion/etiquetas.csv": "inventado",
                  "data/_solucion/gracko/metricas.csv": "inventado",
                  "data/_Solucion/gracko/logs.md": "inventado",
                  "data/gracko/etiquetas.csv": "inventado",
                  "scripts/generar.py": "print('inventado')"}
    datos = _zip({**_empresa("data/"), **prohibidos})
    abiertos, original = [], zipfile.ZipFile.open

    def espia(self, nombre, *a, **k):
        abiertos.append(nombre.filename if isinstance(nombre, zipfile.ZipInfo) else nombre)
        return original(self, nombre, *a, **k)
    monkeypatch.setattr(zipfile.ZipFile, "open", espia)
    res = _ok(cliente, datos)
    assert res["ignorados"] == len(prohibidos) and res["avisos"]
    assert abiertos and not set(prohibidos) & set(abiertos)
    en_disco = [p.relative_to(subidas).as_posix().lower() for p in subidas.rglob("*")]
    assert en_disco and not [p for p in en_disco if "_solucion" in p or "etiquetas" in p or "generar" in p]


def test_ignora_enlaces_simbolicos(cliente, subidas):
    enlace = zipfile.ZipInfo("data/gracko/logs.md")
    enlace.create_system = 3
    enlace.external_attr = (stat.S_IFLNK | 0o777) << 16
    res = _ok(cliente, _zip({"data/gracko/metricas.csv": DATA / "gracko" / "metricas.csv",
                             "data/gracko/logs.md": (enlace, "/etc/passwd")}))
    assert res["ignorados"] == 1 and any("Sin logs.md" in a for a in res["avisos"])
    logs = next(subidas.rglob("logs.md"))
    assert not logs.is_symlink() and logs.read_text() == ""


def test_zip_danado(cliente, subidas):
    assert _subir(cliente, b"esto no es un zip").status_code == 422
    entero = _zip(_empresa("data/"))
    r = _subir(cliente, entero[: len(entero) // 2])
    assert r.status_code == 422 and "zip" in r.json()["detail"]
    _sin_restos(subidas)


def test_sin_metricas(cliente, subidas):
    r = _subir(cliente, _zip({"data/gracko/logs.md": DATA / "gracko" / "logs.md", "README.md": "hola"}))
    assert r.status_code == 422 and "metricas.csv" in r.json()["detail"]
    _sin_restos(subidas)


def test_metricas_ilegible(cliente, subidas):
    r = _subir(cliente, _zip({"data/gracko/metricas.csv": "hora,cpu\n2026-10-08T08:00:00,1\n"}))
    assert r.status_code == 422 and "faltan columnas" in r.json()["detail"]
    assert str(subidas) not in r.json()["detail"]  # no revela rutas del servidor
    _sin_restos(subidas)


def test_sin_campo_archivo(cliente):
    assert cliente.post("/api/kit", data={"otro": "x"}).status_code == 422


def test_errores_del_formulario_en_espanol(cliente, subidas):
    """Starlette responde 400 en inglés si el formulario no se puede leer; el contrato dice 422 en español."""
    datos = _zip(_empresa("data/"))
    dos = cliente.post("/api/kit", files=[("archivo", ("a.zip", datos, "application/zip")),
                                          ("otro", ("b.zip", datos, "application/zip"))])
    sin_frontera = cliente.post("/api/kit", content=datos, headers={"Content-Type": "multipart/form-data"})
    for r in (dos, sin_frontera):
        assert r.status_code == 422 and "un solo archivo .zip" in r.json()["detail"], r.text
    _sin_restos(subidas)


@pytest.mark.parametrize("limite, valor, estado", [("archivo", 100_000, 413), ("logs", 50_000, 413),
                                                     ("total", 400_000, 413), ("entradas", 2, 422),
                                                     ("indice", 100, 422), ("zip", 10_000, 413)])
def test_limites_de_tamano(cliente, subidas, monkeypatch, limite, valor, estado):
    monkeypatch.setitem(kits.LIMITES, limite, valor)
    r = _subir(cliente, _zip(_empresa("data/")))  # metricas.csv ~ 360 kB, logs.md ~ 80 kB; los tres ~ 450 kB
    assert r.status_code == estado, r.text
    _sin_restos(subidas)


def test_los_topes_por_archivo_son_cercanos_al_kit_oficial(cliente, subidas):
    """Un logs.md de 55 MB se aceptaba y costaba 47 s y 1.2 GB en cada vista; ahora el tope es 2 MB."""
    mayor = {n: max((DATA / t / n).stat().st_size for t in api.Config.calib["empresas"])
             for n in ("metricas.csv", "logs.md")}
    assert 10 * mayor["metricas.csv"] < kits.LIMITES["archivo"] <= 5 * kits.MB
    assert 10 * mayor["logs.md"] < kits.LIMITES["logs"] <= 2 * kits.MB
    linea = "2026-10-08T08:00:00 INFO prueba de un log grande\n"
    grande = linea * (kits.LIMITES["logs"] // len(linea) + 1)  # comprimido ocupa unos KB
    r = _subir(cliente, _zip({"data/gracko/metricas.csv": DATA / "gracko" / "metricas.csv",
                              "data/gracko/logs.md": grande}))
    assert r.status_code == 413 and "logs.md pasa de 2 MB" in r.json()["detail"], r.text
    _sin_restos(subidas)


def test_zip_con_demasiadas_entradas_se_rechaza_sin_cargar_su_indice(cliente, subidas, monkeypatch):
    """ZipFile carga todo el índice al abrirse (+527 MB con 900 000 entradas vacías): se cuenta antes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for i in range(kits.LIMITES["entradas"] + 1):
            z.writestr(f"vacio/{i}", b"")
    datos = buf.getvalue()

    def prohibido(*a, **k):
        raise AssertionError("se abrió el zip completo antes de revisar su registro final")
    monkeypatch.setattr(kits.zipfile, "ZipFile", prohibido)
    r = _subir(cliente, datos)
    assert r.status_code == 422 and f"{kits.LIMITES['entradas'] + 1} entradas" in r.json()["detail"], r.text
    _sin_restos(subidas)


def test_subidas_simultaneas_esperan_su_turno(cliente, subidas, monkeypatch):
    monkeypatch.setattr(kits, "ESPERA_S", 0.05)
    tomados = [kits._procesando.acquire(timeout=1) for _ in range(kits.SIMULTANEAS)]
    try:
        r = _subir(cliente, _zip(_empresa("data/")))
    finally:
        for _ in tomados:
            kits._procesando.release()
    assert all(tomados) and r.status_code == 503 and "otras subidas" in r.json()["detail"]
    _sin_restos(subidas)
    _ok(cliente, _zip(_empresa("data/")))  # con turno libre, pasa


def test_limite_del_zip_sin_content_length(cliente, subidas, monkeypatch):
    """Un cliente que no declara el tamaño (envío por partes) también se corta al pasar el límite."""
    monkeypatch.setitem(kits.LIMITES, "zip", 10_000)
    datos, frontera = _zip(_empresa("data/")), b"zikitfrontera"
    cuerpo = (b"--" + frontera + b'\r\nContent-Disposition: form-data; name="archivo"; filename="kit.zip"\r\n'
              b"Content-Type: application/zip\r\n\r\n" + datos + b"\r\n--" + frontera + b"--\r\n")

    def partes():
        for i in range(0, len(cuerpo), 4096):
            yield cuerpo[i:i + 4096]
    r = cliente.post("/api/kit", content=partes(),
                     headers={"Content-Type": f"multipart/form-data; boundary={frontera.decode()}"})
    assert r.status_code == 413
    _sin_restos(subidas)


def test_se_guardan_como_maximo_8_kits(cliente, subidas):
    zip_ = _kit_pequeno()
    ids = [_ok(cliente, zip_)["id"] for _ in range(kits.MAX_KITS)]
    primero = f"kit-{ids[0]}"
    assert _get(cliente, "/api/gracko/rango", corrida=primero)  # queda en la caché
    ultimo = _ok(cliente, zip_)
    assert any("se borró el más viejo" in a for a in ultimo["avisos"])
    assert not [a for a in ultimo["avisos"] if ids[0] in a]  # el aviso no revela identificadores ajenos
    assert cliente.get(f"/api/kit/{ids[0]}").status_code == 404
    assert all(_get(cliente, f"/api/kit/{i}")["id"] == i for i in ids[1:] + [ultimo["id"]])
    assert not (subidas / primero).exists() and len(list(subidas.iterdir())) == kits.MAX_KITS
    assert cliente.get("/api/gracko/rango", params={"corrida": primero}).status_code == 404  # caché limpia


def test_kit_borrado_mientras_se_calcula_no_queda_en_la_cache(cliente, subidas, monkeypatch):
    """Si la rotación borra un kit mientras se analiza, ese cálculo no debe seguir respondiendo después."""
    monkeypatch.setattr(kits, "MAX_KITS", 1)
    zip_ = _kit_pequeno()
    viejo = _ok(cliente, zip_)["id"]
    _como_tras_reiniciar()
    original, rotado = api._analizar, threading.Event()

    def analizar_y_rotar(tenant, carpeta):
        r = original(tenant, carpeta)
        if f"kit-{viejo}" in str(carpeta) and not rotado.is_set():
            rotado.set()  # otra subida llega justo antes de que termine el cálculo
            kits.subir(io.BytesIO(zip_), api.Config.calib["empresas"], "otro.zip", api._validar_subida)
            api._resultado.cache_clear()
        return r
    monkeypatch.setattr(api, "_analizar", analizar_y_rotar)
    assert cliente.get("/api/gracko/rango", params={"corrida": f"kit-{viejo}"}).status_code == 200
    assert rotado.is_set() and cliente.get(f"/api/kit/{viejo}").status_code == 404
    for ruta in ("rango", "alertas.csv"):
        r = cliente.get(f"/api/gracko/{ruta}", params={"corrida": f"kit-{viejo}"})
        assert r.status_code == 404, (ruta, r.status_code)


# --- Privacidad: identificador secreto y clave de subida -------------------------------------

def test_los_kits_no_se_listan_y_su_identificador_no_se_adivina(cliente):
    res = _ok(cliente, _zip(_empresa("data/")))
    assert re.fullmatch(r"[0-9a-f]{32}", res["id"])  # 128 bits al azar
    for t in api.Config.calib["empresas"]:
        assert not [c for c in _get(cliente, f"/api/{t}/corridas") if c.startswith("kit-")]
    for otro in ("0" * 32, res["id"][:8], "../" + res["id"]):
        assert cliente.get(f"/api/kit/{otro}").status_code == 404
    assert _get(cliente, f"/api/kit/{res['id']}") == res


def test_la_subida_pide_la_clave_si_esta_configurada(cliente, subidas, monkeypatch):
    monkeypatch.setenv("ZIKIT_CLAVE", "clave-de-prueba")
    api.configurar(DATA, subidas=subidas)
    assert api.Config.clave == "clave-de-prueba"
    datos = _zip(_empresa("data/"))
    for cabeceras in (None, {"X-Zikit-Clave": "otra"}, {"X-Zikit-Clave": ""}):
        r = _subir(cliente, datos, headers=cabeceras)
        assert r.status_code == 401 and "clave" in r.json()["detail"]
    _sin_restos(subidas)
    res = _ok_con(cliente, datos, {"X-Zikit-Clave": "clave-de-prueba"})
    # Consultar no pide clave: el identificador secreto basta.
    assert _get(cliente, "/api/gracko/rango", corrida=res["corridas"][0])["corrida"] == res["corridas"][0]


def _ok_con(cliente, datos, headers) -> dict:
    r = _subir(cliente, datos, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --- Datos que no se pueden analizar ------------------------------------------------------------

def test_rechaza_metricas_que_cubren_demasiados_dias(cliente, subidas):
    """2 filas con un año de distancia (zip de 226 B) pedían 525 600 minutos: 113 s y +1.2 GB por vista."""
    for fin in ("2027-10-08T08:00:00", "2106-10-08T08:00:00"):
        t0 = time.perf_counter()
        r = _subir(cliente, _zip({"data/gracko/metricas.csv": _metricas("2026-10-08T08:00:00", fin)}))
        assert r.status_code == 422 and "como máximo 31 días" in r.json()["detail"], r.text
        assert time.perf_counter() - t0 < 5
    _sin_restos(subidas)


def test_kit_guardado_que_cubre_demasiados_dias_responde_422(cliente, subidas):
    """Un kit que ya está en disco (por ejemplo, de una versión anterior) tampoco crea un año de minutos."""
    res = _ok(cliente, _zip(_empresa("data/")))
    _como_tras_reiniciar()
    next(subidas.rglob("metricas.csv")).write_text(_metricas("2026-10-08T08:00:00", "2056-10-08T08:00:00"))
    t0 = time.perf_counter()
    r = cliente.get("/api/gracko/rango", params={"corrida": res["corridas"][0]})
    assert r.status_code == 422 and "como máximo 31 días" in r.json()["detail"], r.text
    assert time.perf_counter() - t0 < 5 and str(subidas) not in r.json()["detail"]


def test_empresa_que_no_se_puede_analizar_se_omite_con_aviso(cliente, subidas):
    """Antes se aceptaba con 200 y entrega.csv daba 422 para todo el archivo."""
    latin1 = b"# Ficha de gramo: n\xf3mina\n" + (DATA / "gramo" / "contexto.md").read_bytes()
    con_zona = (DATA / "kaiku" / "metricas.csv").read_text().replace(":00,", ":00Z,")
    res = _ok(cliente, _zip({**_empresa("data/"),
                             **_empresa("data/", tenant="gramo"), "data/gramo/contexto.md": latin1,
                             **_empresa("data/", tenant="kaiku"), "data/kaiku/metricas.csv": con_zona}))
    kit = res["corridas"][0]
    assert res["empresas"] == ["gracko"] and res["empresas_por_corrida"] == {kit: ["gracko"]}
    aviso = next(a for a in res["avisos"] if a.startswith("No se pudieron analizar 2 empresa(s)"))
    assert "gramo" in aviso and "contexto.md no está en UTF-8" in aviso
    assert "kaiku" in aviso and "zona horaria" in aviso and str(subidas) not in aviso
    for t in ("gramo", "kaiku"):
        assert cliente.get(f"/api/{t}/rango", params={"corrida": kit}).status_code == 404
    r = cliente.get("/api/entrega.csv", params={"corrida": kit})
    assert r.status_code == 200 and r.content == cliente.get("/api/gracko/alertas.csv", params={"corrida": kit}).content


def test_si_ninguna_empresa_se_puede_analizar_responde_422(cliente, subidas):
    con_zona = (DATA / "gracko" / "metricas.csv").read_text().replace(":00,", ":00Z,")
    r = _subir(cliente, _zip({**_empresa("data/"), "data/gracko/metricas.csv": con_zona}))
    assert r.status_code == 422 and "zona horaria" in r.json()["detail"]
    _sin_restos(subidas)


def test_calendario_de_la_corrida_pedida(cliente):
    """/calendario usaba siempre la raíz oficial, aunque se pidiera otra corrida."""
    res = _ok(cliente, _zip({"data/gracko/metricas.csv": DATA / "gracko" / "metricas.csv"}))  # sin contexto.md
    kit = res["corridas"][0]
    propio = _get(cliente, "/api/gracko/calendario", corrida=kit)
    fin = _get(cliente, "/api/gracko/rango", corrida=kit)["fin"]
    assert propio == _get(cliente, "/api/gracko/serie", corrida=kit, hasta=fin)["calendario"]
    assert propio and all(e["origen"].startswith("calendario manual") for e in propio)
    raiz = _get(cliente, "/api/gracko/calendario")
    assert raiz == _get(cliente, "/api/gracko/calendario", corrida="raiz")
    assert raiz and all(e["origen"].startswith("contexto.md") for e in raiz)


def test_kit_que_se_dana_despues_responde_422(cliente, subidas):
    """Si los datos de un kit ya registrado no se pueden analizar, se explica (422), sin un 500 ni rutas del servidor."""
    res = _ok(cliente, _zip(_empresa("data/")))
    _como_tras_reiniciar()
    next(subidas.rglob("metricas.csv")).write_text("timestamp,cpu\n", encoding="utf-8")
    r = cliente.get("/api/gracko/rango", params={"corrida": res["corridas"][0]})
    assert r.status_code == 422 and "faltan columnas" in r.json()["detail"]
    assert str(subidas) not in r.json()["detail"]


# --- Revisión de Codex en #29 ---------------------------------------------------------------------

def _csv_metricas(filas: str) -> str:
    return "timestamp,cpu,ram,disco,latencia_ms,errores\n" + filas


@pytest.mark.parametrize("valor, fila, col", [("-1", 2, "cpu"), ("inf", 2, "cpu"), ("abc", 2, "cpu")])
def test_metricas_fuera_del_dominio_de_la_pantalla_se_rechazan(cliente, subidas, valor, fila, col):
    """La pantalla exige números finitos y >= 0: un kit así no debe aceptarse para fallar al verlo."""
    m = _csv_metricas(f"2026-10-08T08:00:00,{valor},40,50,30,0\n2026-10-08T08:10:00,20,40,50,30,0\n")
    r = _subir(cliente, _zip({"data/gracko/metricas.csv": m, "data/gracko/logs.md": "",
                              "data/gracko/contexto.md": DATA / "gracko" / "contexto.md"}))
    assert r.status_code == 422, r.text
    assert f"fila {fila}" in r.json()["detail"] and f"«{col}»" in r.json()["detail"]
    _sin_restos(subidas)


def test_celdas_vacias_son_datos_faltantes_y_una_empresa_mala_se_omite(cliente, subidas):
    buena = _csv_metricas("2026-10-08T08:00:00,20,,50,30,0\n2026-10-08T08:10:00,20,40,50,30,0\n")
    mala = _csv_metricas("2026-10-08T08:00:00,20,40,-5,30,0\n")
    res = _ok(cliente, _zip({"data/gracko/metricas.csv": buena, "data/gracko/logs.md": "",
                             "data/acme/metricas.csv": mala, "data/acme/logs.md": ""}))
    assert res["empresas"] == ["gracko"]
    assert any("acme" in a and "«disco»" in a for a in res["avisos"])


def _publicar(tmp_path, clave):
    """Corre deploy/publicar.sh de verdad contra un «servidor» falso: ssh ejecuta el comando remoto en
    un HOME temporal (con la entrada estándar), y docker/curl son falsos. docker run falla (125) si el
    --env-file no existe desde la carpeta donde se ejecuta, como el Docker real."""
    import os
    import subprocess
    falsos, casa, registro = tmp_path / "falsos", tmp_path / "servidor", tmp_path / "registro.txt"
    falsos.mkdir()
    casa.mkdir()
    (falsos / "rsync").write_text(f'#!/bin/sh\nmkdir -p "{casa}/zikit"\nexit 0\n')
    (falsos / "ssh").write_text(f'#!/bin/sh\nshift\nprintf "SSH: %s\\n" "$(echo "$*" | tr "\\n" " ")" >> "{registro}"\n'
                                f'cd "{casa}" && exec sh -c "$*"\n')
    (falsos / "docker").write_text(f'#!/bin/sh\necho "DOCKER: $* (en $(pwd))" >> "{registro}"\n'
                                   'if [ "$1" = run ]; then\n'
                                   '  while [ $# -gt 0 ]; do\n'
                                   '    if [ "$1" = --env-file ]; then [ -f "$2" ] || { echo "falta $2" >&2; exit 125; }\n'
                                   f'      echo "ENVFILE: $(cat "$2")" >> "{registro}"; fi\n'
                                   '    shift\n'
                                   '  done\n'
                                   'fi\nexit 0\n')
    (falsos / "curl").write_text("#!/bin/sh\nexit 0\n")
    for f in falsos.iterdir():
        f.chmod(0o755)
    env = {**os.environ, "PATH": f"{falsos}:{os.environ['PATH']}"}
    env.pop("ZIKIT_CLAVE", None)
    if clave is not None:
        env["ZIKIT_CLAVE"] = clave
    repo = Path(__file__).resolve().parents[2]
    r = subprocess.run(["bash", str(repo / "deploy" / "publicar.sh"), "root@203.0.113.10"], env=env,
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    assert r.returncode == 0, r.stdout + r.stderr
    return registro.read_text(), casa


def test_publicar_pasa_la_clave_al_contenedor_sin_mostrarla(tmp_path):
    reg, casa = _publicar(tmp_path, "s3cr3t'o $(x)")
    clave = casa / "zikit" / ".zikit-clave.env"
    assert clave.read_text() == "ZIKIT_CLAVE=s3cr3t'o $(x)\n" and (clave.stat().st_mode & 0o077) == 0
    assert "ENVFILE: ZIKIT_CLAVE=s3cr3t'o $(x)" in reg  # docker run la encontró desde su carpeta
    assert not any("s3cr3t" in l for l in reg.splitlines() if l.startswith(("SSH:", "DOCKER:")))
    orden = [l.split()[1] for l in reg.splitlines() if l.startswith("DOCKER:")]
    assert orden == ["build", "rm", "run"]


def test_publicar_sin_clave_deja_la_subida_libre(tmp_path):
    reg, casa = _publicar(tmp_path, None)
    assert not (casa / "zikit" / ".zikit-clave.env").exists()
    assert not any("--env-file" in l for l in reg.splitlines()) and "ENVFILE" not in reg


# --- Revisión del #26 sobre la API integrada ----------------------------------------------------

def test_la_primera_vista_del_kit_reutiliza_el_analisis_de_la_subida(cliente, subidas, monkeypatch):
    """Con un kit de 4 semanas, la subida (~14 s) y la primera vista (otros ~14 s) repetían el análisis:
    la pantalla se rendía a los 10 s. La vista toma el de la subida y da exactamente lo mismo."""
    kit = _ok(cliente, _zip(_empresa("data/")))["corridas"][0]
    llamadas = []
    original = api._analizar
    monkeypatch.setattr(api, "_analizar", lambda *a: llamadas.append(a) or original(*a))
    fin = _get(cliente, "/api/gracko/rango", corrida=kit)["fin"]
    vista = [_get(cliente, f"/api/gracko/{r}", corrida=kit, hasta=fin) for r in ("alertas", "serie", "estado")]
    assert llamadas == []
    api._resultado.cache_clear()
    assert [_get(cliente, f"/api/gracko/{r}", corrida=kit, hasta=fin) for r in ("alertas", "serie", "estado")] == vista
    assert len(llamadas) == 1 and len(vista[0]) > 0
    assert not api._precalculados  # cada análisis guardado se usa una sola vez


def test_un_kit_sin_ninguna_medicion_se_rechaza(cliente, subidas):
    """Se aceptaba como «Kit listo» y la pantalla mostraba «Sin datos» toda la semana."""
    vacio = _csv_metricas("2026-10-08T08:00:00,,,,,\n2026-10-08T08:10:00,,,,,\n")
    r = _subir(cliente, _zip({"data/gracko/metricas.csv": vacio, "data/gracko/logs.md": ""}))
    assert r.status_code == 422 and "no trae ninguna medición" in r.json()["detail"], r.text
    _sin_restos(subidas)


@pytest.mark.parametrize("filas, esperado", [
    ("2026-10-08T08:00:00,-1,40,50,30,0\n", ["fila 2", "«cpu»", "«-1»"]),
    ("2026-10-08T08:00:00,10,40,50,30,0\nayer,10,40,50,30,0\n", ["fila 3", "«timestamp»", "«ayer» no es una fecha"]),
    (",10,40,50,30,0\n", ["fila 2", "«timestamp»", "está vacía"]),
])
def test_los_errores_del_kit_citan_la_celda_tal_cual_en_espanol_y_sin_el_id(cliente, subidas, filas, esperado):
    """Decían np.float64(-1.0), el error de pandas en inglés y un kit-<id> que nunca llegó a existir."""
    r = _subir(cliente, _zip({"data/gracko/metricas.csv": _csv_metricas(filas), "data/gracko/logs.md": ""}))
    detalle = r.json()["detail"]
    assert r.status_code == 422 and all(e in detalle for e in esperado), detalle
    assert "gracko (raíz)" in detalle
    assert not any(x in detalle for x in ("np.", "kit-", "doesn't", "format", str(subidas))), detalle
    _sin_restos(subidas)


def test_el_aviso_de_una_empresa_omitida_nombra_la_corrida_sin_el_id(cliente, subidas):
    res = _ok(cliente, _zip({**_empresa("data/"), **_empresa("data/corridas/corrida_01/", C01),
                             "data/corridas/corrida_01/acme/metricas.csv": _csv_metricas("ayer,1,1,1,1,0\n")}))
    aviso = next(a for a in res["avisos"] if a.startswith("No se pudieron analizar"))
    assert "acme (corrida_01): " in aviso and "kit-" not in aviso, aviso
