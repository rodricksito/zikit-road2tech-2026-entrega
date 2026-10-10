import { parseTime } from "./data.mjs?v=claridad-r31-20261010";

const numberFormat = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 2,
});

const SIGNALS = {
  cpu: { label: "CPU", unit: "%" },
  ram: { label: "RAM", unit: "%" },
  disco: { label: "Disco", unit: "%" },
  latencia_ms: { label: "Tiempo de respuesta", unit: "ms" },
  errores: { label: "Errores", unit: "errores/min" },
};

const INCIDENT_TYPES = new Set([
  "capacidad_disco",
  "memoria",
  "agotamiento_conexiones",
  "base_de_datos",
  "seguridad_acceso",
  "trafico_anomalo",
  "red_enlace",
  "degradacion_rendimiento",
  "anomalia_generica",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function number(value) {
  return isNumber(value) ? numberFormat.format(value) : "sin datos";
}

function measurement(value, unit) {
  return isNumber(value)
    ? `${number(value)}${unit ? ` ${unit}` : ""}`
    : "sin datos";
}

function timestamp(value) {
  try {
    return parseTime(value);
  } catch {
    return null;
  }
}

function evidenceTime(family) {
  const value = family.hora ?? family.timestamp;
  if (timestamp(value) !== null) {
    return `observación: ${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} ${value.slice(11)}`;
  }
  return "hora" in family || "timestamp" in family
    ? "hora de observación no disponible"
    : null;
}

function shortDate(value) {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} a las ${value.slice(11, 16)}`;
}

function summaryForFamily(family, issued) {
  if (!isRecord(family)) return null;
  const signal = SIGNALS[family.senal];
  const label =
    signal?.label ?? (hasText(family.senal) ? family.senal : "La señal");
  const unit = hasText(family.unidad) ? family.unidad : signal?.unit || "";
  const observedAt = family.hora ?? family.timestamp;
  const observed = timestamp(observedAt);
  if (issued !== null && observed !== null && observed > issued) return null;

  switch (family.familia) {
    case "nivel": {
      if (!isNumber(family.valor)) return null;
      const value = measurement(family.valor, unit);
      let statement;
      if (isNumber(family.ventana_min) && family.ventana_min > 0) {
        const duration = `${number(family.ventana_min)} min`;
        const period =
          observed !== null
            ? observed === issued
              ? `en los últimos ${duration}`
              : `en ${duration} hasta el ${shortDate(observedAt)}`
            : `en un periodo de ${duration}`;
        statement = `${label} promedió ${value} ${period}.`;
      } else {
        statement = `${label}: ${value}${observed !== null ? ` el ${shortDate(observedAt)}` : ""}.`;
      }
      return `${statement}${isNumber(family.normal) ? ` Referencia habitual: ${measurement(family.normal, unit)}.` : ""}`;
    }
    case "tendencia":
      return isNumber(family.z) && family.z !== 0
        ? `${label} mostró una tendencia ${family.z > 0 ? "al alza" : "a la baja"} durante las últimas 3 h.`
        : `La tendencia de ${label} requiere revisión.`;
    case "saturacion":
      if (!isNumber(family.horas_para_95) || family.horas_para_95 < 0)
        return null;
      return family.horas_para_95 === 0
        ? `${label} alcanzó o superó el 95 %.`
        : `${label} podría alcanzar el 95 % en ${number(family.horas_para_95)} h, según el ritmo observado.`;
    case "errores":
      if (!isNumber(family.errores_60min)) return null;
      return `${number(family.errores_60min)} errores en los últimos 60 min.${isNumber(family.esperados_60min) ? ` Referencia habitual: ${number(family.esperados_60min)} en ese periodo.` : ""}`;
    case "logs":
      if (!isNumber(family.lineas)) return null;
      return `${number(family.lineas)} ${family.lineas === 1 ? "registro fuera" : "registros fuera"} de lo habitual.`;
    default:
      return null;
  }
}

/** The main message uses one readable signal; full evidence stays in the detail. */
export function formatAlertSummary(alert) {
  if (!isRecord(alert)) return "Consulta el detalle de la detección.";
  const families = Array.isArray(alert.familias) ? alert.familias : [];
  const issued = timestamp(alert.timestamp);
  const metric = families.find(
    (family) =>
      isRecord(family) &&
      family.familia !== "logs" &&
      summaryForFamily(family, issued),
  );
  const selected =
    metric ?? families.find((family) => summaryForFamily(family, issued));
  return selected
    ? summaryForFamily(selected, issued)
    : "Consulta el detalle de la detección y la revisión sugerida.";
}

/** A point at issue time must be explicit; an earlier average is never a substitute. */
export function alertObservation(alert, signal) {
  if (
    !isRecord(alert) ||
    timestamp(alert.timestamp) === null ||
    !Array.isArray(alert.familias)
  ) {
    return null;
  }
  const family = alert.familias.find((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.senal !== signal ||
      !isNumber(candidate.valor_actual)
    ) {
      return false;
    }
    const observed = timestamp(candidate.hora ?? candidate.timestamp);
    return observed === null || observed <= timestamp(alert.timestamp);
  });
  if (!family) return null;
  return {
    value: family.valor_actual,
    unit: hasText(family.unidad) ? family.unidad : SIGNALS[signal]?.unit || "",
    label: SIGNALS[signal]?.label ?? signal,
    timestamp: alert.timestamp,
  };
}

/** Keep the measured average, its reference and its actual window together. */
export function alertAverage(alert, signal) {
  if (!isRecord(alert) || !Array.isArray(alert.familias)) return null;
  const issued = timestamp(alert.timestamp);
  if (issued === null) return null;
  const family = alert.familias.find((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate.familia !== "nivel" ||
      candidate.senal !== signal ||
      !isNumber(candidate.valor) ||
      !isNumber(candidate.ventana_min) ||
      candidate.ventana_min <= 0
    ) {
      return false;
    }
    const observedAt = candidate.hora ?? candidate.timestamp;
    if (observedAt == null) return true;
    const observed = timestamp(observedAt);
    return observed !== null && observed <= issued;
  });
  if (!family) return null;
  return {
    value: family.valor,
    normal: isNumber(family.normal) ? family.normal : null,
    unit: hasText(family.unidad) ? family.unidad : SIGNALS[signal]?.unit || "",
    windowMinutes: family.ventana_min,
    timestamp: family.hora ?? family.timestamp ?? null,
  };
}

const ACTION_VERBS =
  "liberar|averiguar|confirmar|revisar|bloquear|forzar|aplicar|vigilar|cerrar|limitar|identificar|programar|terminar|verificar|activar|preparar|comprobar";

/** Split only independent, supplied actions; ambiguous conditions stay together. */
export function actionSteps(text) {
  if (!hasText(text)) return [];
  const source = text.trim();
  if (
    !new RegExp(`^(?:${ACTION_VERBS})\\b`, "i").test(source) ||
    /\b(?:si|sin|no|solo|sólo|cuando|salvo|excepto)\b/i.test(source)
  ) {
    return [source];
  }
  const separator = new RegExp(
    `(?:,\\s*|\\s+y\\s+)(?=(?:${ACTION_VERBS})\\b)`,
    "gi",
  );
  const pieces = [];
  let start = 0;
  for (const match of source.matchAll(separator)) {
    // A parenthetical example can contain an action, but is still one instruction.
    let depth = 0;
    for (const char of source.slice(0, match.index)) {
      if (char === "(") depth += 1;
      if (char === ")") depth = Math.max(0, depth - 1);
    }
    if (depth) continue;
    // Do not detach an action from a preceding purpose or timing condition.
    if (
      /\b(?:para|antes de|antes del|después de|después del|hasta)\b/i.test(
        source.slice(start, match.index),
      )
    )
      continue;
    pieces.push(source.slice(start, match.index).trim());
    start = match.index + match[0].length;
  }
  pieces.push(source.slice(start).trim());
  return pieces.map(
    (piece) => `${piece[0].toLocaleUpperCase("es-MX")}${piece.slice(1)}`,
  );
}

/** Describe evidence without turning a trend, duration or total into a level. */
export function formatEvidence(family) {
  if (!isRecord(family)) return "Evidencia no disponible.";

  const signal = SIGNALS[family.senal];
  const label =
    signal?.label ?? (hasText(family.senal) ? family.senal : "Señal");
  const explicitUnit = hasText(family.unidad) ? family.unidad : "";
  const levelUnit = explicitUnit || signal?.unit || "";
  const parts = [];

  switch (family.familia) {
    case "nivel":
      parts.push(`${label}: ${measurement(family.valor, levelUnit)}`);
      parts.push(`referencia: ${measurement(family.normal, levelUnit)}`);
      if (isNumber(family.ventana_min) && family.ventana_min > 0) {
        parts.push(`promedios de ${number(family.ventana_min)} min`);
      }
      if (isNumber(family.z)) {
        parts.push(
          `desviación${isNumber(family.ventana_min) && family.ventana_min > 0 ? " del promedio" : ""}: ${number(family.z)} σ`,
        );
      }
      break;
    case "tendencia":
      parts.push(`${label}: tendencia de las últimas 3 h`);
      parts.push(
        isNumber(family.z)
          ? `desviación: ${number(family.z)} σ`
          : "desviación no disponible",
      );
      break;
    case "saturacion":
      if (isNumber(family.horas_para_95) && family.horas_para_95 === 0) {
        parts.push(`${label}: ya alcanzó o superó el 95 %`);
      } else if (isNumber(family.horas_para_95) && family.horas_para_95 > 0) {
        parts.push(
          `${label}: estimación hasta el 95 %: ${number(family.horas_para_95)} h`,
        );
      } else {
        parts.push(`${label}: estimación hasta el 95 % no disponible`);
      }
      break;
    case "errores":
      parts.push(
        `Errores: ${number(family.errores_60min)} en los últimos 60 min`,
      );
      parts.push(`referencia: ${number(family.esperados_60min)} en 60 min`);
      break;
    case "logs":
      parts.push(
        isNumber(family.lineas)
          ? `Logs: ${number(family.lineas)} ${family.lineas === 1 ? "línea" : "líneas"} fuera de lo habitual`
          : "Logs: cantidad de líneas no disponible",
      );
      break;
    default:
      parts.push(
        `${label}: ${hasText(family.familia) ? family.familia : "familia no informada"}`,
      );
      if ("valor" in family) {
        parts.push(`valor: ${measurement(family.valor, explicitUnit)}`);
      }
      if ("normal" in family) {
        parts.push(`referencia: ${measurement(family.normal, explicitUnit)}`);
      }
  }

  const observedAt = evidenceTime(family);
  if (observedAt) parts.push(observedAt);
  if ("valor_actual" in family) {
    parts.push(
      `lectura al emitir la alerta: ${measurement(family.valor_actual, levelUnit)}`,
    );
  }
  return parts.join(" · ");
}

function impactResult(status, reference = null, minutes = null) {
  return { status, reference, minutes };
}

/** Match within a run, without revealing an impact before the replay reaches it. */
export function formatImpact({ alert, alerts, references, run, until } = {}) {
  if (!isRecord(alert) || !Array.isArray(references) || !hasText(run)) {
    return impactResult("missing");
  }
  if (alerts !== undefined && !Array.isArray(alerts)) {
    return impactResult("missing");
  }
  if (alert.tenant !== undefined && alert.tenant !== "gracko") {
    return impactResult("missing");
  }
  if (alert.corrida !== undefined && alert.corrida !== run) {
    return impactResult("missing");
  }

  const cutoff = timestamp(until);
  const issued = timestamp(alert.timestamp);
  if (cutoff === null || issued === null || issued > cutoff) {
    return impactResult("missing");
  }

  const scoped = references.filter(
    (reference) =>
      isRecord(reference) &&
      hasText(reference.id) &&
      reference.corrida === run &&
      (reference.tenant === undefined || reference.tenant === "gracko") &&
      timestamp(reference.timestamp) !== null,
  );
  const linked = hasText(alert.id)
    ? scoped.filter((reference) => reference.alerta_id === alert.id)
    : [];
  const candidates = linked.length
    ? linked
    : scoped.filter(
        (reference) =>
          reference.alerta_id === undefined &&
          INCIDENT_TYPES.has(alert.tipo) &&
          reference.tipo === alert.tipo,
      );

  if (!candidates.length) return impactResult("missing");
  if (candidates.length !== 1) return impactResult("ambiguous");

  // A unique reference is still ambiguous when several observed alerts share
  // its type. An explicit alert link resolves that ambiguity independently.
  if (!linked.length && alerts) {
    const sameType = alerts.filter((candidate) => {
      if (!isRecord(candidate) || candidate.tipo !== alert.tipo) return false;
      if (candidate.tenant !== undefined && candidate.tenant !== "gracko") {
        return false;
      }
      if (candidate.corrida !== undefined && candidate.corrida !== run) {
        return false;
      }
      const candidateTime = timestamp(candidate.timestamp);
      return candidateTime !== null && candidateTime <= cutoff;
    });
    if (sameType.length > 1) return impactResult("ambiguous");
  }

  const reference = candidates[0];
  const impact = timestamp(reference.timestamp);
  if (impact > cutoff) return impactResult("pending");
  return impactResult(
    "available",
    { ...reference },
    (impact - issued) / 60_000,
  );
}
