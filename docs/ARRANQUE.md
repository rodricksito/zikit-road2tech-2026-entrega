# Arranque del equipo

> **Documento histórico** de la preparación del 9 de octubre de 2026: sus estados («Por comprobar», «Pendiente», «En curso») son de ese momento. La solución elegida está en [DECISION.md](DECISION.md) y el estado actual, en el [README](../README.md).

Este tablero organizó la preparación; las tareas de desarrollo se concretaron cuando el equipo eligió la solución. No representa una rúbrica oficial ni una decisión de arquitectura.

## Estado conocido

- Repositorio privado creado y documentación inicial compartida.
- América aceptó la invitación y tiene permiso de escritura. La invitación de Arturo seguía pendiente al revisar con la API de GitHub el 2026-10-09.
- Cada persona tiene una IA asignada; falta comprobar que las tres herramientas abran el proyecto en su entorno de trabajo.
- Créditos Claude API confirmados por rodricksito; falta configurar y comprobar su uso si se decide incorporarlos al prototipo.
- Condiciones del mentor recibidas el 2026-10-09: ver [RETO.md](RETO.md). Siguen pendientes la solución, las tecnologías, el formato exacto de entrega y las respuestas del mentor.

## Tablero de preparación

Los responsables son propuestas operativas. Las duraciones son estimaciones para organizarse, no plazos oficiales.

| ID | Trabajo | Responsable propuesto | Depende de | Se considera listo cuando | Estado |
| --- | --- | --- | --- | --- | --- |
| P01 | Abrir el proyecto y comprobar contexto en las tres herramientas | Cada pareja | — | Cada IA identifica su persona, su frente y los acuerdos pendientes; cada persona puede consultar el repo | Por comprobar |
| P02 | Confirmar condiciones del reto con el mentor | Arturo reúne respuestas; rodricksito valida dudas técnicas | — | Quedan anotados criterios, entrega, horario, datos disponibles y definición de acción efectiva, con su fuente | En curso: condiciones en [RETO.md](RETO.md); faltan 7 respuestas |
| P03 | Preparar el uso de Claude API | rodricksito | — | Presupuesto y responsable acordados; saldo y forma de configurar el servidor comprobados; prueba mínima solo cuando haga falta | En curso: [CLAUDE_API.md](CLAUDE_API.md) |
| P04 | Elegir alcance, tecnologías y resultado de la demo | Los tres; rodricksito coordina | P02 | Una frase define usuario, falla, intervención y medición; queda explícito qué no se construirá | Propuesta en [ANALISIS.md](ANALISIS.md#plan-actualizado-gracko-como-app-web) y #3: gracko como app web |
| P05 | Acordar los datos entre interfaz, backend y pruebas | rodricksito propone; América y Arturo revisan | P04 | Hay un ejemplo común de entrada/salida, estados y errores, incluso con datos ficticios identificados | Propuesta en [FORMATO_ALERTAS.md](FORMATO_ALERTAS.md) |
| P06 | Abrir una tarea concreta por pareja y nombrar quien integra | rodricksito coordina con los tres | P01, P04, P05 | Cada tarea tiene dueño, resultado, archivos a cargo, dependencias y comprobación | Pendiente |

P01, P02 y P03 pueden avanzar en paralelo. Dedicar unos 10–15 minutos a la preparación inicial y otros 15–20 a decidir alcance y datos, cuando el mentor haya aclarado lo necesario. Las dudas restantes deben quedar visibles; no se inventan respuestas para llenar el tablero.

## Primer bloque de construcción, después del acuerdo

| Pareja | Primera entrega propuesta | Comprobación |
| --- | --- | --- |
| rodricksito + Claude Code | Backend mínimo con el formato de datos acordado; conexión API si aporta al flujo elegido | Una entrada conocida produce la salida esperada y los errores se pueden identificar |
| América + Codex | Una pantalla del flujo principal con datos de ejemplo y los estados necesarios | Otra persona entiende lo que ocurre y puede completar la acción principal |
| Arturo + Antigravity CLI | Datos y pasos para un caso normal, una falla persistente y una señal transitoria | Los casos se pueden repetir; se distingue qué es simulado y qué se midió |

Primero conectar un recorrido completo. Reunirse cinco minutos cada 45–60 minutos para responder: qué funciona, qué bloquea y qué sigue. Programar una primera comprobación conjunta al terminar el primer recorrido, sin esperar a tener todas las funciones.

## Acuerdo mínimo entre las partes

Antes de trabajar por separado, anoten en la tarea correspondiente:

- Qué datos entran y salen, con un ejemplo.
- Qué estados verá la interfaz y qué significa cada uno.
- Cómo se representa un error y qué pasa si la API no responde.
- Qué eventos y tiempos se registran para evaluar la demostración.
- Qué archivos modifica cada pareja y qué necesita de las otras.

Arturo puede preparar pruebas y América usar datos de ejemplo mientras rodricksito construye el backend, siempre que los tres respeten ese acuerdo.

## Cómo abrir el trabajo con cada IA

**rodricksito, en Claude Code:**

> Soy rodricksito. Lee EQUIPO.md y docs/ARRANQUE.md. Mi frente propuesto es coordinación técnica, backend e integración; tengo experiencia con Python. Ayúdame a concretar mi primera tarea respetando las decisiones pendientes del equipo.

**América, en este Codex:**

> Soy América y tomo esta sesión. Lee EQUIPO.md y docs/TRASPASO_CODEX.md. Mi frente es diseño e interfaz. Revisa el alcance acordado y los datos disponibles antes de proponer pantallas y conectar el backend.

**Arturo, en Antigravity CLI (`agy`):**

> Soy Arturo. Lee EQUIPO.md y docs/ARRANQUE.md. Mi frente propuesto es pruebas, datos y evidencia. A partir del alcance acordado, prepara casos reproducibles, resultados esperados y una forma de registrar los resultados reales.

Estos mensajes inician el trabajo local. La autorización para publicar comentarios se daba por separado, con un mensaje explícito de cada persona a su IA.

## Cierre del hackatón

Reservar las últimas tres horas de su tiempo de construcción confirmado para corregir problemas, repetir la demo, guardar resultados, preparar un respaldo en video y ensayar la presentación. Ajustar ese margen al horario y formato que indique el comité.

La persona que presenta se elige después de un ensayo breve. Los tres deben poder explicar qué construyeron, qué midieron y qué limitaciones siguen presentes.
