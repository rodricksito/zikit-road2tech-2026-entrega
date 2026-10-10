import test from "node:test";
import assert from "node:assert/strict";
import {
  actionSteps,
  alertAverage,
  alertObservation,
  formatAlertSummary,
  formatEvidence,
  formatImpact,
} from "../web/presentation.mjs";

const RUN = "corrida_01";
const alert = {
  id: "gracko-disco-1",
  tenant: "gracko",
  timestamp: "2026-10-10T10:00:00",
  tipo: "capacidad_disco",
};
const reference = {
  id: "impacto-disco",
  corrida: RUN,
  tipo: "capacidad_disco",
  timestamp: "2026-10-10T11:00:00",
  descripcion: "Impacto hipotético de prueba",
  fuente: "Hipótesis del equipo",
};
const parameters = (extra = {}) => ({
  alert,
  references: [reference],
  run: RUN,
  until: "2026-10-10T12:00:00",
  ...extra,
});
const hiddenResult = (status) => ({ status, reference: null, minutes: null });

test("level evidence distinguishes its averaging window, peak time and reading at issue time", () => {
  const text = formatEvidence({
    familia: "nivel",
    senal: "latencia_ms",
    valor: 74.4,
    normal: 40.6,
    ventana_min: 15,
    z: 6.3,
    hora: "2026-10-13T20:16:00",
    valor_actual: 43.4,
  });
  assert.equal(
    text,
    "Tiempo de respuesta: 74.4 ms · referencia: 40.6 ms · promedios de 15 min · desviación del promedio: 6.3 σ · observación: 13/10/2026 20:16:00 · lectura al emitir la alerta: 43.4 ms",
  );
});

test("valid zero readings stay zero and missing current values stay missing", () => {
  const text = formatEvidence({
    familia: "nivel",
    senal: "cpu",
    valor: 0,
    normal: 20,
    timestamp: "2026-10-10T10:00:12",
    valor_actual: null,
  });
  assert.match(text, /CPU: 0 % · referencia: 20 %/);
  assert.match(text, /10\/10\/2026 10:00:12/);
  assert.match(text, /lectura al emitir la alerta: sin datos/);
  assert.doesNotMatch(text, /sin datos %/);
});

test("trend evidence uses its standardized deviation, not a fabricated percentage", () => {
  const text = formatEvidence({ familia: "tendencia", senal: "disco", z: 4.2 });
  assert.equal(text, "Disco: tendencia de las últimas 3 h · desviación: 4.2 σ");
  assert.doesNotMatch(text, /%|valor:|referencia:/);
  assert.match(
    formatEvidence({ familia: "tendencia", senal: "ram", z: null }),
    /desviación no disponible/,
  );
});

test("saturation preserves estimated hours, distinguishes zero and tolerates missing data", () => {
  assert.equal(
    formatEvidence({
      familia: "saturacion",
      senal: "disco",
      horas_para_95: 0.5,
    }),
    "Disco: estimación hasta el 95 %: 0.5 h",
  );
  assert.match(
    formatEvidence({ familia: "saturacion", senal: "ram", horas_para_95: 0 }),
    /ya alcanzó o superó el 95 %/,
  );
  for (const value of [null, undefined, NaN, -1]) {
    assert.match(
      formatEvidence({
        familia: "saturacion",
        senal: "ram",
        horas_para_95: value,
      }),
      /estimación hasta el 95 % no disponible/,
    );
  }
});

test("error totals remain counts over 60 minutes and logs preserve their count", () => {
  const errors = formatEvidence({
    familia: "errores",
    errores_60min: 0,
    esperados_60min: 24.5,
  });
  assert.equal(
    errors,
    "Errores: 0 en los últimos 60 min · referencia: 24.5 en 60 min",
  );
  assert.doesNotMatch(errors, /errores\/min/);
  assert.match(
    formatEvidence({
      familia: "errores",
      errores_60min: null,
      esperados_60min: null,
    }),
    /sin datos en los últimos 60 min · referencia: sin datos en 60 min/,
  );
  assert.equal(
    formatEvidence({ familia: "logs", lineas: 1 }),
    "Logs: 1 línea fuera de lo habitual",
  );
  assert.equal(
    formatEvidence({ familia: "logs", lineas: 3 }),
    "Logs: 3 líneas fuera de lo habitual",
  );
});

test("unknown signals do not acquire invented units and inputs are unchanged", () => {
  const family = Object.freeze({
    familia: "medicion_externa",
    senal: "Cola",
    valor: 7,
    normal: 3,
    unidad: "solicitudes",
  });
  assert.equal(
    formatEvidence(family),
    "Cola: medicion_externa · valor: 7 solicitudes · referencia: 3 solicitudes",
  );
  assert.match(
    formatEvidence({
      familia: "nivel",
      senal: "desconocida",
      valor: 7,
      normal: 3,
    }),
    /^desconocida: 7 · referencia: 3$/,
  );
  assert.equal(formatEvidence(null), "Evidencia no disponible.");
});

test("the main message separates a 15-minute average from the issue-time reading", () => {
  const selected = Object.freeze({
    ...alert,
    resumen: "Disco: 8.0σ; además, señales menores: logs.",
    familias: [
      Object.freeze({
        familia: "nivel",
        senal: "disco",
        valor: 64.4,
        normal: 58.4,
        ventana_min: 15,
        hora: alert.timestamp,
        valor_actual: 64.6,
        z: 8,
      }),
    ],
  });
  assert.equal(
    formatAlertSummary(selected),
    "Disco promedió 64.4 % en los últimos 15 min. Referencia habitual: 58.4 %.",
  );
  assert.deepEqual(alertObservation(selected, "disco"), {
    value: 64.6,
    unit: "%",
    label: "Disco",
    timestamp: alert.timestamp,
  });
  assert.doesNotMatch(formatAlertSummary(selected), /σ|logs|sostenid|64\.6/);
});

test("an older average shows its real end time, not the latest 15 minutes", () => {
  const selected = {
    ...alert,
    timestamp: "2026-10-11T08:24:00",
    familias: [
      {
        familia: "nivel",
        senal: "disco",
        valor: 64.4,
        normal: 58.4,
        ventana_min: 15,
        hora: "2026-10-10T12:06:00",
        valor_actual: 65,
      },
    ],
  };
  assert.equal(
    formatAlertSummary(selected),
    "Disco promedió 64.4 % en 15 min hasta el 10/10/2026 a las 12:06. Referencia habitual: 58.4 %.",
  );
  assert.equal(
    alertObservation(selected, "disco").timestamp,
    selected.timestamp,
  );
});

test("the highlighted average retains its window, reference and actual evidence time", () => {
  const family = Object.freeze({
    familia: "nivel",
    senal: "latencia_ms",
    valor: 74.4,
    normal: 40.6,
    ventana_min: 15,
    hora: "2026-10-10T09:56:00",
    valor_actual: 43.4,
  });
  const selected = Object.freeze({ ...alert, familias: [family] });
  assert.deepEqual(alertAverage(selected, "latencia_ms"), {
    value: 74.4,
    normal: 40.6,
    unit: "ms",
    windowMinutes: 15,
    timestamp: family.hora,
  });
  assert.equal(alertObservation(selected, "latencia_ms").value, 43.4);
  assert.equal(
    alertObservation(selected, "latencia_ms").timestamp,
    alert.timestamp,
  );
});

test("average and reference zeros stay visible while a missing reference stays null", () => {
  const family = {
    familia: "nivel",
    senal: "disco",
    valor: 0,
    normal: 0,
    ventana_min: 15,
    timestamp: alert.timestamp,
  };
  const selected = { ...alert, familias: [family] };
  assert.deepEqual(alertAverage(selected, "disco"), {
    value: 0,
    normal: 0,
    unit: "%",
    windowMinutes: 15,
    timestamp: alert.timestamp,
  });
  for (const normal of [null, undefined, NaN, "0"]) {
    family.normal = normal;
    assert.equal(alertAverage(selected, "disco").normal, null);
  }
});

test("an average without an evidence time does not acquire the alert emission time", () => {
  const family = {
    familia: "nivel",
    senal: "cola",
    unidad: "solicitudes",
    valor: 12,
    normal: 4,
    ventana_min: 10,
  };
  const selected = { ...alert, familias: [family] };
  assert.deepEqual(alertAverage(selected, "cola"), {
    value: 12,
    normal: 4,
    unit: "solicitudes",
    windowMinutes: 10,
    timestamp: null,
  });
  family.hora = null;
  assert.equal(alertAverage(selected, "cola").timestamp, null);
  delete family.unidad;
  assert.equal(alertAverage(selected, "cola").unit, "");
});

test("a highlighted average requires an explicit duration and matching level signal", () => {
  const family = {
    familia: "nivel",
    senal: "disco",
    valor: 64.4,
    normal: 58.4,
    ventana_min: 15,
    hora: alert.timestamp,
  };
  const average = (changes) =>
    alertAverage({ ...alert, familias: [{ ...family, ...changes }] }, "disco");
  for (const ventana_min of [undefined, null, 0, -1, NaN, Infinity, "15"]) {
    assert.equal(average({ ventana_min }), null);
  }
  for (const valor of [undefined, null, NaN, Infinity, "64.4"]) {
    assert.equal(average({ valor }), null);
  }
  for (const familia of ["tendencia", "saturacion", "errores", "logs"]) {
    assert.equal(average({ familia }), null);
  }
  assert.equal(average({ senal: "ram" }), null);
  for (const selected of [null, {}, { ...alert, familias: [null] }]) {
    assert.equal(alertAverage(selected, "disco"), null);
  }
});

test("future or malformed evidence is skipped and an invalid alert time yields no average", () => {
  const family = {
    familia: "nivel",
    senal: "disco",
    valor: 64.4,
    normal: 58.4,
    ventana_min: 15,
  };
  const selected = { ...alert, familias: [{ ...family }] };
  for (const hora of ["2026-10-10T10:00:01", "not-a-date", ""]) {
    selected.familias[0].hora = hora;
    assert.equal(alertAverage(selected, "disco"), null);
  }
  selected.familias.push({ ...family, timestamp: "2026-10-10T09:55:00" });
  assert.equal(
    alertAverage(selected, "disco").timestamp,
    "2026-10-10T09:55:00",
  );
  selected.timestamp = "invalid";
  assert.equal(alertAverage(selected, "disco"), null);
});

test("a reading without an averaging window does not gain a made-up duration", () => {
  const selected = {
    ...alert,
    familias: [
      {
        familia: "nivel",
        senal: "disco",
        valor: 0,
        normal: 3,
        timestamp: alert.timestamp,
      },
    ],
  };
  assert.equal(
    formatAlertSummary(selected),
    "Disco: 0 % el 10/10/2026 a las 10:00. Referencia habitual: 3 %.",
  );
  assert.doesNotMatch(formatAlertSummary(selected), /promed|últimos|15 min/);
  assert.equal(alertObservation(selected, "disco"), null);
});

test("missing average times do not become the last minutes and null is not zero", () => {
  const selected = {
    ...alert,
    familias: [
      {
        familia: "nivel",
        senal: "ram",
        valor: 50,
        normal: null,
        ventana_min: 15,
        hora: null,
        valor_actual: null,
      },
    ],
  };
  assert.equal(
    formatAlertSummary(selected),
    "RAM promedió 50 % en un periodo de 15 min.",
  );
  assert.equal(alertObservation(selected, "ram"), null);
  selected.familias[0].valor_actual = 0;
  assert.equal(alertObservation(selected, "ram").value, 0);
});

test("trend, saturation and error summaries preserve their distinct quantities", () => {
  const summary = (family) =>
    formatAlertSummary({ ...alert, familias: [family] });
  assert.equal(
    summary({ familia: "tendencia", senal: "disco", z: 4.2 }),
    "Disco mostró una tendencia al alza durante las últimas 3 h.",
  );
  assert.doesNotMatch(
    summary({ familia: "tendencia", senal: "disco", z: 4.2 }),
    /%|σ/,
  );
  assert.match(
    summary({ familia: "tendencia", senal: "disco", z: -2 }),
    /a la baja/,
  );
  assert.equal(
    summary({ familia: "saturacion", senal: "ram", horas_para_95: 0 }),
    "RAM alcanzó o superó el 95 %.",
  );
  assert.equal(
    summary({ familia: "saturacion", senal: "ram", horas_para_95: 0.5 }),
    "RAM podría alcanzar el 95 % en 0.5 h, según el ritmo observado.",
  );
  assert.equal(
    summary({ familia: "errores", errores_60min: 0, esperados_60min: 3 }),
    "0 errores en los últimos 60 min. Referencia habitual: 3 en ese periodo.",
  );
});

test("metrics precede logs and unsupported evidence falls back without exposing technical prose", () => {
  const selected = {
    ...alert,
    resumen: "8.0σ; logs.",
    familias: [
      { familia: "logs", lineas: 2 },
      { familia: "nivel", senal: "latencia_ms", valor: 8, normal: 5 },
    ],
  };
  assert.equal(
    formatAlertSummary(selected),
    "Tiempo de respuesta: 8 ms. Referencia habitual: 5 ms.",
  );
  assert.equal(
    formatAlertSummary({
      ...selected,
      familias: [{ familia: "logs", lineas: 1 }],
    }),
    "1 registro fuera de lo habitual.",
  );
  assert.equal(
    formatAlertSummary({ ...selected, familias: [{ familia: "nueva" }] }),
    "Consulta el detalle de la detección y la revisión sugerida.",
  );
});

test("future evidence is excluded and an issue-time reading requires a valid alert time", () => {
  const selected = {
    ...alert,
    familias: [
      {
        familia: "nivel",
        senal: "disco",
        valor: 90,
        valor_actual: 91,
        hora: "2026-10-11T10:00:00",
      },
    ],
  };
  assert.doesNotMatch(formatAlertSummary(selected), /90|91/);
  assert.equal(alertObservation(selected, "disco"), null);
  assert.equal(
    alertObservation({ ...selected, timestamp: null }, "disco"),
    null,
  );
  assert.equal(
    alertObservation({ ...selected, familias: [null] }, "disco"),
    null,
  );
});

test("action steps preserve examples and time restrictions when splitting independent verbs", () => {
  assert.deepEqual(
    actionSteps(
      "Liberar espacio en el volumen afectado (archivos temporales y exportaciones), averiguar qué proceso lo está llenando y confirmar que el próximo respaldo tendrá lugar.",
    ),
    [
      "Liberar espacio en el volumen afectado (archivos temporales y exportaciones)",
      "Averiguar qué proceso lo está llenando",
      "Confirmar que el próximo respaldo tendrá lugar.",
    ],
  );
  assert.deepEqual(
    actionSteps(
      "Identificar el proceso que crece en memoria y programar su reinicio controlado fuera del horario crítico.",
    ),
    [
      "Identificar el proceso que crece en memoria",
      "Programar su reinicio controlado fuera del horario crítico.",
    ],
  );
  assert.deepEqual(
    actionSteps(
      "Revisar consultas lentas y bloqueos en la base de datos y terminar las transacciones colgadas.",
    ),
    [
      "Revisar consultas lentas y bloqueos en la base de datos",
      "Terminar las transacciones colgadas.",
    ],
  );
});

test("conditional actions and parenthetical instructions remain attached", () => {
  for (const text of [
    "Si hay respaldo, liberar espacio y confirmar el resultado.",
    "Revisar sin cerrar conexiones y limitar el acceso.",
    "No bloquear el servicio y revisar los registros.",
    "Revisar el proceso (confirmar su origen y comprobar su estado).",
    "Revisar el respaldo antes de bloquear el rango y forzar el cambio de contraseña.",
    "Revisar la evidencia para confirmar el origen y bloquear el rango correcto.",
    "Contactar al responsable y comprobar los registros.",
  ])
    assert.deepEqual(actionSteps(text), [text]);
  assert.deepEqual(actionSteps(null), []);
  assert.deepEqual(actionSteps("  "), []);
});

test("a unique canonical type matches only within the selected run and tenant", () => {
  const result = formatImpact(
    parameters({
      references: [
        { ...reference, id: "otra-corrida", corrida: "corrida_02" },
        { ...reference, id: "otra-empresa", tenant: "kaiku" },
        reference,
      ],
    }),
  );
  assert.deepEqual(result, { status: "available", reference, minutes: 60 });
  assert.deepEqual(
    formatImpact(parameters({ run: "corrida_02" })),
    hiddenResult("missing"),
  );
  assert.deepEqual(
    formatImpact(
      parameters({ references: [{ ...reference, corrida: undefined }] }),
    ),
    hiddenResult("missing"),
  );
});

test("references without identity or canonical type cannot match by missing values or titles", () => {
  for (const replacement of [
    { ...reference, id: undefined },
    { ...reference, id: "" },
    { ...reference, tipo: undefined },
    { ...reference, tipo: "Disco cerca de llenarse" },
    { ...reference, timestamp: "2026-02-30T10:00:00" },
  ]) {
    assert.deepEqual(
      formatImpact(parameters({ references: [replacement] })),
      hiddenResult("missing"),
    );
  }
  assert.deepEqual(
    formatImpact(
      parameters({
        alert: { ...alert, tipo: undefined },
        references: [{ ...reference, tipo: undefined }],
      }),
    ),
    hiddenResult("missing"),
  );
  assert.deepEqual(
    formatImpact(
      parameters({
        alert: { ...alert, tipo: "sin_clasificar" },
        references: [{ ...reference, tipo: "sin_clasificar" }],
      }),
    ),
    hiddenResult("missing"),
  );
});

test("an explicit alert link takes precedence and never falls back to another alert", () => {
  const explicit = {
    ...reference,
    id: "enlace-explicito",
    alerta_id: alert.id,
  };
  assert.deepEqual(
    formatImpact(parameters({ references: [reference, explicit] })),
    { status: "available", reference: explicit, minutes: 60 },
  );
  assert.deepEqual(
    formatImpact(
      parameters({ references: [{ ...reference, alerta_id: "otra-alerta" }] }),
    ),
    hiddenResult("missing"),
  );
  assert.deepEqual(
    formatImpact(
      parameters({
        alert: { ...alert, id: undefined },
        references: [explicit],
      }),
    ),
    hiddenResult("missing"),
  );
});

test("multiple type matches or explicit links are ambiguous, including future candidates", () => {
  const other = {
    ...reference,
    id: "otro-impacto",
    timestamp: "2026-10-10T13:00:00",
  };
  assert.deepEqual(
    formatImpact(parameters({ references: [reference, other] })),
    hiddenResult("ambiguous"),
  );
  assert.deepEqual(
    formatImpact(
      parameters({
        references: [reference, other].map((item) => ({
          ...item,
          alerta_id: alert.id,
        })),
      }),
    ),
    hiddenResult("ambiguous"),
  );
});

test("one unlinked impact cannot be assigned to two observed alerts of the same type", () => {
  const second = {
    ...alert,
    id: "gracko-disco-2",
    timestamp: "2026-10-10T10:30:00",
  };
  for (const selected of [alert, second]) {
    assert.deepEqual(
      formatImpact(parameters({ alert: selected, alerts: [alert, second] })),
      hiddenResult("ambiguous"),
    );
  }
});

test("future alerts and alerts from another run, tenant or type do not create ambiguity", () => {
  const alerts = [
    alert,
    { ...alert, id: "future", timestamp: "2026-10-10T12:00:01" },
    { ...alert, id: "other-run", corrida: "corrida_02" },
    { ...alert, id: "other-tenant", tenant: "kaiku" },
    { ...alert, id: "other-type", tipo: "memoria" },
    { ...alert, id: "invalid-time", timestamp: null },
  ];
  assert.deepEqual(formatImpact(parameters({ alerts })), {
    status: "available",
    reference,
    minutes: 60,
  });
  assert.deepEqual(
    formatImpact(parameters({ alerts, until: "2026-10-10T12:00:01" })),
    hiddenResult("ambiguous"),
  );
});

test("an exact alert link resolves ambiguity among alerts of the same canonical type", () => {
  const explicit = { ...reference, alerta_id: alert.id };
  const alerts = [
    alert,
    { ...alert, id: "gracko-disco-2", timestamp: "2026-10-10T10:30:00" },
  ];
  assert.deepEqual(
    formatImpact(parameters({ alerts, references: [explicit] })),
    { status: "available", reference: explicit, minutes: 60 },
  );
  assert.deepEqual(
    formatImpact(
      parameters({ alert: alerts[1], alerts, references: [explicit] }),
    ),
    hiddenResult("missing"),
  );
});

test("a future impact hides its timestamp and gain until the exact reference time", () => {
  assert.deepEqual(
    formatImpact(parameters({ until: "2026-10-10T10:59:59" })),
    hiddenResult("pending"),
  );
  assert.deepEqual(formatImpact(parameters({ until: reference.timestamp })), {
    status: "available",
    reference,
    minutes: 60,
  });
  assert.deepEqual(
    formatImpact(parameters({ until: "2026-10-10T09:59:59" })),
    hiddenResult("missing"),
  );
});

test("a late alert preserves a negative gain instead of reporting positive anticipation", () => {
  const lateAlert = { ...alert, timestamp: "2026-10-10T11:15:00" };
  assert.equal(formatImpact(parameters({ alert: lateAlert })).minutes, -15);
  assert.equal(
    formatImpact(
      parameters({ alert: { ...alert, timestamp: reference.timestamp } }),
    ).minutes,
    0,
  );
});

test("invalid scope and dates fail closed and frozen input remains unchanged", () => {
  for (const extra of [
    { alert: null },
    { alert: { ...alert, tenant: "ttr" } },
    { alert: { ...alert, corrida: "corrida_02" } },
    { alert: { ...alert, timestamp: null } },
    { references: null },
    { run: "" },
    { until: "2026-10-10T12:00:00Z" },
  ]) {
    assert.deepEqual(formatImpact(parameters(extra)), hiddenResult("missing"));
  }
  const frozenReference = Object.freeze({ ...reference });
  const result = formatImpact(
    parameters({
      alert: Object.freeze({ ...alert }),
      references: Object.freeze([frozenReference]),
    }),
  );
  assert.deepEqual(result, { status: "available", reference, minutes: 60 });
  assert.notEqual(result.reference, frozenReference);
});
