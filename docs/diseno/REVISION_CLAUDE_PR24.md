# Seguimiento de la revisión cruzada de #24

América / Codex · 10 de octubre de 2026. Fuente: [revisión de rodricksito / Claude Code](https://github.com/rodricksito/zikit-road2tech-2026/pull/24#issuecomment-6095165344). La autorización de América para desarrollar, publicar las actualizaciones y documentar sigue vigente. Este seguimiento no sustituye la revisión de Claude de los commits corregidos.

## Correcciones prioritarias

| Hallazgo | Comportamiento acordado para la corrección | Estado |
| --- | --- | --- |
| P2-1: vaciado y saltos durante cada avance | Conservar el cuadro validado mientras llega el siguiente; limpiar al cambiar de fuente/corrida, retroceder o fallar. Indicador sin cambiar el alto y botones de alerta estables. | Corregido y probado |
| P2-2: ejemplo ficticio al abrir FastAPI | Intentar API al iniciar. Solo 404/405 permiten pasar al ejemplo rotulado; errores de servidor, red o tiempo agotado se muestran con reintento. `?fuente=api` y `?fuente=demo` fuerzan una elección. | Corregido y probado |
| P2-3: selección detenida en primera alerta | Seguir automáticamente la alerta nueva o la referencia cruzada. Una elección manual fija la alerta que la persona examina, incluso durante una consulta pendiente. | Corregido y probado |
| P2-4: texto que afirma ausencia antes del impacto | Indicar que todavía no hay un impacto observado hasta ese minuto, sin anunciar información futura ni calcular anticipación. | Corregido y probado |
| P2-5: consulta que no termina | Límite de 10 segundos para conexión y cuerpo de respuesta, error comprensible y reintento. Cancelar por navegación sigue siendo una cancelación voluntaria. | Corregido y probado |
| P2-6: segunda pasada sin sonido | Al retroceder, habilitar las referencias posteriores para que vuelvan a sonar al cruzarlas en reproducción; mover el reloj no produce sonido. | Corregido y probado |
| P3: `alerta_id:null` tratado como campo ausente | Conservar el `null` como ausencia explícita de enlace; no usar el emparejamiento por tipo. | Corregido y probado |
| Contrato actualizado de evidencia | Conservar `ventana_min` y mostrar los promedios; rotular `valor_actual` como «lectura al emitir la alerta». | Corregido y probado |

## Comprobación de las correcciones

- **54/54 pruebas unitarias** (38 del adaptador contando subcasos, 16 de presentación). El timeout y la cancelación se probaron con un servidor HTTP local real bloqueado tanto antes de los encabezados como durante el JSON; se comprobó el reintento y la limpieza de temporizadores/listeners.
- **23/23 pruebas de navegador en Chrome**. Los casos nuevos comprueban API al iniciar/recargar, fuentes explícitas, fallback 404/405, error 500/503 sin datos ficticios, timeout con reintento, paneles en la misma posición durante una consulta lenta, foco y selección manual durante esa consulta, seguimiento automático y repetición del sonido.
- Inspección de capturas de escritorio y móvil sin recortes ni desbordamiento. Sonido comprobado con `AudioContext` sustituido; no se afirma calidad acústica ni validación con lectores de pantalla reales.
- Comprobación adicional mediante navegador integrado y FastAPI **real `a33c722`**: inicio automático en servidor/raíz y cinco lecturas desde el primer minuto; al final se selecciona ERP, se muestran promedio de 15 min y lectura al emitir la alerta, y la comparación de **785 min sigue rotulada como hipótesis**. Sin errores ni advertencias JavaScript capturados en ese recorrido. Servidor y pestaña temporales cerrados después.
- **56/56 pruebas de backend** en `a33c722`, sin omitidas. Revisión independiente del diff y reproducciones sintéticas de causalidad, apagones y descripción recortada sin un nuevo bloqueo identificado. [Revisión publicada de #25](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6095393581).

## Observaciones P3 que conservamos para priorización

Estas observaciones vienen de la revisión de Claude y no se declaran corregidas en esta ronda:

- Fechas de fin y procedencia/duración supuesta de eventos de calendario.
- Tolerancia de textos opcionales nulos, sin debilitar la validación de campos obligatorios.
- Mostrar el cierre de una alerta y unificar su nombre entre lista/detalle.
- Restauración de audio al regresar desde el historial del navegador.
- Conservar el contexto de una alerta abierta durante un apagón.
- Alinear el nombre de la línea del impacto estimado con el panel y la precisión decimal de errores.
- Mostrar evidencia adicional y calendario descartado. La distinción de la lectura al emitir la alerta sí quedó atendida con el nuevo contrato.

La conservación del foco y los anuncios repetidos se atendieron junto con P2-1. Rodricksito corrigió en #25 `a33c722` la descripción que revelaba el futuro, media/mediana de la evidencia, hora de la última medición real y errores durante apagones. Codex revisó ese commit; no modificó su backend.

## Condición de integración

Publicar la actualización comprobada de #24, solicitar la nueva revisión de Claude y coordinar #23 → #25 → #24. Una prueba de interfaz satisfactoria no convierte los impactos hipotéticos en mediciones oficiales; Arturo conserva la validación de cifras y evidencia para el pitch.
