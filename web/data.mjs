// Adapter timestamps are wall-clock values on a logical UTC axis, not a timezone claim.
// This fixed range belongs ONLY to the fictitious example; API ranges come from loadRun.
export const DEFAULT_RANGE = Object.freeze({
  start: "2026-10-08T08:00:00",
  end: "2026-10-14T17:19:00",
});

const KEYS = ["cpu", "ram", "disco", "latencia_ms", "errores"];
const MINUTE = 60_000;
const KIT_RUN = /^kit-[0-9a-f]{32}(?:-corrida_[A-Za-z0-9_-]+)?$/;
const emptyMetrics = () => Object.fromEntries(KEYS.map((key) => [key, null]));

function requestTimeout(run, configured) {
  if (configured !== undefined) return configured;
  // Uploaded kits may trigger a first analysis of several weeks of data.
  return typeof run === "string" && KIT_RUN.test(run) ? 60_000 : 10_000;
}

function invalid(field) {
  throw new Error(
    `Datos no válidos: ${field}. Revisa el formato acordado de la API.`,
  );
}

export function parseTime(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) ||
    value.startsWith("0000")
  ) {
    throw new Error(
      "Fecha no válida. Usa YYYY-MM-DDTHH:mm:ss, sin zona horaria.",
    );
  }
  const epoch = Date.parse(`${value}Z`);
  if (
    !Number.isFinite(epoch) ||
    new Date(epoch).toISOString().slice(0, 19) !== value
  ) {
    throw new Error("Fecha no válida: revisa el día, mes y hora.");
  }
  return epoch;
}

export function isoTime(epoch) {
  if (typeof epoch !== "number" || !Number.isFinite(epoch))
    throw new Error("Instante no válido.");
  const date = new Date(epoch);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new Error("Instante fuera del rango de fechas admitido.");
  }
  return date.toISOString().slice(0, 19);
}

function aborted(signal) {
  if (signal?.aborted)
    throw new DOMException("Solicitud cancelada.", "AbortError");
}

function record(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(field);
  return value;
}

function list(value, field) {
  if (!Array.isArray(value)) invalid(field);
  return value;
}

function optionalList(value, field) {
  return list(value === undefined ? [] : value, field);
}

function string(value, field, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value;
}

function companyName(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value))
    invalid("identificador de empresa");
  return value;
}

function apiBase(value) {
  if (typeof value !== "string" || !/^\/(?!\/)[A-Za-z0-9_/-]+$/.test(value))
    throw new Error("La API debe usar una ruta del mismo origen, como /api.");
  return value.replace(/\/$/, "");
}

function httpOptions(fetchImpl, timeoutMs) {
  if (typeof fetchImpl !== "function")
    throw new Error("No hay un cliente HTTP disponible.");
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647
  )
    throw new Error(
      "El tiempo límite de la API debe ser un número positivo de milisegundos.",
    );
}

function scope(value, tenant, run, field) {
  if (value.tenant !== undefined && value.tenant !== tenant)
    invalid(`empresa de ${field}`);
  if (value.corrida !== undefined && value.corrida !== run)
    invalid(`corrida de ${field}`);
}

function number(value, field, { nullable = false, max = Infinity } = {}) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  )
    invalid(field);
  return value;
}

function timestamp(value) {
  parseTime(value);
  return value;
}

function interval(value, field) {
  record(value, field);
  const inicio = timestamp(value.inicio);
  const fin = timestamp(value.fin);
  if (parseTime(fin) <= parseTime(inicio))
    invalid(`${field}: fin anterior o igual al inicio`);
  return { inicio, fin };
}

function calendar(values) {
  return list(values, "calendario").map((value) => {
    const event = {
      ...interval(value, "evento de calendario"),
      evento: string(value.evento, "nombre del evento"),
      origen: string(
        value.origen,
        "origen del evento",
        "Origen no informado por la API",
      ),
    };
    if (value.suprime !== undefined) {
      if (typeof value.suprime !== "boolean") invalid("suprime del calendario");
      event.suprime = value.suprime;
    }
    if (value.recurrencia !== undefined)
      event.recurrencia = string(
        value.recurrencia,
        "recurrencia del calendario",
      );
    return event;
  });
}

function calendarInfo(payload, fallback = { source: null, warnings: [] }) {
  const source =
    payload.calendario_fuente === undefined
      ? fallback.source
      : payload.calendario_fuente;
  if (source !== null && source !== "contexto.md" && source !== "manual")
    invalid("fuente del calendario");
  const values =
    payload.avisos === undefined ? fallback.warnings : payload.avisos;
  const warnings = list(values, "avisos del calendario").map((warning) =>
    string(warning, "aviso del calendario"),
  );
  return { source, warnings };
}

function samples(values) {
  const seen = new Set();
  return list(values, "serie")
    .map((value) => {
      record(value, "muestra");
      const t = timestamp(value.t);
      if (seen.has(t)) invalid("muestras duplicadas para el mismo instante");
      seen.add(t);
      return {
        t,
        ...Object.fromEntries(
          KEYS.map((key) => [key, number(value[key], key, { nullable: true })]),
        ),
      };
    })
    .sort((a, b) => parseTime(a.t) - parseTime(b.t));
}

function alerts(values, tenant = "gracko", run) {
  const ids = new Set();
  return list(values, "alertas")
    .map((value) => {
      record(value, "alerta");
      scope(value, tenant, run, "la alerta");
      const id = string(value.id, "identificador de la alerta");
      if (ids.has(id)) invalid("identificadores de alerta duplicados");
      ids.add(id);
      const familias = optionalList(
        value.familias,
        "familias de evidencia",
      ).map((family) => {
        record(family, "familia de evidencia");
        const result = { familia: string(family.familia, "familia") };
        for (const key of ["senal", "unidad"]) {
          if (family[key] !== undefined) result[key] = string(family[key], key);
        }
        if (family.ventana_min !== undefined) {
          result.ventana_min = number(
            family.ventana_min,
            "ventana de evidencia",
          );
          if (result.ventana_min === 0) invalid("ventana de evidencia");
        }
        for (const key of [
          "valor",
          "valor_actual",
          "normal",
          "z",
          "horas_para_95",
          "errores_60min",
          "esperados_60min",
          "lineas",
          "confianza",
        ]) {
          if (family[key] !== undefined) {
            // A standardized deviation can be negative, unlike a metric value.
            if (
              family[key] !== null &&
              (typeof family[key] !== "number" || !Number.isFinite(family[key]))
            )
              invalid(key);
            result[key] = family[key];
          }
        }
        for (const key of ["hora", "timestamp"]) {
          if (family[key] !== undefined)
            result[key] = family[key] === null ? null : timestamp(family[key]);
        }
        return result;
      });
      const logs = optionalList(value.logs, "logs").map((log) => {
        record(log, "log");
        return {
          timestamp: timestamp(log.timestamp),
          seccion: string(log.seccion, "sección de log", "Sin sección"),
          nivel: string(log.nivel, "nivel de log", "Sin nivel"),
          mensaje: string(log.mensaje, "mensaje de log"),
        };
      });
      const actualizaciones = optionalList(
        value.actualizaciones,
        "actualizaciones",
      )
        .map((update) => {
          record(update, "actualización");
          return {
            timestamp: timestamp(update.timestamp),
            confianza: number(update.confianza, "confianza de actualización", {
              max: 1,
            }),
            motivo: string(update.motivo, "motivo de actualización"),
          };
        })
        .sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
      const issued = timestamp(value.timestamp);
      if (
        actualizaciones.some(
          (update) => parseTime(update.timestamp) < parseTime(issued),
        )
      )
        invalid("actualización anterior a la alerta");
      return {
        id,
        timestamp: issued,
        confianza: number(value.confianza, "confianza", { max: 1 }),
        tipo: string(value.tipo, "tipo de alerta", "sin_clasificar"),
        resumen: string(
          value.resumen,
          "resumen de alerta",
          "Explicación no disponible en la respuesta.",
        ),
        accion_sugerida: string(
          value.accion_sugerida,
          "acción sugerida",
          "Acción sugerida no proporcionada por el servidor.",
        ),
        familias,
        logs,
        actualizaciones,
      };
    })
    .sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
}

function readWindow({ run, until, from, signal } = {}, range) {
  aborted(signal);
  string(run, "corrida");
  if (from === undefined) from = range.start;
  const end = parseTime(until);
  const start = parseTime(from);
  if (start > end)
    throw new Error("El inicio del tramo no puede ser posterior al reloj.");
  if (start < parseTime(range.start) || end > parseTime(range.end))
    throw new Error(
      "El tramo solicitado está fuera del rango de esta corrida.",
    );
  return { run, until, from, start, end, signal };
}

// Implemented by the backend (GET /api/{tenant}/rango).
// Keep metadata normalization isolated from the replay and presentation.
function runMetadata(payload, run, tenant) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.inicio === undefined ||
    payload.fin === undefined ||
    payload.tenant === undefined ||
    payload.corrida === undefined
  ) {
    throw new Error(
      "El servidor no proporcionó un rango de fechas válido para esta corrida.",
    );
  }
  if (payload.tenant !== tenant || payload.corrida !== run)
    throw new Error("El rango recibido corresponde a otra empresa o corrida.");
  const start = timestamp(payload.inicio);
  const end = timestamp(payload.fin);
  if (parseTime(start) % MINUTE || parseTime(end) % MINUTE)
    throw new Error(
      "El rango de la corrida debe indicar minutos completos, con segundos 00.",
    );
  if (parseTime(start) > parseTime(end))
    throw new Error("El inicio del rango de la corrida es posterior a su fin.");
  if (payload.unidades?.errores !== "errores/min")
    throw new Error(
      "El servidor no declara errores/min para esta corrida. Es necesario confirmar las unidades para mostrar las cifras.",
    );
  return {
    range: { start, end },
    units: { errores: "errores/min" },
    calendarInfo: calendarInfo(payload),
  };
}

function references(values, run, until, tenant = "gracko") {
  const ids = new Set();
  const result = [];
  for (const value of list(values, "referencias de impacto")) {
    record(value, "referencia de impacto");
    // Legacy references without an explicit run cannot be safely associated.
    if (value.corrida === undefined) continue;
    string(value.corrida, "corrida de referencia");
    if (value.tenant !== undefined)
      string(value.tenant, "empresa de referencia");
    if (
      value.corrida !== run ||
      (value.tenant !== undefined && value.tenant !== tenant)
    )
      continue;
    const reference = {
      id: string(value.id, "identificador de referencia"),
      corrida: value.corrida,
      tipo: string(value.tipo, "tipo de referencia"),
      timestamp: timestamp(value.timestamp),
      fuente: string(value.fuente, "fuente de referencia"),
      descripcion: string(value.descripcion, "descripción de referencia"),
    };
    // null explicitly means no association; absence alone permits legacy matching.
    if (value.alerta_id !== undefined)
      reference.alerta_id =
        value.alerta_id === null
          ? null
          : string(value.alerta_id, "alerta de referencia");
    if (ids.has(reference.id)) invalid("referencias duplicadas");
    ids.add(reference.id);
    if (parseTime(reference.timestamp) <= until) result.push(reference);
  }
  result.sort((a, b) => parseTime(a.timestamp) - parseTime(b.timestamp));
  return {
    references: result,
    referenceStatus: result.length ? "available" : "missing",
  };
}

function frame(
  { serie, alertas, calendario, apagones, estado, calendarInfo: info },
  { start, end },
) {
  const gaps = apagones.map((gap) => ({
    ...gap,
    start: parseTime(gap.inicio),
    end: parseTime(gap.fin),
  }));
  const visibleGaps = gaps.filter((gap) => gap.start <= end && gap.end > start);
  const series = serie
    .filter((point) => parseTime(point.t) >= start && parseTime(point.t) <= end)
    .map((point) => {
      const time = parseTime(point.t);
      return gaps.some((gap) => time >= gap.start && time < gap.end)
        ? { t: point.t, ...emptyMetrics() }
        : { ...point };
    });
  // An explicit null at a gap boundary prevents a chart connecting two real
  // samples across a short outage that falls entirely between sample timestamps.
  for (const gap of visibleGaps) {
    const t = isoTime(Math.max(start, gap.start));
    if (!series.some((point) => point.t === t))
      series.push({ t, ...emptyMetrics() });
  }
  series.sort((a, b) => parseTime(a.t) - parseTime(b.t));
  const visibleAlerts = alertas
    .filter((alert) => parseTime(alert.timestamp) <= end)
    .map((alert) => {
      const evidenceLimit = Math.min(end, parseTime(alert.timestamp));
      return {
        ...alert,
        familias: alert.familias
          .filter(
            (family) =>
              (family.timestamp == null ||
                parseTime(family.timestamp) <= evidenceLimit) &&
              (family.hora == null || parseTime(family.hora) <= evidenceLimit),
          )
          .map((family) => ({ ...family })),
        logs: alert.logs
          .filter((log) => parseTime(log.timestamp) <= evidenceLimit)
          .map((log) => ({ ...log })),
        actualizaciones: alert.actualizaciones
          .filter((update) => parseTime(update.timestamp) <= end)
          .map((update) => ({ ...update })),
      };
    });
  const last = series.at(-1);
  const metrics = last
    ? Object.fromEntries(KEYS.map((key) => [key, last[key]]))
    : emptyMetrics();
  const noData = KEYS.every((key) => metrics[key] === null);
  return {
    series,
    alerts: visibleAlerts,
    calendar: calendario.map((event) => ({ ...event })),
    calendarInfo: { source: info.source, warnings: [...info.warnings] },
    apagones: visibleGaps.map((gap) => ({
      inicio: isoTime(Math.max(start, gap.start)),
      fin: isoTime(Math.min(end, gap.end)),
    })),
    metrics,
    status: noData
      ? "Sin datos"
      : estado || "Datos disponibles; estado no informado",
  };
}

function demoData() {
  const calendario = [
    {
      evento: "Carga masiva de declaraciones",
      inicio: "2026-10-09T17:00:00",
      fin: "2026-10-09T19:30:00",
      origen: "contexto.md de gracko; agenda documentada",
      recurrencia: "unica",
      suprime: true,
    },
    {
      evento: "Cierre de nómina",
      inicio: "2026-10-12T10:00:00",
      fin: "2026-10-12T14:00:00",
      origen: "contexto.md de gracko; agenda documentada",
      recurrencia: "unica",
      suprime: true,
    },
    ...Array.from({ length: 7 }, (_, index) => {
      const day = String(8 + index).padStart(2, "0");
      const inicio = `2026-10-${day}T23:00:00`;
      return {
        evento: "Respaldo nocturno · duración supuesta de 60 min",
        inicio,
        fin: isoTime(parseTime(inicio) + 60 * MINUTE),
        recurrencia: "diaria",
        suprime: false,
        origen:
          "contexto.md: inicio a las 23:00; calendario del equipo: duración supuesta de 60 min, no medida",
      };
    }),
  ].sort((a, b) => parseTime(a.inicio) - parseTime(b.inicio));
  const apagones = [
    { inicio: "2026-10-08T14:03:00", fin: "2026-10-08T14:17:00" },
    { inicio: "2026-10-10T09:05:00", fin: "2026-10-10T09:20:00" },
    { inicio: "2026-10-13T14:00:00", fin: "2026-10-13T14:25:00" },
  ];
  const references = [
    {
      tipo: "capacidad_disco",
      timestamp: "2026-10-11T23:00:00",
      descripcion: "Llamada hipotética por espacio en disco",
    },
    {
      tipo: "seguridad_acceso",
      timestamp: "2026-10-13T00:31:00",
      descripcion: "Llamada hipotética por acceso",
    },
    {
      tipo: "degradacion_rendimiento",
      timestamp: "2026-10-14T09:20:00",
      descripcion: "Llamada hipotética por lentitud",
    },
  ].map((reference, index) => ({
    ...reference,
    id: `ejemplo-gracko-hip-${index + 1}`,
    corrida: "ejemplo_01",
    alerta_id: `ficticia-gracko-${reference.tipo}`,
    fuente: "Referencia FICTICIA de demostración; no validada por el evaluador",
  }));
  const definitions = [
    {
      timestamp: "2026-10-10T10:52:00",
      tipo: "capacidad_disco",
      confianza: 0.7,
      signal: "disco",
      normal: 58,
      resumen:
        "EJEMPLO FICTICIO: el uso de /data mantiene una tendencia creciente fuera de la carga prevista.",
      accion:
        "Revisar la tendencia de /data y consultar al responsable antes de modificar archivos.",
    },
    {
      timestamp: "2026-10-12T23:40:00",
      tipo: "seguridad_acceso",
      confianza: 0.76,
      signal: "errores",
      normal: 0,
      resumen:
        "EJEMPLO FICTICIO: aumentan los intentos de acceso fallidos; revisar los registros de autenticación.",
      accion:
        "Contrastar los registros de acceso con el responsable de seguridad; no bloquear cuentas automáticamente.",
    },
    {
      timestamp: "2026-10-13T20:45:00",
      tipo: "degradacion_rendimiento",
      confianza: 0.68,
      signal: "latencia_ms",
      normal: 40,
      resumen:
        "EJEMPLO FICTICIO: la latencia y la carga se mantienen por encima de su referencia ilustrativa.",
      accion:
        "Revisar latencia, carga y calendario con la persona responsable antes de intervenir.",
    },
  ];
  const start = parseTime(DEFAULT_RANGE.start);
  const end = parseTime(DEFAULT_RANGE.end);
  const times = [];
  for (let t = start; t <= end; t += 5 * MINUTE) times.push(t);
  if (times.at(-1) !== end) times.push(end);
  const round = (value) => Math.round(value * 10) / 10;
  const serie = times.map((t, index) => {
    const hour = new Date(t).getUTCHours();
    const work = hour >= 8 && hour < 18;
    const inEvent = calendario.some(
      (event) => t >= parseTime(event.inicio) && t < parseTime(event.fin),
    );
    const diskRamp =
      t >= parseTime("2026-10-10T08:00:00") &&
      t < parseTime("2026-10-12T00:00:00")
        ? Math.min(
            38,
            ((t - parseTime("2026-10-10T08:00:00")) / (60 * MINUTE)) * 1.1,
          )
        : 0;
    const access =
      t >= parseTime("2026-10-12T23:30:00") &&
      t < parseTime("2026-10-13T01:00:00");
    const slow =
      t >= parseTime("2026-10-13T20:00:00") &&
      t < parseTime("2026-10-14T10:00:00");
    return {
      t: isoTime(t),
      cpu: round(
        Math.min(
          97,
          (work ? 27 : 13) +
            Math.sin(index / 11) * 5 +
            (inEvent ? 35 : 0) +
            (slow ? 36 : 0),
        ),
      ),
      ram: round(
        Math.min(
          96,
          51 + Math.sin(index / 31) * 4 + (inEvent ? 12 : 0) + (slow ? 15 : 0),
        ),
      ),
      disco: round(57 + Math.sin(index / 42) * 0.5 + diskRamp),
      latencia_ms: round(
        40 + Math.sin(index / 8) * 5 + (inEvent ? 80 : 0) + (slow ? 170 : 0),
      ),
      errores: access ? 8 + (index % 7) : slow ? 2 + (index % 3) : 0,
    };
  });
  // Partial missing data is also distinct from a valid zero error count.
  const partial = serie.find((point) => point.t === "2026-10-09T08:10:00");
  partial.ram = null;
  const alertas = definitions.map((definition) => {
    // The displayed evidence must be a sample that the replay has already shown.
    const observed = serie.findLast(
      (point) => parseTime(point.t) <= parseTime(definition.timestamp),
    );
    return {
      id: `ficticia-gracko-${definition.tipo}`,
      timestamp: definition.timestamp,
      confianza: definition.confianza,
      tipo: definition.tipo,
      resumen: definition.resumen,
      accion_sugerida: definition.accion,
      familias: [
        {
          familia: "nivel",
          senal: definition.signal,
          valor: observed[definition.signal],
          normal: definition.normal,
          timestamp: observed.t,
        },
      ],
      logs: [
        {
          timestamp: isoTime(parseTime(definition.timestamp) - 2 * MINUTE),
          seccion: "ejemplo",
          nivel: "INFO",
          mensaje:
            "Registro FICTICIO creado para explorar la interfaz; no procede del kit.",
        },
      ],
      actualizaciones: [
        {
          timestamp: isoTime(parseTime(definition.timestamp) + 30 * MINUTE),
          confianza: 0.88,
          motivo:
            "EJEMPLO FICTICIO: persiste la señal en observaciones posteriores.",
        },
      ],
    };
  });
  return { serie, alertas, calendario, apagones, references };
}

export class DemoSource {
  constructor() {
    this.data = demoData();
  }

  async load({ signal } = {}) {
    aborted(signal);
    return { runs: ["ejemplo_01"] };
  }

  async loadRun({ run, signal } = {}) {
    aborted(signal);
    if (run !== "ejemplo_01")
      throw new Error("La corrida elegida no pertenece al ejemplo ficticio.");
    return {
      range: { ...DEFAULT_RANGE },
      units: { errores: "errores/min" },
      calendarInfo: { source: null, warnings: [] },
    };
  }

  async read(options) {
    const metadata = await this.loadRun(options);
    const window = readWindow(options, metadata.range);
    const visible = this.data.alertas.filter(
      (alert) => parseTime(alert.timestamp) <= window.end,
    );
    const escalated = visible.some((alert) =>
      alert.actualizaciones.some(
        (update) => parseTime(update.timestamp) <= window.end,
      ),
    );
    return {
      ...frame(
        {
          ...this.data,
          calendarInfo: metadata.calendarInfo,
          estado: visible.length
            ? escalated
              ? "Alerta escalada"
              : "Alerta abierta"
            : "Ejemplo ficticio: aún sin alertas emitidas",
        },
        window,
      ),
      ...references(this.data.references, window.run, window.end),
    };
  }
}

export class ApiSource {
  constructor({
    tenant = "gracko",
    base = "/api",
    fetchImpl = globalThis.fetch?.bind(globalThis),
    timeoutMs,
  } = {}) {
    this.base = apiBase(base);
    httpOptions(fetchImpl, requestTimeout(undefined, timeoutMs));
    // A source and its metadata cache belong to exactly one company.
    Object.defineProperty(this, "tenant", {
      value: companyName(tenant),
      enumerable: true,
    });
    this.fetchImpl = fetchImpl;
    this.timeoutMs = requestTimeout(undefined, timeoutMs);
    this.kitTimeoutMs = timeoutMs === undefined ? 60_000 : timeoutMs;
    this.runMetadata = new Map();
  }

  async request(endpoint, query, signal) {
    aborted(signal);
    const params = new URLSearchParams(query);
    const suffix = params.size ? `?${params}` : "";
    const controller = new AbortController();
    let rejectStopped;
    const stopped = new Promise((_, reject) => {
      rejectStopped = reject;
    });
    const stop = (error) => {
      if (controller.signal.aborted) return;
      controller.abort(error);
      rejectStopped(error);
    };
    const cancel = () =>
      stop(new DOMException("Solicitud cancelada.", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    // One deadline covers both the headers and JSON body; it is cleaned up on
    // every exit. The race also settles a client that ignores its abort signal.
    const timer = setTimeout(
      () =>
        stop(
          new DOMException(
            `La API de ${endpoint} tardó demasiado en responder. Puedes reintentar.`,
            "TimeoutError",
          ),
        ),
      typeof query.corrida === "string" && KIT_RUN.test(query.corrida)
        ? this.kitTimeoutMs
        : this.timeoutMs,
    );
    try {
      return await Promise.race([
        this.fetchPayload(endpoint, suffix, controller.signal),
        stopped,
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  async fetchPayload(endpoint, suffix, signal) {
    let response;
    try {
      response = await this.fetchImpl(
        `${this.base}/${this.tenant}/${endpoint}${suffix}`,
        {
          signal,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error?.name === "AbortError")
        throw new DOMException("Solicitud cancelada.", "AbortError");
      throw new Error(
        `No se pudo conectar con la API de ${endpoint}. Comprueba que el backend esté disponible.`,
      );
    }
    if (signal.aborted) throw signal.reason;
    if (!response?.ok) {
      const status = Number.isInteger(response?.status)
        ? ` (HTTP ${response.status})`
        : "";
      const error = new Error(
        `La API de ${endpoint} no pudo responder${status}. Puedes reintentar.`,
      );
      error.status = response?.status;
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error?.name === "AbortError")
        throw new DOMException("Solicitud cancelada.", "AbortError");
      throw new Error(
        `La API de ${endpoint} devolvió una respuesta que no es JSON válido.`,
      );
    }
    if (signal.aborted) throw signal.reason;
    return payload;
  }

  async load({ signal } = {}) {
    this.runMetadata.clear();
    const runPayload = await this.request("corridas", {}, signal);
    const runs = list(runPayload, "lista de corridas").map((run) =>
      string(run, "nombre de corrida"),
    );
    if (new Set(runs).size !== runs.length)
      invalid("lista de corridas duplicada");
    aborted(signal);
    return { runs };
  }

  async loadRun({ run, signal } = {}) {
    aborted(signal);
    string(run, "corrida");
    this.runMetadata.delete(run);
    let payload;
    try {
      // Backend PR #25 endpoint; deliberately no fallback to the demo range.
      payload = await this.request("rango", { corrida: run }, signal);
    } catch (error) {
      if (error.status === 404)
        throw new Error(
          "El servidor aún no proporciona el rango por corrida, o no dispone de esta corrida. No se usarán fechas del ejemplo.",
        );
      throw error;
    }
    const metadata = runMetadata(payload, run, this.tenant);
    aborted(signal);
    this.runMetadata.set(run, metadata);
    return {
      range: { ...metadata.range },
      units: { ...metadata.units },
      calendarInfo: {
        source: metadata.calendarInfo.source,
        warnings: [...metadata.calendarInfo.warnings],
      },
    };
  }

  async readReferences(window) {
    try {
      const payload = await this.request(
        "referencias",
        { corrida: window.run, hasta: window.until },
        window.signal,
      );
      return references(payload, window.run, window.end, this.tenant);
    } catch (error) {
      if (window.signal?.aborted || error?.name === "AbortError")
        throw new DOMException("Solicitud cancelada.", "AbortError");
      return { references: [], referenceStatus: "unavailable" };
    }
  }

  async read(options) {
    aborted(options?.signal);
    const metadata = this.runMetadata.get(options?.run);
    if (!metadata)
      throw new Error("Carga primero el rango y las unidades de esta corrida.");
    const window = readWindow(options, metadata.range);
    const common = { corrida: window.run, hasta: window.until };
    const [seriesPayload, alertsPayload, statePayload, referenceFrame] =
      await Promise.all([
        this.request(
          "serie",
          { corrida: window.run, desde: window.from, hasta: window.until },
          window.signal,
        ),
        this.request("alertas", common, window.signal),
        this.request("estado", common, window.signal),
        this.readReferences(window),
      ]);
    record(seriesPayload, "respuesta de serie");
    scope(seriesPayload, this.tenant, window.run, "la serie");
    record(statePayload, "respuesta de estado");
    scope(statePayload, this.tenant, window.run, "estado");
    const estado =
      statePayload.estado === undefined
        ? ""
        : string(statePayload.estado, "estado");
    const data = {
      serie: samples(seriesPayload.serie),
      alertas: alerts(alertsPayload, this.tenant, window.run),
      calendario: calendar(
        seriesPayload.calendario === undefined ? [] : seriesPayload.calendario,
      ),
      calendarInfo: calendarInfo(seriesPayload, metadata.calendarInfo),
      apagones: optionalList(seriesPayload.apagones, "apagones").map((gap) =>
        interval(gap, "apagón"),
      ),
      estado,
    };
    aborted(window.signal);
    return { ...frame(data, window), ...referenceFrame };
  }
}

// Uploaded kits are never enumerated. Only their 128-bit id can reopen them.
export const KIT_MAX_BYTES = 80 * 1024 * 1024;
const KIT_ID = /^[0-9a-f]{32}$/;

export function readKitLink(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const kit = params.get("kit");
  const key = params.get("clave")?.trim();
  return { kit: kit && KIT_ID.test(kit) ? kit : null, key: key || null };
}

export function runLabel(run) {
  if (run === "raiz") return "Conjunto principal";
  if (typeof run === "string" && /^corrida_[A-Za-z0-9_-]+$/.test(run))
    return `Conjunto ${run.slice("corrida_".length)}`;
  return run;
}

export function kitRunLabel(run, id) {
  if (typeof id !== "string" || !KIT_ID.test(id)) return runLabel(run);
  if (run === `kit-${id}`) return "Su kit · Conjunto principal";
  if (typeof run === "string" && run.startsWith(`kit-${id}-`))
    return `Su kit · ${runLabel(run.slice(id.length + 5))}`;
  return runLabel(run);
}

export function deliveryUrl(run, { base = "/api", tenant = null } = {}) {
  const prefix = apiBase(base);
  const query = new URLSearchParams({ corrida: string(run, "corrida") });
  return tenant === null
    ? `${prefix}/entrega.csv?${query}`
    : `${prefix}/${companyName(tenant)}/alertas.csv?${query}`;
}

function companyNames(values, field) {
  const names = list(values, field).map(companyName);
  if (!names.length || new Set(names).size !== names.length) invalid(field);
  return names;
}

export function kitSummary(payload) {
  record(payload, "kit");
  const id = string(payload.id, "identificador del kit");
  if (!KIT_ID.test(id)) invalid("identificador del kit");
  const runs = list(payload.corridas, "corridas del kit").map((run) =>
    string(run, "corrida del kit"),
  );
  const runPattern = new RegExp(`^kit-${id}(?:-corrida_[A-Za-z0-9_-]+)?$`);
  if (
    !runs.length ||
    new Set(runs).size !== runs.length ||
    runs.some((run) => !runPattern.test(run))
  )
    invalid("corridas del kit");
  const companies = companyNames(payload.empresas, "empresas del kit");
  const byRun = record(payload.empresas_por_corrida, "empresas por corrida");
  const companiesByRun = Object.fromEntries(
    runs.map((run) => [run, companyNames(byRun[run], "empresas por corrida")]),
  );
  const present = new Set(Object.values(companiesByRun).flat());
  if (
    present.size !== companies.length ||
    companies.some((name) => !present.has(name))
  )
    invalid("empresas del kit no coinciden con sus corridas");
  const ignored = payload.ignorados === undefined ? 0 : payload.ignorados;
  if (!Number.isSafeInteger(ignored) || ignored < 0)
    invalid("archivos ignorados del kit");
  return {
    id,
    runs,
    companies,
    companiesByRun,
    warnings: optionalList(payload.avisos, "avisos del kit").map((warning) =>
      string(warning, "aviso del kit"),
    ),
    ignored,
  };
}

// These operations share one deadline for headers AND body, including clients
// that ignore AbortSignal. API error details are bounded plain text, never HTML.
async function serviceRequest(
  { base, fetchImpl, signal, timeoutMs },
  endpoint,
  query,
  options,
  action,
) {
  const prefix = apiBase(base);
  httpOptions(fetchImpl, timeoutMs);
  aborted(signal);
  const params = new URLSearchParams(query);
  const url = `${prefix}/${endpoint}${params.size ? `?${params}` : ""}`;
  const controller = new AbortController();
  let rejectStopped;
  const stopped = new Promise((_, reject) => {
    rejectStopped = reject;
  });
  const stop = (error) => {
    if (controller.signal.aborted) return;
    controller.abort(error);
    rejectStopped(error);
  };
  const cancel = () =>
    stop(new DOMException("Solicitud cancelada.", "AbortError"));
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () =>
      stop(
        new DOMException(
          `El servidor tardó demasiado en ${action}. Puedes reintentar.`,
          "TimeoutError",
        ),
      ),
    timeoutMs,
  );
  const request = async () => {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        credentials: "same-origin",
        signal: controller.signal,
        headers: { Accept: "application/json", ...options.headers },
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error?.name === "AbortError")
        throw new DOMException("Solicitud cancelada.", "AbortError");
      throw new Error(
        `No se pudo ${action}: el servidor no responde. Revisa la conexión y vuelve a intentar.`,
      );
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error?.name === "AbortError")
        throw new DOMException("Solicitud cancelada.", "AbortError");
      if (response?.ok)
        throw new Error(`La respuesta para ${action} no es JSON válido.`);
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response?.ok) {
      const detail =
        typeof payload?.detail === "string"
          ? payload.detail
              .replace(/[\u0000-\u001f\u007f]/g, " ")
              .trim()
              .slice(0, 1200)
          : "";
      const status = Number.isInteger(response?.status)
        ? ` (HTTP ${response.status})`
        : "";
      const error = new Error(detail || `No se pudo ${action}${status}.`);
      error.status = response?.status;
      throw error;
    }
    return payload;
  };
  try {
    return await Promise.race([request(), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function loadCompanies({
  run,
  base = "/api",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  signal,
  timeoutMs,
} = {}) {
  const query = run === undefined ? {} : { corrida: string(run, "corrida") };
  const payload = await serviceRequest(
    { base, fetchImpl, signal, timeoutMs: requestTimeout(run, timeoutMs) },
    "empresas",
    query,
    {},
    "cargar las empresas",
  );
  const seen = new Set();
  return list(payload, "lista de empresas").map((value) => {
    record(value, "empresa");
    const tenant = companyName(value.tenant);
    if (seen.has(tenant)) invalid("empresas duplicadas");
    seen.add(tenant);
    if (value.giro !== undefined && typeof value.giro !== "string")
      invalid("giro de empresa");
    if (value.calibrada !== undefined && typeof value.calibrada !== "boolean")
      invalid("calibración de empresa");
    return {
      tenant,
      giro: value.giro ?? "",
      ...(value.calibrada === undefined ? {} : { calibrada: value.calibrada }),
    };
  });
}

export async function uploadKit({
  file,
  key = "",
  base = "/api",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  signal,
  timeoutMs = 120_000,
} = {}) {
  aborted(signal);
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1)
    throw new Error("Elige primero un archivo .zip del kit que no esté vacío.");
  if (typeof file.name !== "string" || !/\.zip$/i.test(file.name))
    throw new Error("El kit debe ser un archivo .zip.");
  if (file.size > KIT_MAX_BYTES)
    throw new Error(
      "El zip pasa de 80 MB. Comprime solo la carpeta data del kit.",
    );
  if (!(file instanceof Blob))
    throw new Error("Elige primero el archivo .zip del kit.");
  if (typeof key !== "string" || /[^\x20-\x7e]/.test(key))
    throw new Error("La clave de subida contiene caracteres no válidos.");
  const body = new FormData();
  body.append("archivo", file, file.name);
  return kitSummary(
    await serviceRequest(
      { base, fetchImpl, signal, timeoutMs },
      "kit",
      {},
      { method: "POST", body, headers: key ? { "X-Zikit-Clave": key } : {} },
      "subir el kit",
    ),
  );
}

export async function loadKit({
  id,
  base = "/api",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  signal,
  timeoutMs = 120_000,
} = {}) {
  if (typeof id !== "string" || !KIT_ID.test(id))
    throw new Error("El enlace no trae un identificador de kit válido.");
  const kit = kitSummary(
    await serviceRequest(
      { base, fetchImpl, signal, timeoutMs },
      `kit/${id}`,
      {},
      {},
      "recuperar el kit",
    ),
  );
  if (kit.id !== id) invalid("el kit recibido no corresponde al enlace");
  return kit;
}
