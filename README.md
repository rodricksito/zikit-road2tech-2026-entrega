# ZIKIT · Antes de que suene el teléfono

Alerta temprana de fallas de TI para PyMEs, hecha por el equipo ZIKIT en el hackatón **Road2Tech 2026** (TecNM Saltillo, 9 y 10 de octubre de 2026) para el reto [ZIKIT, «Antes de que suene el teléfono»](https://www.road2tech.com/#retos).

Una PyME suele enterarse de una falla cuando un cliente llama enojado. ZIKIT lee las métricas por minuto, los logs y la ficha del negocio (`contexto.md`) de cada empresa y avisa antes, sin alertar por lo que estaba planeado (respaldos, cierres de nómina, cargas masivas).

- **Detector de reglas explicables + calendario de negocio** (Python, sin IA, nube ni licencias). Una alerta en el minuto *t* solo usa datos hasta *t*. El calendario se lee del `contexto.md` y «lo normal» se aprende del pasado de la propia semana, para adaptarse a otras fechas, horarios y empresas.
- **App web** (FastAPI + HTML, CSS, JavaScript y Chart.js): reproduce la semana minuto a minuto y muestra cada alerta con su evidencia y una acción sugerida. «Nosotros llamamos primero» la compara con el impacto estimado, rotulado como **hipótesis del equipo**.
- **Su propio kit:** «Subir kit» acepta un `.zip` con la estructura del kit del reto, de cualquier empresa, y descarga las alertas en CSV (`tenant,timestamp,confianza,tipo`).
- **Costo (medido en una laptop):** unos 0.2–0.3 s por semana de gracko en el modo adaptable.

Demo de la presentación: <http://64.177.81.155/> (puede apagarse después del evento).

## Cómo correrlo

Requiere Python 3.12 o superior y Git. Desde la raíz del repositorio:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# Kit público del reto junto al repositorio (../zikit-dataset/data).
# Solo baja data/: nunca _solucion, etiquetas.csv ni generar.py.
ZIKIT_DATA=../zikit-dataset/data sh deploy/arrancar.sh --solo-descargar

cd backend
../.venv/bin/python -m zikit servir    # interfaz + API en http://127.0.0.1:8000
```

Windows, detector por línea de comandos y opciones: [backend/README.md](backend/README.md). Publicarla en un servidor con Docker: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Cómo probarlo

```sh
cd backend && ../.venv/bin/python -m pytest   # backend; sin el kit, las pruebas que lo usan se omiten
cd .. && npm test                              # interfaz, con Node.js 20 o superior
```

Pruebas en navegador (Playwright): [web/README.md](web/README.md#comprobación).

En la app: abre <http://127.0.0.1:8000>, elige «gracko» en «Empresa» y pulsa «Reproducir»: las alertas aparecen antes del impacto estimado. También puedes pulsar «Subir kit» con un `.zip` del kit y después «Descargar alertas (CSV)».

## Documentación

- [docs/RETO.md](docs/RETO.md): el reto y las condiciones del mentor.
- [docs/ANALISIS.md](docs/ANALISIS.md) y [docs/DECISION.md](docs/DECISION.md): análisis del kit y elección del enfoque.
- [docs/FORMATO_ALERTAS.md](docs/FORMATO_ALERTAS.md): formato de las alertas y API.
- [backend/README.md](backend/README.md) y [web/README.md](web/README.md): detector e interfaz.
- [EQUIPO.md](EQUIPO.md): cómo nos organizamos (reglas, revisión cruzada entre IA y registro de decisiones).

Las cifras dicen si son medidas o hipótesis. Los incidentes de referencia los dedujo el equipo a partir de las métricas, los logs y `contexto.md`; nunca se abrieron las etiquetas del evaluador (`_solucion`).

## Equipo

| Persona | GitHub | IA de apoyo | Frente |
| --- | --- | --- | --- |
| rodricksito | [@rodricksito](https://github.com/rodricksito) | Claude Code | Coordinación técnica, backend e integración |
| América | [@ameicastt](https://github.com/ameicastt) | Codex | Diseño e interfaz |
| Arturo | [@Arturo131001](https://github.com/Arturo131001) | Antigravity CLI | Pruebas, datos y evidencia |

## Sobre esta copia

Es una copia pública, sin historial, del repositorio de trabajo del equipo, que sigue siendo privado. Los enlaces a issues y pull requests (`#N`), los hashes de commit y la etiqueta `v1-demo-segura` que aparecen en los documentos son de ese repositorio y desde aquí no se pueden abrir. Los documentos de `docs/` son el registro de trabajo del 9 y 10 de octubre de 2026: sus «pendiente» describen el momento en que se escribieron.

## Fuentes

- [Reto oficial ZIKIT](https://www.road2tech.com/#retos) y [reglamento del evento](https://www.road2tech.com/Documents/REGLAMENTO.pdf).
- [Kit de datos del reto](https://github.com/brunovillarrrrrr/zikit-dataset), fijado al commit `cdea481`.
- Chart.js 4.5.1 (licencia MIT), incluido en [web/vendor/](web/vendor/README.md).
