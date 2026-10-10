# Claridad de alertas y navegación

Fecha: 2026-10-10. Frente: América / Codex, tarea #5.

## Estado

**Integrada en `main` con el PR #31 (`37a1dec`), después de la revisión cruzada de rodricksito / Claude Code.** La rama `codex/5-claridad-alertas` parte de `main` después de integrar los PR #26 y #29. Incluye los seis cambios de claridad pedidos por América y las correcciones de interfaz señaladas por Claude en la revisión posterior de #26.

Se mantiene el diseño verde y azul. Los cambios afectan la presentación y la consulta de datos; no modifican las reglas del detector, las alertas emitidas ni el contrato de la API.

## Los seis cambios

| Cambio | Resultado para quien usa la página |
| --- | --- |
| Separar emisión y reproducción | El detalle destaca el promedio que originó la alerta y su referencia habitual, conserva la hora real de esa evidencia y muestra aparte la lectura puntual de emisión, si la fuente la entrega. La gráfica identifica la hora de la última lectura de la reproducción. |
| Resumir las alertas en lenguaje claro | La lista y el detalle presentan una señal comprensible, su valor y la referencia habitual cuando existen. El resumen original, `σ`, evidencia, puntajes y registros quedan en «Cómo se detectó». |
| Aclarar nombres de controles | «Conjunto principal», «Conjunto 01», «Volver al inicio», «Periodo de la gráfica» y «Descargar alertas (CSV)» reemplazan nombres internos o ambiguos. |
| Hacer explícita la reproducción | «Revisar datos en el tiempo» conserva la fecha visible. Fuente y velocidad se agrupan en «Opciones de reproducción». |
| Identificar la alerta seleccionada | «Revisando alerta del…» muestra la fecha del aviso abierto. «Seguir la última alerta» permite volver al seguimiento después de elegir una anterior. |
| Facilitar la lectura de acciones | «Qué puedes revisar» presenta los pasos sugeridos en una lista, conservando el significado y las precauciones de la fuente. |

### Por qué pueden verse dos valores distintos

Una alerta emitida el 10 de octubre puede registrar **64.6 %** de disco, mientras la reproducción del 11 de octubre muestra **76.6 %**. Corresponden a momentos distintos. El valor de la gráfica no reemplaza la evidencia guardada de la alerta.

Un promedio de **64.4 % en 15 minutos** tampoco equivale a una lectura puntual ni demuestra que cada minuto estuvo por encima de lo normal. La interfaz destaca ese promedio y su referencia habitual; presenta la lectura puntual en pequeño. Si la evidencia corresponde a una ventana anterior, conserva su fecha real. Sin un promedio válido no fabrica uno. Si no llega una lectura puntual explícita de la emisión, muestra «Lectura puntual al emitir: no disponible».

## Correcciones de la revisión de #26

- La gráfica del detalle marca únicamente la alerta seleccionada y su referencia de impacto disponible. Las gráficas generales pueden mostrar los demás avisos. Ningún marcador debe anticipar el minuto reproducido.
- El desplegable de comparación se identifica como **«Nosotros llamamos primero · Modo demostración»**, de modo que su propósito y carácter ilustrativo sean visibles antes de abrirlo. Cuando el reloj alcanza una referencia válida, el resumen también muestra los minutos de anticipación estimada aun cerrado. Retroceder antes de esa referencia los oculta y borra.
- Se usan **«Rendimiento del servicio»** y **«Disco»** sin asumir que todas las empresas tienen el mismo ERP o un volumen llamado `/data`.
- La descarga individual se acompaña de **«Entrega · todas las empresas (CSV)»**. Ambas corresponden al conjunto de datos elegido y a su periodo completo; no al recorte temporal visible de la reproducción.
- Las consultas de conjuntos de kits subidos disponen de **60 segundos** para su análisis inicial. Las consultas normales conservan 10 segundos y los plazos configurados explícitamente siguen teniendo prioridad. La cancelación continúa disponible y el mensaje indica que el kit está siendo analizado; no se anuncia listo antes de cargar sus datos.

## Correcciones de la revisión de #31

Revisión de rodricksito / Claude Code sobre `bf38494`, combinada con `main` `ac77cc3`: [comentario](https://github.com/rodricksito/zikit-road2tech-2026/pull/31#issuecomment-6101429624). Confirma los cinco P2 anteriores y solicita estos ajustes:

- **Identidad del kit:** «Su kit · Conjunto principal» y «Su kit · Conjunto 01» se distinguen de las corridas oficiales con el selector cerrado. Los identificadores de consulta y de descarga se mantienen.
- **Dato principal de la alerta:** en el caso de rendimiento del 13 oct a las 20:15, destaca **81.7 ms de promedio en 15 min**, junto a **38 ms habituales**. La lectura puntual de **37 ms** queda debajo y en pequeño; un minuto normal no contradice un promedio elevado. Promedio, hora de la evidencia y lectura de reproducción permanecen separados.
- **Cifra del pitch:** los minutos visibles con el panel cerrado llevan «hipótesis del equipo», o «ejemplo ficticio» al consultar esa fuente. La referencia debe haber ocurrido dentro del tiempo reproducido para mostrarse.

Los P3 restantes (contexto de calendario en el resumen, leyendas condicionales y mensajes de estado del kit) quedan para después del congelamiento, como propone la revisión. Claude sincroniza la guía de backend/despliegue en #32. Esta entrega actualiza únicamente los archivos de interfaz, sus pruebas y este registro.

## Recorrido breve para América

1. Elige la empresa y el conjunto de datos; abre «Subir kit» si vas a consultar otro archivo.
2. Usa «Reproducir» o mueve la barra para elegir la hora. «Volver al inicio» devuelve la reproducción al comienzo del conjunto.
3. Selecciona una alerta y compara su hora de emisión con la hora que indica la gráfica. La selección manual se conserva mientras ese aviso siga disponible en la reproducción.
4. Lee «Qué puedes revisar». Abre «Cómo se detectó» solo cuando necesites el detalle técnico.
5. Pulsa «Seguir la última alerta» para retomar el seguimiento de nuevos avisos. Usa la descarga de empresa o la entrega completa según el alcance que necesites.

Las acciones son sugerencias: la página no ejecuta correcciones ni declara resuelta una alerta. La comparación de impacto es una **hipótesis del equipo**, no una llamada real ni una medición oficial. No se inventa anticipación cuando falta una referencia válida.

## Comprobación y límites

- Pruebas unitarias: **100/100 aprobadas**, incluidas separación temporal, formatos de evidencia, marcadores, plazos y cancelación.
- Suite de navegador: **37/37 recorridos aprobados**. Comprueban selección y seguimiento de alertas, separación entre promedio, lectura puntual y reproducción (incluido 81.7/38/37 ms y evidencia de una ventana anterior), marcadores sin futuro ni cruces entre alertas, descarga por empresa y total, carga/reintento de kits, teclado y ausencia de desbordamiento entre 320 y 1440 px.
- Vista local revisada con el backend real en `http://127.0.0.1:8015/`, escritorio de 1440 px y móvil de 390 px. Evidencia temporal: `/tmp/zikit-claridad/r31-desktop.png` y `/tmp/zikit-claridad/r31-mobile.png`. Estas capturas no forman parte de los archivos versionados.

La verificación de interfaz no mide la precisión global del detector ni sustituye la revisión cruzada de rodricksito / Claude Code. La integración y el despliegue quedan pendientes de esa revisión. No se abrieron archivos restringidos del dataset.
