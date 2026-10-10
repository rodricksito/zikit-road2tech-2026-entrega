# Detector ZIKIT (backend)

Detector de alerta temprana de **reglas explicables + calendario de negocio** (ver `docs/ANALISIS.md`). Lee la carpeta cruda de una corrida y produce las alertas con su explicación y su acción sugerida. Una alerta en el minuto *t* solo usa datos hasta *t*.

## Instalación

Requiere **Python 3.12 o superior** (lo exigen numpy 2.5.3 y scipy 1.18.1). `python-multipart` es para recibir el .zip en `POST /api/kit`. El dataset se clona **fuera** del repositorio, en `../zikit-dataset`, o se indica con la variable `ZIKIT_DATA`.

```bash
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

En Windows (PowerShell): `python -m venv .venv` y luego `.venv\Scripts\pip install -r backend\requirements.txt`. Para ejecutar, cambia `../.venv/bin/python` por `..\.venv\Scripts\python` en los comandos de abajo, por ejemplo: `..\.venv\Scripts\python -m zikit detectar --corrida ..\..\zikit-dataset\data\corridas\corrida_01 --salida salida\corrida_01`.

## Uso

Desde la carpeta `backend/`:

```bash
# Detectar en una corrida → alertas.csv, explicaciones.json y serie.json
../.venv/bin/python -m zikit detectar --corrida ../../zikit-dataset/data/corridas/corrida_01 --salida salida/corrida_01

# Detectar en la raíz y en las 54 corridas → salida/alertas_gracko_completo.csv (con columna corrida)
../.venv/bin/python -m zikit detectar-todas

# Ablaciones: --modo sin_calendario | solo_metricas | solo_logs
../.venv/bin/python -m zikit detectar-todas --modo sin_calendario

# Recalcular la calibración (solo si cambia el método; ya está en config/calibracion.json)
../.venv/bin/python -m zikit calibrar

# Servidor web: interfaz (web/) + API en http://127.0.0.1:8000
../.venv/bin/python -m zikit servir

# Pruebas
../.venv/bin/python -m pytest
```

La API está documentada en `docs/FORMATO_ALERTAS.md` §5. `--web` indica otra carpeta de interfaz y `--host 0.0.0.0` la comparte en la red local. Para publicarla en un servidor, ver [docs/DESPLIEGUE.md](../docs/DESPLIEGUE.md).

### Probar con otro kit (el del jurado)

Con el servidor en marcha, se puede subir un `.zip` con la estructura del kit (`data/<empresa>/metricas.csv`, `logs.md`, `contexto.md` y, si se quiere, `data/corridas/corrida_NN/...`) y ver sus alertas sin reiniciar nada. En la pantalla: botón **«Subir kit»** y luego «Abrir kit». Al terminar, la pantalla abre la primera corrida del kit («Conjunto de datos») con un selector «Empresa» para cualquiera de sus empresas, y «Descargar alertas.csv» da las alertas de la empresa elegida en la corrida completa; el archivo de entrega con todas las empresas es `entrega.csv` (abajo). La dirección queda como `…/#kit=<id>`: recargar o compartir ese enlace vuelve a abrir el kit.

Desde una terminal:

```bash
curl -F archivo=@kit.zip http://127.0.0.1:8000/api/kit          # → {"id": "ec3547…fdb99", "corridas": ["kit-ec3547…fdb99", ...], ...}
curl -OJ "http://127.0.0.1:8000/api/entrega.csv?corrida=kit-<id>"          # alertas de todas las empresas (formato de entrega)
curl -OJ "http://127.0.0.1:8000/api/gracko/alertas.csv?corrida=kit-<id>"   # solo gracko
```

Los kits **no se listan** en `/api/{empresa}/corridas`: el `id` (32 caracteres al azar) es la única forma de volver a verlos (`GET /api/kit/<id>`). Si existe `ZIKIT_CLAVE`, la subida pide la cabecera `X-Zikit-Clave` (en la pantalla, el campo «Clave de subida» o el enlace `…/#clave=<clave>`); en la laptop, sin esa variable, la subida es libre. Solo se extraen `metricas.csv`, `logs.md` y `contexto.md`; las carpetas `_solucion` y los archivos `etiquetas.csv` o `generar.py` se saltan sin abrirlos. Cada empresa se revisa al subir (UTF-8, timestamps sin zona, como máximo 31 días) y la que no se puede analizar se omite con un aviso. Límites, nombres y errores en `docs/FORMATO_ALERTAS.md` §5. Los kits se guardan en `ZIKIT_SUBIDAS` (por omisión, `zikit-subidas` en el temporal del sistema; máximo 30). Las pruebas usan siempre una carpeta vacía, así que no ven lo que subas a mano.

`--tenant` vale `gracko` por omisión; las otras tres empresas también funcionan. El calendario de eventos esperados se lee del `contexto.md` de cada corrida (`--calendario-fuente contexto`, por omisión); `--calendario-fuente manual` usa `config/calendario.json`. En la API, la variable `ZIKIT_CALENDARIO` hace lo mismo.

**Lo normal se aprende de la semana que llega (modo adaptable, por omisión).** Todo con datos hasta cada minuto (`zikit/propio.py`):

| Qué | En cuanto hay días propios | Arranque en frío (aún no hay un día anterior a esa hora) |
| --- | --- | --- |
| Lo normal de cada métrica | Mediana de los días anteriores a esa hora (hasta 7) | Forma del día del kit + desplazamiento (× en la latencia) aprendido en las primeras 6 h |
| Margen (σ) | Ruido medido en la semana (× incertidumbre por pocos días) | El de un perfil de 1 día (ruido × √2), nunca menor que el del kit |
| Errores esperados | Mediana de los días anteriores a esa hora + tasa de 24 h | Tasa de las 24 h previas, partiendo del kit × la escala de la semana (el kit pesa como 1 h de datos) |
| Rutina de logs | Plantillas vistas esta semana fuera de un caso ∪ fondo del kit | Además, las vistas en 2 horas distintas; una línea nueva pesa según cuánto describe el kit las últimas 24 h |

**Cambio de nivel sostenido:** si en las últimas 24 h los cuatro tramos de 6 h quedan todos a más de 2σ de lo normal, del mismo lado y a menos de 1σ entre sí (un escalón que se quedó quieto, p. ej. más carga), se acepta como nuevo normal: los días anteriores se corrigen con ese escalón. Una falla lenta (el disco que se llena) sigue subiendo y nunca se acepta. La explicación de cada alerta dice de dónde salió lo normal (`normal_de`, `ajuste`, `cambio_nivel`, `esperados_de`).

`ZIKIT_ADAPTAR=0` (CLI y API) vuelve exactamente al detector calibrado con las corridas del kit (mismas alertas, explicaciones, casos, puntaje y roles de log, sin campos nuevos); en código, `detectar(..., adaptar=False)`.

## Salidas

Formato en `docs/FORMATO_ALERTAS.md`.

| Archivo | Contenido |
| --- | --- |
| `alertas.csv` | `tenant,timestamp,confianza,tipo`: la entrega |
| `explicaciones.json` | Por alerta: título, resumen, familias de evidencia, logs, eventos del calendario cercanos y acción sugerida |
| `serie.json` | Un punto cada 5 min (mediana de 5 min de cpu, ram, disco y latencia; errores sumados en el paso), apagones y calendario |

## Archivos

| Ruta | Qué es |
| --- | --- |
| `zikit/ingesta.py` | Lee `metricas.csv` y `logs.md`; plantillas de log. Rechaza timestamps con zona y corridas de más de 31 días (antes de crear una fila por minuto) |
| `zikit/contexto.py` | **Calendario automático:** lee el `contexto.md` de cada corrida (eventos con fecha, semanales, diarios y la tabla de sistemas) y avisa de lo que no entiende |
| `zikit/calendario.py` | Ventanas de eventos esperados a partir del calendario (automático o `config/calendario.json`) |
| `zikit/calibracion.py` | Perfiles, sigmas, λ de errores, umbrales, logs de fondo y eventos diarios del perfil, con las corridas 11–54 (el modo adaptable usa los umbrales y, solo en el arranque en frío, la forma) |
| `zikit/propio.py` | **Modo adaptable:** lo normal, el ruido y los errores esperados aprendidos del pasado de la propia corrida; arranque en frío y cambios de nivel sostenidos |
| `zikit/adaptacion.py` | Arranque en frío: desplazamiento inicial, escala de errores, rutina de logs del kit ∪ aprendida y eventos diarios que el kit no tenía a esa hora |
| `zikit/detector.py` | Las cinco familias de evidencia, la fusión, los casos y el tipo; explicaciones. Con `ZIKIT_ADAPTAR=0`, lo normal sale de la calibración del kit |
| `zikit/acciones.py` | Nombre y acción sugerida por tipo de incidente (sin IA) |
| `zikit/serie.py` | `serie.json` para la línea de tiempo |
| `zikit/api.py` | API web (FastAPI) y servidor de la interfaz; todo recortado a `hasta`. También `alertas.csv`/`entrega.csv` (la corrida completa) y `POST /api/kit` |
| `zikit/kits.py` | **Kits subidos:** revisión del registro final y extracción segura del .zip (límites, sin `_solucion`), detección de la raíz de datos, identificador secreto, validación con la misma lectura que la API, 2 subidas a la vez y tope de 30 kits; acepta empresas sin calibración |
| `zikit/jsonutil.py` | JSON estricto (sin NaN) |
| `config/calendario.json` | Calendario **manual de respaldo** (se usa con `--calendario-fuente manual` o si falta el `contexto.md`) |
| `config/calibracion.json` | Calibración generada; no se edita a mano |

## Comprobación

- **Reproduce el prototipo validado:** mismas alertas (minuto, confianza, tipo y familias) en las 55 corridas de las 4 empresas, en los modos completo, sin calendario y solo logs. En «solo métricas» coinciden minuto, confianza y familias; el tipo cambia a propósito, porque el prototipo usaba el texto de los logs para nombrarlo incluso en ese modo.
- **Revisión independiente:** tres revisores (causalidad, robustez y contrato) y un verificador por hallazgo. Se corrigió lo real, que estaba en las explicaciones, la CLI y la documentación; ninguna alerta cambió.
- **Calendario automático:** en la semana original da las mismas ventanas que el manual en las 4 empresas y las mismas alertas en las 55 corridas. Con la semana desplazada 1 o 7 días (ficha actualizada) da las mismas 3 alertas, desplazadas; el manual da 4, con una falsa alarma en la nómina (`tests/test_contexto.py`).
- **Un evento no se traga fallas ajenas:** las palabras de cada evento salen solo de su descripción; los recursos medidos (disco, cpu, rutas como `/data`) se asocian a un evento únicamente cuando un log anterior del propio evento los menciona. Con una falla de disco inyectada a las 11:00 durante la nómina, el detector avisa a las 11:01 (`test_falla_de_disco_durante_la_nomina_genera_alerta`). Si la API usa el calendario manual, lo dice en `calendario_fuente` y `avisos`.
- **Invariancia de prefijo:** cortar la entrada en *t* no cambia las alertas ≤ *t* ni sus explicaciones (`tests/test_detector.py`).
- **JSON estricto** en las 55 corridas: nunca `NaN` (la corrida 10 tiene una alerta dentro de un apagón).
- **Costo:** unos 0.03–0.07 s por semana de gracko con `ZIKIT_ADAPTAR=0` y unos 0.2–0.3 s en el modo adaptable, en una laptop, sin nube ni licencias.

Nunca se leen `_solucion`, `etiquetas.csv` ni `scripts/generar.py` del kit.
