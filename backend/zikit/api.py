"""API web: sirve la interfaz (web/) y /api/{tenant}/* desde el mismo origen.

Todo lo que se entrega para un minuto `hasta` usa solo datos hasta ese minuto:
la serie, los apagones (recortados, con fin exclusivo), las alertas ya emitidas,
el cierre de un caso (solo si ya ocurrió) y el estado. El calendario es
conocimiento previo (contexto.md) y se entrega completo.

Además de las corridas oficiales, acepta kits subidos como .zip (`POST /api/kit`, ver kits.py) y
entrega las alertas de una corrida completa en el formato de entrega (`alertas.csv`, `entrega.csv`).
Los kits subidos no se listan: se consultan con el identificador secreto que devuelve la subida.
Si existe ZIKIT_CLAVE, la subida exige esa clave en la cabecera X-Zikit-Clave.

    python -m zikit servir                                  # http://127.0.0.1:8000
    uvicorn --app-dir backend zikit.api:app --port 8000     # equivalente
"""
import csv
import io
import json
import os
import re
import secrets
import threading
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import adaptacion, acciones, calendario, calibracion, contexto, ingesta, kits
from .detector import detectar
from .jsonutil import limpio
from .senales import MET, visible
from .serie import UNIDADES

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
CONFIG = BACKEND / "config"
HIPOTESIS = REPO / "docs" / "ejemplos"
DATA_POR_DEFECTO = Path(os.environ.get("ZIKIT_DATA") or REPO.parent / "zikit-dataset" / "data")
WEB_POR_DEFECTO = Path(os.environ.get("ZIKIT_WEB") or REPO / "web")
PASO_MIN = 5
FMT = "%Y-%m-%dT%H:%M:%S"
# Análisis a la vez (1 vCPU y 2 GB en el servidor): las demás consultas esperan en lugar de sumar memoria.
_calculo = threading.BoundedSemaphore(int(os.environ.get("ZIKIT_CALCULOS") or 2))
# Análisis que ya hizo la validación de una subida (kits.COMPLETAS pares por kit): la primera vista del
# kit lo toma en vez de repetirlo (con 4 semanas de datos, otros ~14 s). Cada uno se usa una vez; se
# guardan los de las 2 últimas subidas como mucho, por si una nunca se abre.
_precalculados: OrderedDict = OrderedDict()
_precalculados_lock = threading.Lock()
KIT_EN_RUTA = re.compile(r"(?:\.subiendo-)?kit-([0-9a-f]{32})")


class Config:
    data_dir = None
    calib = None
    cal = None  # calendario manual, de respaldo
    fuente_cal = os.environ.get("ZIKIT_CALENDARIO", "contexto")
    clave = None  # ZIKIT_CLAVE: si existe, POST /api/kit la exige


def configurar(data_dir: Path = DATA_POR_DEFECTO, subidas: Path | None = None):
    """`subidas`: carpeta de los kits subidos (por omisión, ZIKIT_SUBIDAS o el temporal del sistema)."""
    Config.data_dir = Path(data_dir)
    Config.calib = calibracion.cargar(CONFIG / "calibracion.json")
    Config.cal = calendario.cargar(CONFIG / "calendario.json")
    Config.clave = os.environ.get("ZIKIT_CLAVE") or None
    kits.configurar(subidas)
    _resultado.cache_clear()
    with _precalculados_lock:
        _precalculados.clear()


def _json(x):
    return JSONResponse(limpio(x))


def _tenant(tenant: str):
    """Empresa calibrada o con nombre válido; que exista en la corrida se comprueba en _carpeta."""
    if tenant not in Config.calib["empresas"] and not kits.NOMBRE_EMPRESA.fullmatch(tenant):
        raise HTTPException(404, f"Empresa desconocida: {tenant}")


def _presentes(corrida: str) -> list:
    """Empresas con datos en una corrida oficial o de un kit subido (404 si la corrida no existe)."""
    corr = ingesta.corridas_de(Config.data_dir)
    if corrida in corr:
        return sorted(p.parent.name for p in corr[corrida].glob("*/metricas.csv")
                      if kits.NOMBRE_EMPRESA.fullmatch(p.parent.name) and p.parent.name != "corridas")
    kit = kits.buscar(corrida)
    if kit is None:
        raise HTTPException(404, f"Corrida desconocida: {corrida}")
    return sorted(kit[1])


def _minuto(valor: str, campo: str) -> pd.Timestamp:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", valor or ""):
        raise HTTPException(422, f"{campo} debe tener el formato YYYY-MM-DDTHH:mm:ss")
    try:
        return pd.Timestamp(valor).floor("min")
    except ValueError:
        raise HTTPException(422, f"{campo} no es una fecha válida")


def _carpeta(tenant: str, corrida: str) -> Path:
    """Carpeta de una corrida oficial o de un kit subido que traiga a `tenant`."""
    corr = ingesta.corridas_de(Config.data_dir)
    if corrida in corr:
        if not (corr[corrida] / tenant / "metricas.csv").exists():
            raise HTTPException(404, f"La corrida {corrida} no trae datos de {tenant}")
        return corr[corrida]
    kit = kits.buscar(corrida)
    if kit is None:
        raise HTTPException(404, f"Corrida desconocida: {corrida}")
    if tenant not in kit[1]:
        raise HTTPException(404, f"La corrida {corrida} no trae datos de {tenant}")
    return kit[0]


def _es_subida(corrida: str) -> bool:
    return kits.es_kit(corrida) and corrida not in ingesta.corridas_de(Config.data_dir)


def _res(tenant: str, corrida: str):
    """Resultado en caché. La generación de kits va en la clave: si se borra un kit mientras se
    calcula, ese cálculo queda guardado bajo la generación vieja y ya nadie lo vuelve a leer."""
    return _resultado(tenant, corrida, kits.generacion())


def _clave_kit(carpeta: Path, tenant: str):
    """(id del kit, carpeta dentro del kit, empresa): igual mientras se sube y ya registrado.

    Se busca desde la raíz: una carpeta del zip que se llame kit-<id> no cuenta."""
    for padre in reversed(carpeta.parents):
        m = KIT_EN_RUTA.fullmatch(padre.name)
        if m:
            return m.group(1), carpeta.relative_to(padre).as_posix(), tenant
    return None


@lru_cache(maxsize=128)
def _resultado(tenant: str, corrida: str, generacion: int = 0):
    carpeta = _carpeta(tenant, corrida)
    if not _es_subida(corrida):
        return _analizar(tenant, carpeta)
    with _precalculados_lock:
        hecho = _precalculados.pop(_clave_kit(carpeta, tenant), None)
    if hecho is not None:
        return hecho
    try:  # datos subidos por el usuario: un error de lectura se explica en vez de dar un 500
        return _analizar(tenant, carpeta)
    except Exception as e:  # noqa: BLE001
        motivo = str(e).replace(str(carpeta) + os.sep, "")  # sin rutas del servidor
        raise HTTPException(422, f"No se pudo analizar {tenant} en {corrida}: {motivo}")


def _entradas(tenant: str, carpeta: Path):
    """Lo que el detector necesita leer: métricas, logs y calendario (con sus avisos)."""
    met = ingesta.leer_metricas(carpeta, tenant)
    logs = ingesta.leer_logs(carpeta, tenant)
    cal, avisos = contexto.elegir(carpeta, tenant, met.timestamp.iloc[0], Config.cal, Config.fuente_cal)
    fuera = calendario.unicas_fuera(cal, tenant, met.timestamp.iloc[0], met.timestamp.iloc[-1])
    if fuera:
        avisos = avisos + [f"Estos eventos del calendario caen fuera de la corrida y no se toman en cuenta: {', '.join(fuera)}."]
    return met, logs, cal, avisos


def _analizar(tenant: str, carpeta: Path):
    with _calculo:
        met, logs, cal, avisos = _entradas(tenant, carpeta)
        if tenant not in Config.calib["empresas"] and not adaptacion.activa(None):
            avisos = avisos + [f"{tenant} no tiene calibración previa y la adaptación está apagada (ZIKIT_ADAPTAR=0): "
                               f"se usa un punto de partida genérico sin aprender de la semana; los resultados son poco fiables."]
        r = detectar(met, logs, Config.calib, cal, tenant)
        r["calendario"], r["avisos_calendario"] = cal, avisos
        suav = visible(met)  # lo mismo que el «valor actual» de la evidencia; null en apagones
        suav["timestamp"] = met["timestamp"]
        vacio = met[ingesta.METRICAS].isna().all(axis=1).values
        return met, r, suav, vacio


def _validar_subida(carpeta: Path, tenant: str, completo: bool):
    """Para kits.subir: falla igual que fallaría la API al analizar esa empresa de esa corrida.

    `completo` corre el detector entero (los primeros pares del kit); si no, solo la lectura, que es
    donde fallan los datos mal formados (codificación, columnas, zona horaria, rango de fechas)."""
    for nombre in kits.PERMITIDOS:
        ruta = carpeta / tenant / nombre
        if ruta.exists():
            try:
                ruta.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                raise ValueError(f"{nombre} no está en UTF-8; guárdalo como UTF-8 y vuelve a subir el kit") from None
    res = _analizar(tenant, carpeta) if completo else None
    met = res[0] if res else _entradas(tenant, carpeta)[0]
    if met[ingesta.METRICAS].isna().all().all():  # se vería «Sin datos» toda la semana y ninguna alerta
        raise ValueError("metricas.csv no trae ninguna medición: todas las celdas de cpu, ram, disco, "
                         "latencia_ms y errores están vacías")
    clave = _clave_kit(carpeta, tenant)
    if res and clave:
        with _precalculados_lock:
            _precalculados[clave] = res
            while len(_precalculados) > 2 * kits.COMPLETAS:
                _precalculados.popitem(last=False)


def _indice(met: pd.DataFrame, t: pd.Timestamp) -> int:
    """Último índice con timestamp ≤ t (−1 si t es anterior al inicio de la corrida)."""
    return int(np.searchsorted(met.timestamp.values, np.datetime64(t), side="right")) - 1


def _punto(suav: pd.DataFrame, i: int) -> dict:
    fila = suav.iloc[i]
    p = {"t": fila.timestamp.strftime(FMT)}
    for m in MET:
        p[m] = None if pd.isna(fila[m]) else round(float(fila[m]), 1)
    p["errores"] = None if pd.isna(fila["errores"]) else round(float(fila["errores"]), 2)
    return p


def _apagones(met: pd.DataFrame, vacio: np.ndarray, hasta_i: int) -> list:
    """Tramos sin datos observados hasta `hasta`, con fin EXCLUSIVO recortado a hasta + 1 min.

    Así no se revela cuándo vuelven los datos de un apagón que sigue en curso."""
    out, i = [], 0
    while i <= hasta_i:
        if vacio[i]:
            j = i
            while j + 1 <= hasta_i and vacio[j + 1]:
                j += 1
            fin = met.timestamp.iloc[j] + pd.Timedelta(minutes=1)
            out.append({"inicio": met.timestamp.iloc[i].strftime(FMT), "fin": fin.strftime(FMT), "minutos": j - i + 1})
            i = j + 1
        else:
            i += 1
    return out


def _calendario(tenant: str, met: pd.DataFrame, cal: dict) -> list:
    fuentes = {e["evento"]: e.get("fuente", "") for e in cal["empresas"].get(tenant, [])}
    origen = "contexto.md" if cal.get("fuente") == "contexto.md" else "calendario manual (respaldo)"
    vents = calendario.ventanas(cal, tenant, met.timestamp.iloc[0], met.timestamp.iloc[-1])
    return [{"evento": v.evento, "inicio": v.inicio_nominal.strftime(FMT), "fin": v.fin_nominal.strftime(FMT),
             "recurrencia": v.recurrencia, "suprime": v.recurrencia != "diaria",
             "origen": f"{origen} — {fuentes.get(v.evento, '')}".rstrip(" —")}
            for v in sorted(vents, key=lambda v: v.inicio_nominal)]


def _fuente_calendario(r: dict) -> dict:
    """De dónde salió el calendario y qué no se entendió: la pantalla debe poder avisarlo."""
    return {"calendario_fuente": r["calendario"].get("fuente", "manual"), "avisos": r["avisos_calendario"]}


def _alertas_hasta(r: dict, t: pd.Timestamp) -> list:
    out = []
    for k, e in enumerate(r["explicaciones"]):
        if pd.Timestamp(e["timestamp"]) > t:
            break
        cierre = r["cierres"][k]
        visible = cierre if cierre and pd.Timestamp(cierre["timestamp"]) <= t else None
        out.append({**e, "cierre": visible})
    return out


app = FastAPI(title="ZIKIT · Antes de que suene el teléfono")


@app.get("/api/salud")
def salud():
    return {"ok": True, "datos": str(Config.data_dir), "empresas": sorted(Config.calib["empresas"])}


@app.get("/api/empresas")
def empresas(corrida: str | None = None):
    """Sin `corrida`: las empresas calibradas del kit oficial. Con `corrida`: las que trae esa corrida
    (también las de un kit subido sin calibración previa, con calibrada = false)."""
    nombres = sorted(Config.calib["empresas"]) if corrida is None else _presentes(corrida)
    out = []
    for t in nombres:
        base = Config.data_dir if corrida is None else _carpeta(t, corrida)
        ruta = base / t / "contexto.md"
        texto = ruta.read_text(encoding="utf-8", errors="replace") if ruta.exists() else ""
        m = re.search(r"\*\*Giro:\*\*\s*(.+)", texto)
        fila = {"tenant": t, "giro": m.group(1).strip() if m else ""}
        if corrida is not None:
            fila["calibrada"] = t in Config.calib["empresas"]
        out.append(fila)
    return out


@app.get("/api/{tenant}/corridas")
def corridas(tenant: str):
    """Solo las corridas oficiales que traen a esa empresa: los kits subidos no se listan (ver GET /api/kit/{id})."""
    _tenant(tenant)
    return [c for c, d in ingesta.corridas_de(Config.data_dir).items() if (d / tenant / "metricas.csv").exists()]


@app.get("/api/{tenant}/calendario")
def cal_tenant(tenant: str, corrida: str = "raiz"):
    _tenant(tenant)
    met, r, _, _ = _res(tenant, corrida)
    return _calendario(tenant, met, r["calendario"])


@app.get("/api/{tenant}/serie")
def serie(tenant: str, corrida: str, hasta: str, desde: str | None = None):
    _tenant(tenant)
    met, r, suav, vacio = _res(tenant, corrida)
    t = _minuto(hasta, "hasta")
    h = _indice(met, t)
    d = 0 if desde is None else max(0, _indice(met, _minuto(desde, "desde")))
    puntos, apag = [], []
    if h >= 0:
        idx = [i for i in range(d, h + 1) if i % PASO_MIN == 0]
        if not idx or idx[-1] != h:
            idx.append(h)  # el minuto actual, para que la reproducción no se atrase
        puntos = [_punto(suav, i) for i in idx if i >= d]
        apag = _apagones(met, vacio, h)
        if desde is not None:
            lim = met.timestamp.iloc[d].strftime(FMT)
            apag = [a for a in apag if a["fin"] > lim]
    return _json({"tenant": tenant, "corrida": corrida, "paso_min": PASO_MIN, "unidades": UNIDADES,
                  "serie": puntos, "apagones": apag, "calendario": _calendario(tenant, met, r["calendario"]),
                  **_fuente_calendario(r)})


@app.get("/api/{tenant}/alertas")
def alertas(tenant: str, corrida: str, hasta: str):
    _tenant(tenant)
    _, r, _, _ = _res(tenant, corrida)
    return _json(_alertas_hasta(r, _minuto(hasta, "hasta")))


@app.get("/api/{tenant}/estado")
def estado(tenant: str, corrida: str, hasta: str):
    _tenant(tenant)
    met, r, _, vacio = _res(tenant, corrida)
    t = _minuto(hasta, "hasta")
    i = _indice(met, t)
    if i < 0:
        return {"estado": "Sin datos", "alerta_abierta": None, "evento": None, "sin_datos": True}
    caso = int(r["caso"][i])
    alerta = r["explicaciones"][caso] if caso >= 0 else None
    eventos = [v.evento for v in r["ventanas"] if v.inicio_nominal <= t < v.fin_nominal]
    sin_datos = bool(vacio[i])
    if alerta:
        txt = f"Alerta: {alerta['titulo']}"
    elif sin_datos:
        txt = "Sin datos"
    elif eventos:
        txt = f"Evento esperado: {eventos[0]}"
    else:
        txt = "Normal"
    return {"estado": txt, "alerta_abierta": alerta["id"] if alerta else None,
            "evento": eventos[0] if eventos else None, "sin_datos": sin_datos}


@app.get("/api/{tenant}/rango")
def rango(tenant: str, corrida: str):
    """Primer y último minuto de la corrida y unidades de la serie: el reloj de la pantalla sale de aquí."""
    _tenant(tenant)
    met, r, _, _ = _res(tenant, corrida)
    return {"tenant": tenant, "corrida": corrida, "inicio": met.timestamp.iloc[0].strftime(FMT),
            "fin": met.timestamp.iloc[-1].strftime(FMT), "unidades": UNIDADES, **_fuente_calendario(r)}


HORA_TXT = re.compile(r"(\d{4}-\d{2}-\d{2}T)?(\d{2}):(\d{2})")


def _descripcion_hasta(texto: str, impacto: pd.Timestamp, lim) -> str:
    """Recorta la descripción del impacto a lo ocurrido hasta `lim`: «23:00 respaldo abortado
    + 23:01 exportacion fallida» a las 23:00 queda en «23:00 respaldo abortado»."""
    if lim is None:
        return texto
    for m in HORA_TXT.finditer(texto):
        if m.group(1):
            t = pd.Timestamp(m.group(0))
        else:  # solo HH:MM: el mismo día del impacto, o el siguiente si cruza la medianoche
            t = impacto.normalize() + pd.Timedelta(hours=int(m.group(2)), minutes=int(m.group(3)))
            if t < impacto - pd.Timedelta(hours=12):
                t += pd.Timedelta(days=1)
        if t > lim:
            return texto[:m.start()].rstrip(" +;,(")
    return texto


def _primera_hora(texto: str):
    m = re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", texto or "")
    return pd.Timestamp(m.group(0)) if m else None


@app.get("/api/{tenant}/referencias")
def referencias(tenant: str, corrida: str, hasta: str | None = None):
    """Impactos HIPOTÉTICOS del equipo (no son etiquetas oficiales) para comparar con el «teléfono».

    Solo se entregan si la corrida es la misma semana de la que se dedujeron las hipótesis
    (`semana` en docs/ejemplos/hipotesis_<tenant>.json). Para cualquier otra semana: lista vacía,
    y la pantalla muestra «sin referencia de impacto». Cada referencia indica la alerta de esa
    corrida que la anticipó (`alerta_id`): la primera alerta del tipo que declara la hipótesis
    (`tipo_alerta`) entre el primer indicio − 3 h y el impacto. Una alerta de otro tipo no cuenta;
    sin `tipo_alerta` válido no se enlaza ninguna (null).
    """
    _tenant(tenant)
    met, r, _, _ = _res(tenant, corrida)
    ruta = HIPOTESIS / f"hipotesis_{tenant}.json"
    if not ruta.exists() or _es_subida(corrida):
        return []  # las hipótesis son del kit oficial; un kit subido puede tener las mismas fechas y otras fallas
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    semana = datos.get("semana") or {}
    if (semana.get("inicio") != met.timestamp.iloc[0].strftime(FMT)
            or semana.get("fin") != met.timestamp.iloc[-1].strftime(FMT)):
        return []
    lim = None if hasta is None else _minuto(hasta, "hasta")
    out = []
    for k, h in enumerate(datos["hipotesis"]):
        ts, ini = _primera_hora(h["impacto"]), _primera_hora(h.get("primer_indicio"))
        if ts is None or (lim is not None and ts > lim):
            continue
        desde = (ini or ts) - pd.Timedelta(hours=3)
        tipo = h.get("tipo_alerta") if h.get("tipo_alerta") in acciones.NOMBRES else None
        candidatas = sorted((pd.Timestamp(e["timestamp"]), e["id"]) for e in r["explicaciones"]
                            if tipo and e["tipo"] == tipo and desde <= pd.Timestamp(e["timestamp"]) <= ts)
        out.append({"id": f"{tenant}-{corrida}-hip-{k + 1}", "tenant": tenant, "corrida": corrida,
                    "tipo": h["tipo"], "tipo_alerta": tipo, "timestamp": ts.strftime(FMT),
                    "descripcion": _descripcion_hasta(h["impacto"], ts, lim),
                    "fuente": "hipótesis del equipo (sin etiquetas oficiales): impacto = primer ERROR del log",
                    "alerta_id": candidatas[0][1] if candidatas else None})
    return out


# --- Entrega: alertas de la corrida completa en el formato de docs/FORMATO_ALERTAS.md §1 ---

COLUMNAS_ENTREGA = ["tenant", "timestamp", "confianza", "tipo"]


def _csv(alertas: list) -> str:
    """Igual que el alertas.csv de `python -m zikit detectar` (mismas columnas, valores y fin de línea)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNAS_ENTREGA)
    for a in alertas:
        w.writerow([a["tenant"], a["timestamp"].strftime(FMT), a["confianza"], a["tipo"]])
    return buf.getvalue()


def _descarga(texto: str, nombre: str) -> Response:
    nombre = re.sub(r"[^A-Za-z0-9_.-]", "_", nombre)
    return Response(texto, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


@app.get("/api/{tenant}/alertas.csv")
def alertas_csv(tenant: str, corrida: str):
    """Todas las alertas de la corrida (no se recorta a `hasta`): es el archivo de entrega, no la reproducción."""
    _tenant(tenant)
    _, r, _, _ = _res(tenant, corrida)
    return _descarga(_csv(r["alertas"]), f"alertas_{tenant}_{corrida}.csv")


@app.get("/api/entrega.csv")
def entrega_csv(corrida: str):
    """Las alertas de todas las empresas que trae la corrida (también las no calibradas), por timestamp."""
    presentes = _presentes(corrida)
    todas = [a for t in presentes for a in _res(t, corrida)[1]["alertas"]]
    todas.sort(key=lambda a: a["timestamp"])  # estable: a la misma hora, por empresa
    return _descarga(_csv(todas), f"alertas_{corrida}.csv")


# --- Subida de un kit (.zip) ---

def _receptor_limitado(receive, tope: int):
    """Corta la subida en cuanto pasa de `tope` bytes, aunque el cliente no declare Content-Length."""
    leidos = 0

    async def recibir():
        nonlocal leidos
        msg = await receive()
        if msg["type"] == "http.request":
            leidos += len(msg.get("body", b""))
            if leidos > tope:
                raise kits.KitInvalido(f"El zip pasa de {kits.LIMITES['zip'] // kits.MB} MB.", 413)
        return msg
    return recibir


@app.post("/api/kit")
async def subir_kit(request: Request):
    """multipart/form-data con el campo «archivo» (.zip del kit). Ver kits.py y FORMATO_ALERTAS.md §5."""
    if Config.clave and not secrets.compare_digest(request.headers.get("x-zikit-clave", "").encode(),
                                                   Config.clave.encode()):
        raise HTTPException(401, "Falta la clave de subida o no es correcta. Pídesela al equipo: "
                                 "viene en el enlace que te compartieron.")
    tope = kits.LIMITES["zip"] + 64 * 1024  # margen para las cabeceras del formulario
    largo = request.headers.get("content-length", "")
    if largo.isdigit() and int(largo) > tope:
        raise HTTPException(413, f"El zip pasa de {kits.LIMITES['zip'] // kits.MB} MB.")
    form = None
    try:
        try:
            form = await Request(request.scope, _receptor_limitado(request.receive, tope)).form(max_files=1,
                                                                                                max_fields=10)
        except StarletteHTTPException:  # Starlette responde 400 en inglés: varios archivos, sin boundary...
            raise HTTPException(422, "Envía un solo archivo .zip en el campo «archivo» (multipart/form-data).") from None
        archivo = form.get("archivo")
        if not isinstance(archivo, UploadFile):
            raise HTTPException(422, "Falta el campo «archivo» con el .zip del kit (multipart/form-data).")
        archivo.file.seek(0, io.SEEK_END)
        if archivo.file.tell() > kits.LIMITES["zip"]:
            raise HTTPException(413, f"El zip pasa de {kits.LIMITES['zip'] // kits.MB} MB.")
        archivo.file.seek(0)
        res = await run_in_threadpool(kits.subir, archivo.file, Config.calib["empresas"], archivo.filename or "",
                                      _validar_subida)
    except kits.KitInvalido as e:
        raise HTTPException(e.estado, str(e))
    finally:
        if form is not None:
            await form.close()
    if res.pop("borrados"):
        _resultado.cache_clear()  # libera la memoria; la generación nueva ya impide leer el kit borrado
    return res


@app.get("/api/kit/{kit_id}")
def kit(kit_id: str):
    """Corridas, empresas y avisos de un kit subido. Quien conoce el identificador puede verlo."""
    res = kits.resumen(kit_id) if re.fullmatch(r"[0-9a-f]{32}", kit_id) else None
    if res is None:
        raise HTTPException(404, f"Ese kit no existe o ya se borró (se guardan los {kits.MAX_KITS} más recientes).")
    return res


configurar()
if WEB_POR_DEFECTO.is_dir():
    app.mount("/", StaticFiles(directory=WEB_POR_DEFECTO, html=True), name="web")
