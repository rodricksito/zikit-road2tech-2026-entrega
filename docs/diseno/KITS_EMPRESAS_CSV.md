# Subir kits, elegir empresa y descargar alertas

Fecha: 2026-10-10. Frente: América / Codex, tarea #5.

## Resultado y estado

**Estado actualizado el 10 de octubre de 2026.** La implementación está publicada en el [PR #26](https://github.com/rodricksito/zikit-road2tech-2026/pull/26), código de interfaz `945d881`, rama `codex/5-pulido-impeccable`, sobre el diseño verde y azul de `6a10422`. Conserva los dos ajustes solicitados en #26: el selector «Ventana visible» cabe completo en móvil y las bandas de actividad/huecos son translúcidas. Después, rodricksito / Claude Code revisó el alcance nuevo y se integró en `main` con el PR #26 (`11f3693`).

El backend del [PR #29](https://github.com/rodricksito/zikit-road2tech-2026/pull/29) fue [aprobado por Codex en `d59bc0e`](https://github.com/rodricksito/zikit-road2tech-2026/pull/29#pullrequestreview-5480327758) e integrado en `main` como `7a9ce44`. Los dos bloqueos de revisión quedaron corregidos. El frontend provisional se retiró de #29: la simulación con `git merge-tree` de #29 y #26 no produjo conflictos y conservó la interfaz de #26 y el backend de #29. El recorrido local posterior pasó, como se detalla en [Verificación final](#verificación-final); después, rodricksito / Claude Code revisó el alcance nuevo de #26 y se integró en `main` (`11f3693`). El [registro de revisión](../REVISION_PR29_CODEX.md) conserva la evidencia de cada versión.

## Recorrido de la persona

1. «Subir kit» despliega un formulario breve: archivo ZIP, límite de 80 MB y «Abrir kit». El botón evita envíos duplicados mientras se procesa. Si el servidor pide una clave, aparece su campo y el archivo se conserva para reintentar.
2. Al terminar se abre la primera corrida importada. Se conserva la empresa seleccionada si está presente; en otro caso se elige gracko o la primera disponible. Se admiten nombres nuevos, sin tratarlos como gracko.
3. Empresa, reloj, métricas, alertas y evidencia cambian juntos. La lista de empresas corresponde a la corrida. Los resultados tardíos de una selección anterior se descartan. Si falla el rango de una empresa, se puede elegir otra o reintentar.
4. «Descargar alertas.csv» corresponde exclusivamente a la empresa y corrida elegidas. Su rótulo dice «Corrida completa»: es una entrega distinta del recorte temporal de la reproducción. Se oculta durante un cambio de selección y no aparece con datos ficticios.
5. «Enlace a este kit» permite volver a abrirlo. La navegación entre Alertas, Detalle y Métricas conserva el identificador, incluso mientras se está recuperando. Si caducó o fue eliminado, se informa el error y se ofrece reintento.

Las observaciones del kit están en un desplegable; no se ocultan los avisos sobre empresas omitidas o datos incompletos. Los mensajes remotos se muestran como texto, sin interpretar HTML. Los kits importados no inventan referencias de impacto ni anticipación.

## Decisiones de implementación

- Se descubren las empresas oficiales y se unen sus corridas; las importadas se obtienen del manifiesto privado del kit, no de una lista pública.
- Cada `ApiSource` conserva una empresa inmutable. Rango, series, alertas, estado y referencias se validan respecto de esa identidad.
- Las consultas normales y la recuperación del manifiesto tienen 10 segundos de límite. La subida dispone de 180 segundos, incluyendo lectura de la respuesta, para contemplar la cola del servidor de hasta dos minutos.
- Una clave recibida en `#clave=…` se retira de la URL y se conserva en memoria y `sessionStorage` de esa pestaña. No se incluye en el enlace del kit, el CSV ni parámetros de consulta.
- Se versionaron las URL de CSS y módulos con `kit-20261010`: la vista previa conservaba un módulo anterior después de recargar y fallaba al importar los nuevos helpers. Al publicar cambios posteriores del conjunto, debe actualizarse esa versión de forma coherente.
- Se limitó el ancho de los lienzos a su contenedor: durante un cambio rápido de tamaño, Chart.js podía conservar brevemente el ancho anterior y causar desplazamiento horizontal.

## Comprobaciones históricas del 10 de octubre

Estos resultados corresponden al desarrollo de la entrega publicada en #26 (`6a10422`, `900b060`, `bcbf187` y `945d881`). La conexión real descrita aquí usó el backend de #29 en `9d1e5baf`; la comprobación posterior de la etiqueta se identifica al final. No se presentan como una ejecución del conjunto integrado en `main`.

- `npm test`: **70/70** (incluye subpruebas), con validación de empresas, identificadores, manifiestos, multipart, errores, tiempos límite y causalidad de la interfaz.
- `npm run test:browser`, Chrome: **33/33**. Incluye los 25 casos previos y ocho nuevos: subida sin gracko, alcance empresa/corrida del CSV, recarga por enlace, 401/422 y reintento, clave sin filtración al enlace, kit inexistente, resultados tardíos, recuperación de otra empresa tras un rango fallido y navegación mientras se recupera el kit.
- Anchos 320, 390, 740, 1024 y 1440 px sin desbordamiento, con formulario de kit abierto y gráfica en el detalle. Se comprueba también que cabe «Semana hasta ahora» y que ambas bandas conservan transparencia.
- Con el backend real de #29: cuatro empresas oficiales disponibles; ZIP sintético con `taller_norte` y `tienda-sur`, ambas nuevas; alerta de memoria; cambio de empresa; descarga individual y recarga por enlace. El CSV descargado contiene solo `taller_norte`, con cabecera `tenant,timestamp,confianza,tipo`. Cero errores JavaScript en esta prueba.
- Vista previa final comprobada también en el navegador de Codex tras renovar la caché: gracko, corrida raíz, tres alertas y descarga individual. Capturas en escritorio y móvil.
- Tras versionar las URL de los recursos, se repitieron y pasaron los tres casos de navegador afectados: inicio, subida completa y controles móviles.
- `node --check` de módulos modificados y `git diff --check` sin errores.

Las respuestas simuladas validan la interfaz. El caso sintético real comprueba conexión y formato; no mide precisión global del detector. No se afirma haber ejecutado Docker ni la suite completa del backend. No se abrieron archivos restringidos del dataset. El informe de revisión detalla los límites.

## Evidencia y continuidad

- [Escritorio](kits-empresas/escritorio.jpg).
- [Móvil con formulario abierto](kits-empresas/movil.jpg).
- [Resumen de comprobaciones](kits-empresas/qa.json).
- [Guía de la interfaz](../../web/README.md).

La revisión cruzada del alcance nuevo de #26 corresponde a rodricksito / Claude Code. Su revisión anterior de `77a0696` no cubre los cuatro commits posteriores. Rodricksito coordina la integración y el despliegue; América conserva la comprobación del recorrido de la interfaz.

## Verificación final

**Recorrido local completado el 10 de octubre de 2026.** Navegador real de Codex mediante su API de Playwright, interfaz `945d881` y backend `d59bc0e`, aprobado e integrado después en `7a9ce44`. La API se ejecutó localmente en el puerto 8029 y sirvió la interfaz de esta rama; no se hizo merge ni se desplegó durante la comprobación.

1. La carga inicial mostró las cuatro empresas oficiales y sus corridas.
2. «Subir kit» aceptó un ZIP ficticio con `taller_norte` y `tienda-sur`, sin gracko. Indicó dos empresas y una corrida; el reloj salió de los datos del 2 de noviembre de 2026.
3. Al avanzar al final, apareció la alerta de memoria de `taller_norte` a las 09:00, con evidencia y acción sugerida.
4. Se descargó `alertas.csv` desde el enlace visible y se leyó el archivo: cabecera `tenant,timestamp,confianza,tipo` y una fila `taller_norte,2026-11-02T09:00:00,0.6,memoria`.
5. Al elegir `tienda-sur`, el enlace CSV cambió a esa empresa y conservó la misma corrida del kit.
6. Al recargar el enlace del kit se recuperaron sus dos empresas y la corrida; al avanzar de nuevo, volvió a aparecer la alerta.
7. «Comparar impacto estimado» mostró «Sin referencia de impacto para este kit. No se calcula anticipación.». No hubo errores de JavaScript en los registros consultados antes y después de recargar.

Esta prueba ejercita la API real y la interfaz juntas, además de las pruebas automatizadas históricas. No mide precisión del detector ni reemplaza la revisión cruzada de Claude, una prueba del commit que finalmente se integre o la verificación del servidor. Solo el kit de subida es ficticio; la carga inicial consultó los endpoints permitidos del kit oficial. No se abrieron archivos restringidos.

Evidencia temporal local: `/tmp/zikit-cierre-ui/recorrido-verificado.png` y el CSV descargado `alertas_taller_norte_kit-e3e2915ef41b962fdc900ea27e682a5a.csv`. No se sube el dataset ni el ZIP al repositorio. Los archivos temporales no forman parte de la entrega versionada.

## Etiqueta de tiempo de respuesta

Por indicación de América (2026-10-10), «Latencia del ERP» pasa a **«Tiempo de respuesta»** para todas las empresas. El mismo término se usa en la gráfica, sus descripciones accesibles, la tabla y la evidencia estructurada, conservando la unidad **ms** y la clave de datos `latencia_ms`. No se añade un subtítulo de sistema: el selector ya identifica la empresa y el contrato no entrega una etiqueta de sistema para empresas nuevas. Los recursos de esta versión usan `respuesta-20261010` para renovar la caché.

Comprobación de esta etiqueta: 16/16 pruebas existentes de presentación pasan; vista local revisada con el título y la descripción accesible nuevos. [Captura del cambio](kits-empresas/tiempo-respuesta.jpg).
