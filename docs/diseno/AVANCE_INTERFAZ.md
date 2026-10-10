# Registro de trabajo de América / Codex

**Pulido posterior con Impeccable (10 de octubre):** #23, #25 y #24 quedaron integrados en `main` (`4edd258`). A partir de esa base, la rama `codex/5-pulido-impeccable` acerca alertas/evidencia/acción, mejora legibilidad y comparte los colores con Chart.js. Pasan 54 pruebas unitarias, 23 de navegador y una comprobación visual final. Capturas, decisiones, límites y siguiente revisión en [PULIDO_IMPECCABLE.md](PULIDO_IMPECCABLE.md). El pulido se revisó e integró después con el PR #26 (`11f3693`). El resto de este archivo conserva el historial de #24: sus «pendiente» y «no integrada todavía» describen ese momento.

Fecha: 10 de octubre de 2026. Tarea: #5. Rama: `codex/5-reloj-impacto`.

**Actualización tras revisión cruzada:** Claude solicitó seis ajustes P2. Se implementaron y comprobaron, junto con la ausencia explícita de enlace y el rótulo temporal de la evidencia. Resultado actual: **54 pruebas unitarias, 23 de navegador y 56 de backend pasan**. El [seguimiento de la revisión](REVISION_CLAUDE_PR24.md) detalla cambios, comprobaciones y observaciones P3 pendientes. La revisión de Claude de los commits corregidos sigue siendo condición de integración; los apartados posteriores conservan también el historial anterior.

## Punto de partida

La interfaz del PR #11 está integrada en `main`, commit `8f6802a`, y guardada como `v1-demo-segura`. El equipo eligió el camino C en #20. América pidió continuar con su frente y documentar el trabajo, sin detenerse a pedir confirmaciones rutinarias.

## Cambios implementados

1. Se separó la lista de corridas de la carga de sus fechas. El modo servidor no debe reutilizar la semana fija del ejemplo ficticio.
2. Se usan referencias de impacto asociadas explícitamente a la corrida y al aviso. Una referencia de otra semana no permite calcular anticipación.
3. Se conservan los campos de evidencia que incorporó la API: hora del pico, lectura actual, desviación, saturación, errores y registros.
4. Se preparó «Nosotros llamamos primero», con fuente, límites de la comparación y rótulo «modo demostración · impacto estimado».
5. Se comprobaron cambios de corrida, retroceso, cancelaciones, estados vacíos, errores y vista móvil; los resultados aparecen abajo.
6. La agenda muestra su origen y las advertencias de la API; el respaldo manual se advierte incluso sin mensajes adicionales.

## Coordinación y límites

- Rodricksito es responsable de `backend/` y de #22. El PR #25 ya entrega **errores/min**; nuestra etiqueta conserva esa unidad.
- Al comenzar esta rama no existía el contrato por corrida. Ahora está implementado en el PR #25; se comprobó inicialmente el recorrido básico con `4bcb92e` y nuestra interfaz `f1b9a02`. `ae7ea8d` corrige el enlace entre impacto y tipo de alerta; `ab6df80` añade la corrección final de negaciones durante eventos y pasa 51 pruebas de backend.
- Contrato implementado en #25: `GET /api/gracko/rango?corrida=…` → `{tenant, corrida, inicio, fin, unidades:{errores:"errores/min"}}`. La integración final sigue pendiente de los hallazgos de revisión.
- Las referencias requieren `corrida`, `id`, `timestamp`, `fuente`, `descripcion` y un enlace por `alerta_id` o por tipo canónico sin ambigüedad. Las hipótesis anteriores sin corrida no se trasladan automáticamente.
- La versión segura permanece disponible en su etiqueta. Este trabajo va en un PR nuevo para revisión cruzada de Claude; Codex revisará fechas, unidades y formatos del cambio de API.
- Las pruebas con respuestas simuladas comprueban la interfaz; no demuestran la precisión ni la causalidad del detector.

## Investigación paralela

Un agente consultó skills útiles para cada integrante. El resultado está en [SKILLS_EQUIPO.md](SKILLS_EQUIPO.md), con fuentes y requisitos. Con la autorización posterior de América se instaló la skill oficial Playwright en su Codex local, fijada a una versión del repositorio oficial. No se modificaron las herramientas de otras personas. El CLI de la skill no se ejecutó; las pruebas de este proyecto usan la biblioteca Playwright existente.

## Evidencia y resultado

- `npm test`: **43/43 pruebas pasan** (27 del adaptador y 16 de presentación).
- `PLAYWRIGHT_MODULE=<runtime de Codex>/node_modules/playwright BROWSER_CHANNEL=chrome SCREENSHOT_DIR=docs/diseno npm run test:browser`: **17/17 pruebas pasan** en Chrome; el runner cierra su servidor al terminar.
- Revisión visual de capturas de escritorio y móvil; comprobación de distribución entre 320 y 1440 px, sin desbordamiento de página.
- `git diff --check`: sin errores de espacios.
- Sonido apagado por defecto y activación explícita. Las pruebas sustituyen `AudioContext` y verifican dos tonos solo al cruzar una referencia durante reproducción; no verifican la calidad acústica de los altavoces.
- Revisión independiente del frontend detectó y permitió corregir dos bordes: una evidencia con `hora:null` no debe borrar toda la vista, y una respuesta tardía de un salto manual no debe sonar aunque se haya pulsado Reproducir mientras llegaba. Ambos tienen regresiones.
- Una referencia sin enlace explícito no se asigna a varias alertas observadas del mismo tipo. No se muestran minutos de anticipación cuando la asociación es ambigua.
- FastAPI `ae7ea8d` con frontend `a9a7937`: **28/28 comprobaciones en Chrome** entre `corrida_01` y una copia temporal desplazada siete días. En la primera, tres referencias enlazan tipos correctos; el impacto se oculta al retroceder. En la segunda, el reloj usa el 15–21 de octubre y no presenta impacto ni anticipación porque `/referencias` devuelve `[]`. Se observaron 70 respuestas API sin errores HTTP de API, solicitudes fallidas ni excepciones JavaScript; solo un 404 de favicon por sesión. Ambos servidores se apagaron al terminar.
- La semana alternativa usa 9,200 filas de métricas y los logs/contexto permitidos, copiados fuera del repositorio y desplazados siete días. Es una prueba de adaptación de fechas, no el dataset desconocido de evaluación ni un recorrido de las 55 corridas. Los 2,168 minutos del primer caso están rotulados como hipótesis, no como medición oficial.

## Avisos del calendario

- El adaptador conserva `calendario_fuente` y `avisos` de rango y serie, con copias independientes por corrida.
- La pantalla muestra agenda de respaldo, advertencias de la agenda o procedencia no informada sin atribuir datos a una ficha que no fue leída.
- Cambiar de corrida/fuente elimina los mensajes anteriores. Una lectura fallida conserva solo el calendario ya validado de la corrida actual. `avisos:[]` permite limpiar las advertencias.
- Las advertencias se muestran como texto; se comprobó HTML literal y ausencia de ejecución. La región accesible no se anuncia nuevamente cada minuto si no cambió.
- Se añadieron cuatro casos de datos y tres de navegador. La vista móvil de las advertencias se inspeccionó sin desbordamiento.
- Una prueba adicional con FastAPI real y una copia temporal sin `contexto.md` mostró «Agenda de respaldo» y el aviso correspondiente. Las cinco métricas siguieron visibles; cambiar a demo limpió el aviso y regresar a servidor lo restauró. Se observaron 16 respuestas API 200, sin errores JavaScript ni solicitudes fallidas. Dataset original intacto; servidor temporal apagado al terminar.

## Qué falta para integrar

1. Nueva revisión de Claude de #24 después de atender sus seis P2; el detalle está en [REVISION_CLAUDE_PR24.md](REVISION_CLAUDE_PR24.md). El orden coordinado sigue siendo #23 → #25 → #24.
2. Rodricksito coordina la unión y comprueba el conjunto resultante. La nueva API `a33c722` pasó 56 pruebas y se comprobó el inicio/recorrido básico de raíz con la interfaz corregida; las pruebas de navegador cubren los cambios de reproducción y errores con respuestas controladas.
3. Arturo valida las cifras que se usen en el pitch; la comprobación de interfaz no las convierte en mediciones oficiales.

## Revisión de trabajo de Rodricksito

La [revisión inicial de #23](REVISION_PR23.md) fue publicada con autorización de América. Sus cuatro hallazgos fueron corregidos en `97b36b0`.

La [segunda revisión de #23 y revisión de #25](REVISION_PR23_PR25.md) encontró una regresión al clasificar mensajes con «liberó» y una asociación incorrecta de impacto con alertas ajenas. Con autorización «hazlo todo», se publicaron los resultados:

- [Seguimiento de #23](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6094997550).
- [Revisión de #25](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6094997726).

Se ejecutaron las **38 pruebas del backend #25** y un recorrido real en Chrome con `corrida_01`, sin errores de API ni excepciones JavaScript. Los dos casos adicionales fallan aunque la suite existente pase; no se aprobó la integración de esos commits. Los detalles y límites están en el informe.

Al recibir las correcciones, se volvió a revisar el código y ejecutar la suite: **50/50 pasan en `ae7ea8d`**. Se publicó el cierre del [P2 de asociación en #25](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6095071630) y la [corrección del P1 con el caso nuevo de calendario en #23](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6095076123). Una reproducción totalmente sintética con el detector real confirma que una liberación negada puede enseñar un recurso al calendario y ocultar el siguiente aviso. No se modificó el backend ajeno ni se integró ningún PR.

La corrección final de Rodricksito `109ff0e` en #23, incluida en #25 `ab6df80`, trata la negación como falla antes de cerrar, aprender o suprimir. La regresión nueva comprueba el evento activo, el aprendizaje vacío y el aviso posterior. La suite final ejecutada en esta Mac da **51 passed, sin omitidas, en 12.35 s**. Los hallazgos descritos arriba quedan como historial de revisión, no como pendientes de esa versión.

Cierres publicados: [#23](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6095148556) y [#25](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6095148728). [Solicitud de revisión de #24](https://github.com/rodricksito/zikit-road2tech-2026/pull/24#issuecomment-6095132175). La interfaz está lista para revisión, no integrada todavía.
