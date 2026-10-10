#!/bin/sh
# Arranque del contenedor: descarga el kit público si falta y levanta la app (interfaz + API).
#
#   deploy/arrancar.sh                   descarga el kit si hace falta y sirve en 0.0.0.0:8000
#   deploy/arrancar.sh --solo-descargar  solo la descarga (para probarla o prepararla)
#
# Variables: ZIKIT_DATOS (/datos), ZIKIT_DATA ($ZIKIT_DATOS/data), ZIKIT_SUBIDAS ($ZIKIT_DATOS/subidas),
# ZIKIT_PUERTO (8000), ZIKIT_ADAPTAR (1; 0 = detector calibrado con el kit), ZIKIT_KIT_REPO, ZIKIT_KIT_COMMIT,
# ZIKIT_CLAVE (opcional): si se define, subir kits exige esa clave. Por omisión la subida es libre
# (acuerdo del equipo): cada kit solo se ve con su enlace secreto y se guardan hasta 30.
#
# La descarga usa git sparse-checkout en modo no-cone y un clon parcial (sin blobs): solo baja el
# contenido de /data/, y nunca el de _solucion/, etiquetas.csv, generar.py ni scripts/.
set -eu

DATOS=${ZIKIT_DATOS:-/datos}
DATA=${ZIKIT_DATA:-$DATOS/data}
ZIKIT_SUBIDAS=${ZIKIT_SUBIDAS:-$DATOS/subidas}
export ZIKIT_SUBIDAS
KIT_REPO=${ZIKIT_KIT_REPO:-https://github.com/brunovillarrrrrr/zikit-dataset.git}
KIT_COMMIT=${ZIKIT_KIT_COMMIT:-cdea481cb61a8d6e6a3514418b8da8136198c0ae}  # cdea481: corridas 11-54 (sin _solucion)
APP=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

prohibidos() {  # rutas prohibidas que existan en disco (solo nombres; no se abre nada)
  find "$1" -path "$1/.git" -prune -o \( -name _solucion -o -name etiquetas.csv -o -name generar.py \) -print
}

descargar_kit() {
  if [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ]; then
    echo "ERROR: $DATA existe pero no trae gracko/metricas.csv; revísalo o bórralo antes de arrancar." >&2
    exit 1
  fi
  padre=$(dirname -- "$DATA")
  mkdir -p "$padre"
  tmp="$padre/.kit-descarga-$$"
  rm -rf "$tmp"
  trap 'rm -rf "$tmp"' EXIT  # si git falla (sin red, commit inexistente), no deja la descarga a medias
  echo "Descargando el kit ($KIT_REPO @ $KIT_COMMIT) en $DATA ..."
  git init -q "$tmp"
  git -C "$tmp" remote add origin "$KIT_REPO"
  git -C "$tmp" config remote.origin.promisor true
  git -C "$tmp" config remote.origin.partialclonefilter blob:none
  git -C "$tmp" config core.sparseCheckout true
  git -C "$tmp" config core.sparseCheckoutCone false
  # Patrones de sparse-checkout (estilo .gitignore, el último que coincide manda).
  printf '%s\n' '/data/' '!**/_solucion/' '!**/_solucion/**' '!**/etiquetas.csv' '!**/generar.py' \
    > "$tmp/.git/info/sparse-checkout"
  git -C "$tmp" fetch -q --depth 1 --filter=blob:none origin "$KIT_COMMIT"
  git -C "$tmp" -c advice.detachedHead=false checkout -q FETCH_HEAD
  encontrados=$(prohibidos "$tmp")
  if [ -n "$encontrados" ]; then
    rm -rf "$tmp"
    echo "ERROR: la descarga trajo archivos prohibidos; se borró todo:" >&2
    echo "$encontrados" >&2
    exit 1
  fi
  if [ ! -f "$tmp/data/gracko/metricas.csv" ]; then
    rm -rf "$tmp"
    echo "ERROR: la descarga no trae data/gracko/metricas.csv." >&2
    exit 1
  fi
  if [ -d "$DATA" ]; then rmdir "$DATA"; fi  # solo si estaba vacía (se comprobó arriba)
  mv "$tmp/data" "$DATA"
  rm -rf "$tmp"
  trap - EXIT
  echo "Kit listo: $(find "$DATA" -name metricas.csv | wc -l | tr -d ' ') metricas.csv; sin _solucion ni etiquetas."
}

if [ ! -f "$DATA/gracko/metricas.csv" ]; then
  descargar_kit
fi
if [ -n "$(prohibidos "$DATA")" ]; then
  echo "ERROR: $DATA contiene _solucion, etiquetas.csv o generar.py; no se arranca." >&2
  exit 1
fi
[ "${1:-}" = "--solo-descargar" ] && exit 0

# Subida libre por omisión; con ZIKIT_CLAVE definida, la API la exige (cabecera X-Zikit-Clave).
if [ -n "${ZIKIT_CLAVE:-}" ]; then export ZIKIT_CLAVE; else unset ZIKIT_CLAVE; fi

mkdir -p "$ZIKIT_SUBIDAS"
cd "$APP/backend"
exec python -m zikit servir --host 0.0.0.0 --puerto "${ZIKIT_PUERTO:-8000}" --data "$DATA"
