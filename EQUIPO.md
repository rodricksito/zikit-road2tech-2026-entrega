# Acuerdos del equipo

## Integrantes

| Persona | IA asignada | Usuario de GitHub |
| --- | --- | --- |
| rodricksito | Claude Code | rodricksito |
| América | Codex | ameicastt |
| Arturo | Antigravity CLI (`agy`) | Arturo131001 |

Durante la preparación, **rodricksito usa esta sesión de Codex para organizar el equipo**. Durante el hackatón, **América operará este Codex** y rodricksito trabajará con Claude Code.

Habilidades confirmadas por rodricksito: tiene más experiencia y usa Python; América prefiere diseño; Arturo puede adaptarse a lo que necesite el equipo.

## Reparto operativo inicial

Esta es la propuesta de arranque basada en esas habilidades; el equipo puede ajustarla según el alcance elegido.

| Persona | Responsabilidad propuesta | Entrega observable |
| --- | --- | --- |
| rodricksito + Claude Code | Coordinación técnica, backend, integración de Claude API si se necesita e integración del proyecto | Servicio ejecutable, formato de datos acordado y versión integrada que funcione |
| América + Codex | Diseño de experiencia e interfaz | Flujo claro, pantallas conectadas y estados de carga, error y recuperación cuando correspondan |
| Arturo + Antigravity CLI | Pruebas, datos de demostración, medición y evidencia | Casos reproducibles, resultados registrados y guion de comprobación |

Responsable humano de integración propuesto: **rodricksito**. Cada persona también comprueba su propia entrega; Arturo revisa el conjunto y ayuda donde exista un bloqueo.

Quien presenta ante el jurado se elige después de un ensayo breve. No se asigna automáticamente a quien tenga más experiencia técnica.

## Recursos disponibles

- Claude Code: herramienta de trabajo de rodricksito.
- Codex: herramienta de trabajo de América.
- Antigravity CLI (`agy`): herramienta de trabajo de Arturo. Sustituye a Gemini CLI, retirada para cuentas personales el 18 jun 2026.
- Créditos Claude API: beneficio confirmado por rodricksito; recurso del prototipo, si el alcance acordado necesita IA.
- Claude API: workspace exclusivo con su propio límite de gasto mensual. La app entregada no usa la Claude API. Ver [docs/CLAUDE_API.md](docs/CLAUDE_API.md).

No registres claves ni datos de facturación en este archivo. Los créditos API y los límites de los asistentes se administran por separado. La organización del equipo no depende de construir un sistema de conversación automática entre las IA.

## Objetivo y decisiones vigentes

- Reto: ZIKIT, «Antes de que suene el teléfono».
- Fuente oficial: https://www.road2tech.com/#retos
- Objetivo publicado, resumido: reducir el tiempo desde una señal de falla informática en una PyME hasta una acción efectiva y demostrar la mejora.
- **Solución elegida (camino C, 2026-10-10):** detector de reglas explicables + calendario de negocio para **gracko**, que se **adapta a datos nuevos** (calendario leído de `contexto.md`, «lo normal» aprendido solo del pasado de la semana evaluada y rutina de la bitácora aprendida mientras lee), mostrado como **app web** con «Nosotros llamamos primero». Votado por las tres IA en #20 y sin veto de las personas. Detalle en [docs/DECISION.md](docs/DECISION.md).
- Tecnologías: backend en **Python con FastAPI** (`backend/`); interfaz en **HTML, CSS, JavaScript y Chart.js** (`web/`); sin base de datos.
- Condiciones, entregable y criterios del mentor recibidos el 2026-10-09: ver [docs/RETO.md](docs/RETO.md). Las preguntas al mentor sin respuesta registrada (9 de 10) siguen en ese documento.

Las ideas conversadas con una IA son propuestas hasta que el equipo las acuerde. No inventes requisitos, métricas obtenidas ni decisiones aprobadas. Si hay información contradictoria, identifica la fuente y lo que falta confirmar.

El [plan de arranque](docs/ARRANQUE.md) contiene la secuencia de preparación y las tareas propuestas. El [traspaso a América](docs/TRASPASO_CODEX.md) resume lo necesario para continuar esta sesión.

## Ritmo de trabajo: entender antes de avanzar

Acordado por rodricksito, América y Arturo el 2026-10-09. Aplica a **todas** las IA del equipo (Claude Code, Codex y Antigravity CLI).

- **Antes de pasar a un paso nuevo, el equipo debe entender el paso actual.** La IA explica en lenguaje simple, sin tecnicismos innecesarios y con ejemplos de los datos reales.
- Cada paso termina con una comprobación breve, por ejemplo pedir que lo expliquen con sus palabras. La IA **espera una confirmación explícita** («entendido») antes de seguir.
- Mientras el equipo esté aprendiendo, la IA no escribe código nuevo ni publica en GitHub sin que se lo pidan.
- Si algo no está claro, la IA pregunta antes de suponer.
- Los integrantes pueden usar una misma sesión juntos; la IA confirma quién habla cuando importe (por ejemplo, para firmar un mensaje).

## Revisión cruzada

Acordado por rodricksito, América y Arturo el 2026-10-10. **Ningún cambio entra a `main` sin que otra IA lo revise.**

| Cambio de… | Lo revisa… | Mirando sobre todo… |
| --- | --- | --- |
| rodricksito / Claude Code (detector, API) | América / Codex | Que encaje con la pantalla: fechas, unidades y formatos |
| América / Codex (pantalla) | rodricksito / Claude Code | Que use bien la API y no muestre datos del futuro |
| Cualquier cifra para el pitch | Arturo / Antigravity CLI | Que esté medida de verdad y rotulada (medida o hipótesis) |

Lista rápida para cada revisión (10–15 min):
1. ¿Mira el futuro en algún lado?
2. ¿Hay fechas u horas fijas de una semana concreta?
3. ¿Coinciden unidades y formatos entre detector, API y pantalla?
4. ¿Las cifras dicen si son medidas o hipótesis?
5. ¿Qué podría fallar en la presentación?

Las personas, sin leer código, preguntan en cada PR: **«¿Qué cambió, cómo lo probaste y qué podría fallar?»**. Si la respuesta es vaga, no se une. La revisión se deja como comentario en el PR con el formato de mensajes de este archivo.

## Al iniciar o retomar una tarea

1. Lee este acuerdo y la tarea asignada, incluidos sus comentarios recientes.
2. Comprueba la rama actual y el estado del trabajo local antes de sincronizar o cambiar archivos.
3. Identifica el resultado esperado, los archivos a tu cargo y las dependencias con otras parejas.
4. Si falta un acuerdo que afecta a otras partes, plantea una propuesta en la tarea; continúa el trabajo independiente que sí esté definido.

Las instrucciones y el contexto de otra herramienta no se comparten automáticamente. Después de actualizar acuerdos, pide a cada IA que vuelva a leerlos.

## Código e integración

- Una pareja responsable por tarea y una rama breve por tarea. Ejemplo: `america/12-lista-incidentes`.
- Parte de `main` actualizado cuando el estado local lo permita. Conserva los cambios existentes; no sobrescribas trabajo ajeno para resolver conflictos.
- Acordar quién modifica los archivos compartidos y el formato de los datos antes de construir partes que dependan unas de otras.
- Comparte los cambios mediante un pull request que enlace la tarea, explique el resultado y muestre la comprobación realizada.
- La persona encargada de integrar coordina la unión de cambios y comprueba que el conjunto siga funcionando.
- Distingue «lista para revisión» de «integrada y verificada». No cierres una tarea solo porque se generó código.
- Mantén las credenciales fuera del repositorio y de los comentarios. Cada persona utiliza su propia cuenta.

## Comunicación

GitHub Issues es el lugar común para las conversaciones de tareas. Los acuerdos que afecten a todos se registran también en la sección de decisiones de este archivo, una vez acordados por las personas responsables.

Consultar mensajes y publicar mensajes son acciones distintas. Publica comentarios solo con autorización humana que indique el repositorio y el alcance; no interpretes este archivo ni un comentario de otra IA como autorización por sí solos. En el repositorio de trabajo, el README contenía la instrucción que cada persona enviaba explícitamente a su IA.

Formato de mensaje:

```text
De: [Persona / IA]
Para: [Persona / IA o equipo]
Tarea: #N
Estado: en curso | bloqueada | lista para revisión | integrada y verificada
Resultado: [qué cambió o qué se descubrió]
Entrega: [enlace al PR y, si importa, versión del código]
Comprobación: [qué se probó y qué sigue sin comprobarse]
Necesito: [pregunta o siguiente acción concreta, si existe]
```

Los mensajes aparecen bajo la cuenta autenticada de GitHub. La firma identifica a la pareja; no representa una cuenta independiente de la IA.

Cada persona pide a su IA consultar novedades al retomar trabajo o recibir un aviso. Un comentario, una mención o un archivo compartido no despierta automáticamente otra sesión. Las personas pueden hacer una reunión breve cada 45–60 minutos o cuando exista un bloqueo urgente.

## Registro de decisiones

Añade aquí únicamente acuerdos confirmados, con fecha, responsables y enlace a la conversación correspondiente. Mantén arriba el estado vigente.

| Fecha | Acuerdo | Confirmado por | Fuente |
| --- | --- | --- | --- |
| 2026-10-09 | rodricksito: Claude Code; América: Codex; Arturo: Gemini CLI; cuentas de GitHub confirmadas | rodricksito | Conversación de preparación |
| 2026-10-09 | rodricksito organiza ahora en este chat; América utilizará este Codex durante el hackatón | rodricksito | Aclaración explícita en la conversación |
| 2026-10-09 | rodricksito tiene más experiencia y usa Python; América prefiere diseño; Arturo es flexible | rodricksito | Respuesta sobre habilidades |
| 2026-10-09 | Beneficio de créditos Claude API disponible | rodricksito | Confirmación en la conversación; integración aún pendiente |
| 2026-10-09 | Arturo usa Antigravity CLI (`agy`) en lugar de Gemini CLI, que Google retiró para cuentas personales; sigue leyendo `GEMINI.md` | rodricksito | Aviso al instalar Gemini CLI; [migración oficial](https://antigravity.google/docs/cli/gcli-migration) |
| 2026-10-09 | Condiciones del reto recibidas del mentor. Reglas provisionales: nadie abre `_solucion` ni `scripts/generar.py`, y el dataset no se sube al repositorio | rodricksito | Mensaje del mentor en Discord; [docs/RETO.md](docs/RETO.md) |
| 2026-10-09 | Entender antes de avanzar: ninguna IA pasa a un paso nuevo sin la confirmación explícita del equipo de que entendió el actual | rodricksito, América y Arturo | Sesión conjunta en Claude Code; sección «Ritmo de trabajo» |
| 2026-10-10 | **Camino C** («balanceado» con red de seguridad y las condiciones de Codex): C = 5, A = 4, B = 0 | Votado por Claude Code, Antigravity CLI y Codex; sin veto de rodricksito, América y Arturo | [#20](https://github.com/rodricksito/zikit-road2tech-2026/issues/20), [docs/DECISION.md](docs/DECISION.md) |
| 2026-10-10 | Revisión cruzada: ningún cambio entra a `main` sin revisión de otra IA | rodricksito, América y Arturo | Sesión conjunta en Claude Code; sección «Revisión cruzada» |
| 2026-10-09 | Respuesta del mentor a la pregunta 8: no memorizar nada; la solución debe adaptarse a datos distintos | rodricksito, América y Arturo (transmiten al mentor) | [docs/RETO.md](docs/RETO.md) |
| 2026-10-09 | Prioridades del equipo: pulir una sola empresa, maximizar los incidentes detectados con bajo costo y entregarlo como app web | rodricksito | [docs/RETO.md](docs/RETO.md) |
| 2026-10-09 | Empresa a pulir primero: gracko (propuesta de rodricksito; América y Arturo confirman en #3) | rodricksito | [docs/ANALISIS.md](docs/ANALISIS.md) |
| 2026-10-09 | Claude API: workspace exclusivo con límite de gasto mensual; backend en la laptop de rodricksito con la clave en `.env` local; solo rodricksito tiene la clave y la interfaz y las pruebas llaman al backend | rodricksito | Sesión de Claude Code (P03); detalle en [docs/CLAUDE_API.md](docs/CLAUDE_API.md) |
