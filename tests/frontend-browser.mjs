import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DEFAULT_RANGE, parseTime } from "../web/data.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../web/", import.meta.url));
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(path);
    response
      .writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
let browser, origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});
async function newPage(t, initScript) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], "No uncaught browser errors");
  });
  if (initScript) await page.addInitScript(initScript);
  return page;
}
async function open(t, initScript) {
  const page = await newPage(t, initScript);
  await page.goto(`${origin}/?fuente=demo`);
  await ready(page);
  return page;
}
async function setDisclosure(page, id, open = true) {
  const details = page.locator(`#${id}`);
  if ((await details.evaluate((element) => element.open)) !== open)
    await details.locator(":scope > summary").click();
}
async function selectSource(page, value) {
  await setDisclosure(page, "replay-options");
  await page.locator("#source").selectOption(value);
}
async function selectSpeed(page, value) {
  await setDisclosure(page, "replay-options");
  await page.locator("#speed").selectOption(value);
}
async function impactAvailable(page) {
  // A closed disclosure must not make a future-data assertion pass by accident.
  return page.locator("#phone-content").evaluate((element) => !element.hidden);
}
function mockAudioContext() {
  window.audioCalls = {
    constructed: 0,
    resume: 0,
    oscillators: 0,
    starts: 0,
    suspend: 0,
    close: 0,
  };
  window.AudioContext = class {
    constructor() {
      window.audioCalls.constructed++;
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = {};
    }
    async resume() {
      window.audioCalls.resume++;
      this.state = "running";
    }
    async suspend() {
      window.audioCalls.suspend++;
      this.state = "suspended";
    }
    async close() {
      window.audioCalls.close++;
      this.state = "closed";
    }
    createOscillator() {
      window.audioCalls.oscillators++;
      return {
        frequency: { value: 0 },
        connect() {},
        disconnect() {},
        start() {
          window.audioCalls.starts++;
        },
        stop() {
          this.onended?.();
        },
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
  };
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      !document.querySelector("#play").disabled &&
      document.querySelector("#data-view").getAttribute("aria-busy") ===
        "false",
  );
  assert.equal(await page.locator("#error").isVisible(), false);
}
async function seek(page, date, range = DEFAULT_RANGE) {
  const minute = (parseTime(date) - parseTime(range.start)) / 60000;
  await setCursor(page, minute);
  await ready(page);
  assert.equal(await page.locator("#cursor").inputValue(), String(minute));
}
async function setCursor(page, minute) {
  await page.locator("#cursor").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, minute);
}
async function charts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("canvas")].map((canvas) => {
      const chart = Chart.getChart(canvas);
      return {
        data: chart.data.datasets[0].data,
        context: chart.$zikit,
        spanGaps: chart.options.spanGaps ?? chart.data.datasets[0].spanGaps,
        label: canvas.getAttribute("aria-label"),
      };
    }),
  );
}
const sample = (t, cpu = 0) => ({
  t,
  cpu,
  ram: null,
  disco: 58,
  latencia_ms: 40,
  errores: 0,
});
async function mockApi(page, options = {}) {
  const requests = [];
  await page.route("**/api/empresas*", async (route) => {
    const run = new URL(route.request().url()).searchParams.get("corrida");
    if (options.companyStatus && run) {
      await route.fulfill({
        status: options.companyStatus,
        body: "Unavailable",
      });
      return;
    }
    await route.fulfill({
      json: options.companiesByRun?.[run] ??
        options.companies ?? [{ tenant: "gracko", giro: "Despacho contable" }],
    });
  });
  await page.route("**/api/*/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").at(-1);
    const tenant = url.pathname.split("/")[2];
    const run = url.searchParams.get("corrida");
    requests.push({ endpoint, ...Object.fromEntries(url.searchParams) });
    if (endpoint === "corridas" && options.discoveryGate)
      await options.discoveryGate;
    const delay =
      endpoint === "corridas"
        ? options.delay
        : endpoint === "rango"
          ? options.rangeDelays?.[run]
          : 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (endpoint === "serie" && options.frameGate) await options.frameGate;
    if (endpoint === "serie" && options.tenantFrameGate?.[tenant])
      await options.tenantFrameGate[tenant];
    if (options.failure) {
      await route.fulfill({ status: 503, body: "Unavailable" });
      return;
    }
    const status =
      endpoint === "corridas"
        ? options.discoveryStatus
        : endpoint === "rango"
          ? (options.rangeStatusesByTenant?.[tenant] ??
            options.rangeStatuses?.[run])
          : endpoint === "referencias"
            ? options.referenceStatus
            : endpoint === "serie"
              ? options.frameStatus
              : 200;
    if (status && status !== 200) {
      await route.fulfill({ status, body: "Unavailable" });
      return;
    }
    const range = options.ranges?.[run] ?? DEFAULT_RANGE;
    const calendarMetadata = options.calendarByRun?.[run] ?? {};
    const until = url.searchParams.get("hasta") || range.start;
    const values = [
      sample(
        until,
        options.cpuByTenant?.[tenant] ?? options.cpuByRun?.[run] ?? 0,
      ),
    ];
    // Deliberately return a future sample to verify that the browser never draws it.
    if (until !== range.end) values.push(sample(range.end, 99));
    const payloads = {
      corridas: options.runs ?? ["corrida_01"],
      rango: {
        tenant,
        corrida: run,
        inicio: range.start,
        fin: range.end,
        unidades: { errores: "errores/min" },
        ...calendarMetadata,
      },
      referencias: options.references ?? [],
      serie: {
        tenant,
        serie: options.empty ? [] : values,
        apagones: [],
        calendario: options.calendar ?? [],
        ...calendarMetadata,
      },
      estado: { estado: "Estado de prueba" },
      alertas:
        options.alerts ??
        (options.empty
          ? []
          : [
              {
                id: "api-1",
                tenant,
                timestamp: range.start,
                confianza: 0.7,
                tipo: "capacidad_disco",
                resumen: "<script>contenido como texto</script>",
                familias: [
                  {
                    familia: "tendencia",
                    senal: "disco",
                    z: 4.2,
                  },
                ],
                logs: [],
                actualizaciones: [],
              },
            ]),
    };
    assert.ok(endpoint in payloads, `Unexpected API endpoint: ${endpoint}`);
    await route.fulfill({ json: payloads[endpoint] });
  });
  return requests;
}

test("startup uses an available API unless the URL explicitly selects the demo", async (t) => {
  for (const query of ["", "?fuente=api"]) {
    const page = await newPage(t);
    await mockApi(page);
    await page.goto(`${origin}/${query}`);
    await ready(page);
    assert.equal(await page.locator("#source").inputValue(), "api");
    assert.equal(await page.locator("#run").inputValue(), "corrida_01");
  }
  const demoPage = await newPage(t);
  const requests = await mockApi(demoPage);
  await demoPage.goto(`${origin}/?fuente=demo`);
  await ready(demoPage);
  assert.equal(await demoPage.locator("#source").inputValue(), "demo");
  assert.equal(await demoPage.locator("#run").inputValue(), "ejemplo_01");
  assert.deepEqual(
    requests,
    [],
    "An explicit example does not discover the API",
  );
});

test("only absent API discovery falls back to demo; explicit and manual API choices expose errors", async (t) => {
  for (const status of [404, 405]) {
    const page = await newPage(t);
    await mockApi(page, { discoveryStatus: status });
    await page.goto(origin);
    await ready(page);
    assert.equal(await page.locator("#source").inputValue(), "demo");
    assert.equal(await page.locator("#run").inputValue(), "ejemplo_01");
    await selectSource(page, "api");
    await page.locator("#error").waitFor({ state: "visible" });
    assert.equal(await page.locator("#source").inputValue(), "api");
    assert.equal(await page.locator("#play").isDisabled(), true);
    assert.equal(await page.locator("#value-cpu").textContent(), "—");
    assert.match(
      await page.locator("#error-message").textContent(),
      new RegExp(String(status)),
    );
  }
  const forced = await newPage(t);
  await mockApi(forced, { discoveryStatus: 404 });
  await forced.goto(`${origin}/?fuente=api`);
  await forced.locator("#error").waitFor({ state: "visible" });
  assert.equal(await forced.locator("#source").inputValue(), "api");
  assert.equal(await forced.locator("#play").isDisabled(), true);
});

test("temporary API startup failures stay in API mode and retry without showing fictitious data", async (t) => {
  for (const status of [500, 503]) {
    const page = await newPage(t);
    const options = { discoveryStatus: status };
    await mockApi(page, options);
    await page.goto(origin);
    await page.locator("#error").waitFor({ state: "visible" });
    assert.equal(await page.locator("#source").inputValue(), "api");
    assert.equal(await page.locator("#value-cpu").textContent(), "—");
    assert.equal(await page.locator("#alert-count").textContent(), "0");
    options.discoveryStatus = 200;
    await page.locator("#retry").click();
    await ready(page);
    assert.equal(await page.locator("#run").inputValue(), "corrida_01");
  }
});

test("a hanging API request times out into a retryable error instead of staying busy or falling back to demo", async (t) => {
  const page = await newPage(t);
  await page.clock.install();
  let release;
  const options = {
    discoveryGate: new Promise((resolve) => {
      release = resolve;
    }),
  };
  t.after(() => release());
  await mockApi(page, options);
  const discovery = page.waitForRequest((request) =>
    request.url().endsWith("/api/gracko/corridas"),
  );
  await page.goto(origin);
  await discovery;
  assert.equal(
    await page.locator("#data-view").getAttribute("aria-busy"),
    "true",
  );
  await page.clock.fastForward(10_001);
  await page.locator("#error").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#error-message").textContent(),
    /tardó demasiado en responder/,
  );
  assert.equal(await page.locator("#source").inputValue(), "api");
  assert.equal(
    await page.locator("#data-view").getAttribute("aria-busy"),
    "false",
  );
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
  options.discoveryGate = null;
  release();
  await page.locator("#retry").click();
  await ready(page);
  assert.equal(await page.locator("#run").inputValue(), "corrida_01");
});

test("seeking reveals only observed alerts, confidence and hypothetical phone times, including backward seeks", async (t) => {
  const page = await open(t);
  assert.equal(await page.locator("#value-errores").textContent(), "0");
  await seek(page, "2026-10-10T10:51:00");
  assert.equal(await page.locator("#alert-count").textContent(), "0");
  await seek(page, "2026-10-10T10:52:00");
  assert.equal(await page.locator("#alert-count").textContent(), "1");
  assert.equal(await page.locator("#detail-confidence").textContent(), "0.70");
  assert.equal(await impactAvailable(page), false);
  await setDisclosure(page, "impact-details");
  assert.equal(await page.locator("#phone-content").isVisible(), false);
  await seek(page, "2026-10-10T11:22:00");
  assert.equal(await page.locator("#detail-confidence").textContent(), "0.88");
  await seek(page, "2026-10-11T23:00:00");
  assert.equal(await impactAvailable(page), true);
  assert.equal(await page.locator("#phone-content").isVisible(), true);
  assert.equal(await page.locator("#phone-gain").textContent(), "2,168 min");
  await setDisclosure(page, "impact-details", false);
  await seek(page, "2026-10-10T10:51:00");
  assert.equal(await page.locator("#alert-count").textContent(), "0");
  assert.equal(await impactAvailable(page), false);
  await setDisclosure(page, "impact-details");
  assert.equal(await page.locator("#phone-content").isVisible(), false);
  for (const chart of await charts(page)) {
    assert.ok(
      chart.data.every((point) => point.x <= parseTime("2026-10-10T10:51:00")),
    );
    assert.equal(chart.context.phones.length, 0);
  }
});

test("secondary details open with the keyboard and persist while the related chart reuses its original instance", async (t) => {
  const page = await open(t);
  const range = { start: "2027-02-01T08:00:00", end: "2027-02-01T09:00:00" };
  await mockApi(page, {
    ranges: { corrida_01: range },
    alerts: [
      {
        id: "disk",
        timestamp: range.start,
        confianza: 0.6,
        tipo: "capacidad_disco",
        resumen: "Revisar disco",
        familias: [{ familia: "tendencia", senal: "disco", z: 4.2 }],
      },
      {
        id: "performance",
        timestamp: "2027-02-01T08:05:00",
        confianza: 0.7,
        tipo: "degradacion_rendimiento",
        resumen: "Revisar latencia",
        familias: [{ familia: "tendencia", senal: "latencia_ms", z: 4.2 }],
      },
      {
        id: "without-signal",
        timestamp: "2027-02-01T08:10:00",
        confianza: 0.7,
        tipo: "capacidad_disco",
        resumen: "La fuente no proporciona evidencia estructurada",
        familias: [],
      },
    ],
  });
  await selectSource(page, "api");
  await ready(page);
  const identities = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("canvas")]
        .map((canvas) => [canvas.id, Chart.getChart(canvas).id])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const originalCharts = await identities();
  assert.equal(originalCharts.length, 5);
  assert.equal(await page.locator("#focus-metric #chart-disco").count(), 1);
  assert.equal(await page.locator("#focus-metric canvas").isVisible(), true);
  assert.equal(await page.locator("#window").isVisible(), true);
  for (const id of ["detection-details", "impact-details", "metrics-section"]) {
    assert.equal(
      await page.locator(`#${id}`).evaluate((element) => element.open),
      false,
    );
    await page.locator(`#${id} > summary`).press("Enter");
    assert.equal(
      await page.locator(`#${id}`).evaluate((element) => element.open),
      true,
    );
  }
  assert.equal(await page.locator("#detail-evidence").isVisible(), true);
  await seek(page, "2027-02-01T08:05:00", range);
  assert.equal(
    await page.locator("#focus-metric #chart-latencia_ms").count(),
    1,
  );
  assert.equal(await page.locator("#metrics-section #chart-disco").count(), 1);
  assert.deepEqual(await identities(), originalCharts);
  for (const id of ["detection-details", "impact-details", "metrics-section"])
    assert.equal(
      await page.locator(`#${id}`).evaluate((element) => element.open),
      true,
    );
  await seek(page, "2027-02-01T08:10:00", range);
  assert.equal(await page.locator("#focus-metric canvas").count(), 0);
  assert.equal(await page.locator("#metrics-section canvas").count(), 5);
  assert.deepEqual(await identities(), originalCharts);
  assert.equal(
    await page.evaluate(() => Object.keys(Chart.instances).length),
    5,
  );
});

test("calendar events preserve midnight dates, safe labels and an in-progress click across playback frames", async (t) => {
  const page = await open(t);
  const range = { start: "2027-02-01T23:00:00", end: "2027-02-02T01:00:00" };
  const eventName =
    'Respaldo <img src="bad" onerror="window.calendarExecuted=true">';
  await mockApi(page, {
    ranges: { corrida_01: range },
    calendar: [
      {
        evento: eventName,
        inicio: "2027-02-01T23:45:00",
        fin: "2027-02-02T00:15:00",
        suprime: false,
      },
    ],
  });
  await selectSource(page, "api");
  await ready(page);
  await seek(page, "2027-02-02T00:00:00", range);
  const active = page.locator("#calendar-list li.active");
  assert.equal(await active.count(), 1);
  const text = await active.textContent();
  assert.ok(text.includes(eventName));
  assert.match(text, /01 feb 2027[\s\S]*23:45[\s\S]*02 feb 2027[\s\S]*00:15/);
  assert.equal(await page.locator("#calendar-list img").count(), 0);
  assert.equal(await page.evaluate(() => window.calendarExecuted), undefined);

  await page.clock.install();
  await selectSpeed(page, "5");
  const summary = active.locator("summary");
  const originalSummary = await summary.elementHandle();
  const originalRow = await active.elementHandle();
  assert.equal(
    await active.locator("details").evaluate((el) => el.open),
    false,
  );
  await page.locator("#play").click();
  await summary.scrollIntoViewIfNeeded();
  const bounds = await summary.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  try {
    await page.clock.runFor(1000);
    await page.waitForFunction(
      () =>
        document.querySelector("#cursor").value === "65" &&
        document.querySelector("#data-view").getAttribute("aria-busy") ===
          "false",
    );
    assert.equal(
      await summary.evaluate(
        (el, original) => el === original,
        originalSummary,
      ),
      true,
      "Playback must preserve the summary that received pointerdown",
    );
    assert.equal(
      await active.evaluate((el, original) => el === original, originalRow),
      true,
      "Playback must reuse the existing calendar row",
    );
  } finally {
    await page.mouse.up();
  }
  assert.equal(await active.locator("details").evaluate((el) => el.open), true);
  await page.clock.runFor(1000);
  await page.waitForFunction(
    () =>
      document.querySelector("#cursor").value === "70" &&
      document.querySelector("#data-view").getAttribute("aria-busy") ===
        "false",
  );
  assert.equal(
    await summary.evaluate((el, original) => el === original, originalSummary),
    true,
  );
  assert.equal(await active.locator("details").evaluate((el) => el.open), true);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.matches("#calendar-list summary"),
    ),
    true,
    "Playback must retain keyboard focus on the event",
  );
  await page.locator("#play").click();
  await ready(page);

  await seek(page, "2027-02-02T00:20:00", range);
  assert.equal(await page.locator("#calendar-list li.active").count(), 0);
  assert.ok(
    (await page.locator("#calendar-list").textContent()).includes(eventName),
  );
});

test("outages break every chart, partial gaps preserve valid readings, and payroll is calendar context", async (t) => {
  const page = await open(t);
  await seek(page, "2026-10-08T14:10:00");
  for (const chart of await charts(page)) {
    assert.equal(chart.data.at(-1).y, null);
    assert.equal(chart.spanGaps, false);
  }
  await seek(page, "2026-10-09T08:10:00");
  assert.equal(await page.locator("#value-ram").textContent(), "—");
  assert.notEqual(await page.locator("#value-cpu").textContent(), "—");
  await seek(page, "2026-10-12T11:00:00");
  assert.match(
    await page.locator("#calendar-list .active").textContent(),
    /Cierre de nómina/,
  );
});

test("play, pause, keyboard navigation and restart keep the displayed clock synchronized", async (t) => {
  const page = await open(t);
  await selectSpeed(page, "60");
  await page.locator("#play").click();
  await page.waitForFunction(
    () => Number(document.querySelector("#cursor").value) >= 60,
  );
  await page.locator("#play").click();
  await ready(page);
  assert.equal(
    await page.locator("#playback-status").textContent(),
    "En pausa",
  );
  await page.locator("#restart").click();
  await ready(page);
  assert.equal(await page.locator("#cursor").inputValue(), "0");
  await page.locator("#cursor").press("ArrowRight");
  await ready(page);
  assert.equal(await page.locator("#cursor").inputValue(), "1");
  assert.match(await page.locator("#clock").textContent(), /08:01/);
});

test("API initialization survives window events; evidence units, zero and null remain accurate", async (t) => {
  const page = await open(t);
  await mockApi(page, { delay: 250 });
  await selectSource(page, "api");
  assert.equal(await page.locator("#window").isDisabled(), true);
  await page.locator("#window").dispatchEvent("change");
  await ready(page);
  assert.equal(await page.locator("#run").inputValue(), "corrida_01");
  assert.equal(await page.locator("#value-cpu").textContent(), "0");
  assert.equal(await page.locator("#value-ram").textContent(), "—");
  const evidence = await page.locator("#detail-evidence").textContent();
  assert.match(evidence, /tendencia de las últimas 3 h/);
  assert.match(evidence, /4\.2 σ/);
  assert.doesNotMatch(evidence, /pp\/h|4\.2 %/);
  assert.match(
    await page.locator("#detail-action").textContent(),
    /no proporcionada/,
  );
  assert.match(
    await page.locator("#phone-note").textContent(),
    /Aún no hay un impacto observado hasta este minuto/,
  );
  assert.equal(await page.locator("#detail-summary script").count(), 0);
  assert.ok(
    (await charts(page)).every((chart) =>
      chart.data.every((point) => point.x <= parseTime(DEFAULT_RANGE.start)),
    ),
  );
});

test("API failures clear all demo data including accessible canvas descriptions; retry recovers", async (t) => {
  const page = await open(t);
  await seek(page, "2026-10-14T10:00:00");
  await mockApi(page, { failure: true });
  await selectSource(page, "api");
  await page.locator("#error").waitFor({ state: "visible" });
  assert.match(await page.locator("#error-message").textContent(), /503/);
  assert.equal(await page.locator("#alert-count").textContent(), "0");
  assert.equal(await impactAvailable(page), false);
  for (const chart of await charts(page)) {
    assert.equal(chart.data.length, 0);
    assert.match(chart.label, /Sin datos cargados/);
  }
  await page.unroute("**/api/gracko/**");
  await mockApi(page);
  await page.locator("#retry").click();
  await ready(page);
  assert.equal(await page.locator("#run").inputValue(), "corrida_01");
});

test("late requests cannot replace a different source; empty runs and empty series have usable states", async (t) => {
  const page = await open(t);
  await mockApi(page, { delay: 250 });
  await selectSource(page, "api");
  await selectSource(page, "demo");
  await ready(page);
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#run").inputValue(), "ejemplo_01");
  await page.unroute("**/api/gracko/**");
  await mockApi(page, { runs: [] });
  await selectSource(page, "api");
  await page.waitForFunction(() =>
    document
      .querySelector("#data-status")
      .textContent.includes("no tiene corridas"),
  );
  assert.equal(await page.locator("#play").isDisabled(), true);
  assert.equal(await page.locator("#window").isDisabled(), true);
  assert.equal(await page.locator("#error").isVisible(), false);
  await selectSource(page, "demo");
  await ready(page);
  await page.unroute("**/api/gracko/**");
  await mockApi(page, { empty: true });
  await selectSource(page, "api");
  await ready(page);
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
  assert.match(
    await page.locator("#data-status").textContent(),
    /No hay lecturas/,
  );
});

test("API replay derives its clock, slider and requests from another week's run range", async (t) => {
  const page = await open(t);
  const range = { start: "2026-11-02T06:30:00", end: "2026-11-03T10:45:00" };
  const requests = await mockApi(page, { ranges: { corrida_01: range } });
  await selectSource(page, "api");
  await ready(page);
  assert.equal(await page.locator("#cursor").getAttribute("max"), "1695");
  assert.equal(await page.locator("#cursor").inputValue(), "0");
  assert.match(
    await page.locator("#range-start").textContent(),
    /02 nov.*06:30/,
  );
  assert.match(await page.locator("#range-end").textContent(), /03 nov.*10:45/);
  assert.match(await page.locator("#clock").textContent(), /02 nov.*06:30/);
  await seek(page, "2026-11-02T08:00:00", range);
  assert.match(await page.locator("#clock").textContent(), /02 nov.*08:00/);
  const reads = requests.filter((request) => request.endpoint === "serie");
  assert.ok(reads.length >= 2);
  for (const request of reads) {
    assert.equal(request.corrida, "corrida_01");
    assert.ok(parseTime(request.desde) >= parseTime(range.start));
    assert.ok(parseTime(request.hasta) <= parseTime(range.end));
  }
  assert.ok(
    requests.some(
      (request) =>
        request.endpoint === "referencias" &&
        request.corrida === "corrida_01" &&
        request.hasta === "2026-11-02T08:00:00",
    ),
  );
  for (const chart of await charts(page)) {
    assert.ok(chart.data.length > 0);
    assert.ok(
      chart.data.every(
        (point) =>
          point.x >= parseTime(range.start) &&
          point.x <= parseTime("2026-11-02T08:00:00"),
      ),
    );
  }
});

test("a slow run range cannot replace a later run selection", async (t) => {
  const page = await open(t);
  const ranges = {
    corrida_02: { start: "2026-11-09T09:00:00", end: "2026-11-09T17:00:00" },
    corrida_03: { start: "2026-12-01T07:15:00", end: "2026-12-01T08:45:00" },
  };
  const requests = await mockApi(page, {
    runs: ["corrida_01", "corrida_02", "corrida_03"],
    ranges,
    rangeDelays: { corrida_02: 250 },
    cpuByRun: { corrida_02: 22, corrida_03: 33 },
  });
  await selectSource(page, "api");
  await ready(page);
  const slowRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/rango") &&
      url.searchParams.get("corrida") === "corrida_02"
    );
  });
  await page.locator("#run").selectOption("corrida_02");
  await slowRequest;
  await page.locator("#run").selectOption("corrida_03");
  await ready(page);
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#run").inputValue(), "corrida_03");
  assert.equal(await page.locator("#cursor").getAttribute("max"), "90");
  assert.equal(await page.locator("#cursor").inputValue(), "0");
  assert.equal(await page.locator("#value-cpu").textContent(), "33");
  assert.match(await page.locator("#clock").textContent(), /01 dic.*07:15/);
  assert.match(await page.locator("#range-end").textContent(), /01 dic.*08:45/);
  assert.equal(
    requests.some(
      (request) =>
        request.endpoint === "serie" && request.corrida === "corrida_02",
    ),
    false,
    "A superseded range must not start frame requests",
  );
  for (const chart of await charts(page)) {
    assert.ok(
      chart.data.every(
        (point) => point.x === parseTime(ranges.corrida_03.start),
      ),
    );
  }
});

test("a missing run range clears the previous view and retries the same run without demo dates", async (t) => {
  const page = await open(t);
  const options = {
    runs: ["corrida_01", "corrida_02"],
    ranges: {
      corrida_02: { start: "2027-01-04T10:00:00", end: "2027-01-04T11:30:00" },
    },
    rangeStatuses: { corrida_02: 404 },
  };
  const requests = await mockApi(page, options);
  await selectSource(page, "api");
  await ready(page);
  await page.locator("#run").selectOption("corrida_02");
  await page.locator("#error").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#error-message").textContent(),
    /rango por corrida/,
  );
  assert.match(
    await page.locator("#error-message").textContent(),
    /No se usarán fechas del ejemplo/,
  );
  assert.equal(await page.locator("#source").inputValue(), "api");
  assert.equal(await page.locator("#run").inputValue(), "corrida_02");
  assert.equal(await page.locator("#play").isDisabled(), true);
  assert.equal(await page.locator("#cursor").isDisabled(), true);
  assert.equal(await impactAvailable(page), false);
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
  assert.doesNotMatch(await page.locator("#clock").textContent(), /08 oct/);
  assert.equal(
    requests.some(
      (request) =>
        request.endpoint === "serie" && request.corrida === "corrida_02",
    ),
    false,
  );
  for (const chart of await charts(page)) {
    assert.equal(chart.data.length, 0);
    assert.match(chart.label, /Sin datos cargados/);
  }
  options.rangeStatuses.corrida_02 = 200;
  await page.locator("#retry").click();
  await ready(page);
  assert.equal(await page.locator("#run").inputValue(), "corrida_02");
  assert.equal(await page.locator("#cursor").getAttribute("max"), "90");
  assert.match(await page.locator("#clock").textContent(), /04 ene.*10:00/);
  assert.equal(
    requests.filter(
      (request) =>
        request.endpoint === "rango" && request.corrida === "corrida_02",
    ).length,
    2,
  );
});

test("API impact references stay scoped to run and alert, disappear when absent and never reveal future gains", async (t) => {
  const page = await open(t);
  const range = { start: "2027-02-01T06:00:00", end: "2027-02-01T07:00:00" };
  const reference = {
    id: "impacto-api-1",
    corrida: "corrida_01",
    tipo: "capacidad_disco",
    timestamp: "2027-02-01T06:30:00",
    fuente: "Hipótesis identificada del equipo para prueba",
    descripcion: "Impacto hipotético de prueba",
    alerta_id: "api-1",
  };
  const options = { ranges: { corrida_01: range }, references: [reference] };
  await mockApi(page, options);
  await selectSource(page, "api");
  await ready(page);
  assert.equal(await impactAvailable(page), false);
  for (const chart of await charts(page))
    assert.equal(chart.context.phones.length, 0);
  await seek(page, reference.timestamp, range);
  assert.equal(await impactAvailable(page), true);
  assert.equal(await page.locator("#phone-gain").textContent(), "30 min");
  assert.equal(
    await page.locator("#phone-source").textContent(),
    `${reference.fuente} · ${reference.descripcion}`,
  );
  assert.match(
    await page.locator("#phone-note").textContent(),
    /[Hh]ipótesis|hipotétic/,
  );
  for (const [label, references] of [
    ["absent", []],
    ["another run", [{ ...reference, corrida: "corrida_02" }]],
    ["another tenant", [{ ...reference, tenant: "kaiku" }]],
    ["legacy reference without a run", [{ ...reference, corrida: undefined }]],
    ["another alert", [{ ...reference, alerta_id: "api-2" }]],
    [
      "display title instead of canonical type",
      [{ ...reference, alerta_id: undefined, tipo: "Disco cerca de llenarse" }],
    ],
    ["ambiguous links", [reference, { ...reference, id: "impacto-duplicado" }]],
  ]) {
    options.references = references;
    await seek(page, reference.timestamp, range);
    assert.equal(await impactAvailable(page), false, label);
    assert.equal(await page.locator("#error").isVisible(), false, label);
    assert.equal(await page.locator("#alert-count").textContent(), "1", label);
  }
  options.referenceStatus = 503;
  await seek(page, reference.timestamp, range);
  assert.equal(await impactAvailable(page), false);
  assert.equal(await page.locator("#error").isVisible(), false);
  assert.equal(await page.locator("#value-cpu").textContent(), "0");
});

test("slow playback preserves the visible frame, layout and focus, including a manual selection made during the request", async (t) => {
  const page = await open(t);
  const range = { start: "2027-02-01T08:00:00", end: "2027-02-01T09:00:00" };
  const options = {
    ranges: { corrida_01: range },
    cpuByRun: { corrida_01: 10 },
    alerts: [
      {
        id: "old",
        timestamp: range.start,
        confianza: 0.6,
        tipo: "capacidad_disco",
        resumen: "Revisar disco",
      },
      {
        id: "latest",
        timestamp: range.start,
        confianza: 0.7,
        tipo: "seguridad_acceso",
        resumen: "Revisar acceso",
      },
    ],
  };
  await mockApi(page, options);
  await selectSource(page, "api");
  await ready(page);
  await selectSpeed(page, "5");
  const positions = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ["data-view", "detail-section"].map((id) => [
          id,
          document.getElementById(id).getBoundingClientRect().top + scrollY,
        ]),
      ),
    );
  const before = await positions();
  let release;
  options.frameGate = new Promise((resolve) => {
    release = resolve;
  });
  t.after(() => release?.());
  const pending = page.waitForRequest(
    (request) =>
      request.url().includes("/serie?") &&
      new URL(request.url()).searchParams.get("hasta") ===
        "2027-02-01T08:05:00",
  );
  options.cpuByRun.corrida_01 = 20;
  await page.locator("#play").click();
  await page.locator("#speed").focus();
  await pending;
  assert.equal(
    await page.locator("#data-view").getAttribute("aria-busy"),
    "true",
  );
  assert.equal(await page.locator("#value-cpu").textContent(), "10");
  assert.equal(await page.locator("#detail-content").isVisible(), true);
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Acceso y seguridad",
  );
  assert.equal(await page.locator("#alert-list button").count(), 2);
  assert.equal(await page.evaluate(() => document.activeElement.id), "speed");
  assert.deepEqual(
    await positions(),
    before,
    "The loading indicator must not move either panel",
  );
  options.frameGate = null;
  release();
  await ready(page);
  assert.equal(await page.locator("#value-cpu").textContent(), "20");
  assert.equal(await page.evaluate(() => document.activeElement.id), "speed");
  assert.deepEqual(await positions(), before);
  options.frameGate = new Promise((resolve) => {
    release = resolve;
  });
  const second = page.waitForRequest(
    (request) =>
      request.url().includes("/serie?") &&
      new URL(request.url()).searchParams.get("hasta") ===
        "2027-02-01T08:10:00",
  );
  await second;
  const oldAlert = page.locator('[data-alert-id="old"]');
  await oldAlert.click();
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Capacidad de disco",
  );
  options.frameGate = null;
  release();
  await ready(page);
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Capacidad de disco",
    "The response must respect a selection made while the request was pending",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.alertId),
    "old",
  );
  await page.locator("#play").click();
  options.frameGate = new Promise((resolve) => {
    release = resolve;
  });
  await setCursor(page, 0);
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
  assert.equal(await page.locator("#detail-content").isVisible(), false);
  assert.equal(await page.locator("#alert-list button").count(), 0);
  options.frameGate = null;
  release();
  await ready(page);
  options.frameStatus = 503;
  await page.locator("#window").dispatchEvent("change");
  await page.locator("#error").waitFor({ state: "visible" });
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
  assert.equal(await page.locator("#detail-content").isVisible(), false);
});

test("automatic selection follows new alerts and crossed references, while manual selection remains pinned", async (t) => {
  const page = await open(t);
  const range = { start: "2027-02-01T08:00:00", end: "2027-02-01T09:00:00" };
  await mockApi(page, {
    ranges: { corrida_01: range },
    alerts: [
      {
        id: "disk",
        timestamp: range.start,
        confianza: 0.6,
        tipo: "capacidad_disco",
        resumen: "Revisar disco",
      },
      {
        id: "access",
        timestamp: "2027-02-01T08:01:00",
        confianza: 0.7,
        tipo: "seguridad_acceso",
        resumen: "Revisar acceso",
      },
      {
        id: "performance",
        timestamp: "2027-02-01T08:16:00",
        confianza: 0.8,
        tipo: "degradacion_rendimiento",
        resumen: "Revisar rendimiento",
      },
    ],
    references: [
      {
        id: "disk-impact",
        corrida: "corrida_01",
        alerta_id: "disk",
        tipo: "capacidad_disco",
        timestamp: "2027-02-01T08:05:00",
        fuente: "Hipótesis de prueba",
        descripcion: "Impacto de disco",
      },
      {
        id: "performance-impact",
        corrida: "corrida_01",
        alerta_id: "performance",
        tipo: "degradacion_rendimiento",
        timestamp: "2027-02-01T08:20:00",
        fuente: "Hipótesis de prueba",
        descripcion: "Impacto de rendimiento",
      },
    ],
  });
  await selectSource(page, "api");
  await ready(page);
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Capacidad de disco",
  );
  assert.match(
    await page.locator("#phone-note").textContent(),
    /Aún no hay un impacto observado hasta este minuto/,
  );
  assert.doesNotMatch(
    await page.locator("#phone-note").textContent(),
    /sin referencia|no existe/i,
  );
  await seek(page, "2027-02-01T08:01:00", range);
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Acceso y seguridad",
  );
  await selectSpeed(page, "5");
  async function advance() {
    const next = Number(await page.locator("#cursor").inputValue()) + 5;
    await page.locator("#play").click();
    await page.waitForFunction(
      (minute) =>
        Number(document.querySelector("#cursor").value) === minute &&
        document.querySelector("#data-view").getAttribute("aria-busy") ===
          "false",
      next,
    );
    await page.locator("#play").click();
    await ready(page);
  }
  await advance();
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Capacidad de disco",
  );
  assert.equal(await page.locator("#phone-gain").textContent(), "5 min");
  assert.equal(await page.locator("#follow-alerts").isDisabled(), false);
  assert.equal(
    await page.locator("#follow-alerts").textContent(),
    "Seguir la última alerta",
  );
  await advance();
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Capacidad de disco",
    "An automatically selected impact stays visible until another event changes the context",
  );
  await page.locator('[data-alert-id="access"]').click();
  await advance();
  assert.equal(await page.locator("#alert-count").textContent(), "3");
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Acceso y seguridad",
  );
  await advance();
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Acceso y seguridad",
    "A crossed reference must not override the person's selection",
  );
  await page.locator("#follow-alerts").click();
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Rendimiento del servicio",
  );
  assert.equal(await page.locator("#follow-alerts").isDisabled(), true);
  await page.locator('[data-alert-id="performance"]').click();
  await seek(page, range.start, range);
  assert.equal(
    await page.locator("#detail-title").textContent(),
    "Capacidad de disco",
  );
  assert.equal(await page.locator("#follow-alerts").isDisabled(), true);
});

test("calendar warnings render as safe text and reset when changing runs or returning to the demo", async (t) => {
  const page = await open(t);
  const warnings = [
    "Se usó el calendario manual: revisa los eventos con el responsable.",
    '<img src="invalid-warning" onerror="window.calendarWarningExecuted = true"><script>window.calendarWarningExecuted = true</script>',
  ];
  await mockApi(page, {
    runs: ["corrida_01", "corrida_02", "corrida_03"],
    rangeDelays: { corrida_02: 250 },
    calendarByRun: {
      corrida_01: { calendario_fuente: "manual", avisos: warnings },
      corrida_02: { calendario_fuente: "contexto.md", avisos: [] },
    },
  });
  await selectSource(page, "api");
  await ready(page);
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda de respaldo/,
  );
  assert.equal(await page.locator("#calendar-warning").isVisible(), true);
  assert.deepEqual(
    await page.locator("#calendar-warnings li").allTextContents(),
    warnings,
  );
  assert.equal(
    await page
      .locator("#calendar-warnings img, #calendar-warnings script")
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.calendarWarningExecuted),
    undefined,
  );
  assert.ok(
    (await page.locator("#calendar-warning-summary").textContent()).trim(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
    null,
    { timeout: 3000 },
  );
  if (process.env.CALENDAR_WARNING_SCREENSHOT) {
    await page.screenshot({
      path: resolve(process.env.CALENDAR_WARNING_SCREENSHOT),
      fullPage: true,
    });
  }
  await page.locator("#run").selectOption("corrida_02");
  assert.equal(
    await page.locator("#calendar-warning").isVisible(),
    false,
    "Warnings from the previous run must disappear while metadata loads",
  );
  assert.equal(await page.locator("#calendar-warnings li").count(), 0);
  assert.doesNotMatch(
    await page.locator("#calendar-source").textContent(),
    /respaldo/i,
  );
  await ready(page);
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda de esta corrida/,
  );
  assert.equal(await page.locator("#calendar-warning").isVisible(), false);
  await page.locator("#run").selectOption("corrida_03");
  await ready(page);
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /no informad|no disponible|desconocid/i,
  );
  assert.equal(await page.locator("#calendar-warning").isVisible(), false);
  await page.locator("#run").selectOption("corrida_01");
  await ready(page);
  assert.equal(await page.locator("#calendar-warning").isVisible(), true);
  await selectSource(page, "demo");
  await ready(page);
  assert.equal(await page.locator("#calendar-warning").isVisible(), false);
  assert.equal(await page.locator("#calendar-warnings li").count(), 0);
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda ilustrativa del ejemplo/,
  );
});

test("calendar notice follows each API frame and warns about manual calendars even without listed warnings", async (t) => {
  const page = await open(t);
  const options = {
    calendarByRun: {
      corrida_01: {
        calendario_fuente: "contexto.md",
        avisos: ["No se pudo interpretar un horario del contexto."],
      },
    },
  };
  await mockApi(page, options);
  await selectSource(page, "api");
  await ready(page);
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda de esta corrida/,
  );
  assert.equal(await page.locator("#calendar-warning").isVisible(), true);
  assert.deepEqual(
    await page.locator("#calendar-warnings li").allTextContents(),
    options.calendarByRun.corrida_01.avisos,
  );
  options.calendarByRun.corrida_01 = {
    calendario_fuente: "manual",
    avisos: [],
  };
  await seek(page, "2026-10-08T08:01:00");
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda de respaldo/,
  );
  assert.equal(await page.locator("#calendar-warning").isVisible(), true);
  assert.equal(await page.locator("#calendar-warnings li").count(), 0);
  assert.match(
    await page.locator("#calendar-warning-summary").textContent(),
    /agenda de respaldo/i,
  );
  options.calendarByRun.corrida_01 = {
    calendario_fuente: "contexto.md",
    avisos: [],
  };
  await seek(page, "2026-10-08T08:02:00");
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda de esta corrida/,
  );
  assert.equal(await page.locator("#calendar-warning").isVisible(), false);
  assert.equal(await page.locator("#calendar-warnings li").count(), 0);
});

test("a failed frame keeps current calendar metadata, while a failed run change clears the old source and warnings", async (t) => {
  const page = await open(t);
  const options = {
    runs: ["corrida_01", "corrida_02"],
    rangeStatuses: { corrida_02: 404 },
    calendarByRun: {
      corrida_01: {
        calendario_fuente: "manual",
        avisos: ["Aviso exclusivo de corrida_01"],
      },
    },
  };
  await mockApi(page, options);
  await selectSource(page, "api");
  await ready(page);
  assert.equal(await page.locator("#calendar-warning").isVisible(), true);
  options.frameStatus = 503;
  await page.locator("#window").dispatchEvent("change");
  await page.locator("#error").waitFor({ state: "visible" });
  assert.equal(await page.locator("#calendar-warning").isVisible(), true);
  assert.match(
    await page.locator("#calendar-source").textContent(),
    /Agenda de respaldo/,
  );
  assert.deepEqual(
    await page.locator("#calendar-warnings li").allTextContents(),
    ["Aviso exclusivo de corrida_01"],
  );
  options.frameStatus = 200;
  await page.locator("#run").selectOption("corrida_02");
  await page.locator("#error").waitFor({ state: "visible" });
  assert.equal(await page.locator("#calendar-warning").isVisible(), false);
  assert.equal(await page.locator("#calendar-warnings li").count(), 0);
  assert.doesNotMatch(
    await page.locator("#calendar-source").textContent(),
    /respaldo/i,
  );
});

test("demonstration sound requires opt-in and plays once only when forward playback crosses an impact", async (t) => {
  const page = await open(t, mockAudioContext);
  const calls = () => page.evaluate(() => window.audioCalls);
  assert.equal(
    await page.locator("#phone-sound").getAttribute("aria-pressed"),
    "false",
  );
  await seek(page, "2026-10-11T23:00:00");
  assert.equal(await impactAvailable(page), true);
  assert.deepEqual(await calls(), {
    constructed: 0,
    resume: 0,
    oscillators: 0,
    starts: 0,
    suspend: 0,
    close: 0,
  });
  await setDisclosure(page, "impact-details");
  await page.locator("#phone-sound").click();
  assert.equal(
    await page.locator("#phone-sound").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal((await calls()).resume, 1);
  assert.equal(
    (await calls()).starts,
    0,
    "Opting in at an already visible impact stays silent",
  );
  await seek(page, "2026-10-11T22:59:00");
  assert.equal(
    (await calls()).starts,
    0,
    "Manual seeking stays silent with audio enabled",
  );
  await selectSpeed(page, "5");
  await page.locator("#play").click();
  await page.waitForFunction(() => window.audioCalls.starts === 2);
  await page.locator("#play").click();
  await ready(page);
  assert.equal((await calls()).oscillators, 2);
  assert.equal((await calls()).starts, 2);
  assert.match(await page.locator("#clock").textContent(), /11 oct.*23:04/);
  await page.locator("#window").dispatchEvent("change");
  await ready(page);
  assert.equal(
    (await calls()).starts,
    2,
    "Refreshing the same frame must not repeat the cue",
  );
  const currentMinute = Number(await page.locator("#cursor").inputValue());
  await page.locator("#play").click();
  await page.waitForFunction(
    (minute) => Number(document.querySelector("#cursor").value) > minute,
    currentMinute,
  );
  await page.locator("#play").click();
  await ready(page);
  assert.equal(
    (await calls()).starts,
    2,
    "Continuing past an observed impact stays silent",
  );
  await seek(page, "2026-10-11T22:59:00");
  assert.equal(
    (await calls()).starts,
    2,
    "Rewinding must not itself play a sound",
  );
  await page.locator("#play").click();
  await page.waitForFunction(() => window.audioCalls.starts === 4);
  await page.locator("#play").click();
  await ready(page);
  assert.equal(
    (await calls()).starts,
    4,
    "Replaying a crossed impact after rewinding must ring again",
  );
  await seek(page, "2026-10-11T23:00:00");
  assert.equal(
    (await calls()).starts,
    4,
    "Seeking to the impact remains silent",
  );
  await setDisclosure(page, "impact-details");
  await page.locator("#phone-sound").click();
  assert.equal(
    await page.locator("#phone-sound").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal((await calls()).suspend, 1);
  await seek(page, "2026-10-13T00:30:00");
  await page.locator("#play").click();
  await page.waitForFunction(() =>
    document.querySelector("#clock").textContent.includes("00:35"),
  );
  await page.locator("#play").click();
  await ready(page);
  assert.equal(
    (await calls()).starts,
    4,
    "Disabled audio stays silent at the next impact",
  );
  await page.reload();
  await ready(page);
  assert.equal(
    await page.locator("#phone-sound").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    (await calls()).constructed,
    0,
    "Reloading does not recreate or activate audio",
  );
  assert.equal((await calls()).starts, 0);
});

test("starting playback during a delayed manual seek does not sound an impact skipped by that seek", async (t) => {
  const page = await open(t, mockAudioContext);
  const range = { start: "2027-02-01T06:00:00", end: "2027-02-01T07:00:00" };
  const options = {
    ranges: { corrida_01: range },
    references: [
      {
        id: "impacto-antes-del-salto",
        corrida: "corrida_01",
        tipo: "capacidad_disco",
        timestamp: "2027-02-01T06:30:00",
        fuente: "Hipótesis del equipo para prueba",
        descripcion: "Referencia anterior al salto manual",
        alerta_id: "api-1",
      },
    ],
    frameGate: null,
  };
  await mockApi(page, options);
  await selectSource(page, "api");
  await ready(page);
  await setDisclosure(page, "impact-details");
  await page.locator("#phone-sound").click();
  await selectSpeed(page, "5");
  let releaseFrame;
  options.frameGate = new Promise((resolve) => {
    releaseFrame = resolve;
  });
  const manualRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/serie") &&
      url.searchParams.get("hasta") === "2027-02-01T06:40:00"
    );
  });
  await page.locator("#cursor").fill("40");
  await page.locator("#cursor").dispatchEvent("change");
  await manualRequest;
  await page.locator("#play").click();
  assert.equal(
    await page.locator("#data-view").getAttribute("aria-busy"),
    "true",
  );
  assert.equal(
    await page.locator("#playback-status").textContent(),
    "Reproduciendo",
  );
  options.frameGate = null;
  releaseFrame();
  await ready(page);
  assert.equal(await page.locator("#cursor").inputValue(), "40");
  assert.equal(await impactAvailable(page), true);
  assert.equal(
    await page.evaluate(() => window.audioCalls.starts),
    0,
    "Resolving a manual seek during playback must not sound the skipped impact",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#cursor").value === "45" &&
      document.querySelector("#data-view").getAttribute("aria-busy") ===
        "false",
  );
  assert.equal(
    await page.evaluate(() => window.audioCalls.starts),
    0,
    "The first playback tick must start at the seek position, after the impact",
  );
  await page.locator("#play").click();
  await ready(page);
});

test("loading an API run with an already observed reference does not play enabled demonstration sound", async (t) => {
  const page = await open(t, mockAudioContext);
  await setDisclosure(page, "impact-details");
  await page.locator("#phone-sound").click();
  const range = { start: "2027-02-01T06:00:00", end: "2027-02-01T07:00:00" };
  await mockApi(page, {
    ranges: { corrida_01: range },
    references: [
      {
        id: "impacto-al-cargar",
        corrida: "corrida_01",
        tipo: "capacidad_disco",
        timestamp: range.start,
        fuente: "Hipótesis del equipo para prueba",
        descripcion: "Referencia disponible al abrir la corrida",
        alerta_id: "api-1",
      },
    ],
  });
  await selectSource(page, "api");
  await ready(page);
  assert.equal(await impactAvailable(page), true);
  assert.equal(await page.evaluate(() => window.audioCalls.starts), 0);
  await selectSource(page, "demo");
  await ready(page);
  assert.equal(await page.evaluate(() => window.audioCalls.starts), 0);
});

test("desktop and mobile views fit the viewport, with local assets and an accessible readings table", async (t) => {
  const page = await open(t);
  await seek(page, "2026-10-14T10:00:00");
  assert.equal(await page.locator("#alert-count").textContent(), "3");
  await setDisclosure(page, "metrics-section");
  await setDisclosure(page, "detection-details");
  await setDisclosure(page, "impact-details");
  await page.locator(".readings summary").click();
  assert.equal(await page.locator("#readings-body tr").count(), 12);
  for (const width of [320, 390, 740, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForFunction(
      () => document.documentElement.scrollWidth <= innerWidth,
      null,
      { timeout: 3000 },
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No page overflow at ${width}px`,
    );
  }
  assert.ok(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .every((resource) => new URL(resource.name).origin === location.origin),
    ),
  );
  await page.locator(".readings summary").click();
  await setDisclosure(page, "metrics-section", false);
  await setDisclosure(page, "detection-details", false);
  await setDisclosure(page, "impact-details", false);
  if (process.env.SCREENSHOT_DIR) {
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: resolve(process.env.SCREENSHOT_DIR, "gracko-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: resolve(process.env.SCREENSHOT_DIR, "gracko-mobile.png"),
      fullPage: true,
    });
  }
});

const kitId = "0123456789abcdef0123456789abcdef";
const kitRun = `kit-${kitId}`;
const kitRun2 = `kit-${kitId}-corrida_02`;
const kitPayload = {
  id: kitId,
  corridas: [kitRun, kitRun2],
  empresas: ["taller_norte", "tienda-sur"],
  empresas_por_corrida: {
    [kitRun]: ["taller_norte", "tienda-sur"],
    [kitRun2]: ["tienda-sur"],
  },
  avisos: ["Empresa sin calibración previa", "<b>Aviso como texto</b>"],
  ignorados: 1,
};
async function mockKit(page, state = {}) {
  const calls = [];
  await page.route("**/api/kit**", async (route) => {
    const request = route.request();
    calls.push({
      method: request.method(),
      headers: request.headers(),
      body: request.postData(),
    });
    if (state.gate) await state.gate;
    const status =
      request.method() === "POST"
        ? (state.status ?? 200)
        : (state.getStatus ?? 200);
    await route.fulfill({
      status,
      json:
        status === 200
          ? kitPayload
          : {
              detail:
                status === 401
                  ? "Falta la clave de subida"
                  : "No se pudo abrir este kit",
            },
    });
  });
  return calls;
}
const kitApiOptions = () => ({
  companiesByRun: {
    [kitRun]: [
      { tenant: "taller_norte", giro: "Taller", calibrada: false },
      { tenant: "tienda-sur", giro: "Comercio", calibrada: false },
    ],
    [kitRun2]: [{ tenant: "tienda-sur", giro: "Comercio", calibrada: false }],
  },
  cpuByTenant: { gracko: 10, taller_norte: 25, "tienda-sur": 70 },
});
async function chooseZip(page) {
  if (!(await page.locator("#kit-panel").isVisible()))
    await page.locator("#kit-toggle").click();
  await page.locator("#kit-file").setInputFiles({
    name: "nuevo-kit.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("zip-fixture"),
  });
}

test("upload opens companies without gracko; CSV, run and company stay scoped; reload retains kit", async (t) => {
  const page = await newPage(t);
  await mockApi(page, kitApiOptions());
  const calls = await mockKit(page);
  await page.goto(origin);
  await ready(page);
  await chooseZip(page);
  await page.locator("#kit-submit").click();
  await page.waitForFunction(
    (run) => document.querySelector("#run").value === run,
    kitRun,
  );
  await ready(page);
  assert.equal(await page.locator("#company").inputValue(), "taller_norte");
  assert.equal(
    await page.locator("#run option:checked").textContent(),
    "Su kit · Conjunto principal",
  );
  assert.match(
    await page.locator("#tenant-label").textContent(),
    /taller_norte.*Taller/,
  );
  assert.match(
    await page.locator("#detail-meta").textContent(),
    /^taller_norte/,
  );
  assert.match(
    await page.locator("#download-alerts").getAttribute("href"),
    new RegExp(`/api/taller_norte/alertas.csv\\?corrida=${kitRun}$`),
  );
  assert.match(
    await page.locator("#download-note").textContent(),
    /Periodo completo/,
  );
  assert.equal(
    await page.locator("#phone-content").evaluate((element) => element.hidden),
    true,
  );
  assert.match(
    await page.locator("#phone-note").textContent(),
    /Sin referencia de impacto/,
  );
  assert.equal(await page.locator("#kit-warnings-list b").count(), 0);
  await page.locator("#company").selectOption("tienda-sur");
  await ready(page);
  assert.equal(await page.locator("#value-cpu").textContent(), "70");
  assert.match(
    await page.locator("#download-alerts").getAttribute("href"),
    /\/tienda-sur\/alertas.csv/,
  );
  await page.locator("#run").selectOption(kitRun2);
  await ready(page);
  assert.deepEqual(await page.locator("#company option").allTextContents(), [
    "tienda-sur",
  ]);
  await page.locator('nav a[href="#metrics-section"]').click();
  assert.equal(new URL(page.url()).hash, `#kit=${kitId}`);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator("#run").inputValue(), kitRun);
  assert.equal(await page.locator("#company").inputValue(), "taller_norte");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.match(calls[0].body, /name="archivo"/);
  await selectSource(page, "demo");
  await ready(page);
  assert.equal(await page.locator("#download-block").isVisible(), false);
});

test("upload errors preserve the current view, ask for a key on 401 and permit retry", async (t) => {
  const page = await newPage(t);
  await mockApi(page, kitApiOptions());
  const state = { status: 401 };
  const calls = await mockKit(page, state);
  await page.goto(origin);
  await ready(page);
  await chooseZip(page);
  await page.locator("#kit-submit").click();
  await page.locator("#kit-key").waitFor({ state: "visible" });
  assert.equal(await page.locator("#run").inputValue(), "corrida_01");
  assert.equal(await page.locator("#value-cpu").textContent(), "10");
  await page.locator("#kit-key").fill("test-key");
  state.status = 422;
  await page.locator("#kit-submit").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#kit-status")
      .textContent.includes("No se pudo abrir este kit"),
  );
  assert.equal(
    await page.locator("#kit-file").evaluate((element) => element.files.length),
    1,
  );
  assert.equal(await page.locator("#kit-submit").isDisabled(), false);
  state.status = 200;
  await page.locator("#kit-submit").click();
  await page.waitForFunction(
    (run) => document.querySelector("#run").value === run,
    kitRun,
  );
  await ready(page);
  assert.equal(calls[2].headers["x-zikit-clave"], "test-key");
  assert.equal(new URL(page.url()).hash, `#kit=${kitId}`);
  assert.equal(
    (await page.locator("#kit-link").getAttribute("href")).includes("test-key"),
    false,
  );
});

test("a key in the fragment is removed, remembered for this session and never copied to the kit link", async (t) => {
  const page = await newPage(t);
  await mockApi(page, kitApiOptions());
  const calls = await mockKit(page);
  await page.goto(`${origin}/#kit=${kitId}&clave=link-key`);
  await ready(page);
  assert.equal(new URL(page.url()).hash, `#kit=${kitId}`);
  assert.equal(
    (await page.locator("#kit-link").getAttribute("href")).includes("clave"),
    false,
  );
  await chooseZip(page);
  await page.locator("#kit-submit").click();
  await page.waitForFunction(() =>
    document.querySelector("#kit-status").textContent.includes("Kit listo"),
  );
  await ready(page);
  assert.equal(
    calls.find((call) => call.method === "POST").headers["x-zikit-clave"],
    "link-key",
  );
});

test("expired shared kit shows recovery without inventing a kit or falling back to fictitious data", async (t) => {
  const page = await newPage(t);
  await mockApi(page, kitApiOptions());
  const state = { getStatus: 404 };
  await mockKit(page, state);
  await page.goto(`${origin}/#kit=${kitId}`);
  await ready(page);
  assert.equal(await page.locator("#source").inputValue(), "api");
  assert.equal(await page.locator("#kit-retry").isVisible(), true);
  assert.equal(await page.locator("#kit-link").isVisible(), false);
  state.getStatus = 200;
  await page.locator("#kit-retry").click();
  await page.waitForFunction(
    (run) => document.querySelector("#run").value === run,
    kitRun,
  );
  await ready(page);
  assert.equal(await page.locator("#company").inputValue(), "taller_norte");
});

test("changing company discards late frames and hides the old CSV until the new view is ready", async (t) => {
  const page = await newPage(t);
  const options = kitApiOptions();
  await mockApi(page, options);
  await mockKit(page);
  await page.goto(`${origin}/#kit=${kitId}`);
  await ready(page);
  let release;
  options.tenantFrameGate = {
    "tienda-sur": new Promise((resolve) => {
      release = resolve;
    }),
  };
  await page.locator("#company").selectOption("tienda-sur");
  await page.waitForFunction(
    () =>
      !document.querySelector("#company").disabled &&
      document.querySelector("#download-block").hidden,
  );
  assert.equal(
    await page.locator("#download-alerts").getAttribute("href"),
    null,
  );
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
  await page.locator("#company").selectOption("taller_norte");
  await ready(page);
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#value-cpu").textContent(), "25");
  assert.match(
    await page.locator("#download-alerts").getAttribute("href"),
    /\/taller_norte\/alertas.csv/,
  );
  options.companyStatus = 503;
  await page.locator("#run").selectOption(kitRun2);
  await page.locator("#error").waitFor({ state: "visible" });
  assert.equal(await page.locator("#download-block").isVisible(), false);
  assert.equal(await page.locator("#value-cpu").textContent(), "—");
});

test("mobile kit controls fit and the two PR26 fixes remain visible", async (t) => {
  const page = await newPage(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, kitApiOptions());
  await mockKit(page);
  await page.goto(`${origin}/#kit=${kitId}`);
  await ready(page);
  await chooseZip(page);
  for (const width of [320, 390, 740, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No overflow at ${width}: ${await page.evaluate(() => JSON.stringify([...document.querySelectorAll("body *")].filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > innerWidth).map((e) => ({ tag: e.tagName, id: e.id, width: e.getBoundingClientRect().width }))))}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const styles = await page.evaluate(() => {
    const input = document.querySelector("#window"),
      style = getComputedStyle(input);
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d");
    context.font = `${style.fontSize} ${style.fontFamily}`;
    return {
      available:
        input.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      needed: context.measureText("Todo hasta ahora").width,
      expected: getComputedStyle(document.documentElement).getPropertyValue(
        "--signal-expected",
      ),
      gap: getComputedStyle(document.documentElement).getPropertyValue(
        "--signal-gap",
      ),
    };
  });
  assert.ok(styles.available >= styles.needed);
  assert.match(styles.expected, /rgba\(.+,\s*0\.13\)/);
  assert.match(styles.gap, /rgba\(.+,\s*0\.18\)/);
});

test("a failed company range does not trap the user away from other companies", async (t) => {
  const page = await newPage(t);
  const options = kitApiOptions();
  options.rangeStatusesByTenant = { taller_norte: 503 };
  await mockApi(page, options);
  await mockKit(page);
  await page.goto(`${origin}/#kit=${kitId}`);
  await page.locator("#error").waitFor({ state: "visible" });
  assert.equal(await page.locator("#company").isDisabled(), false);
  await page.locator("#company").selectOption("tienda-sur");
  await ready(page);
  assert.equal(await page.locator("#value-cpu").textContent(), "70");
});

test("pending shared-kit navigation keeps its link; changing source cancels late recovery", async (t) => {
  for (const cancel of [false, true]) {
    const page = await newPage(t);
    await mockApi(page, kitApiOptions());
    let release;
    const state = {
      gate: new Promise((resolve) => {
        release = resolve;
      }),
    };
    await mockKit(page, state);
    await page.goto(`${origin}/#kit=${kitId}`);
    await page.locator('nav a[href="#metrics-section"]').click();
    assert.equal(new URL(page.url()).hash, `#kit=${kitId}`);
    if (cancel) {
      await selectSource(page, "demo");
      await ready(page);
    }
    release();
    await ready(page);
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator("#source").inputValue(),
      cancel ? "demo" : "api",
    );
    assert.equal(
      await page.locator("#run").inputValue(),
      cancel ? "ejemplo_01" : kitRun,
    );
  }
});

test("alert evidence and replay readings remain distinct, with only selected markers in detail", async (t) => {
  const page = await newPage(t);
  const range = { start: "2027-02-01T06:00:00", end: "2027-02-01T07:00:00" };
  const alerts = [
    {
      id: "disk-old",
      timestamp: range.start,
      confianza: 0.7,
      tipo: "capacidad_disco",
      resumen: "Disco (8.0σ); lectura actual 64.6 %",
      accion_sugerida:
        "Revisar el espacio libre y confirmar el próximo respaldo.",
      familias: [
        {
          familia: "nivel",
          senal: "disco",
          valor: 64.4,
          normal: 58.4,
          z: 8,
          ventana_min: 15,
          valor_actual: 64.6,
          hora: range.start,
        },
      ],
    },
    {
      id: "disk-new",
      timestamp: "2027-02-01T06:15:00",
      confianza: 0.8,
      tipo: "capacidad_disco",
      resumen: "Otro aviso",
      familias: [
        {
          familia: "nivel",
          senal: "disco",
          valor: 72,
          normal: 58.4,
          z: 9,
          ventana_min: 15,
          valor_actual: 72.2,
          hora: "2027-02-01T06:15:00",
        },
      ],
    },
  ];
  const references = alerts.map((alert, index) => ({
    id: `impact-${index}`,
    corrida: "corrida_01",
    alerta_id: alert.id,
    tipo: alert.tipo,
    timestamp: index ? "2027-02-01T06:45:00" : "2027-02-01T06:30:00",
    fuente: "Hipótesis de prueba",
    descripcion: "Impacto estimado",
  }));
  await mockApi(page, { ranges: { corrida_01: range }, alerts, references });
  await page.goto(origin);
  await ready(page);
  assert.equal(
    await page.locator("#replay-options").evaluate((e) => e.open),
    false,
  );
  assert.equal(await page.locator("#source").isVisible(), false);
  assert.equal(await page.locator("#phone-preview").isVisible(), false);
  assert.equal(await page.locator("#phone-preview").textContent(), "");
  assert.equal(await page.locator("#speed").isVisible(), false);
  assert.equal(
    await page.locator("#run option:checked").textContent(),
    "Conjunto 01",
  );
  assert.match(
    await page.locator("#download-all").getAttribute("href"),
    /^\/api\/entrega\.csv\?corrida=corrida_01$/,
  );
  await seek(page, range.end, range);
  await page.locator('[data-alert-id="disk-old"]').click();
  assert.equal(
    await page.locator("#impact-details").evaluate((e) => e.open),
    false,
  );
  assert.equal(await page.locator("#phone-preview").isVisible(), true);
  assert.equal(
    await page.locator("#phone-preview").textContent(),
    "30 min · antes del impacto estimado · hipótesis del equipo",
  );
  assert.match(
    await page.locator("#selection-status").textContent(),
    /Revisando alerta del.*06:00/,
  );
  assert.match(
    await page.locator("#focus-metric .alert-reading").textContent(),
    /64\.4 %/,
  );
  assert.match(
    await page.locator("#focus-metric .alert-point").textContent(),
    /64\.6 %/,
  );
  assert.match(
    await page.locator("#focus-metric .alert-normal").textContent(),
    /58\.4 %/,
  );
  assert.match(
    await page.locator("#focus-metric .alert-reading-time").textContent(),
    /06:00/,
  );
  assert.match(
    await page.locator("#focus-metric .focus-note").textContent(),
    /Última lectura:.*07:00/,
  );
  assert.equal(await page.locator("#value-disco").textContent(), "58");
  assert.doesNotMatch(
    await page.locator("#detail-summary").textContent(),
    /σ|64\.6/,
  );
  assert.match(
    await page.locator("#detail-summary").textContent(),
    /promedió 64\.4 %.*15 min.*58\.4 %/,
  );
  assert.equal(await page.locator("#detail-action li").count(), 2);
  assert.match(await page.locator("#detail-original").textContent(), /8\.0σ/);
  const markerIds = () =>
    page.locator("#chart-disco").evaluate((canvas) => {
      const context = Chart.getChart(canvas).$zikit;
      return {
        alerts: context.alerts.map((a) => a.id),
        phones: context.phones.map((p) => p.id),
      };
    });
  assert.deepEqual(await markerIds(), {
    alerts: ["disk-old"],
    phones: ["impact-0"],
  });
  await page.locator("#follow-alerts").click();
  assert.deepEqual(await markerIds(), {
    alerts: ["disk-new"],
    phones: ["impact-1"],
  });
  assert.match(
    await page.locator("#focus-metric .alert-reading").textContent(),
    /72 %/,
  );
  assert.match(
    await page.locator("#focus-metric .alert-point").textContent(),
    /72\.2 %/,
  );
  await seek(page, "2027-02-01T06:20:00", range);
  assert.equal(await page.locator("#phone-preview").isVisible(), false);
  assert.equal(await page.locator("#phone-preview").textContent(), "");
  assert.deepEqual(await markerIds(), { alerts: ["disk-new"], phones: [] });
  await seek(page, range.start, range);
  assert.deepEqual(await markerIds(), { alerts: ["disk-old"], phones: [] });
});

test("detail promotes the average and keeps its time and point reading distinct", async (t) => {
  const page = await newPage(t);
  const range = { start: "2027-02-01T06:00:00", end: "2027-02-01T07:00:00" };
  const alerts = [
    {
      id: "latency",
      timestamp: "2027-02-01T06:15:00",
      confianza: 0.8,
      tipo: "rendimiento_erp",
      resumen: "Promedio elevado",
      familias: [
        {
          familia: "nivel",
          senal: "latencia_ms",
          valor: 81.7,
          normal: 38,
          ventana_min: 15,
          valor_actual: 37,
          hora: "2027-02-01T06:15:00",
        },
      ],
    },
    {
      id: "earlier-average",
      timestamp: "2027-02-01T06:20:00",
      confianza: 0.8,
      tipo: "rendimiento_erp",
      resumen: "Evidencia de una ventana anterior",
      familias: [
        {
          familia: "nivel",
          senal: "latencia_ms",
          valor: 81.7,
          normal: 38,
          ventana_min: 15,
          valor_actual: 37,
          hora: "2027-02-01T06:10:00",
        },
      ],
    },
    {
      id: "no-average",
      timestamp: "2027-02-01T06:30:00",
      confianza: 0.8,
      tipo: "rendimiento_erp",
      resumen: "Señal sin promedio",
      familias: [
        {
          familia: "tendencia",
          senal: "latencia_ms",
          valor: 10,
          valor_actual: 0,
          hora: "2027-02-01T06:30:00",
        },
      ],
    },
  ];
  await mockApi(page, { ranges: { corrida_01: range }, alerts });
  await page.goto(origin);
  await ready(page);
  await seek(page, range.end, range);
  await page.locator('[data-alert-id="latency"]').click();
  assert.equal(await page.locator(".alert-reading").textContent(), "81.7 ms");
  assert.equal(
    await page.locator(".alert-normal").textContent(),
    "Habitual: 38 ms",
  );
  assert.equal(
    await page.locator(".alert-average-label").textContent(),
    "Promedio de 15 min al emitirse",
  );
  assert.match(
    await page.locator(".alert-point").textContent(),
    /Lectura del minuto de emisión: 37 ms.*06:15/,
  );
  assert.match(
    await page.locator(".alert-reading-time").textContent(),
    /06:15/,
  );
  await page.locator('[data-alert-id="earlier-average"]').click();
  assert.equal(
    await page.locator(".alert-average-label").textContent(),
    "Promedio de 15 min de la alerta",
  );
  assert.match(
    await page.locator(".alert-reading-time").textContent(),
    /06:10/,
  );
  assert.doesNotMatch(
    await page.locator(".alert-reading-time").textContent(),
    /06:20/,
  );
  await page.locator('[data-alert-id="no-average"]').click();
  assert.equal(await page.locator(".alert-average").isVisible(), false);
  assert.equal(await page.locator(".alert-reading").textContent(), "");
  assert.match(
    await page.locator(".alert-point").textContent(),
    /emisión: 0 ms/,
  );
});

test("a received kit is labelled as analyzing until its first frame is ready", async (t) => {
  const page = await newPage(t);
  const options = kitApiOptions();
  let release;
  options.tenantFrameGate = {
    taller_norte: new Promise((resolve) => {
      release = resolve;
    }),
  };
  await mockApi(page, options);
  await mockKit(page);
  await page.goto(`${origin}/#kit=${kitId}`);
  await page.waitForFunction(() =>
    document
      .querySelector("#loading")
      .textContent.includes("Analizando el kit"),
  );
  assert.match(await page.locator("#kit-status").textContent(), /Analizando/);
  assert.doesNotMatch(
    await page.locator("#kit-status").textContent(),
    /Kit listo/,
  );
  assert.equal(await page.locator("#download-block").isVisible(), false);
  release();
  await ready(page);
  assert.match(await page.locator("#kit-status").textContent(), /Kit listo/);
});

test("a failed kit analysis stops its loading message and retry restores ready state", async (t) => {
  const page = await newPage(t);
  const options = kitApiOptions();
  options.rangeStatusesByTenant = { taller_norte: 503 };
  await mockApi(page, options);
  await mockKit(page);
  await page.goto(`${origin}/#kit=${kitId}`);
  await page.locator("#error").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#kit-status").textContent(),
    /No se pudo completar el análisis/,
  );
  assert.doesNotMatch(
    await page.locator("#kit-status").textContent(),
    /Analizando|Kit listo/,
  );
  options.rangeStatusesByTenant = {};
  await page.locator("#retry").click();
  await ready(page);
  assert.match(await page.locator("#kit-status").textContent(), /Kit listo/);
});
