# Decisión del camino final: votan las tres IA

El equipo (rodricksito, América y Arturo) pidió que **las tres IA (Claude Code, Codex y Antigravity CLI) decidan el camino**, cada una con la información completa. Este documento la reúne. El voto se deja en el Issue indicado al final.

Preparado por rodricksito / Claude Code la noche del viernes 9 de octubre de 2026. Las tablas describen ese momento (por ejemplo, «no está en `main`» o «solo corre en la laptop»); el resultado está en la sección 6 y lo construido después, en el [README](../README.md). Lo marcado con 🔎 es deducción; lo marcado con ❓ no está confirmado por nadie.

## 1. La situación en un minuto

**El reto (ZIKIT, «Antes de que suene el teléfono»):** avisar de las fallas de TI de una PyME antes de que el cliente llame enojado. Detalle en [RETO.md](RETO.md).

**Lo que dijo el mentor:**
- Se entrega **una lista de alertas** (`tenant`, `timestamp`, `confianza` y tipo opcional).
- Se califican los **incidentes reales detectados antes del impacto**, **pocas falsas alarmas**, **más anticipación** y **qué tan costeable** es.
- **No memorizar nada:** la solución debe **adaptarse a datos distintos**.
- Las corridas del kit se pueden usar **para entrenar, validar y probar**. **No se vale mirar el futuro**: una alerta en el minuto *t* solo usa datos hasta *t*.

**Tiempo** (página oficial, «horarios aproximados»): **cierre de entregas el sábado 10 de 14:00 a 15:00**; presentaciones de 15:00 a 18:00, con un **pitch de 5 minutos**. Quedan unas **14 horas**.

**Reglamento:** se permite usar cualquier herramienta o IA como apoyo para desarrollar; hay que seguir las indicaciones de los mentores (desobedecer puede llevar a descalificación); equipos de 3 a 5 personas.

**Lo que no sabemos (❓):** qué se sube exactamente en el «cierre de entregas», el formato exacto del archivo, qué cuenta como «impacto», la rúbrica del jurado y si la web es demo para el jurado o producto para la PyME. El kit oficial del evento **aún no se publica** en el repositorio del kit.

## 2. Lo que ya tenemos

| Pieza | Estado | Detalle |
| --- | --- | --- |
| **Detector** (`backend/zikit`, Python) | ✅ Funciona | En gracko da **3 alertas por corrida**: disco lleno (~35 h antes), ataque a la VPN (~44 min antes) y ERP lento (~13 h antes). Sin falsas alarmas contra nuestras hipótesis. Revisa una semana en **menos de 0.1 s**, sin IA ni licencias. Probado: no mira el futuro |
| **API web** (FastAPI) | ✅ Funciona | Entrega a la pantalla solo lo que se sabía hasta el minuto que se está viendo |
| **Pantalla web** (América, [PR #11](https://github.com/rodricksito/zikit-road2tech-2026/pull/11)) | 🟡 Borrador | Ya conectada a datos reales: reproduce la semana, gráficas, alertas con evidencia y acción sugerida. Falta el «momento del teléfono» y no está en `main` |
| **Evaluador y medición de costo** (Arturo, #4) | 🟡 En curso | — |
| Calendario de eventos planeados | ⚠️ Escrito a mano | Tiene **fechas fijas de esta semana**: con datos nuevos fallaría |
| «Lo normal» de cada hora | ⚠️ Aprendido de esta semana | Con otra semana o empresa podría no aplicar |
| Despliegue en la nube | ❌ | Hoy solo corre en la laptop de rodricksito |
| Historia, pitch de 5 min y video de respaldo | ❌ | — |

**Aviso importante:** todas nuestras cifras se miden contra problemas que **dedujimos nosotros** (no abrimos `_solucion`) y con corridas que **repiten la misma semana**. Prueban que el detector resiste el ruido, no que funcione con datos nuevos.

## 3. Riesgos principales
1. **Datos nuevos.** Si nos evalúan con otra semana, el calendario fijo y «lo normal» aprendido de esta semana darían falsas alarmas. Es justo lo que el mentor pidió evitar.
2. **Presentación.** Sin historia ni ensayo, los 5 minutos se desperdician.
3. **Tiempo.** 14 horas, contando que hay que dormir algo.

## 4. Los tres caminos

**En los tres caminos se hace siempre:**
- Tener listo el archivo de alertas de gracko.
- Integrar la pantalla de América a `main`.
- Preparar el pitch de 5 minutos y un video de respaldo, y elegir quién presenta.
- Enviar las preguntas pendientes al mentor.

### Camino A · «Robusto y adaptable»
Prioridad: que funcione con **cualquier** semana nueva.

| Quién | Qué hace | Horas aprox. |
| --- | --- | --- |
| rodricksito + Claude Code | Versión adaptable: el calendario se lee solo del `contexto.md` que venga, «lo normal» se aprende de los datos recibidos y la rutina de la bitácora se aprende mientras se lee. Validación con una empresa no vista y con fechas desplazadas | 5–7 |
| América + Codex | Pulir la pantalla actual y mostrar que funciona con datos distintos | 4 |
| Arturo + Antigravity | Evaluador, pruebas con datos distintos y medición de costo | 5 |

- **A favor:** cumple al pie de la letra lo que pidió el mentor; resiste un kit de evaluación nuevo.
- **En contra:** poco «wow» en la presentación. La adaptación podría bajar la detección y no habría mucho tiempo para ajustarla.

### Camino B · «Producto memorable»
Prioridad: que la presentación impacte.

| Quién | Qué hace | Horas aprox. |
| --- | --- | --- |
| rodricksito + Claude Code | Aviso real al celular (por ejemplo, Telegram) y despliegue en la nube | 3–4 |
| América + Codex | «Nosotros llamamos primero» (un teléfono que suena en el impacto y nuestra alerta que llegó antes) y un semáforo simple para el dueño | 5 |
| Arturo + Antigravity | Guion de la demo, video y medición de costo | 4 |

- **A favor:** presentación muy memorable; producto tangible (el jurado recibe la alerta en su celular).
- **En contra:** **no atiende la respuesta del mentor**. Con datos nuevos, el calendario fijo daría falsas alarmas y el puntaje caería.

### Camino C · «Balanceado»
Prioridad: cumplir al mentor con lo mínimo necesario y sumar **una** idea creativa y la nube.

| Quién | Qué hace | Horas aprox. |
| --- | --- | --- |
| rodricksito + Claude Code | Adaptable **mínimo**: calendario automático desde `contexto.md` y «lo normal» aprendido de los datos recibidos (4 h). Después, despliegue en la nube (1–2 h) | 5–6 |
| América + Codex | «Nosotros llamamos primero» en la pantalla actual: teléfono que suena, minutos ganados y modo demostración bien rotulado | 4 |
| Arturo + Antigravity | Evaluador, prueba con datos desplazados, medición de costo, guion y video | 5 |

- **A favor:** cubre al mentor, la creatividad y la nube.
- **En contra:** muchas cosas en paralelo y poco margen. El aviso al celular quedaría solo si sobra tiempo.

## 5. Cómo votamos

1. Cada IA lee este documento y, si lo necesita, [RETO.md](RETO.md), [ANALISIS.md](ANALISIS.md) y [FORMATO_ALERTAS.md](FORMATO_ALERTAS.md).
2. Cada IA deja **un comentario** en el Issue de la decisión con este formato:

```text
De: [Persona / IA]
Voto: A | B | C   (o una variante concreta, explicada)
Segunda opción: A | B | C
Por qué: (máximo 3 puntos)
Riesgo que más me preocupa:
Qué haría mi persona en las próximas 3 horas:
```

3. **Conteo:** el primer lugar vale 2 puntos y la segunda opción 1. Gana el camino con más puntos. Si hay empate, gana **C** por ser el intermedio.
4. Las personas tienen **5 minutos para vetar** si algo no les convence. Si nadie veta, se ejecuta.
5. Claude Code registra la decisión en `EQUIPO.md` y abre las tareas de cada pareja.

## 6. Resultado (2026-10-10)

**Gana el camino C** ([#20](https://github.com/rodricksito/zikit-road2tech-2026/issues/20)): Claude Code C/A, Antigravity C/A, Codex A/C → **C = 5**, A = 4, B = 0. Las personas no vetaron.

Se incorporan las condiciones de Codex:
1. La adaptación llega hasta la pantalla: el reloj de la web no queda fijo al 8–14 de octubre; la API da el rango de cada corrida.
2. Lo que se aprende de la semana evaluada usa **solo el pasado**; la prueba de cortar en el minuto *t* cubre el proceso completo.
3. Validación con expectativas fijadas antes de ajustar: cambios de fecha, de nivel, rutina nueva y periodos sin incidentes.
4. El «teléfono» solo aparece si la referencia corresponde a esa corrida y va rotulada como hipótesis; si no, «sin referencia de impacto».
5. Unidades correctas entre API y pantalla (errores de 5 min frente a «errores/min»).

**Plan:** primero la «demo segura» (pantalla unida a `main` y etiquetada); después los arreglos de adaptación, cada uno con interruptor y prueba; «Nosotros llamamos primero» en la pantalla; evaluador y pruebas con semanas alteradas. La nube solo si sobra tiempo (máximo 1 h). **Código congelado a las 12:00 del sábado**; cierre de entregas de 14:00 a 15:00.
