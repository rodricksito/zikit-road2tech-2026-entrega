# Reto ZIKIT: condiciones del mentor

Fuente: mensaje del mentor en Discord, compartido por rodricksito el 2026-10-09. La estructura del kit la comprobó Claude Code ese mismo día con la API de GitHub, sin descargarlo. Lo que no aparece aquí sigue pendiente y no se completa con suposiciones.

## Objetivo

Una PyME se entera de sus fallas de TI cuando un cliente llama enojado. Nuestro sistema es la alerta temprana: debe avisar de incidentes reales lo antes posible, pero sin alertar por todo, porque con demasiadas falsas alarmas nadie le creerá.

## Qué recibimos

Datos sintéticos de cuatro empresas (*tenants*):

| Tenant | Giro según el mentor |
| --- | --- |
| `gracko` | Despacho contable |
| `gramo` | No lo indicó; ver su `contexto.md` |
| `kaiku` | Tienda en línea |
| `ttr` | Logística |

Cada empresa tiene tres archivos:

| Archivo | Contenido |
| --- | --- |
| `contexto.md` | Qué hace la empresa, sus horarios y sus eventos |
| `metricas.csv` | Una fila por minuto con `cpu`, `ram`, `disco`, `latencia_ms` y `errores` |
| `logs.md` | Logs de servidor, firewall y aplicación |

Además, `todos_metricas.csv` junta las cuatro empresas con una columna `tenant`. Hay 54 corridas en `data/corridas` para entrenar, validar y probar.

Repositorio del kit: <https://github.com/brunovillarrrrrr/zikit-dataset>

### Lo que comprobamos en el repositorio

- 54 corridas (`corrida_01` a `corrida_54`) más un conjunto en la raíz de `data/`. Pesa unos 182 MB; el último commit dice que suman 2,024,000 filas de métricas.
- Las corridas 01–10 y `data/` incluyen `_solucion/<tenant>/etiquetas.csv`; las corridas 11–54 no.
- Incluye `scripts/generar.py`, el programa que genera los datos.
- El README del kit dice que se publicará en *Releases* el día del evento. Al revisar no había ninguna versión publicada, así que los archivos pueden cambiar.

## Qué entregamos

Una lista de alertas. Cada alerta lleva `tenant`, `timestamp` y `confianza`; opcionalmente, el tipo de incidente que esperamos.

## Lo difícil

- Cada empresa tiene 3 incidentes reales por corrida. Algunos dan señales con 40 minutos de anticipación y otros con más de un día.
- Hay señuelos: respaldos nocturnos, cierres de nómina y cargas masivas. Se ven mal, pero no son incidentes; alertar por ellos cuenta como falsa alarma.
- Hay ruido: celdas vacías, apagones y errores en los logs que no significan nada. Las pistas reales son pocas.
- El contexto del negocio ayuda a saber qué es normal.


## Reglas del mentor

- Usar solo los datos del kit.
- No mirar el futuro: una alerta en el minuto *t* solo usa datos hasta *t*.
- Las carpetas `_solucion` son del evaluador: no se usan para entrenar ni para predecir.

## Cómo se califica

- Incidentes reales detectados antes del impacto.
- Pocas falsas alarmas.
- Tiempo de anticipación ganado: más temprano es mejor.

## Reglas provisionales del equipo

Confirmadas por rodricksito el 2026-10-09; se revisan cuando el mentor responda.

- Nadie abre las carpetas `_solucion` ni `scripts/generar.py`.
- El dataset se clona **fuera** de este repositorio y no se sube a Git.
- Todo código de detección respeta la regla del minuto *t* desde el principio.

## Preguntas pendientes para el mentor

Arturo las reúne (P02). Anota cada respuesta con su fecha. La 8 es la más importante: ver [ANALISIS.md](ANALISIS.md).

| # | Pregunta | Respuesta | Fecha |
| --- | --- | --- | --- |
| 1 | ¿Podemos usar las etiquetas de `_solucion` de las corridas 01–10 solo para **medir** nuestro resultado, sin entrenar ni predecir con ellas? | | |
| 2 | ¿Se permite leer `scripts/generar.py`? | | |
| 3 | ¿Con qué datos nos evalúan: `data/`, las corridas o un kit nuevo en *Releases*? | | |
| 4 | ¿Cuál es el formato exacto de entrega: tipo de archivo, nombres de columnas, formato del `timestamp`, rango de `confianza` y tipos válidos? | | |
| 5 | ¿Qué cuenta como «impacto»: el primer ERROR del log, el cruce de un umbral en las métricas o el inicio de la degradación? ¿Hay una anticipación máxima válida? ¿Varias alertas del mismo incidente cuentan como falsas alarmas? ¿Cómo se pesan las falsas alarmas frente a la anticipación? | | |
| 6 | ¿Se permite usar un LLM externo, como Claude API, si solo recibe datos del kit hasta el minuto *t*? (Menos urgente: la IA queda como extra.) | | |
| 7 | ¿Cuál es la hora límite y qué se entrega: código, archivo de alertas o demo? | | |
| 8 | ¿El kit con el que nos evalúan repite la misma semana (8–14 oct) y los mismos eventos a la misma hora, solo con otro ruido, o es un escenario distinto? ¿Son las mismas 4 empresas con el mismo `contexto.md`? ¿Podemos usar las corridas locales para calibrar umbrales y medir el ruido? | **No memorizar nada:** la solución debe adaptarse a datos distintos (otras fechas, horas o eventos). | 2026-10-09 |
| 9 | ¿Cómo se mide «costeable»: costo de operar (servidor, licencias, nube, IA), de construir o de mantener? | | |
| 10 | Con una sola empresa, ¿se evalúa solo la que elijamos (gracko)? ¿Suma puntos agregar una segunda? | | |
