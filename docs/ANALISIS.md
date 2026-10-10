# Análisis del dataset y propuesta de solución (P04)

Estado: análisis y propuesta de rodricksito / Claude Code del 9 de octubre, discutidos en #3. El equipo la adoptó como base del camino C ([DECISION.md](DECISION.md)); las tecnologías se confirmaron en [EQUIPO.md](../EQUIPO.md) y la app se publicó en un servidor ([DESPLIEGUE.md](DESPLIEGUE.md)).

> **Actualización (2026-10-09):** el equipo decidió pulir **una empresa (gracko)** como **app web**, priorizando los incidentes detectados y el bajo costo. El plan vigente es [Plan actualizado: gracko como app web](#plan-actualizado-gracko-como-app-web). El análisis de las 4 empresas se conserva como referencia y para una posible segunda empresa.

Análisis del 2026-10-09 sobre el kit `brunovillarrrrrr/zikit-dataset` (commit `cdea481`), clonado sin `_solucion` ni `scripts/`. No se usaron etiquetas. Lo marcado como HIPÓTESIS sale de leer métricas, logs y `contexto.md`; no está confirmado.

## Resumen

- Se analizaron **las 4 empresas**. Por indicación del mentor, se pule primero **una: gracko**; las demás quedan para después.
- **Las 54 corridas son la misma semana con el mismo guion.** Los incidentes y los señuelos caen en el mismo minuto en todas; solo cambian el ruido, los apagones y las celdas vacías. Validar con más corridas mide la robustez al ruido, no si el detector funciona en otro escenario (pregunta 8 al mentor).
- **Los señuelos tienen una forma reconocible:** un salto a una hora anunciada en `contexto.md`, una meseta y la vuelta a la normalidad. Varios traen ERROR en los logs, así que el nivel ERROR no basta para decidir.
- **Los incidentes probables son rampas lentas, escalones o ráfagas que el contexto no explica.** Varios se anuncian con horas de anticipación, a menudo en logs DEBUG o INFO.
- **Recomendación:** un detector de **reglas explicables con calendario de negocio**. Los dos jueces internos del equipo (no el jurado del evento) lo pusieron primero.

## Lo que medimos en los datos

| Tema | Hallazgo |
| --- | --- |
| Tamaño | 9,200 minutos por empresa y corrida, del jue 8 al mié 14 de oct. Cada empresa empieza a su hora de apertura (ttr 06:00, gramo 07:00, gracko 08:00, kaiku 09:00) |
| Ruido en métricas | Unos 3.7 apagones por corrida (bloques vacíos de 3 a 25 min, a horas al azar) y alrededor del 1.2 % de celdas vacías sueltas |
| Errores por minuto | Ruido tipo Poisson: de 0.29 a 0.43 errores por minuto en calma; en el 65–75 % de los minutos hay 0 |
| Logs | 3 secciones (servidor, firewall, app) de 400 líneas cada una. Hay 25 plantillas de fondo, iguales en las 4 empresas, que suman el 98 % de las líneas e incluyen ERROR y WARN sin significado (webhook, sync_contactos, impresión, correo, escaneo de puertos). Además hay de 17 a 26 plantillas «de guion» por empresa |
| Trabajos no documentados | gramo, todos los días 02:00–02:18 (CPU +10, RAM +6), y ttr, todos los días 01:00–01:44 (respaldo de BD). Deben tratarse como normales |

### Señuelos medidos (eventos de `contexto.md`)

| Empresa | Evento | Cómo se ve |
| --- | --- | --- |
| gracko | Respaldo diario, 23:00 | CPU +14 y latencia +24 durante unos 35 min |
| gracko | Carga masiva, vie 9, 17:00–19:30 | Escalón de disco de +7 puntos |
| gracko | Cierre de nómina, lun 12, 10:00–14:00 | Latencia ×3.3, unos 2 errores por minuto, WARN y ERROR en logs |
| gramo | Promoción 2x1, vie 9, 10:00–12:00 | Latencia hasta 245 ms y unos 5.5 errores por minuto |
| gramo | Snapshot, sáb, 03:00–04:30 | CPU +22 y disco +2 |
| kaiku | Respaldo diario, 03:00 | CPU +12 y latencia +30 durante unos 27 min |
| kaiku | Campaña de correo, vie 9, 12:00 | Latencia ×2.9 durante unos 85 min |
| kaiku | Reindexado, dom, 04:00 | CPU +25, latencia +93 y un ERROR de deadlock |
| ttr | Mantenimiento de red, sáb 10, 22:00–23:00 | Latencia ×2.2 y unos 2.6 errores por minuto |

### Incidentes probables (HIPÓTESIS, 3 por empresa)

| Empresa | Incidente | Impacto (primer ERROR) |
| --- | --- | --- |
| gracko | Disco `/data` lleno | dom 11, 23:00 |
| gracko | Fuerza bruta a la VPN y cuentas del ERP bloqueadas | mar 13, 00:31 |
| gracko | Degradación del ERP (ráfagas de CPU y latencia) | mié 14, 09:20 |
| gramo | Tráfico anómalo o SYN flood escondido alrededor de la promoción | vie 9 |
| gramo | Fuga de memoria en `pedidos-worker` | mar 13, 07:35 |
| gramo | Pool de conexiones a inventario agotado | mié 14, 07:21 |
| kaiku | Degradación de la BD `srv-bd-01` | dom 11, 20:31 |
| kaiku | Pool del checkout agotado (sin límite por cliente) | lun 12, 14:00 |
| kaiku | Pico de tráfico no programado o bots | mar 13, 20:01 |
| ttr | Pérdida intermitente del enlace GPS | vie 9, 15:02 |
| ttr | Servidor compartido saturado (caché GPS frente al optimizador) | lun 12, 07:02 |
| ttr | Bloqueos en la BD de rutas | mié 14, 06:31 |

Queda una duda: la «planeación extra» de ttr del martes 13, 06:00–08:50 (CPU +22, latencia +62, sin errores), que no está en `contexto.md`. No sabemos si es un señuelo o un incidente.

## Tres enfoques probados

Cada enfoque tuvo un prototipo desechable, calibrado con las corridas 11–54 y probado en las corridas 01–10 y el conjunto raíz (44 series). La referencia son las 12 hipótesis, no etiquetas oficiales. Las cifras las recalculó un juez con el mismo criterio para los tres.

| Enfoque | Detecta antes del impacto | Alertas por serie | Duplicadas por serie | Fuera de incidente por serie | Anticipación mediana |
| --- | --- | --- | --- | --- | --- |
| **1. Reglas + calendario** | **100 %** (132/132) | 3.25 | **0** | **0.25** (todas en la planeación de ttr) | **320 min** |
| 2. Estadístico (EWMA/CUSUM) | 90.9 % | 3.91 | 0.89 | 0.27 | 243 min |
| 3. Aprendizaje (IsolationForest) | 98.5 % | 3.82 | 0.32 | 0.52 | 206 min |

Puntaje de los jueces internos del equipo, no del jurado del evento (1–10):

| Enfoque | Juez de puntaje y reglas | Juez de ejecución en el hackatón |
| --- | --- | --- |
| 1. Reglas + calendario | 8 | 8.5 |
| 2. Estadístico | 6 | 6.5 |
| 3. Aprendizaje | 5.5 | 4 |

**El argumento más fuerte para el jurado:** si se quita el calendario de negocio al enfoque 1, las posibles falsas alarmas suben de **0.25 a 1.50 por serie**, y los señuelos documentados con alerta pasan de **0 de 57 a 38 de 57**.

Anticipación mediana por incidente con el enfoque 1 (HIPÓTESIS): disco de gracko 36 h, BD de kaiku 16 h, ERP de gracko 13 h, optimizador de ttr 12 h, fuga de RAM de gramo 7.6 h, pool del checkout de kaiku 7.5 h, SYN de gramo 3.6 h, GPS de ttr 2.4 h, bloqueos de ttr 1.6 h, pool de gramo 70 min, VPN de gracko 52 min y pico de tráfico de kaiku 36 min.

## Propuesta

**Base: enfoque 1.** Cada minuto se calculan, solo con datos hasta ese minuto, cinco familias de evidencia:

1. **Nivel** frente al perfil normal de esa hora del día.
2. **Tendencia** de 3 h (subidas lentas).
3. **Tiempo hasta saturación** del disco o la RAM.
4. **Errores** por encima de lo esperado.
5. **Logs nuevos**: plantillas que no son de fondo, sin filtrar por nivel.

Las métricas que caen dentro de un evento del calendario pesan menos, y los logs de señuelo o de resolución no alertan. Se emite **una alerta por caso**, con un tipo inferido por reglas y una explicación.

**Piezas de los otros enfoques:**
- Del enfoque 2, una **confianza que sube cuando coinciden varias familias** (niveles 0.5, 0.7 y 0.85). Hoy la confianza va de 0.50 a 0.71 y no separa aciertos de falsas alarmas.
- Del enfoque 3, la **línea base causal dentro de la propia corrida**, como modo alternativo si el mentor no permite calibrar con otras corridas, y su protocolo de validación.

**Fuera del alcance:** IsolationForest, CUSUM, FastAPI (salvo que sobre tiempo) y Claude API dentro de la detección. Claude API, si el mentor lo permite, solo sin conexión: convertir `contexto.md` en calendario y clasificar las ~106 plantillas de log, con revisión humana.

## Riesgos y cómo los cubrimos

| Riesgo | Mitigación |
| --- | --- |
| Validación circular: mismas corridas e incidentes hipotéticos | Presentar las cifras como robustez al ruido. Validar dejando fuera una empresa y desplazando el guion N horas |
| El calendario del prototipo tiene fechas fijas en el código | Generarlo desde `contexto.md` con horas nominales, en un YAML revisado por una persona |
| Las palabras clave de logs se eligieron mirando esta semana | Mostrar la prueba «solo métricas» y validar dejando fuera una empresa |
| Que no se permita calibrar con otras corridas | Tener listo el modo de línea base causal por corrida |
| Un tope de anticipación (el disco de gracko avisa unas 36 h antes) | Política de emisión configurable: alerta temprana de confianza baja más escalada |
| Mirar el futuro sin querer | Prueba de invariancia de prefijo: cortar en *t* y comprobar que las alertas ≤ *t* no cambian |

## Plan actualizado: gracko como app web

### Por qué gracko

- En el prototipo da **exactamente 3 alertas por corrida en las 55 corridas**: todas antes del impacto, ninguna duplicada y ninguna dentro de un evento del calendario (comparado contra las HIPÓTESIS).
- Sus tres incidentes (HIPÓTESIS) cuentan bien una historia:

| Incidente | Primera alerta del prototipo | Impacto | Anticipación mediana |
| --- | --- | --- | --- |
| Disco `/data` lleno | sáb 10, ~10:50 | dom 11, 23:00 (respaldo abortado, «no space») | **35.8 h** (mínimo 34.9 h) |
| Fuerza bruta a la VPN y cuentas bloqueadas | lun 12, ~23:40 | mar 13, 00:31 | 48 min (mínimo 32 min) |
| Degradación del ERP | mar 13, ~20:45 | mié 14, 09:20 | 13.1 h (mínimo 12.5 h) |

- Tiene tres señuelos claros en su `contexto.md`, con los que se ve por qué **no** alertamos: el respaldo diario de las 23:00, la carga masiva del viernes y el cierre de nómina del lunes. Este último sube la latencia ×3.3 y genera ERROR en los logs.
- El propio contexto anuncia el riesgo: «/data sin alerta de capacidad desde hace 3 meses».

### Qué construimos

1. **Detector** (Python): el prototipo de reglas + calendario convertido en un paquete. Lee la carpeta de una corrida (`metricas.csv`, `logs.md`, `contexto.md`) y produce las alertas, cada una con su explicación y la acción sugerida. Solo usa datos hasta el minuto *t*.
2. **API web** (Python): sirve a la interfaz el estado «hasta el minuto *t*»: métricas, alertas, eventos del calendario y apagones. Contrato en [FORMATO_ALERTAS.md](FORMATO_ALERTAS.md#5-api-web).
3. **App web**: reproduce la semana de gracko en vivo y acelerada. Las alertas aparecen cuando el detector las emite, los señuelos se ven sombreados como «evento esperado» y se marca el momento en que «habría sonado el teléfono», con los minutos ganados. Muestra la corrida que se elija.
4. **Acción sugerida por tipo de incidente**: una guía breve escrita por el equipo, por ejemplo «liberar `/data/tmp` y revisar exportaciones» o «bloquear el rango y forzar el cambio de contraseñas». No necesita IA, y eso apoya que la solución sea costeable.

### Cómo mostramos que es costeable

- Corre en una computadora normal: el prototipo procesa una semana de las 4 empresas en unos 6 s.
- No requiere nube, licencias ni IA de pago.
- Arturo medirá el tiempo y la memoria con una semana de gracko, y lo presentaremos como «costo de operación».
- Si sobra tiempo, la IA se puede añadir como extra opcional para redactar explicaciones, por menos de 0.01 USD por alerta. **No es parte del núcleo.**

### Tecnología propuesta (por confirmar en #3)

- **Backend:** Python con FastAPI. El mismo servidor entrega la API y los archivos de la interfaz.
- **Interfaz:** HTML, CSS y JavaScript con Chart.js, sin un proceso de compilación. Si América prefiere otra herramienta que domine, se cambia aquí.
- **Se ejecuta en la laptop de rodricksito** durante la demo.

### Plan por horas (desde que se acuerde)

| Horas | rodricksito / Claude Code | América / Codex | Arturo / Antigravity CLI |
| --- | --- | --- | --- |
| 0–0.5 | Confirmar el plan en #3 | Confirmar la tecnología de interfaz | Preguntas 8–10 al mentor |
| 0.5–3 | **Hito 1:** paquete detector para gracko, que lee la carpeta cruda, calibra con JSON, usa el calendario en YAML y escribe `alertas.csv` y `explicaciones.json` | Diseño de la app y maqueta navegable con [docs/ejemplos/](ejemplos/) | Arnés de evaluación de gracko: incidentes detectados, falsas alarmas, anticipación y alertas dentro del calendario |
| 3–5 | **Hito 2:** API web con el estado hasta el minuto *t* | Pantalla en vivo: línea de tiempo, tarjetas de alerta, bandas de calendario y «teléfono» | Robustez: 55 corridas, apagones inyectados e invariancia de prefijo |
| 5–8 | Acción sugerida por tipo, integración y ajustes | Conectar con la API, estados de carga, error y sin datos, y pulido | Medición de costo (tiempo y memoria), tabla de evidencia y guion de demo |
| 8+ | **Congelar el código**, ensayar y grabar un video de respaldo | Ensayo | Ensayo; elegir quién presenta |
| Si sobra | Segunda empresa (kaiku) e IA opcional | | |

## Dónde está el material

Prototipos, salidas y artefactos pequeños: la carpeta local `zikit-analisis/` de rodricksito (fuera del repositorio). El prototipo base es `diseno-reglas-calendario/proto_reglas.py`. El arnés del juez es `juez/puntaje.py`, y las hipótesis están en `calendario/hipotesis_incidentes.json`. Ejemplos de salida para la interfaz: [docs/ejemplos/](ejemplos/).
