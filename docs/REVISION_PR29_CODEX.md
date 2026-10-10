# Revisión del PR #29 — kits, API y despliegue

## Estado actual — 10 de octubre de 2026

**PR #29 aprobado en `d59bc0e849a25f8fdf66f6ee7075a9f91a3e7d6a` e integrado en `main` como `7a9ce4431db77404e66da8b92b8775f8ac77a881`.** La [aprobación publicada](https://github.com/rodricksito/zikit-road2tech-2026/pull/29#pullrequestreview-5480327758) retira los bloqueos P1 y P2 de las revisiones anteriores dentro del alcance comprobado. La integración del backend no acredita por sí sola el despliegue ni el funcionamiento de la interfaz nueva.

El [PR #26](https://github.com/rodricksito/zikit-road2tech-2026/pull/26), código de interfaz `945d881`, contiene la interfaz publicada por América / Codex y después se revisó e integró en `main` (`11f3693`). #29 retiró su frontend provisional: `web/`, `package.json` y la presencia/ausencia de `tests/frontend-kit.test.mjs` coinciden con `main` en `e6bb948`. La simulación con `git merge-tree --write-tree` de #29 y #26 pasó sin conflictos; el árbol `d41724d88c6126d3f8171cb08eac2d9f4ae7a607` conserva la interfaz y sus pruebas de #26 y backend, despliegue y contrato de #29. No se modificaron ramas ni se integraron PRs durante esa comprobación.

### Seguimiento de las correcciones

Todas estas revisiones se realizaron el 10 de octubre de 2026:

| Versión | Resultado y evidencia |
| --- | --- |
| `9d1e5baf` | Solicitud inicial de cambios: clave ausente del contenedor y métricas aceptadas fuera del dominio de la interfaz. El informe original se conserva más abajo. |
| `0103cf8` | P2 corregido en la lectura compartida: 24 casos sintéticos, contrato con `ApiSource` y cuatro pruebas nuevas pasan. La clave ya viaja por stdin, pero se confirmó un P1 adicional: después de `cd zikit`, la ruta `zikit/.zikit-clave.env` se buscaba en una carpeta duplicada. |
| `f08e1d1`, incluido en `d59bc0e` | P1 corregido: `--env-file .zikit-clave.env` usa la ruta correcta y se comprueba su existencia antes de construir o retirar el contenedor anterior. Cinco casos con SSH, rsync, Docker y curl simulados pasan. |
| `d59bc0e` | Aprobación final: siete pruebas seleccionadas del repositorio pasan (cinco de API/dominio y dos de despliegue), además de los cinco casos independientes del script. Backend de producción sin cambios desde `0103cf8`; el `ApiSource` de #26 acepta las respuestas capturadas y validadas, el manifiesto, el identificador y la URL CSV. La documentación ya coincide en un límite de 30 kits. |

Las pruebas de esta revisión utilizaron datos ficticios. No se ejecutó la suite completa, Docker real ni un despliegue en el servidor; el ensayo de Vultr relatado por Claude es evidencia de Claude. No se leyó el dataset del reto durante estas pruebas de revisión. El recorrido local posterior de la interfaz y la API real quedó registrado por separado en [Verificación final](diseno/KITS_EMPRESAS_CSV.md#verificación-final).

## Revisión inicial histórica — 10 de octubre de 2026, `9d1e5baf`

Los hallazgos y comandos que siguen describen esa versión y se conservan para reproducir la revisión inicial; **ya no son bloqueos pendientes de #29**.

- Fecha: 2026-10-10.
- Revisión: América / Codex.
- PR: https://github.com/rodricksito/zikit-road2tech-2026/pull/29
- HEAD revisado: `9d1e5baf45e2400ab255610770caa542a2b16c07`.
- Dictamen de esa versión: **solicita correcciones** por los dos hallazgos siguientes.
- Publicación: [revisión en GitHub](https://github.com/rodricksito/zikit-road2tech-2026/pull/29#pullrequestreview-5479873217), bajo `ameicastt`, firmada **América / Codex**, con estado **CHANGES_REQUESTED**, tras autorización de América. El HEAD seguía siendo el revisado al publicar. No se modificó el código del PR ni se desplegó en un servidor.

### P1 — La publicación no transmite la clave al contenedor

**Ubicación:** `deploy/publicar.sh:53–54`; configuración consumida en `backend/zikit/api.py:66`.

Cuando se ejecuta `ZIKIT_CLAVE=… deploy/publicar.sh usuario@servidor`, el script imprime un enlace con esa clave, pero el comando `docker run` solo pasa `ZIKIT_ADAPTAR`. No pasa `ZIKIT_CLAVE`. La API obtiene la protección de esa variable y, cuando está ausente, admite subidas sin clave.

Esto contradice el comportamiento prometido en `docs/DESPLIEGUE.md:13` y `:127`: alguien que decide restringir las subidas recibe un enlace que aparenta activar esa protección, mientras el servicio permanece abierto.

**Comprobación sin conexión remota:** se ejecutó el script con `rsync` y `ssh` sustituidos por funciones inocuas. La primera no hace nada; la segunda únicamente imprime el comando remoto. Se utilizó una clave ficticia:

```sh
bash -c '
  rsync() { :; }
  ssh() { printf "%s\n" "$2"; }
  export -f rsync ssh
  ZIKIT_CLAVE=clave-de-prueba-no-secreta bash deploy/publicar.sh nadie@192.0.2.1
'
```

El comando generado fue:

```sh
docker run -d --name zikit --restart unless-stopped -p 80:8000 \
  -v zikit-datos:/datos -e ZIKIT_ADAPTAR=1 zikit
```

Después imprimió `http://192.0.2.1/#clave=clave-de-prueba-no-secreta`. La omisión de la variable queda confirmada sin usar SSH, copiar archivos ni arrancar Docker.

**Corrección solicitada:** transmitir la clave opcional al entorno del contenedor con un mecanismo que preserve su contenido sin interpolación insegura. Comprobar que, al configurarla, una subida sin clave o con clave incorrecta devuelve 401, y una subida válida con la clave correcta puede continuar. Sin clave configurada debe conservarse la subida libre acordada.

### P2 — Se acepta un kit que la interfaz no puede reproducir

**Ubicación:** `backend/zikit/api.py:164–179`, especialmente las llamadas de validación de `:176–179`.

La validación de una subida comprueba la lectura y, en algunos pares de empresa y corrida, ejecuta el detector, pero no verifica el dominio de las métricas que exige la interfaz. Un ZIP sintético con `data/gracko/metricas.csv` y valores de CPU `-1` recibe HTTP 200. La serie posterior conserva `cpu: -1.0`, y el `ApiSource` del mismo HEAD rechaza esa respuesta con:

> Datos no válidos: cpu. Revisa el formato acordado de la API.

Por tanto, el usuario recibe una subida aceptada que falla al intentar verla.

**Caso reproducido:** dos filas a las 08:00 y 08:10 del 2026-10-08, con columnas `timestamp,cpu,ram,disco,latencia_ms,errores` y valores `-1,40,50,30,0`. El ZIP se creó en memoria; se usó el `TestClient` real de FastAPI y después el `ApiSource` real con las respuestas capturadas. No se utilizó el dataset del reto.

**Corrección solicitada:** validar el dominio de las métricas en la lectura compartida antes de registrar una empresa, manteniendo los campos vacíos como datos ausentes. Rechazar los valores negativos y los no finitos inválidos con un diagnóstico de columna y fila. Conforme al contrato actual del PR, debe resultar en 422 si no queda ninguna empresa utilizable, o en un aviso de la empresa omitida si quedan otras válidas. La reproducción confirmada corresponde a CPU negativa; no se afirma haber probado todas las variantes de valores inválidos.

Evidencia temporal de esta sesión, fuera del repositorio:

- `/tmp/zikit-pr29-contract-repro.py`: genera los ZIP sintéticos y consulta la API.
- `/tmp/zikit-pr29-contract-responses.json`: respuestas completas.
- `/tmp/zikit-pr29-contract-ui-repro.mjs`: consulta el `ApiSource` real con esas respuestas.
- `/tmp/zikit-pr29-contract-ui-result.json`: error exacto de CPU negativa y aceptación del caso de un solo minuto.

Estos archivos temporales documentan la reproducción local; no forman parte de la entrega versionada ni se garantiza su conservación después de esta sesión.

### Comprobaciones que pasaron

- Sintaxis de despliegue: `bash -n deploy/publicar.sh` y `sh -n deploy/arrancar.sh`.
- Caso sintético con empresa nueva `acme` y empresa calibrada `gracko`.
- Recuperación del manifiesto por identificador, sin enumeración de los kits en las corridas; un identificador desconocido devuelve 404.
- Referencias vacías para kits importados.
- En el caso construido, ambas empresas emiten una alerta de memoria a las 09:00; consultar hasta las 08:59 devuelve `[]`.
- CSV conjunto ordenado por timestamp y CSV individual por empresa.
- Formularios multipart malformados devuelven 422.
- Una corrida de un solo minuto es aceptada por el `ApiSource`.
- Prueba existente `backend/tests/test_empresa_nueva.py -k generica`: **1 passed, 4 deselected**, con configuración de calibración y directorio de datos vacío.

La validación adicional está registrada en `/tmp/zikit-pr29-validacion-final.py` y `/tmp/zikit-pr29-validacion-final.json`.

### Límites de la revisión y ajuste documental

- El cliente Docker está instalado, pero el daemon no está disponible. **No se comprobó `docker build`, `docker run` ni el despliegue real.**
- No se ejecutó la suite completa del backend ni pruebas que dependan del dataset. No se abrieron `_solucion`, `etiquetas.csv` ni `scripts/generar.py`.
- Las comprobaciones de causalidad e identificadores se limitan a los casos descritos; no constituyen una auditoría exhaustiva de seguridad.
- Se instaló `python-multipart==0.0.32` únicamente en el entorno temporal `/tmp/zikit-review-23-25-env` para las comprobaciones de API.
- `docs/DESPLIEGUE.md:12` y `backend/README.md:54` aún indican un máximo de **8** kits. `backend/zikit/kits.py:49` y la sección de seguridad documentan **30**. Conviene unificar el límite para que la guía coincida con el código.

### Resumen de comunicación al equipo

La [revisión publicada](https://github.com/rodricksito/zikit-road2tech-2026/pull/29#pullrequestreview-5479873217) incluye ambos hallazgos, reproducciones y límites. Este es su resumen:

```text
De: América / Codex
Para: rodricksito / Claude Code y equipo
Tarea: #5 — revisión cruzada del PR #29
Estado: lista para revisión
Resultado: Solicito correcciones. P1: publicar.sh imprime el enlace con ZIKIT_CLAVE pero no transmite la variable al contenedor; las subidas quedan libres. P2: un kit con CPU negativa recibe 200, pero el ApiSource del mismo HEAD lo rechaza al reproducirlo.
Entrega: https://github.com/rodricksito/zikit-road2tech-2026/pull/29 — HEAD 9d1e5baf45e2400ab255610770caa542a2b16c07. Detalle en docs/REVISION_PR29_CODEX.md.
Comprobación: Reproducción del comando de despliegue con SSH y rsync sustituidos por funciones inocuas; API real y ApiSource con ZIP sintético. Pasaron sintaxis de shell, una prueba de empresa genérica y los casos de manifiesto, CSV y corte temporal descritos. Sin despliegue ni dataset del reto; Docker no tiene daemon disponible.
Necesito: Transmitir la clave al contenedor y validar las métricas antes de aceptar la empresa. Después, repetir los casos sobre el nuevo HEAD antes de integrar.
```
