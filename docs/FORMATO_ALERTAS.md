# Formato de alertas (P05)

Estado: **vigente**: lo implementan el detector y la API (`backend/`) y la interfaz (`web/`); propuesto por rodricksito / Claude Code. Por indicación del mentor se empieza con **una empresa (gracko)** y una **app web**; el formato conserva la columna `tenant` para poder sumar otra empresa después. Comparten este formato el detector (rodricksito), la interfaz (América) y el evaluador (Arturo). Si el mentor fija otro formato de entrega (pregunta 4 de [RETO.md](RETO.md)), se ajusta `alertas.csv` y lo demás se conserva.

## 1. `alertas.csv`: la entrega

Una fila por alerta, de las 4 empresas en el mismo archivo y ordenada por `timestamp`. Hay un archivo por corrida evaluada.

| Columna | Tipo | Ejemplo | Regla |
| --- | --- | --- | --- |
| `tenant` | texto | `gracko` | `gracko`, `gramo`, `kaiku` o `ttr` |
| `timestamp` | fecha y hora | `2026-10-10T10:52:00` | ISO 8601 sin zona horaria, al minuto, igual que `metricas.csv`. La alerta solo usa datos hasta este minuto |
| `confianza` | número | `0.70` | De 0 a 1. Niveles propuestos: 0.50 (baja), 0.70 (media) y 0.85 o más (alta) |
| `tipo` | texto | `capacidad_disco` | Opcional según el mentor; ver el catálogo |

```text
tenant,timestamp,confianza,tipo
gracko,2026-10-10T10:52:00,0.60,capacidad_disco
gramo,2026-10-12T23:59:00,0.58,memoria
```

### Catálogo de tipos (provisional)

| Tipo | Cuándo |
| --- | --- |
| `capacidad_disco` | Disco que crece hacia la saturación |
| `memoria` | Fuga o crecimiento de RAM, heap o caché |
| `agotamiento_conexiones` | Pool de conexiones al límite |
| `base_de_datos` | Bloqueos, deadlocks o consultas lentas |
| `seguridad_acceso` | Intentos fallidos, autenticación o cuentas bloqueadas |
| `trafico_anomalo` | SYN flood, conexiones ×N o bots |
| `red_enlace` | Latencia o errores sin carga de CPU, enlaces o proveedores |
| `degradacion_rendimiento` | CPU y latencia altas sin otra causa clara |
| `anomalia_generica` | No encaja en ningún tipo anterior |

Si el mentor define un catálogo cerrado, se cambia este mapeo.

## 2. `explicaciones.json`: para la interfaz y la demo

Una entrada por alerta, con el mismo `tenant` y `timestamp` que su fila de `alertas.csv`. El `id` es `<tenant>-<AAAA-MM-DDTHH:MM>`. No se entrega al evaluador. Todo lo que contiene usa datos hasta el minuto de la alerta. El JSON es estricto: los valores ausentes salen como `null`, nunca `NaN`.

Ejemplo real (gracko, `corrida_01`):

```json
{
  "id": "gracko-2026-10-13T20:46",
  "tenant": "gracko",
  "timestamp": "2026-10-13T20:46:00",
  "confianza": 0.577,
  "nivel": "baja",
  "tipo": "degradacion_rendimiento",
  "titulo": "Servicio cada vez más lento",
  "resumen": "CPU promedió 48.4 % en los últimos 15 min contra 24.9 % normal a esta hora (3.8σ); lectura actual 48.1 %; latencia promedió 74.4 ms en 15 min hasta las 20:16 contra 40.6 ms normal a esa hora (6.3σ); lectura actual 35.0 ms. Fuera de los eventos esperados del calendario.",
  "familias": [
    { "familia": "nivel", "senal": "cpu", "unidad": "%", "ventana_min": 15, "valor": 48.4, "normal": 24.9, "z": 3.8, "hora": "2026-10-13T20:46:00", "valor_actual": 48.1, "confianza": 0.35 },
    { "familia": "nivel", "senal": "latencia_ms", "unidad": "ms", "ventana_min": 15, "valor": 74.4, "normal": 40.6, "z": 6.3, "hora": "2026-10-13T20:16:00", "valor_actual": 35.0, "confianza": 0.35 }
  ],
  "otras_evidencias": [],
  "logs": [],
  "calendario_descartado": [],
  "actualizaciones": [],
  "accion_sugerida": "Revisar los procesos que más consumen CPU y preparar un reinicio controlado del servicio antes del siguiente horario de uso."
}
```

| Campo | Contenido |
| --- | --- |
| `nivel` | Nivel de la confianza: `baja` (≥ 0.5), `media` (≥ 0.7) o `alta` (≥ 0.85) |
| `titulo` | Nombre legible del `tipo`, para mostrar al dueño de la PyME |
| `resumen` | Explicación técnica en una o dos frases |
| `familias` | Evidencias con aporte ≥ 0.3 (las que explican la alerta). Todas traen `familia` y `confianza` (aporte de esa familia); el resto depende de la familia (tabla siguiente) |
| `otras_evidencias` | Evidencias menores (aporte entre 0 y 0.3): `{familia, senal, confianza}`. La confianza total es 1 − Π(1 − c) de `familias` y `otras_evidencias` |
| `logs` | Líneas de log que pesan en ese minuto, todas con hora ≤ la alerta (`nivel` aquí es DEBUG/INFO/WARN/ERROR) |
| `calendario_descartado` | Eventos del calendario (no diarios) de las últimas 24 h, ya iniciados, que pudieron bajar el peso de las señales: `{evento, inicio, fin}` |
| `actualizaciones` | Escaladas de confianza de la misma alerta (`{timestamp, confianza, motivo}`); no son alertas nuevas. Por ahora vacío |
| `accion_sugerida` | Qué hacer, escrito por el equipo según el `tipo` (sin IA) |

| Familia | Campos propios |
| --- | --- |
| `nivel` | `senal` y su `unidad` (`%` o `ms`); `valor` y `normal`: **media de 15 min** (`ventana_min: 15`) en el pico de la última hora; `hora`: último minuto **con medición** hasta ese pico (nunca dentro de un apagón); `z`: máximo en la última hora del z sostenido 10 min; `valor_actual`: la misma lectura que muestra la pantalla en el minuto de la alerta (mediana de 5 min, ver §3), o `null` si hay apagón. Es una foto del minuto de la alerta: más tarde, la tarjeta puede marcar otra cosa |
| `tendencia` | `senal`; `z` de la subida de 3 h |
| `saturacion` | `senal`; `horas_para_95` (0 si ya lo superó) |
| `errores` | `errores_60min` y `esperados_60min` (pueden ser `null`); `unidad`: `errores en 60 min` |

**De dónde sale «lo normal» (modo adaptable, por omisión).** Las familias `nivel` traen `normal_de`: `dias_anteriores` (mediana de los días anteriores de esta misma semana a esa hora) o `perfil_kit_ajustado` (arranque en frío: forma del día del kit + `ajuste` aprendido en las primeras 6 h de la semana). Si se aceptó un cambio de nivel sostenido, vienen `cambio_nivel` (en la unidad de la señal) y `cambio_nivel_desde`. La familia `errores` trae `esperados_de`: `dias_anteriores` o `ultimas_24h` (con `peso_kit` y `escala_kit` durante el arranque). Con `ZIKIT_ADAPTAR=0` ninguno de estos campos aparece y todo es como antes. La pantalla puede ignorarlos: el `resumen` ya lo dice en texto («… normal a esta hora en los días anteriores»).
| `logs` | `lineas`: cuántas líneas hay en `logs` |

## 3. `serie.json`: la línea de tiempo

Lo genera `python -m zikit detectar` en la carpeta `--salida` de cada corrida, junto a `alertas.csv` y `explicaciones.json`. Tiene un punto cada 5 min, con la mediana de 5 min de cpu, ram, disco y latencia, y los `errores` **por minuto** (promedio de los últimos 5 min, con 2 decimales), desde el primer minuto de la corrida. En los minutos de apagón **todas** las series, también `errores`, van en `null`. Es la misma lectura que usa la API y el `valor_actual` de la evidencia (`senales.visible`). `unidades` dice la unidad de cada serie. Incluye los apagones y las bandas del calendario. Es un archivo **offline con la semana completa**, así que incluye el fin de cada apagón. La interfaz en vivo no lo recorta: usa `GET /api/{tenant}/serie?hasta=…` (sección 5), que solo entrega datos hasta ese minuto.

```json
{
  "tenant": "gracko",
  "paso_min": 5,
  "unidades": { "cpu": "%", "ram": "%", "disco": "%", "latencia_ms": "ms", "errores": "errores/min" },
  "serie": [ { "t": "2026-10-08T08:05:00", "cpu": 26.3, "ram": 53.8, "disco": 58.1, "latencia_ms": 40.0, "errores": 0.2 } ],
  "apagones": [ { "inicio": "2026-10-09T19:44:00", "fin": "2026-10-09T19:57:00", "minutos": 13 } ],
  "calendario": [ { "evento": "cierre de nomina quincenal", "recurrencia": "unica", "inicio": "2026-10-12T10:00:00", "fin": "2026-10-12T14:00:00", "suprime": true } ]
}
```

- Durante un apagón, los valores se dejan en `null`, no en cero. El `fin` de un apagón es **exclusivo**: el primer minuto con datos.
- `suprime: true`: dentro de la banda, las métricas pesan menos y el evento no alerta. `suprime: false` (eventos diarios como el respaldo): su efecto ya está en lo normal de esa hora; solo sus logs se tratan como señuelo y **puede haber alertas por otra causa** dentro de la banda.

## 4. Estados que verá la interfaz

| Estado | Significado |
| --- | --- |
| Normal | Sin evidencia por encima del umbral |
| Evento esperado | Dentro de una ventana del calendario; se muestra sombreado. Si `suprime` es `true`, sus señales no alertan |
| Alerta abierta | Alerta emitida; muestra confianza, tipo y explicación |
| Alerta escalada | La misma alerta subió de confianza porque se sumó otra familia |
| Resuelta | Un log de resolución del operador cerró el caso |
| Sin datos | Apagón: no hay métricas en ese tramo, sin que eso signifique una falla |
| Error de carga | No se pudo leer el archivo o el formato no es válido |

## 5. API web

Implementada en `backend/zikit/api.py` (FastAPI). `python -m zikit servir` entrega la interfaz (`web/`) y la API desde el mismo origen, en http://127.0.0.1:8000. El parámetro `hasta` garantiza que la interfaz solo vea lo que el detector sabía en ese minuto. Fechas en `YYYY-MM-DDTHH:mm:ss`, sin zona. JSON estricto (`null`, nunca `NaN`).

| Método y ruta | Devuelve |
| --- | --- |
| `GET /api/empresas` | `[{ "tenant": "gracko", "giro": "despacho contable y fiscal (...)" }, ...]` (las 4 calibradas) |
| `GET /api/empresas?corrida=...` | Las empresas que trae esa corrida (oficial o de un kit subido): `[{tenant, giro, calibrada}]`. Una empresa con `calibrada: false` se analiza con un punto de partida genérico y aprende de su propia semana |
| `GET /api/{tenant}/corridas` | `["raiz", "corrida_01", ..., "corrida_54"]`: solo las corridas oficiales. Los **kits subidos no se listan** (ver `GET /api/kit/{id}`) |
| `GET /api/{tenant}/calendario?corrida=...` | Eventos esperados de esa corrida (`raiz` si no se indica): `[{evento, inicio, fin, recurrencia, suprime, origen}]`, con horas nominales. `origen` empieza con `contexto.md` o con `calendario manual (respaldo)`. Es lo mismo que trae `serie` en `calendario` |
| `GET /api/{tenant}/rango?corrida=...` | `{tenant, corrida, inicio, fin, unidades, calendario_fuente, avisos}`: primer y último minuto **de esa corrida**. La interfaz arma su reloj con esto, sin fechas fijas |
| `GET /api/{tenant}/serie?corrida=...&desde=...&hasta=...` | `{tenant, corrida, paso_min, unidades, serie, apagones, calendario, calendario_fuente, avisos}`: puntos cada 5 min más el minuto `hasta`, con `errores` en **errores/min**; apagones con `fin` exclusivo **recortados a `hasta` + 1 min** (no revelan cuándo vuelven los datos) |
| `GET /api/{tenant}/alertas?corrida=...&hasta=...` | Alertas emitidas hasta ese minuto, con su explicación (sección 2) y `cierre`: `{timestamp, motivo}` (`resolucion` o `calma`) solo si ya ocurrió; si no, `null` |
| `GET /api/{tenant}/estado?corrida=...&hasta=...` | `{estado, alerta_abierta, evento, sin_datos}`; `estado` es `Normal`, `Evento esperado: …`, `Alerta: …` o `Sin datos` |
| `GET /api/{tenant}/referencias?corrida=...&hasta=...` | Impactos **HIPOTÉTICOS** del equipo para la comparación con el «teléfono»: `[{id, tenant, corrida, tipo, tipo_alerta, timestamp, descripcion, fuente, alerta_id}]`. Solo responde si la semana de la hipótesis (`semana.inicio`/`fin` en `docs/ejemplos/hipotesis_{tenant}.json`) coincide con el rango de la corrida; si no, `[]`. Para un kit subido (`kit-…`) siempre `[]`: las hipótesis son del kit oficial y otro kit puede tener las mismas fechas con otras fallas y la interfaz muestra «sin referencia de impacto». `descripcion` se recorta a lo ocurrido hasta `hasta` (a las 23:00 no muestra «+ 23:01 exportacion fallida»). `alerta_id` es la **primera alerta del tipo `tipo_alerta`** (declarado en la hipótesis, del catálogo de §1) entre el primer indicio − 3 h y el impacto; una alerta de otro tipo nunca se enlaza. Sin coincidencia o sin `tipo_alerta` válido: `null`. No son etiquetas oficiales |
| `GET /api/{tenant}/alertas.csv?corrida=...` | **Descarga** (`Content-Disposition: attachment`, `text/csv`) con **todas** las alertas de la corrida en el formato de §1 (`tenant,timestamp,confianza,tipo`). Es el mismo archivo que da `python -m zikit detectar` con esos datos. No se recorta a `hasta`: es la entrega, no la reproducción |
| `GET /api/entrega.csv?corrida=...` | Lo mismo para todas las empresas que trae la corrida (también las no calibradas), en un solo archivo ordenado por `timestamp` |
| `POST /api/kit` | Sube un kit (ver abajo). Responde `{id, creado, corridas, empresas, empresas_por_corrida, avisos, ignorados}` |
| `GET /api/kit/{id}` | Lo mismo para un kit ya subido, si `id` existe (404 si no o si ya se borró). Así la pantalla lo recupera desde el enlace `#kit=<id>` |
| `GET /api/salud` | `{ok, datos, empresas}` |

**Calendario:** `calendario_fuente` vale `contexto.md` (leído de la ficha de la corrida) o `manual` (respaldo, si falta la ficha o no trae eventos reconocibles). `avisos` lista lo que no se entendió de la ficha o los eventos que caen fuera de la corrida; la interfaz debe mostrarlos si no está vacío.

**Modo en vivo:** la interfaz pide `rango` al elegir la corrida, avanza `hasta` dentro de ese rango a la velocidad que elija el usuario y pide `serie`, `alertas` y `estado`. No se necesita WebSocket. Los errores de parámetros devuelven 422 (fecha mal formada) o 404 (empresa o corrida desconocida).

**Acción sugerida:** cada alerta incluye `accion_sugerida`, un texto breve según el `tipo` escrito por el equipo, sin IA.

### Subir un kit (`POST /api/kit`)

Sirve para que el jurado pruebe la app con **sus propios datos**. En la pantalla es el botón «Subir kit». Desde una terminal se envía un `.zip` como `multipart/form-data` en el campo `archivo`:

```sh
curl -F archivo=@kit.zip http://127.0.0.1:8000/api/kit                                  # sin ZIKIT_CLAVE
curl -F archivo=@kit.zip http://64.177.81.155/api/kit         # servidor publicado (subida libre)
```

Respuesta real al subir la carpeta `data/` del kit completo comprimida (solo `metricas.csv`, `logs.md` y `contexto.md`: 20 MB, 55 corridas; tardó 4.8 s en la laptop con el modo adaptable y 3.1 s con `ZIKIT_ADAPTAR=0`). Se acortaron la lista de corridas y `empresas_por_corrida`:

```json
{
  "id": "ec354768bc0383653c43c0ad477fdb99",
  "creado": "2026-10-10T09:33:52",
  "corridas": ["kit-ec354768bc0383653c43c0ad477fdb99", "kit-ec354768bc0383653c43c0ad477fdb99-corrida_01", "..."],
  "empresas": ["gracko", "gramo", "kaiku", "ttr"],
  "empresas_por_corrida": {"kit-ec354768bc0383653c43c0ad477fdb99": ["gracko", "gramo", "kaiku", "ttr"], "...": []},
  "avisos": [],
  "ignorados": 0
}
```

Si el zip trae soluciones, `ignorados` las cuenta y `avisos` empieza con «Se ignoraron N archivo(s) sin abrirlos: …».

- **Quién puede verlo.** `id` son 32 caracteres hexadecimales al azar (128 bits). Los kits no aparecen en `corridas` ni en ninguna otra lista: solo quien tiene el `id` (o el enlace `…/#kit=<id>` que muestra la pantalla) puede consultarlos. Consultar no pide clave.
- **Quién puede subir.** Por acuerdo del equipo, **cualquiera** (subida libre, lo más fácil para el jurado). Opcional: si el servidor tiene la variable `ZIKIT_CLAVE`, la subida exige la cabecera `X-Zikit-Clave` con ese valor (401 sin leer el zip); `deploy/publicar.sh` imprime entonces el enlace `http://IP/#clave=…`, y la pantalla toma la clave del enlace, la guarda solo en esa pestaña y la quita de la barra de direcciones.

- **Qué zip sirve.** El del repositorio del kit tal cual (`zikit-dataset-main/data/...`), la carpeta `data/` comprimida o las carpetas de empresa directamente (`gracko/metricas.csv`). La raíz de datos es la carpeta más corta que tiene `<empresa>/metricas.csv`; se registra como `kit-<id>`, y cada `corridas/corrida_NN` dentro de ella como `kit-<id>-corrida_NN`. Si el zip solo trae `corridas/`, se registran solo esas.
- **Qué se usa.** Solo `metricas.csv`, `logs.md` y `contexto.md`, de **cualquier empresa** cuya carpeta tenga un nombre seguro (`[a-z0-9][a-z0-9_-]*`). Las que no son `gracko`, `gramo`, `kaiku` o `ttr` se analizan con un punto de partida genérico y lo dice `avisos`; con `ZIKIT_ADAPTAR=0` se avisa además que sus resultados son poco fiables. Sin `logs.md` se analiza solo con métricas; sin `contexto.md` se usa el calendario manual de respaldo (también lo avisan `rango` y `serie`).
- **Qué se revisa al subir.** Cada empresa de cada corrida se lee igual que al analizarla: los tres archivos en UTF-8, las columnas de `metricas.csv`, timestamps **sin zona** (`2026-10-08T08:00:00`, no `…Z`) y como máximo **31 días** entre el primero y el último (el kit oficial cubre 7). También se exige al menos una medición (un `metricas.csv` con todas las celdas vacías se rechaza). Las primeras 4 combinaciones de corrida y empresa (empezando por la raíz) además se analizan completas, y la primera consulta de cada una reutiliza ese análisis en vez de repetirlo; las demás solo se leen, para que subir el kit completo tarde segundos y no minutos. La que falla se omite y lo explica `avisos` («No se pudieron analizar N empresa(s) y se omiten: acme (raíz): data/acme/metricas.csv: valor no válido en la fila 2, columna «cpu»: «-1» …»: la corrida se nombra `raíz` o `corrida_NN`, y se cita la celda tal como viene), así `entrega.csv` nunca encuentra una empresa registrada que no pueda analizar. Si no queda ninguna, 422.
- **Qué nunca se abre.** Las rutas con una carpeta `_solucion` y los archivos `etiquetas.csv` o `generar.py` se saltan sin leerlos y se cuentan en `ignorados` (igual que los enlaces simbólicos).
- **Después.** Las corridas `kit-…` funcionan con todas las rutas de arriba (`rango`, `serie`, `alertas`, `estado`, `calendario`, `referencias`, `alertas.csv`, `entrega.csv`) sin cambios de formato. El reloj sale de `rango`, como siempre. La pantalla reproduce cualquier empresa del kit (selector «Empresa», con `empresas_por_corrida`).
- **Límites.** Zip ≤ 80 MB; ≤ 3000 entradas y un índice ≤ 3 MB (se leen del registro final antes de abrir el zip); `logs.md` ≤ 2 MB y `metricas.csv`/`contexto.md` ≤ 5 MB cada uno (el kit oficial usa 0.08 MB y 0.37 MB); ≤ 250 MB en total, contando los bytes que de verdad salen al descomprimir. Se revisan como máximo 2 subidas a la vez (las demás esperan hasta 2 min). Se guardan como máximo 30 kits en `ZIKIT_SUBIDAS` (por omisión, `zikit-subidas` en el temporal del sistema); al pasar el tope se borra el más viejo y lo dice `avisos`, sin revelar su `id`.
- **Errores** (`{"detail": "..."}` siempre en español, sin dejar nada en disco): 401 si falta la clave o no es correcta; 413 si pasa un límite de tamaño; 422 si el formulario no trae un solo archivo en `archivo`, no es un zip válido, trae demasiadas entradas, una ruta absoluta o con `..`, no trae ningún `<empresa>/metricas.csv` con un nombre de empresa válido o ninguna empresa se puede analizar; 503 si el servidor sigue ocupado con otras subidas tras 2 min. Una corrida `kit-…` que no trae esa empresa, o un kit que ya se borró, responde 404.

## Ejemplos reales del prototipo

En [docs/ejemplos/](ejemplos/) están las alertas del prototipo para `corrida_01`, con y sin calendario. Tienen las columnas de `alertas.csv` más `familias` y `en_calendario`. Son salidas de un prototipo comparadas con incidentes hipotéticos, no resultados oficiales.

## Pendiente con el mentor

- Formato exacto: tipo de archivo, nombres de columnas, formato del timestamp, rango de la confianza y catálogo de tipos.
- Si las actualizaciones o las alertas duplicadas cuentan como falsas alarmas.
- Si se entrega un archivo por corrida o uno solo.
