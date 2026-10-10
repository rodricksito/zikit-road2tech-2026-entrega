# Pulido de la interfaz con Impeccable

América / Codex · 10 de octubre de 2026 · Tarea #5.

## Resultado y alcance

América autorizó aplicar Impeccable para mejorar la interfaz existente, con tres prioridades: acercar alerta, evidencia y acción; mejorar legibilidad; y unificar las señales visuales. La rama `codex/5-pulido-impeccable` parte de `main` en `4edd258`, después de integrar #23, #25 y #24. Este cambio se revisó e integró después en `main` con el PR #26 (`11f3693`).

La página conserva HTML, CSS, JavaScript y Chart.js, su identidad verde y sus dependencias locales. No se cambian detector, API, reproducción, selección de alertas, valores, escalas, unidades ni reglas de recorte temporal.

## Qué cambió y por qué

1. **Alertas y explicación antes de las gráficas.** El orden del documento ahora es controles → accesos a secciones → alertas, evidencia y comparación de impacto → métricas y calendario → costo. En escritorio, la lista queda junto al detalle; en móvil, antes. Así la acción sugerida se encuentra sin atravesar primero las cinco gráficas.
2. **Navegación explícita.** Los enlaces «Alertas», «Evidencia y acción» y «Métricas y contexto» llevan a destinos que pueden recibir foco, sin agregar paradas al recorrido normal de Tab. «Volver a las alertas» facilita regresar desde el detalle. Pulsar una tarjeta conserva el desplazamiento y la selección existentes.
3. **Lectura más cómoda.** Los textos auxiliares importantes usan 13–14 px y el cuerpo 16 px; acciones sugeridas usan 16 px. Los controles mantienen al menos 44 px de alto. Las leyendas de gráficas usan 12 px. Se reducen rótulos decorativos repetidos y se ajusta el nombre de marca para no bajar de 11 px en móvil.
4. **Una paleta compartida.** Chart.js toma los colores semánticos de las variables CSS: serie, evento esperado, ausencia de datos, alerta e impacto. Las marcas de alerta usan guiones; las de impacto, puntos. Ambas tienen 2 px de grosor y una leyenda correspondiente.
5. **Comparación primero, audio después.** Dentro del panel de impacto, las horas, la comparación y sus límites aparecen antes del control opcional de sonido. El audio sigue apagado por defecto y su lógica no se modifica.

## Revisión inicial

La evaluación visual independiente examinó fuente, estados inicial y final de la demo en Chrome y selección manual. La captura móvil inicial se evaluó como complemento. Se confirmó que «Ver evidencia» **ya funcionaba**: el hallazgo era la posición tardía del contenido, no una acción rota.

Impeccable se aplicó en modo **Operate**, orientado a comprender el estado y completar una tarea. El diseño existente aporta contexto propio mediante el reloj, el calendario y la comparación alerta–impacto. Su mayor debilidad era dar protagonismo inicial a las gráficas sobre la explicación de un incidente.

Evaluación heurística subjetiva de la versión inicial, **29/40**; no es una medición con usuarios ni una certificación:

| Heurística            | /4  | Observación inicial                                                           |
| --------------------- | --- | ----------------------------------------------------------------------------- |
| Estado del sistema    | 3   | Hora, pausa, selección y origen visibles.                                     |
| Lenguaje cotidiano    | 3   | Acciones claras; algunos términos necesitan contexto.                         |
| Control y libertad    | 3   | Reinicio, pausa, reloj y selección manual.                                    |
| Consistencia          | 3   | Paletas separadas en CSS y Chart.js.                                          |
| Prevención de errores | 3   | Advertencias de hipótesis y controles limitados.                              |
| Reconocimiento        | 3   | El detalle queda lejos del contexto principal.                                |
| Eficiencia            | 3   | Controles útiles, pero recorrido vertical largo.                              |
| Minimalismo           | 3   | Las métricas y textos secundarios compiten con la acción.                     |
| Recuperación          | 3   | Implementación de error y reintento; no provocados en esta inspección visual. |
| Ayuda                 | 2   | Faltaba orientación compacta entre las secciones.                             |

Fortalezas preservadas: identidad sobria, hipótesis explícitas, revisión humana y tabla alternativa a las gráficas. Las tres prioridades se clasificaron como P2: jerarquía, legibilidad y semántica visual común. Las perspectivas hipotéticas de un operador y una persona con baja visión ayudaron a priorizar; no representan entrevistas.

El análisis de diseño terminó antes de leer hallazgos mecánicos. La revisión final del diff y la QA de navegador se delegaron por separado. El segundo subagente previsto para el detector no entregó resultados y se interrumpió; el escaneo mecánico final se ejecutó desde la sesión principal. Por tanto, no se presenta este trabajo como una ejecución completa del procedimiento dual de `critique`, ni se inventa una puntuación posterior. No se inyectó un overlay en el navegador.

Las prioridades y el alcance ya habían sido aprobados por América; se continuó con el pulido sin pedir nuevamente esas decisiones. El registro se conserva aquí, siguiendo la organización documental del repositorio.

## Detector y decisiones

Se ejecutó `impeccable detect --json web/index.html` una vez al terminar la primera versión de los cambios. Devolvió dos observaciones y código 2:

| Regla                | Resultado                                              | Decisión                                                                                                                             |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `undersized-ui-text` | El lema de marca llegaba a 7 px en pantallas pequeñas. | Se elevó a 11 px y se permitió envolverlo dentro del espacio disponible.                                                             |
| `em-dash-overuse`    | Encontró 12 guiones largos en el HTML.                 | Son marcadores de lecturas/fechas pendientes, no prosa repetitiva. Se conservan; no se sustituyen por cero ni por cifras inventadas. |

No se declaró un escaneo «limpio» ni se repitió para obtener otra puntuación. La corrección del lema se verifica en el navegador junto con los demás tamaños.

## Comprobación

- **54/54 pruebas unitarias** pasan.
- **23/23 pruebas de navegador** pasan, sin omitidas ni cambios en sus expectativas. Incluyen respuestas API simuladas, cambio de corrida, recorte temporal, referencias ausentes, errores, reintento, sonido, selección manual y conservación de posiciones/foco durante carga lenta.
- La revisión estática independiente confirmó conservación de IDs, ausencia de duplicados y anclas sin destino, y que el detalle dentro de `data-view` sigue siendo compatible con el renderizado por ID y `aria-busy`.
- QA adicional: sin desbordamiento en 320, 390, 740, 1024 y 1440 px, incluido el lema a 11 px. Los tres enlaces trasladan el foco con Enter; el regreso a las alertas y el siguiente Tab también funcionan. El orden visual coincide con el DOM.
- Contraste computado de **190 elementos de texto** del ejemplo: mínimo **4.70:1**, sin fallos en esa muestra. Se excluyen canvas y estados no mostrados; no equivale a una auditoría completa WCAG. Resultados en [qa.json](impeccable/qa.json).
- Después de corregir el tamaño del lema se repitió solamente el caso visual: **1/1** pasa. Se inspeccionaron las capturas finales de escritorio y móvil sin encontrar recortes o solapamientos. Cero errores JavaScript en la QA adicional; `git diff --check` sin errores.
- Se conservaron capturas comparables antes/después, con la misma hora reproducida y datos **ficticios**. Los números visibles en ellas no son resultados del detector.

Estas comprobaciones validan la interfaz; no prueban precisión del detector, anticipación real, cumplimiento integral de accesibilidad ni legibilidad en un proyector físico. No se ejecutó nuevamente la suite de backend porque no se modifica ese código ni su contrato.

## Capturas de comparación

Todas muestran el ejemplo ficticio local:

| Tamaño     | Antes                                    | Después                                      |
| ---------- | ---------------------------------------- | -------------------------------------------- |
| Escritorio | [Antes](impeccable/antes-escritorio.png) | [Después](impeccable/despues-escritorio.png) |
| Móvil      | [Antes](impeccable/antes-movil.png)      | [Después](impeccable/despues-movil.png)      |

## Herramienta utilizada

Se instaló la [skill Impeccable 4.5.2](https://github.com/pbakaus/impeccable/blob/d631a8827f99414d2b6daba4ef08b7f8701751d7/.agents/skills/impeccable/SKILL.md), fijada al commit `d631a8827f99414d2b6daba4ef08b7f8701751d7`, mediante el instalador de skills de Codex. Motor oficial 0.1.14. La instalación queda fuera del repositorio, en la Mac de América; no se añaden hooks ni dependencias de ejecución a ZIKIT.

`context --target web/index.html` permitió continuar como refinamiento con el contexto existente. Se leyeron las referencias `critique`, `polish`, `craft-floor` y `operate`. Las fuentes locales de la interfaz, su paleta y las afirmaciones verificables del producto prevalecieron sobre recomendaciones estéticas genéricas. Detalles de instalación en [SKILLS_EQUIPO.md](SKILLS_EQUIPO.md).

## Siguiente revisión

Claude debe revisar el PR del pulido; Rodricksito coordina la integración. América puede explicar el recorrido alerta → evidencia → acción → comparación. Arturo valida cualquier cifra que se use en la presentación. El pulido no cambia esa separación de responsabilidades.
