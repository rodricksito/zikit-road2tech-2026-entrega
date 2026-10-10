"""Calendario automático: lee el contexto.md de la corrida y arma los eventos esperados.

Así no se memoriza la semana: si llega otra semana con su propio contexto.md, el
calendario sale de esa ficha. Reconoce:
- eventos con fecha:  «**Viernes 9 de octubre:** carga masiva … (17:00–19:30)»
                      «**Viernes 9 de octubre, 10:00–12:00:** promoción …»
- semanales:          «**Sabados:** snapshot …, 03:00–04:30»   «**Domingos 04:00:** … (unos 90 min)»
                      «**Todos los viernes 17:00:** …»   «**Cada viernes 17:00:** …»
- diarios:            «**Diario 03:00:** respaldo … (30 min)»   «**Todos los dias 03:00:** …»
- filas de la tabla de sistemas con ventana «Diario» y una hora: «| Respaldo nocturno | … 23:00 | Diario |»

Las palabras de cada evento salen solo de su propia descripción. Los recursos medidos
(disco, cpu, rutas como /data…) no se le asignan aquí: el detector los asocia al evento
solo si un log del propio evento los menciona (ver calendario.recursos_de).

Lo que no entiende lo devuelve en `no_reconocidas`, para avisar en lugar de inventar.
"""
import re
import unicodedata
from datetime import date
from pathlib import Path

from .calendario import MEDIDAS

MESES = {m: i for i, m in enumerate(
    ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
     "septiembre", "octubre", "noviembre", "diciembre"], start=1)}
DIAS_PLURAL = {"lunes": "lunes", "martes": "martes", "miercoles": "miercoles", "jueves": "jueves",
               "viernes": "viernes", "sabados": "sabado", "domingos": "domingo"}
DIAS_SINGULAR = {d: d for d in ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]}
DURACION_POR_OMISION = 60

HORA = r"(\d{1,2}):(\d{2})"
RANGO = re.compile(HORA + r"\s*[–—-]\s*" + HORA)
UNA_HORA = re.compile(r"(?<![\d:])" + HORA + r"(?![\d:])")
FECHA = re.compile(r"(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)\s+(\d{4}))?")
MINUTOS = re.compile(r"(\d+)\s*min\b")
HORAS = re.compile(r"(\d+(?:[.,]\d+)?)\s*h\b")
VINETA = re.compile(r"^\s*-\s*\*\*(.+?):\*\*\s*(.+)$")

VACIAS = set("""de del la el los las en y a al para por con se mas lo una unos unas uno que su sus
             cada desde hasta sobre entre como esta este estos estas mayor menor durante sin espera
             cliente clientes alto alta normal habitual""".split())


def _sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def _minutos(h: str, m: str) -> int:
    return int(h) * 60 + int(m)


def _hhmm(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _duracion(texto: str, rango):
    if rango:
        ini, fin = _minutos(*rango.groups()[:2]), _minutos(*rango.groups()[2:])
        return (fin - ini) % 1440 or 1440
    m = MINUTOS.search(texto)
    if m:
        return int(m.group(1))
    h = HORAS.search(texto)
    if h:
        return int(round(float(h.group(1).replace(",", ".")) * 60))
    return DURACION_POR_OMISION


def _nombre(desc: str) -> str:
    corte = re.split(r"[,(;.«]", desc, maxsplit=1)[0].strip() or desc.strip()
    return " ".join(corte.split()[:4])


def _palabras(*textos: str) -> str:
    """Palabras propias del evento (nombre, sistema), sin recursos medidos ni rutas."""
    vistas, out = set(), []
    for t in textos:
        for w in re.findall(r"[a-z0-9]+", re.sub(r"/[^\s,;:()]*", " ", _sin_acentos(t))):
            if w in VACIAS or w in MEDIDAS or w in vistas or w.isdigit() \
                    or (len(w) < 4 and w not in {"erp", "nas", "red", "bd"}):
                continue
            vistas.add(w)
            out.append(w)
    return "|".join(rf"\b{re.escape(w)}" for w in out)


def _fecha(dia: int, mes: int, anio_escrito, inicio):
    """Fecha del evento. Respeta el año escrito; si no lo hay, toma el año que deja la
    fecha más cerca del inicio de la corrida (una semana del 28 dic al 3 ene cruza de año)."""
    anio, ref = (inicio, None) if isinstance(inicio, int) else (inicio.year, date(inicio.year, inicio.month, inicio.day))
    candidatos = [int(anio_escrito)] if anio_escrito else ([anio] if ref is None else [anio - 1, anio, anio + 1])
    validas = []
    for a in candidatos:
        try:
            validas.append(date(a, mes, dia))
        except ValueError:
            pass
    if not validas:
        return None
    return validas[0] if ref is None else min(validas, key=lambda f: abs((f - ref).days))


def leer(texto: str, inicio) -> dict:
    """Devuelve {"eventos": [...], "no_reconocidas": [...]} con el formato de config/calendario.json.

    `inicio` es el primer minuto de la corrida (o solo su año, como entero)."""
    eventos, no_reconocidas = [], []
    seccion = ""
    for linea in texto.splitlines():
        if linea.startswith("## "):
            seccion = _sin_acentos(linea[3:])
            continue
        if "evento" in seccion:
            m = VINETA.match(linea)
            if not m:
                continue
            cuando, desc = m.group(1), m.group(2)
            ev = _evento(cuando, desc, inicio, linea.strip())
            (eventos.append(ev) if ev else no_reconocidas.append(linea.strip()))
        elif "sistema" in seccion and linea.startswith("|"):
            celdas = [c.strip() for c in linea.strip("|").split("|")]
            if len(celdas) >= 3 and _sin_acentos(celdas[-1]).startswith("diari"):
                h = UNA_HORA.search(celdas[1]) or UNA_HORA.search(celdas[0])
                if not h:
                    no_reconocidas.append(linea.strip())
                    continue
                eventos.append(dict(evento=_sin_acentos(celdas[0]), recurrencia="diaria",
                                    inicio=_hhmm(_minutos(*h.groups())), duracion_min=DURACION_POR_OMISION,
                                    palabras=_palabras(celdas[0], celdas[1]), fuente=linea.strip()))
    return {"eventos": eventos, "no_reconocidas": no_reconocidas}


def _evento(cuando: str, desc: str, inicio, fuente: str):
    c = _sin_acentos(cuando)
    d = _sin_acentos(desc)
    rango = RANGO.search(c) or RANGO.search(d)
    hora = rango.groups()[:2] if rango else ((UNA_HORA.search(c) or UNA_HORA.search(d)) or None)
    if hora is None:
        return None
    if not isinstance(hora, tuple):
        hora = hora.groups()
    hhmm = _hhmm(_minutos(*hora))
    dur = _duracion(d, rango)
    base = dict(evento=_nombre(d), duracion_min=dur, palabras=_palabras(desc), fuente=fuente)
    f = FECHA.search(c)
    if f and f.group(2) in MESES:
        dia = _fecha(int(f.group(1)), MESES[f.group(2)], f.group(3), inicio)
        return dict(base, recurrencia="unica", inicio=f"{dia.isoformat()}T{hhmm}") if dia else None
    p = c.replace(",", " ").split()
    if p[0] in DIAS_PLURAL:
        return dict(base, recurrencia="semanal", dia=DIAS_PLURAL[p[0]], inicio=hhmm)
    if p[0] == "cada" and len(p) > 1 and p[1] in DIAS_SINGULAR:
        return dict(base, recurrencia="semanal", dia=DIAS_SINGULAR[p[1]], inicio=hhmm)
    if p[0] == "todos" and len(p) > 2 and p[1] == "los":
        if p[2] in DIAS_PLURAL:
            return dict(base, recurrencia="semanal", dia=DIAS_PLURAL[p[2]], inicio=hhmm)
        if p[2] == "dias":
            return dict(base, recurrencia="diaria", inicio=hhmm)
        return None  # «todos los …» que no es un día: mejor avisar que adivinar
    if p[0].startswith("diari"):
        return dict(base, recurrencia="diaria", inicio=hhmm)
    return None


def calendario_para(corrida_dir: Path, tenant: str, inicio, base: dict) -> tuple:
    """Calendario (mismo formato que config/calendario.json) leído del contexto.md de la corrida.

    `base` aporta los márgenes. Devuelve (calendario, no_reconocidas).
    """
    texto = (Path(corrida_dir) / tenant / "contexto.md").read_text(encoding="utf-8")
    r = leer(texto, inicio)
    cal = {"margen_antes_min": base.get("margen_antes_min", 10),
           "margen_despues_min": base.get("margen_despues_min", 30),
           "fuente": "contexto.md", "empresas": {tenant: r["eventos"]}}
    return cal, r["no_reconocidas"]


def elegir(corrida_dir: Path, tenant: str, inicio, manual: dict, fuente: str = "contexto") -> tuple:
    """Calendario a usar en una corrida y avisos para mostrar.

    `fuente="contexto"` (por omisión) lee el contexto.md de la corrida; si falta o no trae
    ningún evento reconocible, se usa el calendario manual y se avisa. El calendario
    devuelto indica en `fuente` de dónde salió ("contexto.md" o "manual").
    """
    respaldo = {**manual, "fuente": "manual"}
    if fuente == "manual":
        return respaldo, []
    try:
        cal, no_reconocidas = calendario_para(corrida_dir, tenant, inicio, manual)
    except FileNotFoundError:
        return respaldo, [f"No hay contexto.md para {tenant} en esta corrida; se usa el calendario manual."]
    avisos = [f"No entendí esta línea del contexto.md: {l}" for l in no_reconocidas]
    if not cal["empresas"][tenant]:
        return respaldo, avisos + ["El contexto.md no trae eventos reconocibles; se usa el calendario manual."]
    return cal, avisos
