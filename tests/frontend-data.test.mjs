import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { getEventListeners, once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { formatImpact } from "../web/presentation.mjs";
import {
  ApiSource,
  DemoSource,
  DEFAULT_RANGE,
  loadCompanies,
  parseTime,
  isoTime,
} from "../web/data.mjs";

const time = (minute) => `2026-10-08T08:${String(minute).padStart(2, "0")}:00`;
const sample = (minute, extra = {}) => ({
  t: time(minute),
  cpu: 20,
  ram: 50,
  disco: 58,
  latencia_ms: 40,
  errores: 0,
  ...extra,
});
const alert = (extra = {}) => ({
  id: "gracko-1",
  tenant: "gracko",
  timestamp: time(10),
  confianza: 0.7,
  tipo: "capacidad_disco",
  resumen: "Explicación de prueba",
  accion_sugerida: "Revisar con la persona responsable.",
  familias: [],
  logs: [],
  actualizaciones: [],
  ...extra,
});
const reference = (extra = {}) => ({
  id: "referencia-1",
  corrida: "corrida_01",
  tenant: "gracko",
  tipo: "capacidad_disco",
  timestamp: time(20),
  fuente: "Hipótesis del equipo",
  descripcion: "Impacto estimado de prueba",
  ...extra,
});
const range = (run = "corrida_01", extra = {}) => ({
  tenant: "gracko",
  corrida: run,
  inicio: time(0),
  fin: time(59),
  unidades: { errores: "errores/min" },
  ...extra,
});
const readOptions = (extra = {}) => ({
  run: "corrida_01",
  from: time(0),
  until: time(20),
  ...extra,
});
function mockApi(overrides = {}, calls = [], options = {}) {
  const payloads = {
    corridas: ["corrida_01"],
    rango: (url) => range(url.searchParams.get("corrida")),
    serie: {
      tenant: "gracko",
      serie: [sample(0), sample(10), sample(20)],
      apagones: [],
      calendario: [],
    },
    alertas: [],
    estado: { estado: "Alerta abierta" },
    referencias: [],
    ...overrides,
  };
  return new ApiSource({
    ...options,
    fetchImpl: async (input, init) => {
      calls.push({ url: input, init });
      const url = new URL(input, "http://local.test");
      const endpoint = url.pathname.split("/").at(-1);
      let payload = payloads[endpoint];
      if (typeof payload === "function") payload = await payload(url, init);
      return {
        ok: true,
        status: 200,
        json: async () => structuredClone(payload),
      };
    },
  });
}
async function readApi(source, options = readOptions()) {
  await source.loadRun({ run: options.run, signal: options.signal });
  return source.read(options);
}
const isAbort = (error) => error.name === "AbortError";

async function localApi(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  return (path, init) => fetch(new URL(path, origin), init);
}

test("logical timestamps round-trip without local timezone or date normalization", () => {
  assert.equal(parseTime(time(0)), Date.UTC(2026, 9, 8, 8));
  assert.equal(
    isoTime(parseTime("2024-02-29T23:59:59")),
    "2024-02-29T23:59:59",
  );
  for (const invalid of [
    "2026-02-29T08:00:00",
    "2026-04-31T08:00:00",
    "2026-10-08T24:00:00",
    "2026-10-08T08:00:60",
    "2026-10-08T08:00",
    "2026-10-08T08:00:00Z",
    "2026-10-08T08:00:00-06:00",
    "0000-01-01T00:00:00",
    null,
    0,
  ]) {
    assert.throws(() => parseTime(invalid), /Fecha no válida/);
  }
  assert.throws(() => isoTime(NaN), /Instante/);
  assert.throws(() => isoTime(1e20), /Instante/);
});

test("API loads only runs, then queries metadata and each frame for the selected run", async () => {
  const calls = [];
  const source = mockApi({}, calls);
  const controller = new AbortController();
  assert.deepEqual(await source.load({ signal: controller.signal }), {
    runs: ["corrida_01"],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/gracko/corridas");
  const run = "corrida con espacios";
  const metadata = await source.loadRun({ run, signal: controller.signal });
  assert.deepEqual(metadata, {
    range: { start: time(0), end: time(59) },
    units: { errores: "errores/min" },
    calendarInfo: { source: null, warnings: [] },
  });
  const frame = await source.read(
    readOptions({ run, signal: controller.signal }),
  );
  assert.deepEqual(frame.references, []);
  assert.equal(frame.referenceStatus, "missing");
  assert.equal(calls.length, 6);
  assert.ok(calls.every((call) => !call.url.includes("/calendario")));
  for (const call of calls.slice(1)) {
    const url = new URL(call.url, "http://local.test");
    const endpoint = url.pathname.split("/").at(-1);
    assert.equal(url.searchParams.get("corrida"), run);
    assert.equal(
      url.searchParams.get("hasta"),
      endpoint === "rango" ? null : time(20),
    );
    assert.equal(
      url.searchParams.get("desde"),
      endpoint === "serie" ? time(0) : null,
    );
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.equal(call.init.signal.aborted, false);
    assert.equal(call.init.credentials, "same-origin");
  }
  assert.throws(
    () => new ApiSource({ base: "https://other.test/api" }),
    /mismo origen/,
  );
  assert.throws(
    () => new ApiSource({ base: "//other.test/api" }),
    /mismo origen/,
  );
});

test("every selected company reads only its own run, evidence and impact references", async () => {
  for (const tenant of ["gracko", "gramo", "kaiku", "ttr", "empresa-nueva_1"]) {
    const calls = [];
    const foreignTenant = tenant === "gracko" ? "kaiku" : "gracko";
    const source = mockApi(
      {
        rango: (url) => range(url.searchParams.get("corrida"), { tenant }),
        serie: {
          tenant,
          corrida: "corrida_01",
          serie: [sample(0), sample(20), sample(30)],
        },
        alertas: [
          alert({ id: `${tenant}-1`, tenant }),
          alert({ id: "future", tenant, timestamp: time(30) }),
        ],
        estado: { tenant, corrida: "corrida_01", estado: "Alerta abierta" },
        referencias: [
          reference({ tenant }),
          reference({ id: "foreign", tenant: foreignTenant }),
          reference({ id: "foreign-run", tenant, corrida: "corrida_02" }),
          reference({ id: "future", tenant, timestamp: time(30) }),
        ],
      },
      calls,
      { tenant },
    );
    assert.deepEqual(await source.load(), { runs: ["corrida_01"] });
    const result = await readApi(source);
    assert.equal(source.tenant, tenant);
    assert.ok(calls.every(({ url }) => url.startsWith(`/api/${tenant}/`)));
    assert.deepEqual(
      result.alerts.map(({ id }) => id),
      [`${tenant}-1`],
    );
    assert.deepEqual(
      result.references.map(({ id }) => id),
      ["referencia-1"],
    );
    assert.deepEqual(
      result.series.map(({ t }) => t),
      [time(0), time(20)],
    );
    assert.equal(result.referenceStatus, "available");
  }
});

test("cross-company or cross-run required payloads fail instead of mixing the frame", async () => {
  const own = {
    rango: range("corrida_01", { tenant: "kaiku" }),
    serie: { tenant: "kaiku", serie: [sample(0)] },
  };
  for (const bad of [
    { rango: range("corrida_01") },
    { serie: { tenant: "gracko", serie: [sample(0)] } },
    { alertas: [alert()] },
    { alertas: [alert({ tenant: "kaiku", corrida: "corrida_02" })] },
    { estado: { tenant: "gracko", estado: "Normal" } },
    { estado: { tenant: "kaiku", corrida: "corrida_02", estado: "Normal" } },
  ])
    await assert.rejects(
      readApi(mockApi({ ...own, ...bad }, [], { tenant: "kaiku" })),
      /otra empresa|empresa de|corrida de/,
    );
  const first = mockApi();
  await first.loadRun({ run: "corrida_01" });
  assert.throws(() => {
    first.tenant = "kaiku";
  }, TypeError);
  const second = mockApi(own, [], { tenant: "kaiku" });
  await assert.rejects(second.read(readOptions()), /Carga primero el rango/);
});

test("company identifiers cannot escape their route or silently fall back to gracko", () => {
  for (const tenant of [
    null,
    "",
    " kaiku",
    "KAIKU",
    "../gracko",
    "kaiku/serie",
    "a?x=1",
    "a#b",
    "a".repeat(41),
    1,
  ])
    assert.throws(() => new ApiSource({ tenant }), /identificador de empresa/);
});

test("API has no default week: each shifted run uses its own validated range", async () => {
  const windows = {
    marzo: { inicio: "2027-03-01T09:00:00", fin: "2027-03-01T10:00:00" },
    junio: { inicio: "2028-06-15T14:00:00", fin: "2028-06-15T16:00:00" },
  };
  const calls = [];
  const source = mockApi(
    {
      rango: (url) => {
        const run = url.searchParams.get("corrida");
        return range(run, windows[run]);
      },
      serie: (url) => ({
        serie: [
          sample(0, { t: windows[url.searchParams.get("corrida")].inicio }),
        ],
        calendario: [],
      }),
    },
    calls,
  );
  await assert.rejects(
    source.read(readOptions({ run: "marzo" })),
    /Carga primero/,
  );
  for (const run of ["marzo", "junio", "marzo"]) {
    const metadata = await source.loadRun({ run });
    assert.deepEqual(metadata.range, {
      start: windows[run].inicio,
      end: windows[run].fin,
    });
    const frame = await source.read({ run, until: windows[run].fin });
    assert.equal(frame.series[0].t, windows[run].inicio);
    const seriesUrl = new URL(
      calls.findLast((call) => call.url.includes("/serie?")).url,
      "http://local.test",
    );
    assert.equal(seriesUrl.searchParams.get("desde"), windows[run].inicio);
    await assert.rejects(
      source.read({ run, until: DEFAULT_RANGE.end }),
      /posterior al reloj|fuera del rango/,
    );
  }
});

test("range contract validates identity, minute boundaries, ordering and exact error units", async () => {
  for (const payload of [
    null,
    {},
    range("another"),
    range("corrida_01", { tenant: "kaiku" }),
    range("corrida_01", { inicio: time(20), fin: time(10) }),
    range("corrida_01", { inicio: "2026-02-29T08:00:00" }),
    range("corrida_01", { inicio: "2026-10-08T08:00:01" }),
    range("corrida_01", { unidades: { errores: "errores/5min" } }),
    range("corrida_01", { unidades: {} }),
  ]) {
    const source = mockApi({ rango: payload });
    await assert.rejects(source.loadRun({ run: "corrida_01" }));
    await assert.rejects(source.read(readOptions()), /Carga primero/);
  }
  const single = await mockApi({
    rango: range("corrida_01", { fin: time(0) }),
  }).loadRun({ run: "corrida_01" });
  assert.equal(single.range.start, single.range.end);
});

test("missing range route is actionable and a failed reload cannot retain old metadata", async () => {
  const missing = new ApiSource({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  await assert.rejects(
    missing.loadRun({ run: "corrida_01" }),
    /aún no proporciona el rango por corrida/,
  );
  let valid = true;
  const source = mockApi({ rango: () => (valid ? range() : {}) });
  await source.loadRun({ run: "corrida_01" });
  valid = false;
  await assert.rejects(
    source.loadRun({ run: "corrida_01" }),
    /rango de fechas válido/,
  );
  await assert.rejects(source.read(readOptions()), /Carga primero/);
});

test("observed series, original evidence, logs and escalations cannot look ahead", async () => {
  const source = mockApi({
    serie: {
      serie: [sample(0), sample(10), sample(20), sample(30)],
      calendario: [],
    },
    alertas: [
      alert({
        familias: [
          { familia: "nivel", hora: time(9), timestamp: time(9), valor: 20 },
          { familia: "nivel", hora: time(25), valor: 99 },
          { familia: "nivel", timestamp: time(25), valor: 99 },
        ],
        logs: [
          { timestamp: time(9), mensaje: "Available" },
          { timestamp: time(15), mensaje: "After issuance" },
          { timestamp: time(30), mensaje: "Future" },
        ],
        actualizaciones: [
          { timestamp: time(15), confianza: 0.8, motivo: "Available" },
          { timestamp: time(30), confianza: 0.9, motivo: "Future" },
        ],
      }),
      alert({ id: "future", timestamp: time(30) }),
    ],
  });
  const result = await readApi(source);
  assert.deepEqual(
    result.series.map((point) => point.t),
    [time(0), time(10), time(20)],
  );
  assert.equal(result.alerts.length, 1);
  assert.deepEqual(
    result.alerts[0].logs.map((log) => log.timestamp),
    [time(9)],
  );
  assert.deepEqual(
    result.alerts[0].familias.map((family) => family.hora),
    [time(9)],
  );
  assert.deepEqual(
    result.alerts[0].actualizaciones.map((update) => update.timestamp),
    [time(15)],
  );
});

test("API evidence preserves family-specific fields and calendar suppression semantics", async () => {
  const families = [
    {
      familia: "nivel",
      senal: "cpu",
      hora: time(9),
      timestamp: time(9),
      valor: 60,
      valor_actual: null,
      normal: 20,
      z: -2,
      confianza: 0.35,
      unidad: "%",
      ventana_min: 15,
    },
    { familia: "saturacion", senal: "disco", horas_para_95: 4 },
    { familia: "errores", errores_60min: null, esperados_60min: 0 },
    { familia: "logs", lineas: 3 },
  ];
  const event = {
    evento: "Respaldo",
    inicio: time(0),
    fin: time(59),
    origen: "contexto.md",
    recurrencia: "diaria",
    suprime: false,
  };
  const result = await readApi(
    mockApi({
      alertas: [alert({ familias: families })],
      serie: { serie: [sample(10)], calendario: [event] },
    }),
  );
  assert.deepEqual(result.alerts[0].familias, families);
  assert.deepEqual(result.calendar, [event]);
});

test("evidence window is optional but must be a finite positive number when supplied", async () => {
  for (const ventana_min of [0, -1, null, "15", Infinity, NaN]) {
    await assert.rejects(
      readApi(
        mockApi({
          alertas: [alert({ familias: [{ familia: "nivel", ventana_min }] })],
        }),
      ),
      /ventana de evidencia/,
    );
  }
  const frame = await readApi(
    mockApi({
      alertas: [alert({ familias: [{ familia: "nivel" }] })],
    }),
  );
  assert.equal(
    Object.hasOwn(frame.alerts[0].familias[0], "ventana_min"),
    false,
  );
});

test("calendar source and warnings survive metadata and legacy frames without inventing a source", async () => {
  const warnings = ["No se reconoció un evento de la ficha."];
  const source = mockApi({
    rango: range("corrida_01", {
      calendario_fuente: "manual",
      avisos: warnings,
    }),
  });
  const metadata = await source.loadRun({ run: "corrida_01" });
  assert.deepEqual(metadata.calendarInfo, { source: "manual", warnings });
  assert.deepEqual(
    (await source.read(readOptions())).calendarInfo,
    metadata.calendarInfo,
  );
  const manualWithoutWarnings = await mockApi({
    rango: range("corrida_01", { calendario_fuente: "manual" }),
  }).loadRun({ run: "corrida_01" });
  assert.deepEqual(manualWithoutWarnings.calendarInfo, {
    source: "manual",
    warnings: [],
  });
  assert.deepEqual((await readApi(mockApi())).calendarInfo, {
    source: null,
    warnings: [],
  });
});

test("explicit frame calendar metadata clears warnings and never mutates run metadata", async () => {
  let current = {};
  const source = mockApi({
    rango: range("corrida_01", {
      calendario_fuente: "manual",
      avisos: ["Se usó el calendario manual."],
    }),
    serie: () => ({ serie: [sample(0)], ...current }),
  });
  const metadata = await source.loadRun({ run: "corrida_01" });
  metadata.calendarInfo.source = "contexto.md";
  metadata.calendarInfo.warnings.push("Mutación externa");
  const first = await source.read(readOptions());
  assert.deepEqual(first.calendarInfo, {
    source: "manual",
    warnings: ["Se usó el calendario manual."],
  });
  first.calendarInfo.warnings.length = 0;
  assert.equal(
    (await source.read(readOptions())).calendarInfo.warnings.length,
    1,
  );
  current = { avisos: [] };
  assert.deepEqual((await source.read(readOptions())).calendarInfo, {
    source: "manual",
    warnings: [],
  });
  current = { calendario_fuente: "contexto.md", avisos: [] };
  assert.deepEqual((await source.read(readOptions())).calendarInfo, {
    source: "contexto.md",
    warnings: [],
  });
  current = {};
  assert.deepEqual((await source.read(readOptions())).calendarInfo, {
    source: "manual",
    warnings: ["Se usó el calendario manual."],
  });
});

test("calendar warnings never leak into another run", async () => {
  const source = mockApi({
    rango: (url) => {
      const run = url.searchParams.get("corrida");
      return range(
        run,
        run === "corrida_01"
          ? {
              calendario_fuente: "manual",
              avisos: ["Aviso de la primera corrida."],
            }
          : {},
      );
    },
  });
  await source.loadRun({ run: "corrida_01" });
  assert.equal(
    (await source.read(readOptions())).calendarInfo.warnings.length,
    1,
  );
  await source.loadRun({ run: "corrida_02" });
  assert.deepEqual(
    (await source.read(readOptions({ run: "corrida_02" }))).calendarInfo,
    { source: null, warnings: [] },
  );
});

test("malformed calendar metadata fails visibly in both range and frame", async () => {
  for (const malformed of [
    { calendario_fuente: "inventada" },
    { calendario_fuente: 7 },
    { avisos: "aviso" },
    { avisos: null },
    { avisos: [42] },
    { avisos: [""] },
  ]) {
    await assert.rejects(
      mockApi({ rango: range("corrida_01", malformed) }).loadRun({
        run: "corrida_01",
      }),
      /calendario/,
    );
    await assert.rejects(
      readApi(mockApi({ serie: { serie: [sample(0)], ...malformed } })),
      /calendario/,
    );
  }
  const explicitUnknown = await readApi(
    mockApi({
      serie: { serie: [sample(0)], calendario_fuente: null, avisos: [] },
    }),
  );
  assert.deepEqual(explicitUnknown.calendarInfo, {
    source: null,
    warnings: [],
  });
});

test("empty runs are valid and an omitted action is explicitly absent", async () => {
  assert.deepEqual(await mockApi({ corridas: [] }).load(), { runs: [] });
  const result = await readApi(
    mockApi({ alertas: [alert({ accion_sugerida: undefined })] }),
  );
  assert.equal(
    result.alerts[0].accion_sugerida,
    "Acción sugerida no proporcionada por el servidor.",
  );
});

test("missing evidence timestamps and values stay null without hiding the frame", async () => {
  const family = {
    familia: "nivel",
    senal: "cpu",
    hora: null,
    timestamp: null,
    valor: null,
    valor_actual: null,
    normal: 20,
    z: null,
  };
  const result = await readApi(
    mockApi({ alertas: [alert({ familias: [family] })] }),
  );
  assert.equal(result.metrics.cpu, 20);
  assert.equal(result.alerts.length, 1);
  assert.deepEqual(result.alerts[0].familias, [family]);
});

test("null stays missing and zero stays zero; cards derive from latest series, not state", async () => {
  const result = await readApi(
    mockApi({
      serie: {
        serie: [sample(0), sample(20, { cpu: 0, ram: null, errores: 0 })],
      },
      estado: { estado: "Normal", metricas: { cpu: 99, ram: 99, errores: 99 } },
    }),
  );
  assert.equal(result.metrics.cpu, 0);
  assert.equal(result.metrics.ram, null);
  assert.equal(result.metrics.errores, 0);
});

test("outages erase apparent readings and break a curve even between sparse samples", async () => {
  const result = await readApi(
    mockApi({
      serie: {
        serie: [sample(0), sample(10), sample(20)],
        apagones: [
          { inicio: time(5), fin: time(15) },
          { inicio: time(30), fin: time(40) },
        ],
      },
    }),
    readOptions({ until: time(12) }),
  );
  assert.deepEqual(
    result.series.map((point) => point.t),
    [time(0), time(5), time(10)],
  );
  assert.ok(Object.values(result.metrics).every((value) => value === null));
  assert.deepEqual(result.apagones, [{ inicio: time(5), fin: time(12) }]);
  assert.equal(result.status, "Sin datos");
  const short = await readApi(
    mockApi({
      serie: {
        serie: [sample(0), sample(20)],
        apagones: [{ inicio: time(5), fin: time(7) }],
      },
    }),
  );
  assert.equal(short.series.find((point) => point.t === time(5)).cpu, null);
  assert.equal(short.metrics.cpu, 20);
});

test("an empty subsequent response clears prior metrics and calendar instead of reusing them", async () => {
  let empty = false;
  const event = {
    evento: "Event",
    inicio: time(0),
    fin: time(30),
    origen: "contexto.md",
  };
  const source = mockApi({
    serie: () =>
      empty ? { serie: [] } : { serie: [sample(0)], calendario: [event] },
  });
  await source.loadRun({ run: "corrida_01" });
  assert.equal((await source.read(readOptions())).metrics.cpu, 20);
  empty = true;
  const result = await source.read(readOptions());
  assert.deepEqual(result.series, []);
  assert.deepEqual(result.calendar, []);
  assert.ok(Object.values(result.metrics).every((value) => value === null));
  assert.equal(result.status, "Sin datos");
});

test("the requested frame supplies its own known future agenda", async () => {
  const event = {
    evento: "Evento documentado",
    inicio: time(30),
    fin: time(40),
    origen: "contexto.md",
  };
  const result = await readApi(
    mockApi({ serie: { serie: [sample(0)], calendario: [event] } }),
  );
  assert.deepEqual(result.calendar, [event]);
  assert.ok(
    result.series.every((point) => parseTime(point.t) <= parseTime(time(20))),
  );
  assert.equal(result.alerts.length, 0);
});

test("references require explicit matching run, honor tenant and time, and preserve source", async () => {
  const included = reference({ alerta_id: "gracko-1" });
  const result = await readApi(
    mockApi({
      referencias: [
        included,
        reference({ id: "future", timestamp: time(30) }),
        reference({ id: "foreign-run", corrida: "corrida_02" }),
        reference({ id: "foreign-tenant", tenant: "kaiku" }),
        reference({ id: "legacy", corrida: undefined }),
      ],
    }),
  );
  assert.equal(result.referenceStatus, "available");
  const { tenant, ...expected } = included;
  assert.deepEqual(result.references, [expected]);
  assert.equal(result.references[0].fuente, included.fuente);
  assert.equal(result.references[0].descripcion, included.descripcion);
});

test("legacy unassociated or future-only references are missing, never inferred from text", async () => {
  for (const refs of [
    [],
    [reference({ corrida: undefined, descripcion: "Impacto de corrida_01" })],
    [reference({ timestamp: time(30) })],
    [reference({ corrida: "corrida_02" })],
  ]) {
    const result = await readApi(mockApi({ referencias: refs }));
    assert.deepEqual(result.references, []);
    assert.equal(result.referenceStatus, "missing");
  }
});

test("an explicit null alert link survives normalization and blocks matching by type", async () => {
  for (const tipo of ["capacidad_disco", "disco /data lleno"]) {
    const result = await readApi(
      mockApi({
        alertas: [alert()],
        referencias: [reference({ tipo, alerta_id: null })],
      }),
    );
    assert.equal(Object.hasOwn(result.references[0], "alerta_id"), true);
    assert.equal(result.references[0].alerta_id, null);
    assert.equal(
      formatImpact({
        alert: result.alerts[0],
        alerts: result.alerts,
        references: result.references,
        run: "corrida_01",
        until: time(20),
      }).status,
      "missing",
    );
  }
  const legacy = await readApi(
    mockApi({
      alertas: [alert()],
      referencias: [reference()],
    }),
  );
  assert.equal(Object.hasOwn(legacy.references[0], "alerta_id"), false);
  assert.equal(
    formatImpact({
      alert: legacy.alerts[0],
      alerts: legacy.alerts,
      references: legacy.references,
      run: "corrida_01",
      until: time(20),
    }).status,
    "available",
  );
});

test("malformed optional references are unavailable without discarding metrics", async () => {
  for (const refs of [
    null,
    {},
    [null],
    [reference({ fuente: undefined })],
    [reference({ descripcion: undefined })],
    [reference({ timestamp: "tomorrow" })],
    [reference(), reference()],
  ]) {
    const result = await readApi(mockApi({ referencias: refs }));
    assert.equal(result.metrics.cpu, 20);
    assert.deepEqual(result.references, []);
    assert.equal(result.referenceStatus, "unavailable");
  }
});

test("optional reference HTTP failure leaves the required frame available", async () => {
  const source = mockApi();
  const baseFetch = source.fetchImpl;
  source.fetchImpl = async (url, init) =>
    url.includes("/referencias?")
      ? { ok: false, status: 503 }
      : baseFetch(url, init);
  const result = await readApi(source);
  assert.equal(result.metrics.cpu, 20);
  assert.equal(result.referenceStatus, "unavailable");
  assert.deepEqual(result.references, []);
});

test("reference results are not retained across run changes or rewind", async () => {
  const source = mockApi({
    referencias: (url) =>
      url.searchParams.get("corrida") === "corrida_01" ? [reference()] : [],
  });
  await source.loadRun({ run: "corrida_01" });
  assert.equal((await source.read(readOptions())).referenceStatus, "available");
  assert.equal(
    (await source.read(readOptions({ until: time(10) }))).referenceStatus,
    "missing",
  );
  await source.loadRun({ run: "corrida_02" });
  const changed = await source.read(readOptions({ run: "corrida_02" }));
  assert.equal(changed.referenceStatus, "missing");
  assert.deepEqual(changed.references, []);
});

test("required malformed payloads still fail visibly without coercing values", async () => {
  for (const overrides of [
    { serie: [] },
    { serie: { serie: [sample(0, { cpu: "20" })] } },
    { serie: { serie: [sample(0, { cpu: undefined })] } },
    { serie: { serie: [sample(0), sample(0)] } },
    { serie: { tenant: "kaiku", serie: [] } },
    { serie: { corrida: "corrida_02", serie: [] } },
    { serie: { serie: [], apagones: [{ inicio: time(15), fin: time(10) }] } },
    { serie: { serie: [], calendario: [{ evento: "malformed" }] } },
    { serie: { serie: [], calendario: null } },
    { alertas: {} },
    { alertas: [alert({ confianza: 1.1 })] },
    { alertas: [alert({ id: undefined })] },
    { alertas: [alert({ logs: "log" })] },
    { alertas: [alert({ logs: null })] },
    { serie: { serie: [], apagones: null } },
    { estado: [] },
    { estado: { estado: 0 } },
  ])
    await assert.rejects(
      readApi(mockApi(overrides)),
      /Datos no válidos|Fecha no válida/,
    );
  await assert.rejects(
    mockApi({ corridas: ["corrida_01", "corrida_01"] }).load(),
    /Datos no válidos/,
  );
  await assert.rejects(
    readApi(mockApi(), readOptions({ from: time(30) })),
    /posterior al reloj/,
  );
});

test("HTTP, network and JSON errors expose safe messages and never use demo fallback", async () => {
  const http = new ApiSource({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => "<h1>Private traceback</h1>",
    }),
  });
  await assert.rejects(
    http.load(),
    (error) =>
      /HTTP 503/.test(error.message) && !/Private|<h1>/.test(error.message),
  );
  const network = new ApiSource({
    fetchImpl: async () => {
      throw new Error("<script>secret</script>");
    },
  });
  await assert.rejects(
    network.load(),
    (error) =>
      /No se pudo conectar/.test(error.message) &&
      !/secret|script/.test(error.message),
  );
  const malformed = new ApiSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("<html>");
      },
    }),
  });
  await assert.rejects(malformed.load(), /no es JSON válido/);
});

test("a real HTTP request times out at headers or body and can be retried", async (t) => {
  for (const phase of ["headers", "body"])
    await t.test(phase, async (t) => {
      let respond = false;
      let requestsSeen = 0;
      const fetchImpl = await localApi(t, (request, response) => {
        if (respond) {
          response.setHeader("Content-Type", "application/json");
          response.end('["corrida_01"]');
        } else {
          if (phase === "body") {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.write('["');
          }
          requestsSeen++;
        }
      });
      const source = new ApiSource({ fetchImpl, timeoutMs: 200 });
      const controller = new AbortController();
      const failed = assert.rejects(
        source.load({ signal: controller.signal }),
        (error) =>
          error.name === "TimeoutError" &&
          /tardó demasiado.*reintentar/.test(error.message),
      );
      await failed;
      assert.equal(requestsSeen, 1);
      assert.equal(controller.signal.aborted, false);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      respond = true;
      assert.deepEqual(await source.load({ signal: controller.signal }), {
        runs: ["corrida_01"],
      });
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
});

test("voluntary cancellation of real pending HTTP headers or body stays AbortError", async (t) => {
  for (const phase of ["headers", "body"])
    await t.test(phase, async (t) => {
      let observed;
      const requestObserved = new Promise((resolve) => {
        observed = resolve;
      });
      const fetchImpl = await localApi(t, (request, response) => {
        if (phase === "body") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.write('["');
        }
        observed();
      });
      const source = new ApiSource({ fetchImpl, timeoutMs: 500 });
      const controller = new AbortController();
      const cancelled = assert.rejects(
        source.load({ signal: controller.signal }),
        (error) =>
          isAbort(error) && !/tiempo|tardó|reintentar/.test(error.message),
      );
      await Promise.race([requestObserved, cancelled]);
      controller.abort();
      await cancelled;
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
});

test("required frame timeout is visible but an optional reference timeout keeps metrics", async () => {
  const never = () => new Promise(() => {});
  const required = mockApi({ serie: never }, [], { timeoutMs: 20 });
  await assert.rejects(
    readApi(required),
    (error) =>
      error.name === "TimeoutError" && /serie.*reintentar/.test(error.message),
  );
  const optional = mockApi({ referencias: never }, [], { timeoutMs: 20 });
  const result = await readApi(optional);
  assert.equal(result.referenceStatus, "unavailable");
  assert.deepEqual(result.references, []);
  assert.equal(result.metrics.cpu, 20);
});

test("uploaded kit requests can analyze longer data, but still expire and honor configured deadlines", async (t) => {
  const kit = "kit-0123456789abcdef0123456789abcdef-corrida_01";
  for (const endpoint of ["rango", "serie", "alertas", "estado", "referencias"])
    await t.test(endpoint, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let requestSignal;
      const source = new ApiSource({
        fetchImpl: async (url, { signal }) => {
          requestSignal = signal;
          return { ok: true, json: () => new Promise(() => {}) };
        },
      });
      const failed = assert.rejects(
        source.request(endpoint, { corrida: kit }),
        (error) => error.name === "TimeoutError",
      );
      // A 14-second first analysis must survive the former 10-second cutoff.
      t.mock.timers.tick(14_000);
      assert.equal(requestSignal.aborted, false);
      t.mock.timers.tick(45_999);
      assert.equal(requestSignal.aborted, false);
      t.mock.timers.tick(1);
      await failed;
      assert.equal(requestSignal.aborted, true);
    });

  for (const [run, options, deadline] of [
    ["corrida_01", {}, 10_000],
    ["kit-malformado", {}, 10_000],
    [kit, { timeoutMs: 25 }, 25],
  ])
    await t.test(`${run} at ${deadline} ms`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let requestSignal;
      const source = new ApiSource({
        ...options,
        fetchImpl: (url, { signal }) => {
          requestSignal = signal;
          return new Promise(() => {});
        },
      });
      const failed = assert.rejects(
        source.loadRun({ run }),
        (error) => error.name === "TimeoutError",
      );
      t.mock.timers.tick(deadline - 1);
      assert.equal(requestSignal.aborted, false);
      t.mock.timers.tick(1);
      await failed;
      assert.equal(requestSignal.aborted, true);
    });
});

test("long kit analysis and company loading remain cancellable after the normal deadline", async (t) => {
  const run = "kit-0123456789abcdef0123456789abcdef";
  for (const operation of [
    (options) =>
      new ApiSource(options).loadRun({ run, signal: options.signal }),
    (options) => loadCompanies({ run, ...options }),
  ])
    await t.test("cancel after 14 seconds", async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const controller = new AbortController();
      let requestSignal;
      const pending = operation({
        signal: controller.signal,
        fetchImpl: (url, { signal }) => {
          requestSignal = signal;
          return new Promise(() => {});
        },
      });
      const cancelled = assert.rejects(pending, isAbort);
      t.mock.timers.tick(14_000);
      assert.equal(requestSignal.aborted, false);
      controller.abort();
      await cancelled;
      assert.equal(requestSignal.aborted, true);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
});

test("successful and failed requests remove listeners and never fire their old deadlines", async () => {
  const controller = new AbortController();
  const signals = [];
  let failure;
  const source = new ApiSource({
    timeoutMs: 20,
    fetchImpl: async (url, { signal }) => {
      signals.push(signal);
      if (failure === "network") throw new Error("offline");
      if (failure === "http") return { ok: false, status: 503 };
      if (failure === "json")
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError();
          },
        };
      return { ok: true, json: async () => ["corrida_01"] };
    },
  });
  for (let i = 0; i < 12; i++) {
    await source.load({ signal: controller.signal });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
  for (failure of ["network", "http", "json"]) {
    await assert.rejects(source.load({ signal: controller.signal }));
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
  await delay(40);
  assert.ok(signals.every((signal) => !signal.aborted));
  controller.abort();
  assert.ok(signals.every((signal) => !signal.aborted));
});

test("API request timeout must be a supported positive integer duration", () => {
  for (const timeoutMs of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    2_147_483_648,
    "100",
    null,
  ]) {
    assert.throws(() => new ApiSource({ timeoutMs }), /tiempo límite/);
  }
});

test("API and demo cancel load, run load and frames without treating abort as missing references", async () => {
  const controller = new AbortController();
  controller.abort();
  const api = mockApi();
  const demo = new DemoSource();
  for (const source of [api, demo]) {
    const run = source === demo ? "ejemplo_01" : "corrida_01";
    await assert.rejects(source.load({ signal: controller.signal }), isAbort);
    await assert.rejects(
      source.loadRun({ run, signal: controller.signal }),
      isAbort,
    );
    await assert.rejects(
      source.read({ run, until: time(20), signal: controller.signal }),
      isAbort,
    );
  }
  const during = new AbortController();
  const source = mockApi({
    referencias: () => {
      during.abort();
      return [];
    },
  });
  await source.loadRun({ run: "corrida_01" });
  await assert.rejects(
    source.read(readOptions({ signal: during.signal })),
    isAbort,
  );
});

test("demo is deterministic and reveals its explicitly fictitious references only when observed", async () => {
  const first = new DemoSource();
  const second = new DemoSource();
  assert.deepEqual(await first.load(), { runs: ["ejemplo_01"] });
  assert.deepEqual(await first.loadRun({ run: "ejemplo_01" }), {
    range: DEFAULT_RANGE,
    units: { errores: "errores/min" },
    calendarInfo: { source: null, warnings: [] },
  });
  await assert.rejects(
    first.loadRun({ run: "corrida_01" }),
    /ejemplo ficticio/,
  );
  const options = { run: "ejemplo_01", until: DEFAULT_RANGE.end };
  const end = await first.read(options);
  assert.deepEqual(end.calendarInfo, { source: null, warnings: [] });
  assert.deepEqual(end, await second.read(options));
  assert.equal(end.alerts.length, 3);
  assert.ok(end.series.length > 1800);
  assert.equal(end.references.length, 3);
  assert.ok(
    end.references.every(
      (item) =>
        item.corrida === "ejemplo_01" &&
        item.fuente.includes("FICTICIA") &&
        item.alerta_id,
    ),
  );
  assert.ok(end.alerts.every((item) => item.resumen.includes("FICTICIO")));
  const early = await first.read({
    run: "ejemplo_01",
    until: "2026-10-10T10:52:00",
  });
  assert.equal(early.alerts.length, 1);
  assert.equal(early.alerts[0].actualizaciones.length, 0);
  assert.equal(early.referenceStatus, "missing");
  assert.ok(
    early.series.every(
      (point) => parseTime(point.t) <= parseTime("2026-10-10T10:52:00"),
    ),
  );
  const rewind = await first.read({
    run: "ejemplo_01",
    until: DEFAULT_RANGE.start,
  });
  assert.deepEqual(rewind.alerts, []);
  assert.deepEqual(rewind.references, []);
  assert.equal(rewind.series.length, 1);
});

test("demo evidence matches the visible series and its backup lasts 60 minutes without suppressing alerts", async () => {
  const source = new DemoSource();
  const full = await source.read({
    run: "ejemplo_01",
    until: DEFAULT_RANGE.end,
  });
  for (const alert of full.alerts) {
    const frame = await source.read({
      run: "ejemplo_01",
      until: alert.timestamp,
    });
    const latest = frame.series.at(-1);
    for (const family of alert.familias) {
      assert.equal(family.timestamp, latest.t);
      assert.equal(family.valor, latest[family.senal]);
      assert.equal(family.valor, frame.metrics[family.senal]);
    }
  }
  const backup = full.calendar.find((event) => event.recurrencia === "diaria");
  assert.equal(parseTime(backup.fin) - parseTime(backup.inicio), 60 * 60_000);
  assert.equal(backup.suprime, false);
});
