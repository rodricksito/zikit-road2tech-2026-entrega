#!/usr/bin/env bash
# Publica la app en un servidor con Docker desde una copia local del repositorio (se copia con rsync; el servidor no clona nada).
#
#   deploy/publicar.sh root@203.0.113.10                  el código actual de esta carpeta
#   deploy/publicar.sh root@203.0.113.10 v1-demo-segura   otra versión (etiqueta, rama o commit)
#   ZIKIT_ADAPTAR=0 deploy/publicar.sh root@203.0.113.10  detector calibrado con el kit
#
# Usa tu llave SSH (ssh-agent); el script no guarda contraseñas. En el servidor: Docker y rsync
# instalados y un usuario que pueda usar docker (root o del grupo docker). Ver docs/DESPLIEGUE.md.
# Variables: ZIKIT_PUBLICAR (80: puerto del servidor; 127.0.0.1:8000 si va detrás de Caddy),
# ZIKIT_REMOTO_DIR (zikit, en el home remoto), ZIKIT_ADAPTAR (1), ZIKIT_CLAVE (opcional: si se
# define, subir kits pide esa clave; viaja por la entrada estándar de ssh a un archivo 0600 del
# servidor y llega al contenedor con --env-file, nunca en la línea de comandos).
set -euo pipefail

DESTINO=${1:?"Uso: deploy/publicar.sh usuario@IP [versión]"}
VERSION=${2:-}
REPO=$(cd "$(dirname "$0")/.." && pwd)
REMOTO_DIR=${ZIKIT_REMOTO_DIR:-zikit}
PUBLICAR=${ZIKIT_PUBLICAR:-80}
PUERTO=${PUBLICAR##*:}
ADAPTAR=${ZIKIT_ADAPTAR:-1}

case "$REMOTO_DIR$PUBLICAR$ADAPTAR" in
  *[!A-Za-z0-9._/:-]*) echo "ZIKIT_REMOTO_DIR, ZIKIT_PUBLICAR o ZIKIT_ADAPTAR traen caracteres no válidos." >&2; exit 1 ;;
esac

FUENTE=$REPO
if [ -n "$VERSION" ]; then
  # Otra versión: se exporta de git y se le añaden los archivos de despliegue actuales.
  FUENTE=$(mktemp -d)
  trap 'rm -rf "$FUENTE"' EXIT
  git -C "$REPO" archive --format=tar "$VERSION" | tar -x -C "$FUENTE"
  mkdir -p "$FUENTE/deploy"
  cp "$REPO/Dockerfile" "$REPO/.dockerignore" "$FUENTE/"
  cp "$REPO/deploy/arrancar.sh" "$FUENTE/deploy/arrancar.sh"
  echo "Versión $VERSION ($(git -C "$REPO" rev-parse --short "$VERSION"))"
else
  echo "Versión: carpeta actual ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo 'sin git'))"
fi

echo "1/2 Copiando el código a $DESTINO:$REMOTO_DIR ..."
rsync -az --delete \
  --exclude .git --exclude .venv --exclude venv --exclude node_modules \
  --exclude backend/salida --exclude __pycache__ --exclude .pytest_cache \
  --exclude .env --exclude '.env.*' --exclude .DS_Store --exclude .claude \
  --exclude docs/diseno --exclude '*.zip' \
  "$FUENTE/" "$DESTINO:$REMOTO_DIR/"

CLAVE_ENV="$REMOTO_DIR/.zikit-clave.env"
ENVFILE=""
if [ -n "${ZIKIT_CLAVE:-}" ]; then
  case "$ZIKIT_CLAVE" in
    *$'\n'*|*$'\r'*) echo "ZIKIT_CLAVE no puede tener saltos de línea." >&2; exit 1 ;;
  esac
  printf 'ZIKIT_CLAVE=%s\n' "$ZIKIT_CLAVE" | ssh "$DESTINO" "umask 077 && cat > '$CLAVE_ENV'"
  ENVFILE="--env-file .zikit-clave.env"  # relativo a la carpeta del cd de abajo (= $CLAVE_ENV)
else
  ssh "$DESTINO" "rm -f '$CLAVE_ENV'"  # subida libre (acuerdo del equipo)
fi

echo "2/2 Construyendo y arrancando el contenedor ..."
ssh "$DESTINO" "set -e
  cd '$REMOTO_DIR'
  if [ -n '$ENVFILE' ] && [ ! -f .zikit-clave.env ]; then
    echo 'No se encontró la clave en el servidor; no se toca el contenedor actual.' >&2; exit 1
  fi
  docker build -t zikit .
  docker rm -f zikit >/dev/null 2>&1 || true  # solo después de comprobar todo lo anterior
  docker run -d --name zikit --restart unless-stopped -p $PUBLICAR:8000 \
    -v zikit-datos:/datos -e ZIKIT_ADAPTAR=$ADAPTAR $ENVFILE zikit >/dev/null
  echo 'Esperando a la app (la primera vez descarga el kit, 1-3 min) ...'
  for i in \$(seq 1 90); do
    if curl -fsS http://127.0.0.1:$PUERTO/api/salud >/dev/null 2>&1; then echo 'Lista.'; exit 0; fi
    sleep 2
  done
  echo 'La app no respondió en 3 min. Revisa: docker logs zikit' >&2
  exit 1"

HOST=${DESTINO#*@}
if [ "$PUBLICAR" = "$PUERTO" ]; then
  URL="http://$HOST$([ "$PUERTO" = 80 ] || echo ":$PUERTO")/"
  echo "Publicada en $URL"
else
  URL="https://$HOST.sslip.io/"
  echo "Publicada en $PUBLICAR del servidor (detrás de Caddy: $URL)"
fi
# Subida libre por omisión. Si se publicó con ZIKIT_CLAVE, el enlace la lleva tras «#»: el navegador
# no la envía en la petición de la página y la pantalla la quita de la barra de direcciones.
CLAVE=${ZIKIT_CLAVE:-}
if [ -n "$CLAVE" ]; then
  echo "Enlace para el jurado (puede subir su kit sin escribir la clave): ${URL}#clave=$CLAVE"
  echo "Clave de subida, por si entra sin ese enlace: $CLAVE"
fi
