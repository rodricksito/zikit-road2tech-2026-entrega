# Interfaz ZIKIT

La entrega de kits, empresas y CSV, sus capturas y las pruebas están en [KITS_EMPRESAS_CSV.md](../docs/diseno/KITS_EMPRESAS_CSV.md).

Frente de América / Codex para #5, con HTML, CSS, JavaScript y Chart.js. Permite elegir empresa y conjunto de datos, reproduce las métricas de una corrida, conserva los huecos de datos y permite revisar alertas y evidencia. La solución elegida por el equipo es el camino C; sus acuerdos están en [DECISION.md](../docs/DECISION.md).

**El contrato por corrida y la interfaz corregida quedaron integrados con #23, #25 y #24 en `main` (`4edd258`).** La actualización de API `a33c722` corrige descripciones futuras y alinea las lecturas de evidencia con la serie. El [pulido con Impeccable](../docs/diseno/PULIDO_IMPECCABLE.md) parte de esa base y se integró después en `main` con el PR #26 (`11f3693`). La versión de respaldo se conserva en la etiqueta `v1-demo-segura`.

**Estado al 10 de octubre de 2026:** selector de empresa, subida de kits y descarga CSV integrados mediante el [PR #26](https://github.com/rodricksito/zikit-road2tech-2026/pull/26) en `11f3693`, junto al backend #29. La [mejora de claridad de alertas](../docs/diseno/CLARIDAD_ALERTAS.md) parte de esa versión y se integró en `main` con el PR #31 (`37a1dec`), tras la revisión cruzada de rodricksito / Claude Code.

El backend del [PR #29](https://github.com/rodricksito/zikit-road2tech-2026/pull/29), de rodricksito / Claude Code, fue [aprobado en `d59bc0e`](https://github.com/rodricksito/zikit-road2tech-2026/pull/29#pullrequestreview-5480327758) e integrado en `main` como `7a9ce44`; sus bloqueos de revisión están corregidos. #29 retiró su frontend provisional y la simulación de combinación con #26 pasó sin conflictos. El recorrido local con ambas partes pasó y está documentado en [Verificación final](../docs/diseno/KITS_EMPRESAS_CSV.md#verificación-final). Para probar el flujo completo se necesita ese backend junto con esta interfaz; el servidor estático permite explorar el ejemplo ficticio.

La pantalla prioriza alertas y acción sugerida, con verde para las acciones y azul para selección y contexto. Una gráfica relacionada aparece en el detalle cuando la evidencia identifica su señal; conserva la ventana del reloj actual. «Cómo se detectó» contiene la confianza y evidencia de emisión; «Nosotros llamamos primero · Modo demostración» muestra los minutos con el rótulo explícito «hipótesis del equipo» incluso cuando el panel está cerrado (o «ejemplo ficticio» en esa fuente). El detalle destaca el promedio que originó la alerta y su referencia habitual, con la lectura puntual del minuto de emisión en pequeño; ambos quedan separados de la última lectura del periodo reproducido; su gráfica marca solo la alerta seleccionada y su referencia disponible. El calendario usa una línea de tiempo y las demás gráficas/tabla se abren en «Ver todas las métricas». Chart.js lee los colores semánticos de `styles.css`; la alerta se marca con guiones y el impacto con puntos. El [registro de la interfaz verde y azul](../docs/diseno/INTERFAZ_ALERTAS_VERDE_AZUL.md) documenta la decisión de América, capturas y pruebas.

## Abrir localmente

Desde la raíz del repositorio:

```sh
python3 -m http.server 8015 --bind 127.0.0.1 --directory web
```

Abre [http://127.0.0.1:8015](http://127.0.0.1:8015). Termina con `Ctrl+C`. Los módulos requieren HTTP; abrir el HTML como archivo no basta. Chart.js y sus licencias están incluidos en [vendor/](vendor/README.md); la ejecución no descarga bibliotecas.

El ejemplo ficticio permite reproducir, pausar, reiniciar, mover el reloj y elegir una ventana de 6 horas, 24 horas o toda la corrida transcurrida. Hay cinco gráficas y una tabla alternativa de lecturas. Un valor `null` sigue siendo ausencia de datos; cero conserva su significado.

Al abrir se intenta conectar con la API. Si en ese arranque automático falta la ruta de empresas o de corridas (404/405), se selecciona el ejemplo ficticio identificado como tal. Un error de servidor, de red o de tiempo límite mantiene la fuente servidor y muestra reintento. `?fuente=api` obliga a usar el servidor sin pasar al ejemplo; `?fuente=demo` abre expresamente el ejemplo. Elegir «Servidor» manualmente tampoco permite el cambio automático al ejemplo.

Durante un avance se conserva el último cuadro validado, indicando su hora mientras llega la respuesta. Cambiar de empresa, corrida o fuente, retroceder o recibir un error limpia los datos que ya no corresponden. Pausar una consulta pendiente vuelve el reloj al cuadro conservado. El indicador no desplaza los paneles y los botones de alertas conservan el foco.

## Empresa, conjuntos de datos y kits

«Opciones de reproducción» agrupa la fuente y la velocidad. Con la fuente «Servidor», «Conjunto de datos» reúne las corridas oficiales disponibles y las del kit abierto. Las subidas llevan «Su kit ·» en el nombre, visible también con el selector cerrado: «Su kit · Conjunto principal» o «Su kit · Conjunto 01». «Empresa» muestra solo las que contiene el conjunto elegido, incluidas las empresas nuevas aceptadas por el backend. Cada selección carga su propio rango, unidades, calendario, alertas y referencias. Una empresa sin calibración previa se identifica con la información del servidor; no se atribuyen sus datos ni su estado a gracko. El ejemplo ficticio sigue siendo únicamente de gracko.

«Subir kit» abre el formulario para elegir un **ZIP de hasta 80 MB**. «Abrir kit» lo envía como `multipart/form-data`, con un único archivo en el campo `archivo`, y muestra el progreso mientras el servidor lo revisa. La estructura y los límites del contenido están en [FORMATO_ALERTAS.md, sección 5](../docs/FORMATO_ALERTAS.md#5-api-web). Al terminar se abre la primera corrida del kit y se conserva la empresa elegida si está presente; si no, se selecciona gracko o la primera disponible. Las observaciones del servidor quedan consultables.

La dirección conserva `#kit=<id>`, donde `id` tiene **32 caracteres hexadecimales aleatorios (128 bits)**. «Enlace a este kit» permite volver a abrirlo o compartirlo; el backend no enumera los kits en las listas públicas de corridas. Al recargar ese enlace, la página recupera el resumen con `GET /api/kit/<id>`. Si el kit ya no está disponible, muestra el error y permite reintentar.

La subida es libre si el backend no configura una clave. Ante un 401, aparece «Clave de acceso»; se envía exclusivamente en `X-Zikit-Clave`. Una clave recibida por `#clave=…` se retira de la dirección con `history.replaceState` y se conserva en `sessionStorage` de esa pestaña (o solo en memoria si el almacenamiento no está disponible). El enlace compartible del kit no incluye la clave.

«Descargar alertas (CSV)» descarga las alertas de la **empresa elegida y la corrida completa**, aunque el reloj esté al principio. El rótulo lo indica: el CSV de entrega no está recortado al minuto reproducido. «Entrega · todas las empresas (CSV)» descarga el mismo periodo completo para todas las empresas presentes. Ambas opciones están disponibles con datos del servidor. Las hipótesis de impacto del kit oficial no se reutilizan en kits importados; su API de referencias devuelve `[]`, por lo que no se inventa una comparación de anticipación.

## «Nosotros llamamos primero»

El panel lleva el rótulo **«Modo demostración · impacto estimado»**. La comparación exige una referencia de la misma corrida, asociada a la alerta por identificador o por tipo canónico sin ambigüedad. Solo muestra su hora cuando el reloj alcanza el impacto. Las referencias ajenas, ausentes o ambiguas no permiten calcular anticipación. Una alerta tardía muestra el retraso, sin convertirlo en una ganancia.

El sonido es opcional y está apagado al abrir. Tras activarlo expresamente, emite dos tonos breves cuando un avance automático cruza una referencia disponible. Buscar un minuto, cargar datos, cambiar de fuente o seleccionar una alerta no hace sonar el teléfono. La página no hace llamadas reales ni ejecuta las acciones sugeridas.

La selección automática sigue las alertas nuevas y los impactos cruzados. Un impacto permanece seleccionado hasta el siguiente evento que cambie el contexto. Pulsar una alerta fija esa elección; «Seguir la última alerta» devuelve el seguimiento automático. Antes de observar un impacto se indica esa situación sin afirmar que una referencia futura no existe. Retroceder habilita nuevamente el sonido de los impactos posteriores, sin hacerlo sonar durante el salto.

El ejemplo local se genera en [data.mjs](data.mjs), sin leer el dataset. Todas sus métricas, alertas, evidencias e impactos son **ficticios**; no representan resultados del detector. Los eventos de negocio parten del contexto conocido de gracko. El respaldo usa 60 minutos supuestos, como el calendario del backend; no es una duración medida.

## Organización

| Archivo                    | Responsabilidad                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `index.html`, `styles.css` | Estructura, presentación adaptable, controles y estados accesibles.                        |
| `app.mjs`                  | Selección de empresa/corrida, formulario de kit, reloj, cancelación, alertas y sonido opcional. |
| `charts.mjs`               | Gráficas, ventanas de calendario, huecos, alertas y referencias observadas.                |
| `data.mjs`                 | Fuentes demo/API, aislamiento por empresa, validación, kits, enlaces CSV y recorte de datos futuros. |
| `presentation.mjs`         | Evidencia según su familia y asociación de referencias sin mezclar corridas.               |

Las fuentes implementan:

- `load({signal})` → `{runs}`.
- `loadRun({run, signal})` → `{range:{start,end}, units:{errores:"errores/min"}, calendarInfo:{source,warnings}}`.
- `read({run, from, until, signal})` → series, alertas, calendario, apagones, métricas, estado, `references`, `referenceStatus` y `calendarInfo`.

`ApiSource({tenant})` mantiene una empresa fija durante toda su vida; cambiarla crea otra fuente para no reutilizar metadatos ajenos. `loadCompanies({run})` consulta las empresas de una corrida; sin `run`, consulta las oficiales. `uploadKit({file, key, signal, timeoutMs})` y `loadKit({id, signal, timeoutMs})` devuelven `{id, runs, companies, companiesByRun, warnings, ignored}`. `companiesByRun` conserva las empresas de cada corrida, sin filtrar por gracko. `deliveryUrl(run, {tenant})` construye la descarga de esa empresa; sin `tenant`, construye la entrega de todas las empresas, disponible en el backend.

La evidencia conserva hora del pico, lectura al emitir la alerta, ventana del promedio (`ventana_min`), desviación, saturación, errores de 60 minutos y número de registros. El valor de la evidencia es una foto del minuto de la alerta; no se presenta como lectura del reloj actual. Una tendencia expresada en desviaciones no se presenta como porcentaje; el total de errores de 60 minutos no se presenta como errores/min. La confianza sigue siendo un índice provisional, sin afirmaciones de probabilidad o gravedad.

## Contrato con la API

La fuente «Servidor» consulta el mismo origen. El servidor estático anterior no implementa `/api`: elegir esa fuente allí muestra un error. Solo la ausencia de rutas durante el arranque automático permite el ejemplo, como se describe arriba; los fallos de datos reales no lo sustituyen.

| Ruta                                              | Uso                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/empresas[?corrida=…]`                   | Sin corrida: empresas oficiales. Con corrida: las presentes en ese conjunto, incluidas las importadas. Devuelve `[{tenant, giro, calibrada?}]`. |
| `GET /api/{tenant}/corridas`                      | Corridas oficiales disponibles para la empresa; no enumera kits subidos. |
| `GET /api/{tenant}/rango?corrida=…`                | Implementada en #25: devuelve `tenant`, `corrida`, `inicio`, `fin`, `unidades.errores="errores/min"`, `calendario_fuente` y `avisos`. |
| `GET /api/{tenant}/serie?corrida=…&desde=…&hasta=…` | Serie, apagones, calendario, `calendario_fuente` y `avisos` de esa empresa/corrida. No se reutiliza la agenda raíz. |
| `GET /api/{tenant}/alertas?corrida=…&hasta=…`       | Avisos y evidencia observable de la empresa seleccionada. |
| `GET /api/{tenant}/estado?corrida=…&hasta=…`        | Estado textual si está disponible. |
| `GET /api/{tenant}/referencias?corrida=…&hasta=…`   | Implementada en #25: lista con `id`, `tenant`, `corrida`, `tipo`, `tipo_alerta`, `timestamp`, `fuente`, `descripcion` y `alerta_id`. La API enlaza la primera alerta del tipo declarado dentro de su ventana; sin coincidencia, entrega `null`. Para kits importados devuelve `[]`. |
| `POST /api/kit`                                  | ZIP en `multipart/form-data`, campo `archivo`; cabecera `X-Zikit-Clave` solo si corresponde. Devuelve `id`, `corridas`, `empresas`, `empresas_por_corrida`, `avisos` e `ignorados`. |
| `GET /api/kit/{id}`                               | Recupera el mismo resumen mediante el identificador del enlace; 404 si el kit ya no existe. |
| `GET /api/{tenant}/alertas.csv?corrida=…`           | Descarga de la empresa elegida: `tenant,timestamp,confianza,tipo`, de toda la corrida, sin recorte por `hasta`. |
| `GET /api/entrega.csv?corrida=…`                   | Entrega de todas las empresas presentes en la corrida; el enlace principal de la interfaz usa la descarga por empresa. |

Las fechas deben tener `YYYY-MM-DDTHH:mm:ss`, sin zona; los extremos del rango son minutos completos. Se usa un eje UTC lógico para evitar conversiones del navegador; no se afirma que la zona del dataset sea UTC. La interfaz no usa la semana fija de la demo como respaldo para el servidor.

Las referencias antiguas sin corrida no se asocian; tampoco las de otra empresa o corrida. Las identidades declaradas en rango, serie, alertas y estado se validan contra la selección. Si falla solo la consulta opcional de referencias, las lecturas siguen visibles y la comparación informa su ausencia. El rango y las unidades son obligatorios: sin ellos el reloj queda desactivado y se ofrece reintento.

Las consultas normales y la recuperación del resumen de un kit tienen un límite de **10 segundos**, incluida la lectura del cuerpo JSON. Consultar datos de un conjunto importado permite **60 segundos** para su primer análisis; «Kit recibido · Analizando los datos…» pasa a «Kit listo» cuando llega el primer cuadro, o a un error recuperable si falla. La subida desde la interfaz permite **180 segundos** para cubrir la cola y la revisión del servidor. Se distingue el tiempo agotado de una cancelación voluntaria; el primero muestra error y reintento cuando afecta a un dato obligatorio. El timeout de referencias opcionales conserva las métricas y advierte de la comparación no disponible. Los errores de kit conservan el estado HTTP y muestran `detail` como texto acotado, sin interpretar HTML. `alerta_id:null` significa que no hay enlace y no permite inferirlo por tipo.

El PR #25 entrega el rango y errores/min esperados. Con `ae7ea8d` pasaron 28 comprobaciones de navegador entre `corrida_01` y una copia temporal desplazada siete días: reloj, alertas, impacto, retroceso y ausencia de referencias en la otra semana. La asociación corregida se comprobó además con varias alertas sintéticas y los consumidores reales del frontend. El ajuste posterior `ab6df80` corrige el caso de negación durante un evento y pasa 51 pruebas de backend. Ver [registro de avance](../docs/diseno/AVANCE_INTERFAZ.md).

### Origen y advertencias de la agenda

`calendario_fuente` y `avisos` se normalizan como `calendarInfo:{source,warnings}`. La pantalla distingue agenda de la corrida, agenda de respaldo, origen no informado y ejemplo ilustrativo. El respaldo se advierte incluso si no trae mensajes adicionales. Los mensajes se insertan como texto, sin interpretar HTML.

Los datos de `/serie` reemplazan los de `/rango` cuando están presentes; si faltan, se conserva la información de rango de la misma corrida. `avisos:[]` limpia la lista. Cambiar de corrida o fuente elimina la agenda anterior antes de cargar; un error de lecturas conserva solo la información ya validada de la corrida actual. Los avisos no se vuelven a anunciar cada minuto si no cambian.

## Comprobación

Con Node.js 20 o superior:

```sh
npm test
npm ci --ignore-scripts
BROWSER_CHANNEL=chrome npm run test:browser
```

Las pruebas de navegador necesitan Google Chrome instalado o Chromium de Playwright (`npx playwright install chromium`, sin `BROWSER_CHANNEL`). El runner inicia y cierra su propio servidor. `PLAYWRIGHT_MODULE` permite usar una instalación existente; `SCREENSHOT_DIR=/tmp/zikit-qa` guarda capturas.

Se verifican rangos en otras semanas, cambios rápidos de corrida, reintento de rango ausente, referencias erróneas, evidencia con datos nulos, reproducción, teclado, errores y pantallas entre 320 y 1440 px. El audio se comprueba sustituyendo `AudioContext`: cuenta los tonos programados y los momentos permitidos; no evalúa volumen percibido en los altavoces.

Los antecedentes y sus límites quedan en [AVANCE_INTERFAZ.md](../docs/diseno/AVANCE_INTERFAZ.md); los resultados de kits y empresas, en [su registro de entrega](../docs/diseno/KITS_EMPRESAS_CSV.md). **Las respuestas simuladas prueban la interfaz; no demuestran precisión, causalidad del detector, falsas alarmas ni anticipación real.** Se hizo una comprobación real del recorrido básico antes de integrar #24. Las correcciones posteriores a la revisión de Claude sobre #26 y sus comprobaciones se registran en [CLARIDAD_ALERTAS.md](../docs/diseno/CLARIDAD_ALERTAS.md); rodricksito / Claude Code las revisó y se integraron en `main` con el PR #31.

Capturas del ejemplo ficticio con el pulido: [escritorio](../docs/diseno/impeccable/despues-escritorio.png) y [móvil](../docs/diseno/impeccable/despues-movil.png). Las capturas previas y los [bocetos iniciales](../docs/diseno/README.md) se conservan como antecedente.
