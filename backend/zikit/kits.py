"""Kits subidos desde la app: el jurado sube un .zip con la estructura del kit y ve sus alertas.

El .zip se descomprime de forma segura en ZIKIT_SUBIDAS (por omisión, `zikit-subidas` en el
temporal del sistema) y sus corridas quedan disponibles con estos nombres:

    kit-<id>                la carpeta de datos (la que trae <empresa>/metricas.csv)
    kit-<id>-corrida_NN     cada data/corridas/corrida_NN, si el zip las trae

`<id>` son 32 caracteres hexadecimales al azar (128 bits): no se puede adivinar y los kits no se
listan en ningún lado, así que solo quien subió el kit (o a quien le pase el enlace) puede verlo.

Reglas de la extracción:
- Antes de abrir el zip se lee solo su registro final: si declara más de 3000 entradas o un índice
  de más de 3 MB, se rechaza sin cargar el índice en memoria.
- Solo se extraen archivos llamados metricas.csv, logs.md o contexto.md.
- Nunca se abre una ruta con una carpeta `_solucion` ni archivos `etiquetas.csv` o `generar.py`:
  se saltan sin leerlos y se cuentan en «ignorados», igual que los enlaces simbólicos.
- Se rechaza el zip entero si trae una ruta absoluta o con «..».
- Límites: zip ≤ 80 MB; logs.md ≤ 2 MB y los demás archivos ≤ 5 MB cada uno (el kit oficial usa
  0.37 MB y 0.08 MB); ≤ 250 MB en total. Se miden con los bytes que de verdad salen al
  descomprimir, no con el tamaño que declara el zip.
- Se acepta cualquier empresa (carpeta con nombre seguro, NOMBRE_EMPRESA): las que no están
  calibradas se analizan con un punto de partida genérico y aprenden de su propia semana
  (calibracion.de_empresa). Cada empresa se revisa con la función `validar` que pasa la API (la
  misma lectura que usa para analizar); la que falla se omite con un aviso.
- Se procesan como máximo SIMULTANEAS subidas a la vez; las demás esperan su turno.
- Se guardan como máximo MAX_KITS kits; al pasar el tope se borra el más viejo y se incrementa
  `generacion()`, que la API usa en la clave de su caché.
"""
import json
import os
import re
import secrets
import shutil
import stat
import struct
import tempfile
import threading
import time
import zipfile
import zlib
from pathlib import Path

from . import ingesta

MB = 1024 * 1024
LIMITES = {"zip": 80 * MB, "total": 250 * MB, "entradas": 3000, "indice": 3 * MB,
           "archivo": 5 * MB, "logs": 2 * MB}
MAX_KITS = 30  # subida libre (sin clave): un tope alto hace difícil desplazar el kit del jurado
COMPLETAS = 4  # pares (corrida, empresa) que se analizan completos al subir; el resto, solo su lectura
SIMULTANEAS = 2
ESPERA_S = 120
PERMITIDOS = {"metricas.csv", "logs.md", "contexto.md"}
PROHIBIDOS = {"etiquetas.csv", "generar.py"}
NOMBRE_CORRIDA = re.compile(r"corrida_[A-Za-z0-9_-]+")
NOMBRE_EMPRESA = re.compile(r"[a-z0-9][a-z0-9_-]{0,39}")
KIT = re.compile(r"kit-([0-9a-f]{32})")
BLOQUE = MB


class KitInvalido(Exception):
    """El zip no se puede usar. `estado`: 413 si es por tamaño, 422 en lo demás."""

    def __init__(self, mensaje: str, estado: int = 422):
        super().__init__(mensaje)
        self.estado = estado


_lock = threading.RLock()
_procesando = threading.BoundedSemaphore(SIMULTANEAS)
_dir: Path | None = None
_kits: dict = {}  # id → manifiesto (kit.json)
_generacion = 0  # sube cada vez que se borra un kit


def _mb(n: int) -> str:
    return f"{n / MB:.3g}"


def generacion() -> int:
    return _generacion


def dir_por_omision() -> Path:
    return Path(os.environ.get("ZIKIT_SUBIDAS") or Path(tempfile.gettempdir()) / "zikit-subidas")


def configurar(directorio=None):
    """Carga los kits ya subidos (sobreviven a un reinicio si la carpeta es persistente)."""
    global _dir, _generacion
    with _lock:
        _generacion += 1
        _dir = Path(directorio) if directorio else dir_por_omision()
        _dir.mkdir(parents=True, exist_ok=True)
        _kits.clear()
        for d in _dir.iterdir():
            if d.is_dir() and d.name.startswith(".subiendo-kit-"):
                shutil.rmtree(d, ignore_errors=True)  # una subida que quedó a medias
            elif d.is_dir() and KIT.fullmatch(d.name):
                m = _cargar(d)
                if m:
                    _kits[m["id"]] = m


def _cargar(d: Path):
    try:
        m = json.loads((d / "kit.json").read_text(encoding="utf-8"))
        if f"kit-{m['id']}" != d.name:
            return None
        for c in m["corridas"].values():
            ruta = (d / c["ruta"]).resolve()
            if not ruta.is_relative_to(d.resolve()) or not ruta.is_dir():
                return None
        return m
    except (OSError, ValueError, KeyError, TypeError):
        return None


def es_kit(corrida: str) -> bool:
    return corrida.startswith("kit-")


def _publico(m: dict) -> dict:
    return {"id": m["id"], "creado": m["creado"], "corridas": list(m["corridas"]), "empresas": list(m["empresas"]),
            "empresas_por_corrida": {n: list(c["empresas"]) for n, c in m["corridas"].items()},
            "avisos": list(m["avisos"]), "ignorados": m.get("ignorados", 0)}


def resumen(kit_id: str):
    """Lo que se sabe de un kit subido (sin rutas del servidor), o None si no existe."""
    with _lock:
        m = _kits.get(kit_id)
        return _publico(m) if m else None


def buscar(corrida: str):
    """(carpeta, empresas) de una corrida subida, o None si no existe."""
    with _lock:
        for m in _kits.values():
            c = m["corridas"].get(corrida)
            if c:
                return _dir / f"kit-{m['id']}" / c["ruta"], list(c["empresas"])
    return None


def subir(archivo, calibradas, nombre_archivo: str = "", validar=None) -> dict:
    """Descomprime, valida y registra un kit. Devuelve el resumen del kit (ver `resumen`) más `borrados`.

    `archivo`: objeto de archivo binario con seek (el .zip). `validar(carpeta, empresa, completo)`
    lanza una excepción si la API no podría analizar esa empresa; `completo` pide el análisis entero
    (solo para los primeros COMPLETAS pares). Lanza KitInvalido si el kit no se puede usar; en ese
    caso no queda nada en disco."""
    if _dir is None:
        configurar()
    if not _procesando.acquire(timeout=ESPERA_S):
        raise KitInvalido("El servidor está revisando otras subidas; intenta de nuevo en un minuto.", 503)
    try:
        return _subir(archivo, set(calibradas), nombre_archivo, validar or _validar_basico)
    finally:
        _procesando.release()


def _subir(archivo, calibradas: set, nombre_archivo: str, validar) -> dict:
    with _lock:
        kit_id = secrets.token_hex(16)
        while kit_id in _kits:
            kit_id = secrets.token_hex(16)
    final = _dir / f"kit-{kit_id}"
    tmp = _dir / f".subiendo-kit-{kit_id}"
    datos = tmp / "datos"
    try:
        datos.mkdir(parents=True)
        extraidos, ignorados = _extraer(archivo, datos)
        manifiesto = _registrar(kit_id, datos, extraidos, calibradas, validar)
        manifiesto.update(ignorados=ignorados, archivo=os.path.basename(nombre_archivo or "")[:120])
        if ignorados:
            manifiesto["avisos"].insert(0, f"Se ignoraron {ignorados} archivo(s) sin abrirlos: soluciones, "
                                           "etiquetas, generar.py o enlaces simbólicos.")
        (tmp / "kit.json").write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.rename(final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    with _lock:
        _kits[kit_id] = manifiesto
        borrados = _rotar()
    res = _publico(manifiesto)
    if borrados:  # sin sus identificadores: solo quien subió cada kit los conoce
        res["avisos"].append(f"Se guardan como máximo {MAX_KITS} kits: se borró el más viejo "
                             f"(subido el {', '.join(borrados)}).")
    return {**res, "borrados": len(borrados)}


def _rotar() -> list:
    """Borra los kits más viejos por encima de MAX_KITS; devuelve cuándo se subieron."""
    global _generacion
    orden = sorted(_kits.values(), key=lambda m: m["creado_ns"])
    borrados = []
    while len(orden) > MAX_KITS:
        m = orden.pop(0)
        del _kits[m["id"]]
        _generacion += 1  # antes de borrar: un cálculo en curso ya no puede quedar en la caché vigente
        shutil.rmtree(_dir / f"kit-{m['id']}", ignore_errors=True)
        borrados.append(m["creado"])
    return borrados


def _partes(nombre: str) -> list:
    """Componentes de la ruta de una entrada; rechaza rutas absolutas o que salgan de la carpeta."""
    n = nombre.replace("\\", "/")
    corto = nombre if len(nombre) <= 80 else nombre[:77] + "..."
    if n.startswith("/") or re.match(r"[A-Za-z]:", n):
        raise KitInvalido(f"El zip trae una ruta absoluta ({corto}); se rechaza por seguridad.")
    partes = [p for p in n.split("/") if p not in ("", ".")]
    if ".." in partes:
        raise KitInvalido(f"El zip trae una ruta con «..» ({corto}); se rechaza por seguridad.")
    return partes


def _protegido(partes: list) -> bool:
    bajas = [p.lower() for p in partes]
    return "_solucion" in bajas or (bool(bajas) and bajas[-1] in PROHIBIDOS)


def _revisar_indice(archivo):
    """Lee solo el registro final del zip (22 bytes más el comentario) antes de abrirlo.

    zipfile.ZipFile carga el índice completo en memoria al abrirse: un zip de 77 MB con 900 000
    entradas vacías ocupaba +527 MB antes de poder contar las entradas. Aquí se rechaza antes."""
    leer_fin = getattr(zipfile, "_EndRecData", None)  # interno de CPython; si faltara, se cuenta después
    if leer_fin is None:
        return
    try:
        fin = leer_fin(archivo)
    except (OSError, ValueError, EOFError, struct.error, zipfile.BadZipFile):
        fin = None
    finally:
        archivo.seek(0)
    if not fin:
        raise KitInvalido("El archivo no es un .zip válido (está dañado o es de otro tipo).")
    entradas, indice = fin[zipfile._ECD_ENTRIES_TOTAL], fin[zipfile._ECD_SIZE]
    if entradas > LIMITES["entradas"]:
        raise KitInvalido(f"El zip trae {entradas} entradas; el máximo es {LIMITES['entradas']}.")
    if indice > LIMITES["indice"]:
        raise KitInvalido(f"El índice del zip ocupa {_mb(indice)} MB; el máximo es {_mb(LIMITES['indice'])} MB.")


def _tope(partes: list) -> int:
    return LIMITES["logs"] if partes[-1] == "logs.md" else LIMITES["archivo"]


def _extraer(archivo, datos: Path):
    _revisar_indice(archivo)
    try:
        zf = zipfile.ZipFile(archivo)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, OSError, ValueError, EOFError):
        raise KitInvalido("El archivo no es un .zip válido (está dañado o es de otro tipo).")
    with zf:
        infos = zf.infolist()
        if len(infos) > LIMITES["entradas"]:
            raise KitInvalido(f"El zip trae {len(infos)} entradas; el máximo es {LIMITES['entradas']}.")
        elegidos, ignorados = [], 0
        for info in infos:  # primera vuelta: solo nombres; no se abre nada
            partes = _partes(info.filename)
            if info.is_dir() or not partes:
                continue
            if _protegido(partes) or stat.S_ISLNK(info.external_attr >> 16):
                ignorados += 1
                continue
            if partes[-1] in PERMITIDOS and "__MACOSX" not in partes:
                elegidos.append((info, partes))
        for info, partes in elegidos:
            if info.file_size > _tope(partes):
                raise KitInvalido(f"{info.filename} pasa de {_mb(_tope(partes))} MB al descomprimirse.", 413)
        if sum(i.file_size for i, _ in elegidos) > LIMITES["total"]:
            raise KitInvalido(f"El kit pasa de {_mb(LIMITES['total'])} MB al descomprimirse.", 413)
        base, total, extraidos = datos.resolve(), 0, []
        for info, partes in elegidos:
            destino = datos.joinpath(*partes)
            if not destino.resolve().is_relative_to(base):
                raise KitInvalido(f"El zip trae una ruta que sale de su carpeta ({info.filename}).")
            try:
                destino.parent.mkdir(parents=True, exist_ok=True)
                n, tope = 0, _tope(partes)
                with zf.open(info) as src, open(destino, "wb") as dst:
                    while bloque := src.read(BLOQUE):  # se cuentan los bytes reales, no los declarados
                        n += len(bloque)
                        total += len(bloque)
                        if n > tope:
                            raise KitInvalido(f"{info.filename} pasa de {_mb(tope)} MB al descomprimirse.", 413)
                        if total > LIMITES["total"]:
                            raise KitInvalido(f"El kit pasa de {_mb(LIMITES['total'])} MB al descomprimirse.", 413)
                        dst.write(bloque)
            except KitInvalido:
                raise
            except (zipfile.BadZipFile, zlib.error, EOFError, RuntimeError, NotImplementedError, ValueError) as e:
                raise KitInvalido(f"No se pudo descomprimir {info.filename}: el zip está dañado, cifrado "
                                  f"o usa una compresión no soportada ({type(e).__name__}).")
            except OSError as e:
                raise KitInvalido(f"No se pudo extraer {info.filename} ({e.strerror or type(e).__name__}).")
            extraidos.append(destino)
    return extraidos, ignorados


def _registrar(kit_id: str, datos: Path, extraidos: list, calibradas: set, validar) -> dict:
    """Detecta la raíz de datos, nombra las corridas y revisa cada empresa con `validar`."""
    cand, otras = {}, set()
    for ruta in extraidos:
        if ruta.name != "metricas.csv" or ruta.parent == datos:
            continue
        if NOMBRE_EMPRESA.fullmatch(ruta.parent.name) and ruta.parent.name != "corridas":
            cand.setdefault(ruta.parent.parent, set()).add(ruta.parent.name)
        else:
            otras.add(ruta.parent.name)
    if not cand:
        if otras:
            raise KitInvalido(f"Los nombres de empresa del zip no son válidos ({', '.join(sorted(otras))}): usa "
                              f"minúsculas, números, «_» o «-» (por ejemplo, data/mi_empresa/metricas.csv).")
        raise KitInvalido("No se encontró ninguna carpeta <empresa>/metricas.csv en el zip. Sube la carpeta data "
                          "del kit (data/<empresa>/metricas.csv, logs.md y contexto.md) comprimida en .zip.")
    raiz = min(cand, key=lambda p: (len(p.parts), str(p)))
    registradas = {}
    if raiz.parent.name == "corridas" and NOMBRE_CORRIDA.fullmatch(raiz.name):  # el zip solo trae corridas
        for c in sorted(cand):
            if c.parent == raiz.parent and NOMBRE_CORRIDA.fullmatch(c.name):
                registradas[f"kit-{kit_id}-{c.name}"] = c
    else:
        registradas[f"kit-{kit_id}"] = raiz
        for c in sorted(cand):
            if c.parent == raiz / "corridas" and NOMBRE_CORRIDA.fullmatch(c.name):
                registradas[f"kit-{kit_id}-{c.name}"] = c

    avisos, errores, corr = [], [], {}
    if otras:
        avisos.append(f"Carpetas con nombre de empresa no válido, no se analizan: {', '.join(sorted(otras))}.")
    nuevas = sorted({t for ts in cand.values() for t in ts} - set(calibradas))
    if nuevas:
        avisos.append(f"Empresas sin calibración previa: {', '.join(nuevas)}. Se analizan con un punto de partida "
                      f"genérico y aprenden «lo normal» de su propia semana (el primer día es más prudente).")
    fuera = [c for c in cand if c not in registradas.values()]
    if fuera:
        avisos.append(f"{len(fuera)} carpeta(s) con datos fuera de la estructura del kit no se usan "
                      f"(por ejemplo, {fuera[0].relative_to(datos)}).")
    sin_logs, sin_ctx, intentos = [], [], 0
    for nombre, carpeta in registradas.items():
        ok, donde = [], nombre.removeprefix(f"kit-{kit_id}").removeprefix("-") or "raíz"  # sin el id del kit
        for t in sorted(cand[carpeta]):
            falta_logs = not (carpeta / t / "logs.md").exists()
            if falta_logs:  # se analiza solo con métricas
                (carpeta / t / "logs.md").write_text("", encoding="utf-8")
            completo, intentos = intentos < COMPLETAS, intentos + 1
            try:
                validar(carpeta, t, completo)
            except Exception as e:  # noqa: BLE001 — cualquier error de lectura o análisis se explica
                errores.append(f"{t} ({donde}): {str(e).replace(str(datos) + os.sep, '')}")
                continue
            ok.append(t)
            if falta_logs:
                sin_logs.append(f"{t} ({donde})")
            if not (carpeta / t / "contexto.md").exists():
                sin_ctx.append(f"{t} ({donde})")
        if ok:
            corr[nombre] = {"ruta": str(carpeta.relative_to(datos.parent)), "empresas": ok}
    if not corr:
        raise KitInvalido(f"No se pudo analizar ninguna empresa del zip: {errores[0]}")
    if errores:
        avisos.append(f"No se pudieron analizar {len(errores)} empresa(s) y se omiten: " + "; ".join(errores[:3])
                      + (f"; y {len(errores) - 3} más." if len(errores) > 3 else "."))
    if sin_logs:
        avisos.append(f"Sin logs.md, se analiza solo con métricas: {_lista(sin_logs)}.")
    if sin_ctx:
        avisos.append(f"Sin contexto.md, se usa el calendario manual de respaldo (puede no coincidir "
                      f"con las fechas): {_lista(sin_ctx)}.")
    ahora = time.time_ns()
    return {"id": kit_id, "creado": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ahora / 1e9)),
            "creado_ns": ahora, "corridas": corr,
            "empresas": sorted({t for c in corr.values() for t in c["empresas"]}), "avisos": avisos}


def _validar_basico(carpeta: Path, tenant: str, completo: bool = False):
    """Validación mínima, para quien llame a `subir` sin la de la API."""
    met = ingesta.leer_metricas(carpeta, tenant)
    if met.empty or met[ingesta.METRICAS].isna().all().all():
        raise ValueError("metricas.csv no trae mediciones")
    logs = carpeta / tenant / "logs.md"
    if logs.exists():
        logs.read_text(encoding="utf-8")  # que se pueda leer como texto UTF-8


def _lista(xs: list) -> str:
    return ", ".join(xs[:4]) + (f" y {len(xs) - 4} más" if len(xs) > 4 else "")
