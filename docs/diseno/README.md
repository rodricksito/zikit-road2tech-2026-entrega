# Bocetos iniciales de alerta y línea de tiempo

Fecha: 9 de octubre de 2026. Tarea: [#5 — América / Codex](https://github.com/rodricksito/zikit-road2tech-2026/issues/5).

**Antecedente: propuesta visual de cuatro empresas.** Estos bocetos exploran cómo explicar una alerta y su evidencia, sin implementar una aplicación ni un detector. El destinatario provisional era una persona de soporte que atiende varias empresas; esa definición sigue sujeta a revisión con América y el equipo.

El desarrollo actual se concentra en **gracko**, en [web/](../../web/README.md), tras la autorización de América en el chat para construir su interfaz con HTML, CSS, JavaScript y Chart.js. Esa interfaz se integró después con el backend en `main`; ver [web/README.md](../../web/README.md). Los escenarios, imágenes y preguntas de este documento corresponden a los bocetos anteriores y se conservan como referencia.

Todos los valores, curvas, alertas, mensajes de evidencia y horas de impacto de los bocetos son **FICTICIOS**. Los giros, horarios y eventos de negocio proceden de los cuatro `contexto.md` citados más abajo. Un evento del calendario da contexto; por sí solo no prueba que el sistema esté sano.

## Cómo revisar la propuesta

Abre [bocetos.html](bocetos.html) en un navegador. Es un documento visual de revisión, sin framework, detector, backend ni datos reales. Las imágenes permiten revisar las tres vistas sin abrir el documento:

1. [Tarjeta de alerta](alerta.png): identificar la empresa, la hora, el índice de confianza, el tipo probable y la razón de la alerta.
2. [Línea de tiempo](linea-tiempo.png): contrastar las métricas, los eventos de negocio, las alertas y los periodos sin datos.
3. [Vista de demo](demo.png): explicar una comparación retrospectiva con el momento de impacto, cuando exista una referencia válida.

El recorrido propuesto es **alerta → evidencia y línea de tiempo → demo retrospectiva**. Primero entendemos por qué se avisa; después revisamos si los datos respaldan la señal y cómo encaja en el negocio. Finalmente comparamos el aviso con el impacto, sin usar ese conocimiento futuro para justificar la alerta original.

## Qué aprendimos de las cuatro empresas

Fuentes: únicamente `data/<tenant>/contexto.md` del kit público, fijadas al commit `cdea481cb61a8d6e6a3514418b8da8136198c0ae`. El dataset está fuera de este repositorio. Para este trabajo no se leyeron CSV, `_solucion` ni `scripts/generar.py`.

| Empresa | Negocio y operación | Sistemas y contexto que conviene mostrar |
| --- | --- | --- |
| [gracko](https://github.com/brunovillarrrrrr/zikit-dataset/blob/cdea481cb61a8d6e6a3514418b8da8136198c0ae/data/gracko/contexto.md) | Despacho contable y fiscal; 12 personas. Lunes a viernes 08:00–18:00; sábados 09:00–13:00. | Archivos `/data`, ERP contable y firewall/VPN. Respaldo diario a las 23:00, sin duración indicada. Carga masiva el viernes 9, 17:00–19:30; cierre de nómina el lunes 12, 10:00–14:00. El contexto identifica falta de alerta de capacidad en `/data`; esto no confirma un incidente. |
| [gramo](https://github.com/brunovillarrrrrr/zikit-dataset/blob/cdea481cb61a8d6e6a3514418b8da8136198c0ae/data/gramo/contexto.md) | Distribuidora de alimentos; 25 personas. Lunes a sábado 07:00–16:00; pedidos en línea 24/7. | API y worker de pedidos, inventario, portal y firewall. Promoción 2×1 el viernes 9, 10:00–12:00; snapshot de inventario los sábados 03:00–04:30; picos habituales de pedidos a las 07:30 y 13:00. |
| [kaiku](https://github.com/brunovillarrrrrr/zikit-dataset/blob/cdea481cb61a8d6e6a3514418b8da8136198c0ae/data/kaiku/contexto.md) | Tienda de café y accesorios; 18 personas. Tienda 24/7 y soporte de lunes a sábado 09:00–19:00. | Base de datos de pedidos e inventario, tienda y firewall/WAF. Campaña de correo el viernes 9 a las 12:00, con pico esperado de unas 2 h; reindexado los domingos 04:00, unos 90 min; respaldo diario 03:00, 30 min. La ausencia de límite de conexiones por cliente en checkout es un riesgo documentado, no una causa confirmada. |
| [ttr](https://github.com/brunovillarrrrrr/zikit-dataset/blob/cdea481cb61a8d6e6a3514418b8da8136198c0ae/data/ttr/contexto.md) | Logística de última milla; 40 personas. Lunes a sábado 06:00–20:00; planeación de rutas 06:00–08:00. | TMS/optimizador comparte servidor con rastreo GPS de 32 unidades; también hay VPN y aplicación móvil. Mantenimiento de red el sábado 10, 22:00–23:00. La ventana de planeación ayuda a entender una carga esperada. |

Los cuatro contextos describen CPU, RAM, disco, latencia y errores por minuto. La unidad y el significado exactos de cada campo que llegue a la interfaz deben confirmarse en P05; el texto del contexto no sustituye al contrato de datos.

## Qué debe comunicar cada vista

### 1. Tarjeta: entender el aviso y encontrar la evidencia

La jerarquía empieza por empresa, estado y hora. Después muestra el tipo probable, una frase concreta que explique la señal y la confianza como **índice de 0 a 1**. La acción siguiente es revisar la evidencia.

El índice de confianza no se presenta como probabilidad de falla ni como gravedad. Por ejemplo, `0.70` no significa «70 % de que falle» ni «impacto medio». La propuesta P05 menciona niveles baja/media/alta, pero aún hay que precisar su interpretación y sus límites. El boceto no los convierte en criterios aprobados.

El tipo es probable: no equivale a causa raíz. La interfaz debe conservar la explicación recibida y permitir contrastarla con las métricas y logs. No debe inventar una reparación, afirmar que el problema se resolvió ni ejecutar acciones operativas desde este boceto.

### 2. Línea de tiempo: contrastar la señal con el negocio

Cada empresa conserva su propio contexto. La gráfica sigue la señal principal del ejemplo: RAM para gramo y ttr, disco para gracko y latencia para kaiku. Las series, alertas, ventanas del calendario y periodos sin datos se distinguen mediante texto, marcas y estilos; el color no es la única pista.

- **Ventana del calendario:** explica una carga o intervención prevista. Puede coexistir con una alerta si hay evidencia que la justifique; no cancela cualquier señal de forma automática.
- **Observación sin alerta:** debe explicar qué se observó y por qué no se emitió un aviso. No se puede deducir esa decisión únicamente de la existencia de un evento programado.
- **Sin datos:** un tramo vacío se representa como ausencia de observaciones, sin sustituirlo por cero, interpolar una línea continua ni llamarlo «normal» o «falla» sin más evidencia.
- **Evidencia de una alerta:** debe corresponder a información disponible hasta la hora del aviso. La vista retrospectiva puede mostrar lo ocurrido después, pero debe distinguirlo de lo que el detector conocía entonces.

Esto permite examinar un posible señuelo —por ejemplo, una campaña o un cierre de nómina— sin afirmar que es inocuo solo porque aparece en `contexto.md`.

### 3. Demo: mostrar la anticipación con una referencia explícita

La vista inicial usa gramo, con **alerta a las 10:20** e **impacto o llamada hipotética a las 11:00**. La diferencia de **40 minutos es ilustrativa**, no una medición del detector ni un resultado obtenido del kit. El selector de empresa cambia el escenario:

| Empresa | Ventana de negocio documentada | Alerta ficticia | Impacto o llamada hipotética |
| --- | --- | --- | --- |
| gramo | 9 de octubre, promoción 10:00–12:00 | 10:20 | 11:00 |
| gracko | 12 de octubre, nómina 10:00–14:00 | 10:20 | 11:00 |
| kaiku | 9 de octubre, campaña desde las 12:00, con pico esperado de unas 2 h | 12:20 | 13:00 |
| ttr | 10 de octubre, mantenimiento 22:00–23:00 | 22:20 | 23:00 |

En cada ejemplo se plantea una observación inicial sin evidencia adicional de anomalía, un hueco ficticio entre los minutos 08 y 10 de esa hora y una señal adicional ficticia al minuto 20. La gráfica se interrumpe entre la última lectura al minuto 07 y la siguiente al minuto 11, sin inventar valores intermedios. La observación y la decisión de no alertar también son parte del ejemplo; no se obtuvieron ejecutando un detector. Esto permite revisar cómo una ventana prevista, la ausencia de datos y una alerta pueden convivir. No implica que esos incidentes hayan ocurrido durante los eventos documentados.

En una demo evaluable, la comparación necesita una definición acordada de impacto, una fuente autorizada y una relación comprobable con la alerta. Una llamada del cliente y el inicio del impacto no son necesariamente el mismo instante; se debe indicar cuál se está usando. Sin esa referencia validada, la vista debe decir **«No disponible»**, con la explicación «Anticipación pendiente de validar», y no calcular una ganancia real.

El impacto pertenece a la evaluación retrospectiva. Nunca debe incluirse como evidencia que el detector supuestamente conocía al emitir la alerta.

## Relación con P05 y preguntas para acordar

Referencia: [FORMATO_ALERTAS.md](../FORMATO_ALERTAS.md), propuesta de rodricksito / Claude Code revisada sobre la base del proyecto `aef05c8`. Los campos mínimos del mentor son `tenant`, `timestamp` y `confianza`, con `tipo` opcional. La explicación y las series son datos adicionales propuestos para comprender el aviso.

| Pendiente | Pregunta concreta | Efecto en la interfaz |
| --- | --- | --- |
| Identidad de la alerta | `explicaciones.json` pide el mismo `id` que la fila de `alertas.csv`, pero el CSV propuesto no incluye `id`. ¿Se agrega un campo o se define una clave estable y única? | Abrir la explicación y asociar actualizaciones sin confundir dos alertas del mismo minuto. |
| Confianza | ¿Qué representa el índice, cómo se calcula y qué intervalos completos definen baja/media/alta? ¿Cómo se muestran valores fuera de rango o ausentes? | Evitar que una cifra o una etiqueta sugieran probabilidad o gravedad no justificadas. |
| Métricas y unidades | ¿CPU, RAM y disco son porcentajes? ¿`errores` es un conteo por minuto? ¿Qué unidad y referencia acompaña a cada evidencia? | Rotular ejes, valores y comparaciones de forma correcta. |
| Datos de la línea de tiempo | ¿Las series de mediana de 5 min usan solo datos pasados o una ventana centrada? ¿Cómo se indican datos parciales, huecos y cobertura? | No representar un suavizado con datos futuros como evidencia disponible al emitir la alerta. |
| Observaciones sin alerta | ¿Qué registro devuelve el detector para explicar por qué no alertó, con hora, observación y motivo? `calendario_descartado` vive dentro de una alerta; puede no existir una alerta a la cual adjuntar el evento descartado. | Mostrar una razón real para no avisar, sin inventarla a partir del calendario. |
| Calendario y evidencia simultánea | ¿Cómo se representa una ventana esperada cuando también hay evidencia de una anomalía? La propuesta dice que «Evento esperado» no alerta. | Mantener visibles ambas condiciones y evitar que un estado oculte información relevante. |
| Referencia de impacto | ¿Qué instante cuenta como impacto, quién lo valida y mediante qué fuente permitida? ¿Cómo se asocia con una alerta? | Calcular anticipación real solo cuando la comparación esté respaldada. Depende también de las respuestas del mentor en [RETO.md](../RETO.md). |
| Tiempo | El timestamp propuesto no tiene zona horaria. ¿Qué zona representa y cómo se comparan alerta, calendario e impacto? | Etiquetar las horas y evitar diferencias de minutos equivocadas. |
| Lectura de datos y estados | ¿Se leerán archivos o endpoints? ¿Qué forma tendrán carga, vacío, error, reintento y datos desactualizados? ¿Qué evidencia autoriza «Resuelta»? | Diseñar estados de recuperación y cierre sin asumir rutas, permisos ni comportamiento del backend. |

Estas preguntas son propuestas de coordinación para P05. No modifican el contrato ni los acuerdos de [EQUIPO.md](../../EQUIPO.md). La integración de pantallas depende de resolverlas y del acuerdo de alcance y tecnología de P04.

## Comprobación local realizada

Se revisaron las tres vistas y el cambio entre las cuatro empresas en Chrome, con anchos de 320, 736 y 1024 px, en apariencia clara y oscura. No hubo desbordamiento horizontal ni errores de ejecución en esas combinaciones. Se comprobó el recorrido de la alerta a su evidencia, la gráfica de la señal principal y el corte del trazo durante la ausencia de lecturas. También se verificó la vista dentro de la conversación.

Las tres capturas corresponden al ejemplo inicial de gramo. Esta revisión técnica y visual no sustituye la prueba de comprensión con una persona.

## Comprobación con otra persona: pendiente

La tarea pide que otra persona entienda los bocetos sin explicación. América puede mostrar cada vista por separado, sin explicar primero lo que debería ver. Se anotan sus palabras y dudas antes de enseñar la intención del diseño.

Preguntas abiertas sugeridas, en este orden:

1. «¿Qué te está mostrando esta pantalla?»
2. «¿Qué entiendes del número de confianza?»
3. «¿Qué harías a continuación y dónde lo buscarías?»
4. «¿Cómo interpretarías lo que ocurre a lo largo de esta línea de tiempo?»
5. «¿Qué conclusión sacarías de esta comparación de horas? ¿Qué información te faltaría?»

No adelantar «aquí ganamos 40 minutos» ni explicar qué significa una zona sombreada antes de recoger la respuesta. Si una persona duda o interpreta algo distinto, registrar el problema como hallazgo del boceto, sin corregir su respuesta durante esa primera lectura.

| Registro | Por completar |
| --- | --- |
| Persona revisora y fecha | Pendiente |
| Versión de los bocetos revisada | Pendiente |
| Interpretación de la alerta y la confianza | Pendiente |
| Acción que intentó realizar | Pendiente |
| Interpretación del calendario y de los huecos | Pendiente |
| Interpretación de los 40 minutos ficticios | Pendiente |
| Dudas, errores y cambios propuestos | Pendiente |

- [ ] Otra persona revisó las tres vistas sin explicación previa.
- [ ] Se registraron sus respuestas y dificultades.
- [ ] Se comprobó si distinguió datos ficticios, confianza, gravedad y resultado medido.
- [ ] Se revisó si entendió la diferencia entre un evento esperado y la ausencia de evidencia de falla.
- [ ] Se ajustaron los bocetos según los hallazgos y se volvió a revisar lo que causó confusión.
- [ ] El equipo acordó los datos y estados necesarios antes de integrar.

Generar un boceto o revisar su aspecto no completa esta comprobación humana. No se atribuye una validación a América, Arturo, rodricksito ni otra persona hasta que efectivamente la realice y se registre.
