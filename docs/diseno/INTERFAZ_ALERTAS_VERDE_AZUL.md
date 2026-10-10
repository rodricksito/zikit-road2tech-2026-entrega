# Interfaz centrada en alertas: verde y azul

América / Codex · 10 de octubre de 2026 · Tarea #5.

## Decisión de América

América aprobó la propuesta de simplificación presentada en el chat y pidió usar verde y azul, los colores del logo oficial. El objetivo es que la página permita comprender una alerta y su siguiente revisión con menos texto y mayor espacio visual. Los tonos elegidos son verde `#087664` y azul `#1767a0`; no se presentan como valores oficiales del manual de marca. Se conserva el identificador ZIKIT existente.

## Cambios

- Controles de reproducción compactos, sin cabecera promocional ni lema secundario.
- Lista de alertas junto a su detalle en computadora; lista seguida del detalle en móvil. Las filas muestran hora, tipo, extracto y acceso al detalle. La selección tiene borde, fondo azul y texto «Seleccionada», además de `aria-pressed`.
- «Qué puedes revisar» destaca la acción sugerida en verde. El ámbar identifica alertas; no representa una gravedad inferida del puntaje de confianza.
- Cuando la evidencia declara una señal conocida, se mueve su gráfica existente al detalle. Se reutilizan las cinco instancias de Chart.js. La gráfica muestra la ventana visible del reloj y se rotula como tal; la evidencia original sigue siendo la foto del momento de emisión.
- Confianza, evidencia y registros se consultan en «Cómo se detectó»; la comparación conserva sus etiquetas de demostración e impacto estimado dentro de «Comparar impacto estimado». El audio sigue requiriendo activación expresa.
- «Actividad programada» presenta iconos, horario completo, barras proporcionales y detalles accesibles con clic o teclado. Las fechas de inicio y fin se muestran cuando el evento cruza medianoche. Durante reproducción se conservan los nodos, el foco y la apertura del evento.
- Las demás gráficas y la tabla siguen disponibles en «Ver todas las métricas». El enlace de navegación abre esa sección. El selector de ventana usa todo el ancho en móvil y las bandas del calendario/apagones son translúcidas.
- Se retiran el bloque de costos, mediciones pendientes, explicación de implementación, créditos de autoría y referencia al hackatón del producto. La documentación de equipo conserva esos antecedentes. Los avisos de datos/calendario y los errores de carga permanecen.

No se modifican el detector, el adaptador de datos ni el contrato API. El selector de varias empresas, la subida de kits y las descargas del nuevo contrato de #5 siguen siendo un trabajo de integración distinto; no se simulan controles para esas funciones en este cambio.

## Comprobación

- `npm test`: **54/54** pruebas pasan.
- Suite de navegador en Chrome: **25/25** pasan. Conserva comprobaciones de recorte temporal, reintento, cambios de corrida, audio y selección manual. Se incorporan teclado/persistencia de desplegables, reutilización de gráficas y evento que cruza medianoche.
- Regresión del calendario: una pulsación de ratón iniciada antes de actualizar el cuadro termina abriendo el mismo evento; la siguiente actualización conserva el control, su foco y apertura.
- Primera ejecución de navegador: 24/25; se corrigió un desbordamiento móvil de la cuadrícula al desplegar la tabla. La ejecución completa final pasa.
- Dos rondas de inspección visual, escritorio y móvil juntas. La segunda confirma la corrección; no se continúa puliendo fuera del alcance aprobado.
- Sin desbordamiento en **320, 390, 740, 1024 y 1440 px**, también con desplegables y tabla abiertos.
- Muestra de contraste computado: **178 elementos**, mínimo **4.90:1**, sin fallos en la muestra. No incluye canvas ni todos los estados; no es certificación de accesibilidad.
- Sin errores JavaScript en la QA visual; `git diff --check` limpio.
- Vista local comprobada contra el backend `c8c1358`: corrida raíz, final del rango, tres alertas y gráfica relacionada. Esta comprobación no mide exactitud del detector ni anticipación real.

Las capturas versionadas usan exclusivamente el ejemplo ficticio local:

- [Escritorio](alertas-verde-azul/escritorio.png)
- [Móvil](alertas-verde-azul/movil.png)
- [Informe de tamaños y contraste](alertas-verde-azul/qa.json)

## Estado de entrega

Aplicado en la copia local de la rama `codex/5-pulido-impeccable`, que ya contiene el PR #26. Después recibió la revisión cruzada de Claude y se integró en `main` con el PR #26 (`11f3693`). No se desplegó en el servidor público ni se publicó un mensaje en GitHub en este paso.

Se utilizó Impeccable para la dirección visual y las comprobaciones de presentación; la suite existente de Playwright para verificar comportamiento. Un agente revisó/adaptó pruebas y otro revisó el código del calendario. Esto no sustituye la revisión cruzada acordada con rodricksito / Claude Code.
