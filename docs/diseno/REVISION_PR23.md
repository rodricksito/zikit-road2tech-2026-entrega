# Revisión del PR #23 — América / Codex

De: América / Codex  
Para: rodricksito / Claude Code  
Tarea: #22; revisión cruzada solicitada por América  
Estado: lista para revisión  
Entrega: [PR #23](https://github.com/rodricksito/zikit-road2tech-2026/pull/23), commit `bcec8afeb610a0368c325d44df7575b834b03b62`  
Resultado: **recomiendo corregir estos puntos antes de integrar**. No modifiqué el backend ni uní el PR.

## Hallazgos

1. **P1 — Un evento puede descartar registros de fallas ajenas.** [`contexto.py:78–82`](https://github.com/rodricksito/zikit-road2tech-2026/blob/bcec8afeb610a0368c325d44df7575b834b03b62/backend/zikit/contexto.py#L78) agrega todos los recursos vigilados a las palabras de cada evento. Con `Lunes 12 de octubre: cierre de nómina (10:00–14:00)`, a las 11:00, el mensaje `disco /data al 99%` pasa de `novedad` con el calendario manual a `senuelo` con el automático. No contiene ninguna de las excepciones de `RE_DURA`, por lo que `rol_log` lo descarta como evidencia nueva. Esto puede retrasar o impedir un aviso coincidente con un evento legítimo. **Propuesta:** limitar la asociación a los sistemas expresamente relacionados con el evento; añadir una regresión con una falla de otro recurso durante nómina.

2. **P2 — “Todos los viernes” se interpreta como todos los días.** [`contexto.py:131–132`](https://github.com/rodricksito/zikit-road2tech-2026/blob/bcec8afeb610a0368c325d44df7575b834b03b62/backend/zikit/contexto.py#L131) acepta cualquier primera palabra `todos` como recurrencia diaria. `**Todos los viernes 17:00:** copia (30 min)` produce `diaria`, sin avisos. La pantalla repetirá el evento en días incorrectos y el detector trata de forma distinta las ventanas diarias y semanales. **Propuesta:** reconocer explícitamente el día o informar que no se entendió la línea.

3. **P2 — Se ignora el año explícito del evento.** [`contexto.py:125–127`](https://github.com/rodricksito/zikit-road2tech-2026/blob/bcec8afeb610a0368c325d44df7575b834b03b62/backend/zikit/contexto.py#L125) siempre usa el año de la primera métrica. Con inicio de corrida en diciembre de 2026, `**Viernes 1 de enero de 2027:** tarea (17:00–19:30)` se convierte en `2026-01-01T17:00`, sin avisos. La ventana queda un año antes y no cubre el evento de esa corrida. **Propuesta:** respetar el año escrito y validar las fechas de semanas que cruzan año.

4. **P2 — La API oculta que falló la lectura o que usa el calendario manual.** [`api.py:77`](https://github.com/rodricksito/zikit-road2tech-2026/blob/bcec8afeb610a0368c325d44df7575b834b03b62/backend/zikit/api.py#L77) descarta los avisos de `contexto.elegir`. Si falta la ficha o no se entiende, se puede utilizar el calendario fijo de respaldo sin comunicarlo a la interfaz. Además, `_calendario` etiqueta el origen como `contexto.md` incluso en modo manual. La CLI sí muestra avisos. **Propuesta:** conservar fuente y avisos efectivos en la respuesta web y probar una corrida sin ficha o con ficha no reconocida.

## Comprobación efectiva

- Revisión independiente por un segundo agente y reproducción local del parser exacto del commit, con textos sintéticos; no se consultaron archivos restringidos del dataset.
- Para el caso 1 se ejecutaron las funciones originales `contexto.leer`, `calendario.ventanas` y `detector.rol_log`. Esta última y sus expresiones regulares se extrajeron mediante AST, sin modificar su cuerpo, para no requerir todas las dependencias del detector.
- Resultado del caso 1: `manual novedad` / `automatico senuelo`.
- Resultado del caso 2: `recurrencia=diaria`, `inicio=17:00`, `no_reconocidas=[]`.
- Resultado del caso 3: `recurrencia=unica`, `inicio=2026-01-01T17:00`, `no_reconocidas=[]`.
- El caso 4 se comprobó por lectura del flujo de API y de `elegir`; no se levantó FastAPI.
- **No ejecuté la suite completa de backend ni repetí sus 29 pruebas reportadas.** Las dependencias de backend no estaban instaladas en el runtime de revisión. Estas reproducciones no cuantifican falsos negativos del detector completo.
- El rango y las referencias por corrida siguen siendo trabajo pendiente de #22; no son defectos de alcance de este PR. La discrepancia previa de unidades de errores tampoco se atribuye a #23.

## Reproducción mínima del parser

Desde la raíz del checkout del commit revisado, con Python estándar:

```python
import importlib.util

spec = importlib.util.spec_from_file_location("contexto", "backend/zikit/contexto.py")
contexto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contexto)

for titulo, descripcion in [
    ("Todos los viernes 17:00", "copia (30 min)"),
    ("Viernes 1 de enero de 2027", "tarea (17:00–19:30)"),
]:
    r = contexto.leer(f"## Eventos\n- **{titulo}:** {descripcion}", 2026)
    print(r["eventos"][0]["recurrencia"], r["eventos"][0]["inicio"], r["no_reconocidas"])
```

Necesito: correcciones de Claude y pruebas de regresión antes de considerar el PR listo para integrar. Revisión publicada con autorización de América el 10 de octubre de 2026: [comentario en el PR #23](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6094774046). No constituye aprobación ni integración del PR.


Seguimiento: [segunda revisión de #23 y revisión de #25](REVISION_PR23_PR25.md), sobre `97b36b0` y `4bcb92e`.
