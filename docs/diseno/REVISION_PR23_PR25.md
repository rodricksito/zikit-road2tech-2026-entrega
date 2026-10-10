# Segunda revisión de #23 y revisión de #25 — América / Codex

Fecha: 10 de octubre de 2026. Solicitada por América. Revisiones publicadas con autorización de América: [seguimiento de #23](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6094997550) y [revisión de #25](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6094997726). No se modificó backend ni se integraron PRs.

| PR | Versión revisada | Resultado |
| --- | --- | --- |
| [#23 — calendario](https://github.com/rodricksito/zikit-road2tech-2026/pull/23) | `97b36b0cb10e0b1555791cee575e2eb4ac75739d` | Los cuatro hallazgos anteriores están atendidos. Hay una regresión nueva que debe corregirse. |
| [#25 — API por corrida](https://github.com/rodricksito/zikit-road2tech-2026/pull/25) | `4bcb92ec604c3e8e137402b302b2c18010c7bf1c` | Rango y unidades compatibles con nuestra interfaz; falta corregir la asociación entre impacto y alerta. |

**Estado final de esta revisión:** los hallazgos están corregidos en #23 `109ff0e` y #25 `ab6df80`. Codex publicó el cierre de ambos sin bloqueos identificados; la suite final pasa 51/51. Queda la revisión cruzada de Claude de #24 y la integración coordinada. Los apartados siguientes conservan la evidencia de las versiones anteriores, incluida la negación durante eventos, corregida en el último seguimiento.

## PR #23: un mensaje de falla grave se descarta por contener «liberó»

**P1.** En [`backend/zikit/detector.py:47–49`](https://github.com/rodricksito/zikit-road2tech-2026/blob/97b36b0cb10e0b1555791cee575e2eb4ac75739d/backend/zikit/detector.py#L47-L49), la condición nueva `RE_LIBERA` devuelve `fin_programado` antes de evaluar `RE_DURA`. No comprueba si la liberación está negada ni si el mismo mensaje indica una falla grave.

Reproducción mínima: `rol_log(t, "no se liberó memoria; OutOfMemory", [], True, {})` devuelve `fin_programado`, incluso sin evento de calendario. También sucede con `se liberó memoria pero sigue OutOfMemory`.

Se reprodujo además con el detector completo del head de #25, que conserva esa misma lógica de #23, usando métricas y logs de la corrida raíz. Se agregó **solo en memoria** un registro de nivel `ERROR` a las 11:00:30 del 9 de octubre; los archivos del dataset permanecieron intactos:

| Mensaje inyectado | Clasificación | Alerta entre 11:00 y 11:05 | Alertas totales de la semana |
| --- | --- | --- | --- |
| `no se liberó memoria; OutOfMemory` | `fin_programado` | Ninguna | 3 |
| `OutOfMemory` (control) | `novedad` | 11:01 | 4 |

La comparación demuestra pérdida de una alerta por la nueva regla; no evalúa la precisión global ni la clasificación de tipos del detector.

**Corrección sugerida:** dar prioridad a los indicadores de falla grave y no considerar una liberación negada como final exitoso. Agregar regresiones para ambos mensajes y conservar el caso de liberación auténtica.

## PR #25: el impacto puede vincularse a una alerta de otra falla

**P2.** En [`backend/zikit/api.py:273–278`](https://github.com/rodricksito/zikit-road2tech-2026/blob/4bcb92ec604c3e8e137402b302b2c18010c7bf1c/backend/zikit/api.py#L273-L278), `alerta_id` se obtiene con la primera explicación situada entre el primer indicio menos tres horas y el impacto. No se comprueba su tipo ni una relación explícita con el incidente.

Se consultó el endpoint real con `TestClient`, sustituyendo únicamente `_resultado` por un resultado sintético de dos avisos, manteniendo las hipótesis del repositorio:

- Disco: `disco-ajeno`, 12 de octubre a las 19:00.
- VPN: `vpn-correcta`, 12 de octubre a las 23:40.
- Impacto hipotético de VPN: 13 de octubre a las 00:31.

La respuesta asigna **`alerta_id="disco-ajeno"`** al impacto de VPN. Los módulos reales del frontend #24 aceptan ese enlace explícito: atribuyen **331 minutos** al disco y dejan la alerta de VPN sin referencia. Esa anticipación corresponde a una asociación incorrecta.

El test incluido en #25 solo comprueba que el identificador exista entre las alertas, por lo que permite esta asociación errónea.

**Corrección sugerida:** utilizar una identidad o tipo canónico explícito del incidente, comprobar la relación y no asignar una referencia cuando haya ambigüedad. Probar una alerta ajena más temprana y varias candidatas del mismo tipo.

## Qué se corrigió bien en #23

- Ya no se agregan todos los recursos a todas las ventanas. La asociación aprendida se limita a una ventana y a registros anteriores.
- «Todos los viernes» y «Cada sábado» son semanales; «Todos los días» es diario.
- Se conserva el año explícito y se resuelve el cruce diciembre/enero; las fechas imposibles generan aviso.
- La API conserva `calendario_fuente`, `avisos` y el origen manual cuando se usa el respaldo.

Los casos de parser y asociación se comprobaron con reproducciones sintéticas y la suite; el respaldo manual también está cubierto por la prueba HTTP incluida en el backend.

## Pruebas ejecutadas en esta Mac

Se creó un entorno Python 3.12 aislado en `/tmp/zikit-review-23-25-env` y se instalaron las versiones exactas de `backend/requirements.txt`. No se modificó Python del sistema ni el entorno del proyecto.

En el checkout de #25:

```sh
ZIKIT_DATA=<carpeta-del-kit>/data \
  /tmp/zikit-review-23-25-env/bin/python -m pytest -q
```

**Resultado: 38 passed en 11.47 s**, sin pruebas omitidas. Esta suite pasa aunque existan los dos casos adicionales descritos arriba. No se abrió `_solucion`, `scripts/generar.py` ni archivos restringidos del dataset.

## Prueba de integración real con nuestro #24

Se sirvió `web/` del commit `f1b9a02` desde FastAPI #25, usando el dataset local permitido, y se probó con Chrome/Playwright:

- 55 corridas disponibles; selección de `corrida_01` y rango del 8–14 de octubre de 2026 obtenidos de la API.
- Cero alertas a las 10:51 y primera alerta a las 10:52 del 10 de octubre.
- Impacto oculto a las 22:59 del 11 de octubre; visible a las 23:00, con 2,168 minutos **hipotéticos**.
- Al retroceder se ocultan nuevamente impacto y alerta cuando corresponde.
- Las tarjetas coinciden con la serie de la API y las gráficas no muestran muestras futuras en los puntos examinados.
- 35 respuestas de API; cero errores HTTP de API, solicitudes fallidas o excepciones JavaScript. Se observó un 404 de `/favicon.ico`, sin efecto funcional.

Esto comprueba el recorrido básico con una corrida real; no demuestra precisión del detector ni correspondencia de todas las hipótesis con datos nuevos. Las pruebas sintéticas identifican el caso de asociación incorrecta que la corrida original no manifiesta.

## Ajuste que corresponde a América / Codex

Al revisar `f1b9a02`, el adaptador #24 descartaba `calendario_fuente` y `avisos`. El seguimiento de #24 ya los conserva y muestra una advertencia cuando la agenda es de respaldo o contiene avisos. **Se corrigió en el frontend; no se atribuye como defecto de #25.**

El rango y `errores/min` sí coinciden con nuestro contrato. Los valores decimales y nulos se conservan. Comparar únicamente el rango de fechas para reutilizar hipótesis sigue siendo un supuesto de la demo; no demuestra que cualquier contenido nuevo con las mismas fechas represente los mismos incidentes.

## Seguimiento de las correcciones: `abedea7` / `ae7ea8d`

La suite completa de backend en `ae7ea8d0883e461b4100522ec26b0d162e98cb68` pasa **50/50**, sin omitidas, en 12.66 s. Incluye la corrección de detector de `abedea76296e4e1d1d5a458a4096325804afb306`.

- **P1 original de #23 resuelto:** la falla grave se comprueba antes de los cierres; `OutOfMemory` conserva su papel de novedad. Los ocho casos nuevos de clasificación conservan también los tres cierres positivos.
- **P2 original de #25 resuelto:** cada hipótesis declara `tipo_alerta` canónico y la API enlaza la primera alerta de ese tipo dentro de la ventana. Sin tipo válido o sin coincidencia, devuelve `null`. La política para varias candidatas está documentada. Con los consumidores reales del frontend y respuestas sintéticas, disco ajeno y segunda VPN quedan sin referencia; solo la primera VPN obtiene la comparación de 141 minutos hipotéticos. Antes del impacto, la comparación sigue oculta. [Revisión publicada](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6095071630).

### P2 nuevo en #23: una liberación negada enseña una asociación normal

En `detector.py:50–65`, la negación impide marcar un cierre, pero no impide aprender recursos ni descartar la evidencia como señuelo. Con una ventana activa de nómina, palabras `\\bnomina` y `aprendido={}`:

1. `nomina: no se liberó memoria` devuelve `senuelo` y aprende el recurso `memoria`.
2. Después, `memoria al 99%` se descarta también como `senuelo`.

Se comprobó con el módulo real y `detectar(..., modo="solo_logs")`. Métricas, calibración, calendario y logs fueron **íntegramente sintéticos**, sin leer el dataset:

| Caso | Resultado |
| --- | --- |
| Solo `ERROR memoria al 99%` a las 11:01 | Una alerta de memoria, puntuación 0.6 |
| Anteponer `ERROR nomina: no se liberó memoria` a las 11:00 dentro del evento | Cero alertas, puntuación 0 |
| Ambos registros sin la ventana del calendario | Una alerta a las 11:01 |

La segunda supresión no ocurría en `97b36b0`, porque la salida temprana no aprendía recursos. Los tests nuevos de negación desactivan calendario y no cubren este camino. Corrección solicitada: excluir `RE_NEGADA` del aprendizaje y la supresión, con regresión de evento activo y aviso posterior. La suite que pasa no elimina este hallazgo. [Seguimiento publicado](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6095076123).

### Integración de `ae7ea8d` con frontend `a9a7937`

**28/28 comprobaciones pasan en Chrome**, repartidas entre una corrida real y una copia temporal desplazada siete días:

- `corrida_01`: 55 corridas disponibles, tres alertas y tres referencias cuyo tipo coincide con el de la alerta; cada alerta es anterior a su impacto. El impacto aparece únicamente al alcanzar su hora y vuelve a ocultarse al retroceder. La comparación observada de 2,168 minutos sigue rotulada como hipótesis.
- Copia `corrida_99`: 9,200 filas de métricas más logs/contexto permitidos, con fechas desplazadas siete días, fuera del repositorio. Rango 15–21 de octubre de 2026, tres alertas, referencias vacías. La pantalla actualiza las fechas y no calcula anticipación ni muestra impacto.
- 35 respuestas API en cada sesión, sin errores HTTP de API, solicitudes fallidas ni excepciones JavaScript. Solo falta `favicon.ico` (404). Servidores temporales apagados y checkout limpio.

La prueba cubre una corrida y su variante temporal; no todas las corridas ni los datos desconocidos de evaluación. Este recorrido satisfactorio no elimina el caso sintético de negación descrito arriba.

## Cierre: `109ff0e` / `ab6df80`

Rodricksito corrigió el último caso: `dura` ahora incluye `RE_DURA` o `RE_NEGADA`, de modo que una negación no cierra, enseña recursos ni se descarta por calendario. Se revisó el diff de código y la regresión nueva con evento activo, aprendizaje vacío y aviso posterior. La suite completa en #25 `ab6df8003df6100da7959f3a868e42cb5fefd059` da **51 passed, sin omitidas, en 12.35 s**.

Se publicó el cierre sin bloqueos identificados en [#23 `109ff0e`](https://github.com/rodricksito/zikit-road2tech-2026/pull/23#issuecomment-6095148556) y [#25 `ab6df80`](https://github.com/rodricksito/zikit-road2tech-2026/pull/25#issuecomment-6095148728). El recorrido visual de 28 comprobaciones corresponde a `ae7ea8d`; no se volvió a ejecutar en `ab6df80`, cuyo cambio posterior se limita a la condición negada y su regresión. No se presenta una prueba anterior como si correspondiera a un commit distinto.

## Siguiente paso

Rodricksito / Claude revisa el código actualizado de #24 y coordina la unión #23 → #25 → #24. América / Codex incorporó los avisos de calendario en #24; su prueba real con ficha ausente mostró el respaldo, conservó las cinco métricas y limpió/restauró el aviso al cambiar de fuente (16 respuestas API 200, sin errores JavaScript ni de solicitudes). La validación de cifras del pitch por Arturo sigue pendiente.
