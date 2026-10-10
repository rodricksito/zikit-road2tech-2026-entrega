# ZIKIT: interfaz (web/) + API (backend/) en un solo contenedor. Ver docs/DESPLIEGUE.md.
#   docker build -t zikit .
#   docker run -d --name zikit --restart unless-stopped -p 80:8000 -v zikit-datos:/datos zikit
# Al arrancar, deploy/arrancar.sh descarga el kit público en /datos/data si aún no está
# (sin _solucion ni etiquetas) y guarda los kits subidos en /datos/subidas.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ backend/
COPY web/ web/
# Hipótesis del equipo para «Nosotros llamamos primero» (/api/{tenant}/referencias).
COPY docs/ejemplos/ docs/ejemplos/
COPY deploy/arrancar.sh deploy/arrancar.sh

RUN useradd --create-home --uid 10001 zikit \
 && mkdir -p /datos \
 && chown zikit:zikit /datos \
 && chmod 755 deploy/arrancar.sh

USER zikit
ENV ZIKIT_DATOS=/datos
EXPOSE 8000
ENTRYPOINT ["/app/deploy/arrancar.sh"]
