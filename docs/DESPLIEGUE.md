# Despliegue en un servidor (Vultr, Ubuntu 24.04)

Estado: guía de rodricksito / Claude Code. Comprobado en una laptop: la descarga del kit (`deploy/arrancar.sh`), el arranque de la app con esos datos, la subida de un kit completo desde la pantalla y con `curl` (con clave), la creación de la clave de subida y la vuelta a `v1-demo-segura` (etiqueta del repositorio de trabajo). En la laptop no se probaron `docker build` ni `docker run`; el servidor de la demo (`64.177.81.155`) sirve la interfaz de esta copia con los datos en `/datos/data` (comprobado el 2026-10-10 con `/api/salud`). Los comandos usan la IP de ejemplo `203.0.113.10`: cámbiala por la de tu servidor.

## Qué se publica

Un solo contenedor Docker con la pantalla (`web/`) y la API (`backend/`) en el mismo puerto. Todo lo que cambia vive en el volumen `zikit-datos` (montado en `/datos`):

| Carpeta | Qué guarda |
| --- | --- |
| `/datos/data` | El kit público (raíz y 54 corridas). Se descarga solo la primera vez que arranca |
| `/datos/subidas` | Los kits que suba el jurado desde la app (máximo 30; cada kit completo ocupa unos 100 MB y el servidor tiene unos 36 GB libres) |
| `ZIKIT_CLAVE` (opcional) | Si se define al publicar, subir kits pide esa clave. Por omisión la subida es libre (acuerdo del equipo) |

La descarga del kit usa `git sparse-checkout` sin conos y un clon parcial fijado al commit `cdea481` del [kit público](https://github.com/brunovillarrrrrr/zikit-dataset). Solo baja el contenido de `data/`. Nunca baja `_solucion/`, `etiquetas.csv`, `generar.py` ni `scripts/`: sus archivos no llegan ni al disco ni a la copia de git. Si aun así apareciera uno, el contenedor borra la descarga y no arranca.

> El servidor no clona el repositorio: `deploy/publicar.sh` copia el código desde tu copia local con `rsync`, sin `.git`, `.venv`, `.env` ni salidas.

## 1. Crear el servidor (una vez)

1. En Vultr: **Deploy → Cloud Compute**, imagen **Ubuntu 24.04 LTS x64**, 1 vCPU y **2 GB de RAM**. La app guarda en memoria las últimas 128 combinaciones de empresa y corrida que se consultan; llena, ocupa unos 610 MB (medido en la laptop), así que 1 GB queda muy justo. Elige la región más cercana.
2. En **SSH Keys** agrega tu llave pública (`cat ~/.ssh/id_ed25519.pub`). Así no hace falta ninguna contraseña.
3. Anota la IP, por ejemplo `203.0.113.10`.

## 2. Preparar el servidor (una vez)

```sh
ssh root@203.0.113.10
apt-get update && apt-get install -y docker.io rsync
systemctl enable --now docker
exit
```

## 3. Publicar desde la laptop

Desde la carpeta del repositorio:

```sh
deploy/publicar.sh root@203.0.113.10
```

El script hace cuatro cosas:

1. Copia el código al servidor (`~/zikit`) con `rsync`, sin `.git`, `.venv`, `.env`, `backend/salida`, `node_modules` ni `docs/diseno`.
2. Por `ssh`, construye la imagen y arranca el contenedor:

   ```sh
   cd ~/zikit
   docker build -t zikit .
   docker rm -f zikit
   docker run -d --name zikit --restart unless-stopped -p 80:8000 -v zikit-datos:/datos -e ZIKIT_ADAPTAR=1 zikit
   ```

3. Espera a que `/api/salud` responda. La primera vez tarda más: instala las dependencias y descarga el kit (unos 37 MB; en la laptop tardó 1 min 40 s).
4. Imprime la dirección pública (la que se comparte con el jurado). Si se publicó con `ZIKIT_CLAVE`, imprime además el enlace `http://IP/#clave=…`.

Si prefieres hacerlo a mano, son esos mismos comandos. Para ver qué pasa dentro: `ssh root@203.0.113.10 docker logs -f zikit`.

## 4. Comprobar

- Abre `http://203.0.113.10/`: debe salir la pantalla con las corridas de gracko.
- `curl http://203.0.113.10/api/salud` → `{"ok": true, ...}`.
- **Como el jurado:** abre la dirección pública, pulsa «Subir kit», elige el `.zip` y pulsa «Abrir kit». La pantalla dice «Kit listo · N empresas · N corridas», abre la primera corrida del kit («Su kit · raíz», «Su kit · corrida_01», … en «Conjunto de datos») y deja elegir cualquiera de sus empresas en «Empresa», también las que no son gracko. «Descargar alertas.csv» da las alertas de la **empresa elegida** en la corrida completa (no solo hasta la hora reproducida). El archivo de entrega con **todas las empresas** en uno solo es `/api/entrega.csv?corrida=kit-<id>` (abajo). «Enlace a este kit» y la dirección `…/#kit=<id>` vuelven a abrir el kit al recargar o compartir.
- Lo mismo desde una terminal:

  ```sh
  curl -F archivo=@kit.zip http://203.0.113.10/api/kit
  curl -OJ "http://203.0.113.10/api/entrega.csv?corrida=kit-<id>"
  ```

  Los kits no se listan en la pantalla ni en la API: sin el `id` (o el enlace `#kit=<id>`) no se pueden ver. Formatos y errores en [FORMATO_ALERTAS.md](FORMATO_ALERTAS.md) §5.

## 5. Actualizar

Vuelve a ejecutar `deploy/publicar.sh root@203.0.113.10`. El volumen conserva el kit descargado y los kits subidos; solo cambia el código.

## 6. Plan B: apagar la adaptación o volver a la demo segura

| Situación | Qué hacer |
| --- | --- |
| El modo adaptable da algo raro | `ZIKIT_ADAPTAR=0 deploy/publicar.sh root@203.0.113.10`. Mismo código, con el detector calibrado con el kit. Sin reconstruir, en el servidor: `docker rm -f zikit` y el mismo `docker run` con `-e ZIKIT_ADAPTAR=0` |
| La versión nueva falla | `deploy/publicar.sh root@203.0.113.10 v1-demo-segura` publica la etiqueta `v1-demo-segura` (detector de gracko, API y pantalla integradas) con los archivos de despliegue actuales. **No tiene** subida de kits ni descarga de CSV (el enlace con clave que imprime el script no sirve en esa versión) |
| Volver a la versión actual | `deploy/publicar.sh root@203.0.113.10` |

El segundo argumento acepta cualquier etiqueta, rama o commit local.

## 7. HTTPS (opcional) con Caddy y sslip.io

`sslip.io` convierte la IP en un nombre (`203.0.113.10.sslip.io`) para que Caddy pida un certificado gratis. Se hace una vez, en este orden:

1. Publica la app solo hacia dentro del servidor, para liberar el puerto 80 (el 8000 no queda abierto hacia fuera):

   ```sh
   ZIKIT_PUBLICAR=127.0.0.1:8000 deploy/publicar.sh root@203.0.113.10
   ```

2. Instala y configura Caddy:

   ```sh
   ssh root@203.0.113.10
   apt-get install -y caddy
   cat > /etc/caddy/Caddyfile <<'EOF'
   203.0.113.10.sslip.io {
       reverse_proxy 127.0.0.1:8000
   }
   EOF
   ufw status | grep -q "Status: active" && ufw allow 80/tcp && ufw allow 443/tcp
   systemctl restart caddy
   exit
   ```

La app queda en `https://203.0.113.10.sslip.io/`. En adelante, publica siempre con `ZIKIT_PUBLICAR=127.0.0.1:8000`. Si el certificado no sale (límite de Let's Encrypt o puertos 80/443 cerrados en el firewall de Vultr): `ssh root@203.0.113.10 systemctl disable --now caddy`, publica con `deploy/publicar.sh root@203.0.113.10` y usa `http://203.0.113.10/`.

## 8. Si algo falla

| Síntoma | Causa probable y arreglo |
| --- | --- |
| `docker logs zikit` dice `ERROR: ... no trae gracko/metricas.csv` | `/datos/data` quedó a medias: `docker rm -f zikit && docker volume rm zikit-datos` y publica otra vez (borra también los kits subidos) |
| La descarga del kit falla (sin salida a GitHub) | Copia el kit desde la laptop: `rsync -az --exclude _solucion --exclude etiquetas.csv ~/zikit-dataset/data/ root@203.0.113.10:zikit-data/` y arranca con `-v /root/zikit-data:/datos/data:ro` además de `-v zikit-datos:/datos` |
| `port is already allocated` | Otro servicio usa el puerto 80: `ZIKIT_PUBLICAR=8080 deploy/publicar.sh ...` y entra por `http://IP:8080/` |
| La subida responde 413 | El zip pasa de 80 MB o un archivo pasa de su límite (`logs.md` 2 MB; `metricas.csv` y `contexto.md` 5 MB). La carpeta `data/` del kit completo comprimida ocupa 20 MB |
| La subida responde 401 | Se publicó con `ZIKIT_CLAVE` y falta la clave: usa el enlace `#clave=…` que imprimió `deploy/publicar.sh` o escribe la clave en «Clave de subida» |

## Seguridad

- El contenedor corre con un usuario sin privilegios (`zikit`).
- Subir un kit es libre por omisión (acuerdo del equipo). Cada kit solo se ve con su enlace secreto y se guardan 30, así que es difícil desplazar el del jurado. Para cerrarlo, publicar con `ZIKIT_CLAVE` (cabecera `X-Zikit-Clave`).
- Ver un kit no pide clave, pero su identificador son 32 caracteres al azar y no se lista en ningún lado: solo lo ve quien lo subió o recibe su enlace.
- Los límites (zip de 80 MB, archivos de 2–5 MB, 31 días por corrida, 250 MB descomprimido, 30 kits, 2 subidas y 2 análisis a la vez) evitan que un kit llene el disco o la memoria del servidor de 2 GB. Para la presentación basta, pero no es un servicio abierto al público.
- `.env` (la clave de la Claude API) nunca se copia al servidor; la app desplegada no la usa.
