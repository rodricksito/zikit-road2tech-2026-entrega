import {
  DemoSource,
  ApiSource,
  parseTime,
  isoTime,
  loadCompanies,
  loadKit,
  uploadKit,
  kitRunLabel,
  runLabel,
  deliveryUrl,
  readKitLink,
} from "./data.mjs?v=claridad-r31-20261010";
import { MetricCharts, METRICS } from "./charts.mjs?v=claridad-r31-20261010";
import {
  formatEvidence,
  formatImpact,
  formatAlertSummary,
  actionSteps,
  alertObservation,
  alertAverage,
} from "./presentation.mjs?v=claridad-r31-20261010";

const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const typeNames = {
  capacidad_disco: "Capacidad de disco",
  memoria: "Memoria",
  seguridad_acceso: "Acceso y seguridad",
  degradacion_rendimiento: "Rendimiento del servicio",
  agotamiento_conexiones: "Conexiones",
  base_de_datos: "Base de datos",
  trafico_anomalo: "Tráfico anómalo",
  red_enlace: "Enlace de red",
  anomalia_generica: "Señal por revisar",
  sin_clasificar: "Tipo no proporcionado",
};
const app = {
  source: null,
  mode: "demo",
  meta: null,
  frame: null,
  frameUntil: null,
  frameFrom: null,
  chartReferences: [],
  calendarInfo: null,
  calendarMessageKey: null,
  selected: null,
  manualSelection: null,
  until: null,
  start: null,
  end: null,
  retry: "initialize",
  run: "",
  tenant: "gracko",
  companies: [],
  companiesRun: null,
  kit: null,
  kitKey: "",
  pendingKit: null,
  kitController: null,
  uploadController: null,
  uploading: false,
  playing: false,
  timer: null,
  controller: null,
  revision: 0,
  ready: false,
  busy: false,
  charts: null,
  sounded: new Map(),
  audio: null,
  sound: false,
};
const dateTime = (value) => {
  if (value === null || value === undefined) return "—";
  const s = typeof value === "string" ? value : isoTime(value);
  const months = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  return `${s.slice(8, 10)} ${months[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)} · ${s.slice(11, 16)}`;
};
const valueText = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? number.format(value)
    : "—";
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function icon(name, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `icon ${className}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}
function announce(text) {
  $("announcement").textContent = text;
}
function visibleStart() {
  const hours = $("window").value;
  return hours === "all"
    ? app.start
    : Math.max(app.start, app.until - Number(hours) * 3600000);
}

function syncControls() {
  $("play").textContent = app.playing
    ? "Pausar"
    : app.ready && app.until >= app.end
      ? "Reproducir de nuevo"
      : "Reproducir";
  $("playback-status").textContent = app.playing
    ? "Reproduciendo"
    : app.ready && app.until >= app.end
      ? "Periodo finalizado"
      : "En pausa";
  $("playback-status").dataset.playing = String(app.playing);
  $("clock").textContent = dateTime(app.until);
  $("cursor").value = String(
    app.ready ? Math.round((app.until - app.start) / 60000) : 0,
  );
  $("cursor").setAttribute("aria-valuetext", dateTime(app.until));
  $("play").disabled = !app.ready;
  $("restart").disabled = !app.ready;
  $("cursor").disabled = !app.ready;
  $("window").disabled = !app.ready;
  $("run").disabled = !app.meta?.runs?.length;
  $("company").disabled = !app.companies.length || app.companiesRun !== app.run;
  renderDownload();
}

function renderDownload() {
  const available = app.mode === "api" && app.ready && Boolean(app.frame);
  $("download-block").hidden = !available;
  if (available) {
    $("download-alerts").href = deliveryUrl(app.run, { tenant: app.tenant });
    $("download-all").href = deliveryUrl(app.run);
    $("download-note").textContent = `${app.tenant} · Periodo completo`;
  } else {
    $("download-alerts").removeAttribute("href");
    $("download-all").removeAttribute("href");
  }
}

function renderCompany() {
  $("company").replaceChildren(
    ...app.companies.map((company) => {
      const option = node("option", company.tenant);
      option.value = company.tenant;
      return option;
    }),
  );
  $("company").value = app.tenant;
  const company = app.companies.find((item) => item.tenant === app.tenant);
  $("tenant-label").replaceChildren(
    document.createTextNode(company?.tenant ?? "Monitoreo"),
  );
  if (company?.giro) $("tenant-label").append(node("span", company.giro));
  document.title = company ? `ZIKIT · ${company.tenant}` : "ZIKIT · Monitoreo";
}

function renderRuns() {
  $("run").replaceChildren();
  for (const [label, runs] of [
    ["Kit subido", app.meta.runs.filter((run) => app.kit?.runs.includes(run))],
    [
      app.mode === "demo" ? "Ejemplo" : "Kit oficial",
      app.meta.runs.filter((run) => !app.kit?.runs.includes(run)),
    ],
  ]) {
    if (!runs.length) continue;
    const group = document.createElement("optgroup");
    group.label = label;
    for (const run of runs) {
      const option = node(
        "option",
        run === "ejemplo_01"
          ? "Semana de ejemplo"
          : app.kit?.runs.includes(run)
            ? kitRunLabel(run, app.kit.id)
            : runLabel(run),
      );
      option.value = run;
      group.append(option);
    }
    $("run").append(group);
  }
}
function pause() {
  app.playing = false;
  clearTimeout(app.timer);
  app.timer = null;
  syncControls();
}
function cancel() {
  app.controller?.abort();
  app.controller = null;
  app.revision++;
}
function showBusy(busy) {
  app.busy = busy;
  $("loading").hidden = !busy;
  $("loading").textContent =
    app.frameUntil === null
      ? app.kit?.runs.includes(app.run)
        ? "Analizando el kit… Los conjuntos grandes pueden tardar un minuto."
        : "Consultando los datos de este minuto…"
      : `Actualizando… Se conserva el cuadro de ${dateTime(app.frameUntil)}.`;
  $("data-view").setAttribute("aria-busy", String(busy));
  if (busy && !app.frame && !app.uploading && app.kit?.runs.includes(app.run))
    kitMessage("Kit recibido · Analizando los datos…");
}
function clearFrame() {
  app.frame = null;
  app.frameUntil = null;
  app.frameFrom = null;
  app.chartReferences = [];
  app.selected = null;
  app.charts?.clear();
  METRICS.forEach((m) => ($(`value-${m.key}`).textContent = "—"));
  $("readings-body").replaceChildren();
  $("calendar-list").replaceChildren();
  $("calendar-start").textContent = "—";
  $("calendar-end").textContent = "—";
  renderCalendarInfo();
  $("alert-list").replaceChildren();
  $("alert-count").textContent = "0";
  $("alert-empty").hidden = false;
  $("alert-empty").textContent = "No hay datos cargados para este minuto.";
  $("data-status").textContent = "Sin datos cargados.";
  $("phone-cue").textContent = app.sound
    ? "Sonará solo al reproducir una referencia de impacto disponible."
    : "Sonido desactivado. Se puede activar para la reproducción.";
  renderSelection();
  renderDetail();
  renderDownload();
}
function reportError(error) {
  if (app.kit?.runs.includes(app.run))
    kitMessage(
      "Kit recibido · No se pudo completar el análisis. Usa Reintentar para volver a cargarlo.",
      true,
    );
  pause();
  clearFrame();
  showBusy(false);
  $("error").hidden = false;
  $("error-message").textContent =
    error instanceof Error
      ? error.message
      : "Ocurrió un error al consultar los datos.";
  announce("No se pudieron cargar los datos. Puedes reintentar.");
}
async function initialize({
  allowDemoFallback = false,
  preferredRun = null,
} = {}) {
  pause();
  cancel();
  const revision = app.revision;
  const controller = new AbortController();
  app.controller = controller;
  app.ready = false;
  app.meta = null;
  app.companies = [];
  app.companiesRun = null;
  renderCompany();
  app.retry = "initialize";
  resetRange();
  clearFrame();
  syncControls();
  $("error").hidden = true;
  showBusy(true);
  app.mode = $("source").value;
  $("source-note").dataset.mode = app.mode;
  $("source-note").textContent =
    app.mode === "api"
      ? "Datos del servidor"
      : "Datos ficticios · No son resultados del detector.";
  $("run").replaceChildren(node("option", "Cargando…"));
  try {
    let meta;
    if (app.mode === "api") {
      const companies = await loadCompanies({ signal: controller.signal });
      const sources = await Promise.all(
        companies.map(({ tenant }) =>
          new ApiSource({ tenant }).load({ signal: controller.signal }),
        ),
      );
      meta = {
        runs: [
          ...new Set([
            ...(app.kit?.runs ?? []),
            ...sources.flatMap((source) => source.runs),
          ]),
        ],
      };
    } else {
      app.source = new DemoSource();
      meta = await app.source.load({ signal: controller.signal });
    }
    if (revision !== app.revision) return;
    app.meta = meta;
    renderRuns();
    if (!meta.runs.length) {
      $("run").replaceChildren(node("option", "Sin corridas disponibles"));
      showBusy(false);
      $("data-status").textContent =
        "El servidor no tiene corridas disponibles. Puedes subir un kit.";
      syncControls();
      return;
    }
    await selectRun(
      meta.runs.includes(preferredRun) ? preferredRun : meta.runs[0],
    );
  } catch (error) {
    if (revision !== app.revision || error?.name === "AbortError") return;
    // Only an absent API at startup may select the explicitly labeled example.
    // Server/network failures and explicit API choices always remain visible.
    if (allowDemoFallback && [404, 405].includes(error?.status)) {
      $("source").value = "demo";
      await initialize();
      return;
    }
    reportError(error);
  }
}

function resetRange() {
  app.ready = false;
  app.start = app.end = app.until = null;
  app.calendarInfo = null;
  app.manualSelection = null;
  app.sounded.clear();
  $("range-start").textContent = "—";
  $("range-end").textContent = "—";
  $("cursor").max = "0";
}

async function selectRun(run, tenant = app.tenant) {
  pause();
  cancel();
  const revision = app.revision;
  const controller = new AbortController();
  app.controller = controller;
  app.run = run;
  $("run").value = run;
  app.tenant = tenant;
  app.retry = "range";
  resetRange();
  clearFrame();
  syncControls();
  $("error").hidden = true;
  showBusy(true);
  try {
    const companies =
      app.mode === "api"
        ? await loadCompanies({ run, signal: controller.signal })
        : [{ tenant: "gracko", giro: "Despacho contable" }];
    if (revision !== app.revision || controller.signal.aborted) return;
    app.companies = companies;
    app.companiesRun = run;
    app.tenant = companies.some((company) => company.tenant === tenant)
      ? tenant
      : (companies.find((company) => company.tenant === "gracko")?.tenant ??
        companies[0]?.tenant);
    renderCompany();
    if (!app.tenant)
      throw new Error(
        "Este conjunto no tiene empresas disponibles. Elige otro o sube un kit.",
      );
    app.source =
      app.mode === "api"
        ? new ApiSource({ tenant: app.tenant })
        : new DemoSource();
    syncControls();
    const metadata = await app.source.loadRun({
      run,
      signal: controller.signal,
    });
    if (revision !== app.revision || controller.signal.aborted) return;
    app.calendarInfo = metadata.calendarInfo;
    renderCalendarInfo();
    app.start = parseTime(metadata.range.start);
    app.end = parseTime(metadata.range.end);
    app.until = app.start;
    $("cursor").max = String(Math.round((app.end - app.start) / 60000));
    $("range-start").textContent = dateTime(app.start);
    $("range-end").textContent = dateTime(app.end);
    app.ready = true;
    syncControls();
    await loadFrame();
  } catch (error) {
    if (revision === app.revision && error?.name !== "AbortError")
      reportError(error);
  }
}

async function loadFrame({ playbackFrom = null } = {}) {
  if (!app.ready) return false;
  app.retry = "frame";
  cancel();
  const revision = app.revision;
  const controller = new AbortController();
  app.controller = controller;
  const until = app.until,
    from = visibleStart(),
    previousLatest = app.frame?.alerts.at(-1)?.id ?? null;
  const keepFrame =
    app.frame && app.frameUntil !== null && until >= app.frameUntil;
  $("error").hidden = true;
  if (!keepFrame) clearFrame();
  showBusy(true);
  syncControls();
  try {
    const frame = await app.source.read({
      run: app.run,
      until: isoTime(until),
      from: isoTime(from),
      signal: controller.signal,
    });
    if (revision !== app.revision || controller.signal.aborted) return false;
    app.frame = frame;
    app.frameUntil = until;
    app.frameFrom = from;
    app.calendarInfo = frame.calendarInfo;
    renderCalendarInfo();
    if (!frame.alerts.some((alert) => alert.id === app.manualSelection))
      app.manualSelection = null;
    const latest = frame.alerts.at(-1)?.id ?? null;
    const keepAutomatic =
      playbackFrom !== null &&
      latest === previousLatest &&
      frame.alerts.some((alert) => alert.id === app.selected);
    // An impact keeps its context readable until another alert or impact arrives.
    // Read the manual choice now: it may have changed while the request waited.
    app.selected =
      app.manualSelection ?? (keepAutomatic ? app.selected : latest);
    renderFrame(from, until, playbackFrom);
    showBusy(false);
    if (!app.uploading && app.kit?.runs.includes(app.run)) renderKit();
    return true;
  } catch (error) {
    if (revision === app.revision && error?.name !== "AbortError")
      reportError(error);
    return false;
  }
}

function renderCalendarInfo() {
  const info = app.calendarInfo;
  const source = info?.source ?? null;
  const warnings = info?.warnings ?? [];
  const key = JSON.stringify([app.mode, Boolean(info), source, warnings]);
  // Calendar information is known in advance. Reannounce only when it changes,
  // not on every minute of playback or while a metric frame is loading.
  if (key === app.calendarMessageKey) return;
  app.calendarMessageKey = key;
  $("calendar-source").textContent = !info
    ? "Agenda pendiente de cargar"
    : app.mode === "demo"
      ? "Agenda ilustrativa del ejemplo"
      : source === "manual"
        ? "Agenda de respaldo"
        : source === "contexto.md"
          ? "Agenda de esta corrida"
          : "Origen de la agenda no informado";
  $("calendar-warning").hidden = source !== "manual" && warnings.length === 0;
  $("calendar-warning-summary").textContent =
    source === "manual"
      ? "Esta corrida usa una agenda de respaldo. Comprueba que sus fechas y eventos correspondan."
      : warnings.length
        ? "La agenda de esta corrida tiene advertencias."
        : "";
  $("calendar-warnings").replaceChildren(
    ...warnings.map((warning) => node("li", warning)),
  );
}

function renderFrame(from, until, playbackFrom) {
  const frame = app.frame;
  METRICS.forEach(
    (metric) =>
      ($(`value-${metric.key}`).textContent = valueText(
        frame.metrics[metric.key],
      )),
  );
  const missing = METRICS.filter(
    (metric) =>
      frame.metrics[metric.key] === null ||
      frame.metrics[metric.key] === undefined,
  ).length;
  $("data-status").textContent =
    frame.series.length === 0
      ? "No hay lecturas en esta ventana."
      : missing === 5
        ? "Sin datos en la última lectura. El hueco se conserva en las gráficas."
        : missing > 0
          ? `${missing} señales sin datos en la última lectura. Las demás conservan sus valores.`
          : `${frame.status} · Última lectura ${dateTime(frame.series.at(-1).t)}.`;
  const impacts = [
    ...new Map(
      frame.alerts
        .map((alert) => ({
          ...formatImpact({
            alert,
            alerts: frame.alerts,
            references: frame.references,
            run: app.run,
            until: isoTime(until),
          }),
          alert,
        }))
        .filter((result) => result.status === "available")
        .map((result) => [result.reference.id, result]),
    ).values(),
  ].sort(
    (a, b) =>
      parseTime(a.reference.timestamp) - parseTime(b.reference.timestamp),
  );
  const references = impacts.map((impact) => impact.reference);
  playImpactCue(impacts, until, playbackFrom);
  app.chartReferences = references;
  const rows = frame.series
    .slice(-12)
    .reverse()
    .map((row) => {
      const tr = node("tr");
      tr.append(node("th", dateTime(row.t)));
      tr.firstChild.scope = "row";
      METRICS.forEach((metric) =>
        tr.append(
          node(
            "td",
            row[metric.key] === null ? "Sin datos" : valueText(row[metric.key]),
          ),
        ),
      );
      return tr;
    });
  $("readings-body").replaceChildren(...rows);
  if (!rows.length) {
    const row = node("tr");
    const cell = node("td", "No hay lecturas en esta ventana.");
    cell.colSpan = 6;
    row.append(cell);
    $("readings-body").append(row);
  }
  const events = frame.calendar.filter(
    (event) => parseTime(event.inicio) <= until && parseTime(event.fin) >= from,
  );
  const calendarList = $("calendar-list");
  const existingEvents = new Map();
  for (const details of calendarList.querySelectorAll("details")) {
    const matches = existingEvents.get(details.dataset.event) ?? [];
    matches.push(details.closest("li"));
    existingEvents.set(details.dataset.event, matches);
  }
  const focusedEvent = document.activeElement;
  $("calendar-start").textContent = dateTime(from);
  $("calendar-end").textContent = dateTime(until);
  if (events.length) calendarList.querySelector(".calendar-empty")?.remove();
  for (const [index, event] of events.entries()) {
    const key = JSON.stringify([event.inicio, event.fin, event.evento]);
    const matches = existingEvents.get(key);
    let li = matches?.shift();
    if (matches?.length === 0) existingEvents.delete(key);
    // Preserve the actual controls, including an in-progress click or keypress.
    if (!li) {
      li = node("li");
      const details = node("details");
      details.dataset.event = key;
      const summary = node("summary");
      const label = node("span", undefined, "event-label");
      const text = node("span");
      text.append(node("strong"), node("time"));
      label.append(icon("calendar"), text);
      const track = node("span", undefined, "event-track");
      track.setAttribute("aria-hidden", "true");
      track.append(node("span", undefined, "event-bar"));
      summary.append(label, track, node("span", undefined, "event-status"));
      details.append(summary, node("p", undefined, "event-info"));
      li.append(details);
    }
    const start = parseTime(event.inicio),
      end = parseTime(event.fin);
    const active = start <= until && end > until;
    li.classList.toggle("active", active);
    li.querySelector("strong").textContent = event.evento;
    const time = li.querySelector("time");
    time.textContent = `${dateTime(event.inicio)} → ${
      event.inicio.slice(0, 10) === event.fin.slice(0, 10)
        ? event.fin.slice(11, 16)
        : dateTime(event.fin)
    }`;
    time.dateTime = event.inicio;
    const track = li.querySelector(".event-track");
    const duration = Math.max(60000, until - from);
    track.style.setProperty(
      "--event-start",
      `${Math.max(0, ((start - from) / duration) * 100)}%`,
    );
    track.style.setProperty(
      "--event-width",
      `${Math.max(0, ((Math.min(end, until) - Math.max(start, from)) / duration) * 100)}%`,
    );
    li.querySelector(".event-status").textContent = active
      ? "En curso"
      : "Programado";
    li.querySelector(".event-info").textContent =
      event.suprime === false
        ? "Actividad de contexto. Las métricas se siguen evaluando durante este horario."
        : "Horario previsto de la actividad. Su coincidencia con una alerta no descarta una falla.";
    if (calendarList.children[index] !== li)
      calendarList.insertBefore(li, calendarList.children[index] ?? null);
  }
  for (const matches of existingEvents.values())
    for (const li of matches) li.remove();
  if (
    focusedEvent?.isConnected &&
    focusedEvent.matches("#calendar-list summary") &&
    document.activeElement !== focusedEvent
  )
    focusedEvent.focus({ preventScroll: true });
  if (!events.length && !calendarList.querySelector(".calendar-empty"))
    calendarList.append(
      node(
        "li",
        "Sin actividades programadas en esta ventana.",
        "calendar-empty",
      ),
    );
  $("alert-count").textContent = String(frame.alerts.length);
  $("alert-empty").hidden = frame.alerts.length > 0;
  $("alert-empty").textContent = "Sin alertas hasta este momento.";
  renderAlerts();
  renderDetail();
  syncControls();
}

function renderAlerts() {
  const list = $("alert-list");
  const existing = new Map(
    [...list.children].map((button) => [button.dataset.alertId, button]),
  );
  const focused = document.activeElement;
  const visible = [...(app.frame?.alerts ?? [])].reverse();
  for (const [index, alert] of visible.entries()) {
    let button = existing.get(alert.id);
    existing.delete(alert.id);
    if (!button) {
      button = node("button", undefined, "alert-button");
      button.type = "button";
      button.dataset.alertId = alert.id;
      button.setAttribute("aria-controls", "detail-content");
      const top = node("span", undefined, "alert-top");
      top.append(node("time"), icon("alert", "alert-icon"));
      const meta = node("div", undefined, "alert-bottom");
      const open = node("span", "Ver detalle", "alert-open");
      open.append(icon("arrow"));
      meta.append(node("span", "", "alert-selected"), open);
      button.append(
        top,
        node("strong"),
        node("span", undefined, "alert-summary"),
        meta,
      );
      button.addEventListener("click", () => {
        const selected = app.frame?.alerts.find(
          (item) => item.id === button.dataset.alertId,
        );
        if (!selected) return;
        app.manualSelection = app.selected = selected.id;
        renderSelection();
        renderDetail();
        announce(
          `Seleccionada alerta de ${typeNames[selected.tipo] ?? selected.tipo}.`,
        );
        $("alert-detail").scrollIntoView({
          behavior: "instant",
          block: "nearest",
        });
      });
    }
    button.querySelector("time").textContent = dateTime(alert.timestamp);
    button.querySelector("strong").textContent =
      typeNames[alert.tipo] ?? alert.tipo;
    button.querySelector(".alert-summary").textContent =
      formatAlertSummary(alert);
    if (list.children[index] !== button)
      list.insertBefore(button, list.children[index] ?? null);
  }
  for (const button of existing.values()) button.remove();
  if (
    focused?.isConnected &&
    focused.matches(".alert-button") &&
    document.activeElement !== focused
  )
    focused.focus({ preventScroll: true });
  renderSelection();
}

function renderSelection() {
  for (const button of $("alert-list").children) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.alertId === app.selected),
    );
    button.querySelector(".alert-selected").textContent =
      button.dataset.alertId === app.selected ? "Seleccionada" : "";
  }
  const latest = app.frame?.alerts.at(-1)?.id;
  const followingLatest = !app.manualSelection && app.selected === latest;
  $("follow-alerts").disabled = !latest || followingLatest;
  $("follow-alerts").textContent = followingLatest
    ? "Siguiendo la última alerta"
    : "Seguir la última alerta";
  const selected = app.frame?.alerts.find((alert) => alert.id === app.selected);
  $("selection-status").hidden = !selected;
  $("selection-status").textContent = selected
    ? `Revisando alerta del ${dateTime(selected.timestamp)}`
    : "";
}
function effectiveConfidence(alert) {
  return alert.actualizaciones?.at(-1)?.confianza ?? alert.confianza;
}
function confidence(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "no disponible";
}
function renderDetail() {
  const alert = app.frame?.alerts.find((a) => a.id === app.selected);
  const metric = alert?.familias
    ?.map((family) => METRICS.find((item) => family.senal === item.key))
    .find(Boolean);
  const impact = alert
    ? formatImpact({
        alert,
        alerts: app.frame.alerts,
        references: app.frame.references,
        run: app.run,
        until: isoTime(app.frameUntil),
      })
    : null;
  focusMetric(alert, metric);
  if (app.frame)
    app.charts?.update(
      app.frame,
      app.frameFrom,
      app.frameUntil,
      app.chartReferences,
      metric
        ? {
            signal: metric.key,
            alert,
            phones: impact.status === "available" ? [impact.reference] : [],
          }
        : null,
    );
  $("detail-content").hidden = !alert;
  $("detail-empty").hidden = Boolean(alert);
  $("phone-content").hidden = true;
  $("phone-preview").hidden = true;
  $("phone-preview").textContent = "";
  if (!alert) {
    $("detail-title").textContent = "Selecciona una alerta";
    $("phone-note").textContent =
      "Cuando exista una alerta y una referencia disponible, podrás comparar sus horas.";
    return;
  }
  $("detail-title").textContent = typeNames[alert.tipo] ?? alert.tipo;
  $("detail-meta").textContent =
    `${app.tenant} · Alerta emitida el ${dateTime(alert.timestamp)}${app.mode === "demo" ? " · Ejemplo ficticio" : ""}`;
  $("detail-summary").textContent = formatAlertSummary(alert);
  $("detail-original").textContent = alert.resumen;
  $("detail-confidence").textContent = confidence(effectiveConfidence(alert));
  $("detail-action").replaceChildren(
    ...actionSteps(
      alert.accion_sugerida ||
        "El servidor no proporcionó una acción sugerida.",
    ).map((step) => node("li", step)),
  );
  const evidence = (alert.familias ?? []).map((item) =>
    node("li", formatEvidence(item)),
  );
  $("detail-evidence").replaceChildren(
    ...(evidence.length
      ? evidence
      : [
          node(
            "li",
            "La fuente no proporcionó valores de evidencia estructurados.",
          ),
        ]),
  );
  const records = [
    ...(alert.logs ?? []).map(
      (log) =>
        `${dateTime(log.timestamp)} · ${log.mensaje ?? "Registro sin descripción"}`,
    ),
    ...(alert.actualizaciones ?? []).map(
      (update) =>
        `${dateTime(update.timestamp)} · Puntaje ${confidence(update.confianza)} · ${update.motivo ?? "Actualización"}`,
    ),
  ];
  $("detail-logs").replaceChildren(
    ...(records.length
      ? records.map((text) => node("li", text))
      : [
          node(
            "li",
            "No hay registros adicionales disponibles hasta este minuto.",
          ),
        ]),
  );
  if (impact.status !== "available") {
    $("phone-note").textContent =
      impact.status === "ambiguous"
        ? "Sin referencia de impacto inequívoca: hay varias referencias para este aviso. No se calcula anticipación."
        : app.frame.referenceStatus === "unavailable"
          ? "Sin referencia de impacto disponible: no se pudo consultar su fuente. Las lecturas y alertas siguen disponibles."
          : app.kit?.runs.includes(app.run)
            ? "Sin referencia de impacto para este kit. No se calcula anticipación."
            : app.tenant !== "gracko"
              ? "Sin hipótesis de impacto para esta empresa."
              : "Aún no hay un impacto observado hasta este minuto. No se calcula anticipación.";
    return;
  }
  const { reference, minutes } = impact;
  $("phone-note").textContent =
    app.mode === "demo"
      ? "Comparación ficticia para probar la interfaz. No es un resultado oficial ni medido."
      : "Comparación con una hipótesis de impacto del equipo. No representa una llamada real ni una medición oficial.";
  $("phone-content").hidden = false;
  $("phone-alert").textContent = dateTime(alert.timestamp);
  $("phone-impact").textContent = dateTime(reference.timestamp);
  $("phone-gain").textContent =
    minutes > 0 ? `${number.format(minutes)} min` : "Sin anticipación";
  $("phone-gain-label").textContent =
    minutes > 0
      ? "antes del impacto estimado"
      : minutes === 0
        ? "aviso e impacto estimado coinciden"
        : `aviso ${number.format(-minutes)} min después del impacto estimado`;
  $("phone-preview").textContent =
    `${$("phone-gain").textContent} · ${$("phone-gain-label").textContent} · ${app.mode === "demo" ? "ejemplo ficticio" : "hipótesis del equipo"}`;
  $("phone-preview").hidden = false;
  $("phone-source").textContent =
    `${reference.fuente} · ${reference.descripcion}`;
}

// Reuse an existing chart only when the alert explicitly identifies its signal.
// The chart keeps the current visible window; it is not the alert's evidence snapshot.
function focusMetric(alert, metric) {
  const focus = $("focus-metric");
  const grid = $("metric-grid");
  const current = focus.querySelector(".metric-card");
  const target = metric
    ? $(`chart-${metric.key}`).closest(".metric-card")
    : null;
  if (current !== target) {
    if (current) {
      grid.append(current);
      METRICS.forEach((item) => {
        const card = $(`chart-${item.key}`).closest(".metric-card");
        if (card.parentElement === grid) grid.append(card);
      });
    }
    focus.replaceChildren();
    focus.hidden = !target;
    if (target) {
      const context = node("div", undefined, "reading-context");
      const emitted = node("div");
      emitted.className = "alert-average";
      const values = node("div", undefined, "alert-average-values");
      values.append(
        node("strong", undefined, "alert-reading"),
        node("span", undefined, "small alert-normal"),
      );
      emitted.append(
        node("span", undefined, "small alert-average-label"),
        values,
        node("span", undefined, "small alert-reading-time"),
      );
      context.append(emitted, node("p", undefined, "small alert-point"));
      focus.append(context, node("p", undefined, "focus-note"), target);
      const legend = $("metrics-section")
        .querySelector(".chart-legend")
        .cloneNode(true);
      legend.querySelector(".legend-line").parentElement.lastChild.textContent =
        "Esta alerta";
      legend.querySelector(
        ".legend-line.phone",
      ).parentElement.lastChild.textContent = "Su impacto estimado · demo";
      focus.append(legend);
    }
    requestAnimationFrame(() =>
      app.charts?.charts.forEach((chart) => chart.resize()),
    );
  }
  if (!target) return;
  const observation = alertObservation(alert, metric.key);
  const average = alertAverage(alert, metric.key);
  focus.querySelector(".alert-average").hidden = !average;
  focus.querySelector(".alert-reading").textContent = average
    ? `${valueText(average.value)} ${average.unit}`
    : "";
  focus.querySelector(".alert-normal").textContent =
    average && average.normal !== null
      ? `Habitual: ${valueText(average.normal)} ${average.unit}`
      : "";
  focus.querySelector(".alert-average-label").textContent = average
    ? `Promedio de ${valueText(average.windowMinutes)} min ${average.timestamp === alert.timestamp ? "al emitirse" : "de la alerta"}`
    : "";
  focus.querySelector(".alert-reading-time").textContent = average
    ? average.timestamp
      ? `Hasta el ${dateTime(average.timestamp)}`
      : "Hora del promedio no proporcionada."
    : "";
  focus.querySelector(".alert-point").textContent = observation
    ? `Lectura del minuto de emisión: ${valueText(observation.value)} ${observation.unit} · ${dateTime(alert.timestamp)}`
    : `Lectura puntual al emitir: no disponible · ${dateTime(alert.timestamp)}`;
  const last = app.frame?.series.at(-1);
  focus.querySelector(".focus-note").textContent = last
    ? `Gráfica hasta la hora reproducida · Última lectura: ${dateTime(last.t)}`
    : "Sin lecturas en el periodo de la gráfica.";
}

// Sound requires a direct opt-in and forward playback across an observed reference.
// Seeking, loading and merely selecting an alert never make the phone ring.
function playImpactCue(impacts, until, playbackFrom) {
  if (!app.playing || playbackFrom === null || until <= playbackFrom) return;
  for (const { reference, alert } of impacts) {
    const impactTime = parseTime(reference.timestamp);
    if (
      impactTime <= playbackFrom ||
      impactTime > until ||
      app.sounded.has(reference.id)
    )
      continue;
    app.sounded.set(reference.id, impactTime);
    if (!app.manualSelection) app.selected = alert.id;
    $("phone-cue").textContent =
      `La reproducción alcanzó una referencia de impacto estimado de ${typeNames[alert.tipo] ?? alert.tipo}.`;
    if (!app.sound || app.audio?.state !== "running") continue;
    const now = app.audio.currentTime;
    for (const offset of [0, 0.22]) {
      const oscillator = app.audio.createOscillator();
      const gain = app.audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.055, now + offset + 0.015);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.16);
      oscillator.connect(gain);
      gain.connect(app.audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.18);
    }
  }
}

$("phone-sound").addEventListener("click", async () => {
  const button = $("phone-sound");
  button.disabled = true;
  try {
    if (app.sound) {
      app.sound = false;
      await app.audio?.suspend();
    } else {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Audio no disponible");
      app.audio ??= new AudioContext();
      await app.audio.resume();
      app.sound = app.audio.state === "running";
    }
    button.setAttribute("aria-pressed", String(app.sound));
    button.textContent = app.sound
      ? "Desactivar sonido"
      : "Activar sonido de demostración";
    $("phone-cue").textContent = app.sound
      ? "Sonará solo al reproducir una referencia de impacto disponible."
      : "Sonido desactivado. La comparación sigue visible.";
  } catch {
    app.sound = false;
    button.setAttribute("aria-pressed", "false");
    button.textContent = "Activar sonido de demostración";
    $("phone-cue").textContent =
      "El navegador no permitió el sonido. La comparación sigue visible.";
  } finally {
    button.disabled = false;
  }
});

function schedule() {
  clearTimeout(app.timer);
  if (!app.playing || !app.ready) return;
  app.timer = setTimeout(async () => {
    if (!app.playing) return;
    const playbackFrom = app.until;
    app.until = Math.min(app.end, app.until + Number($("speed").value) * 60000);
    const success = await loadFrame({ playbackFrom });
    if (!app.playing || !success) return;
    if (app.ready && app.until >= app.end) {
      pause();
      announce("Terminó la reproducción de la corrida.");
    } else schedule();
  }, 1000);
}
function seek(until) {
  pause();
  moveClock(until);
  void loadFrame();
}

function moveClock(until) {
  const next = Math.max(app.start, Math.min(app.end, until));
  if (next < app.until) {
    for (const [id, timestamp] of app.sounded)
      if (timestamp > next) app.sounded.delete(id);
  }
  app.until = next;
}

function kitMessage(text, error = false) {
  $("kit-feedback").hidden = false;
  $("kit-status").textContent = text;
  $("kit-feedback").dataset.error = String(error);
}

function renderKit() {
  const kit = app.kit;
  if (!kit) return;
  const loaded = app.mode === "api" && app.frame && kit.runs.includes(app.run);
  kitMessage(
    loaded
      ? `Kit listo · ${kit.companies.length} ${kit.companies.length === 1 ? "empresa" : "empresas"} · ${kit.runs.length} ${kit.runs.length === 1 ? "conjunto" : "conjuntos"}`
      : "Kit recibido · Analizando los datos…",
  );
  const url = new URL(window.location.href);
  url.searchParams.set("fuente", "api");
  url.hash = `kit=${kit.id}`;
  $("kit-link").href = url.href;
  $("kit-link").hidden = false;
  $("kit-link").title = "Conserva este enlace para volver a abrir el kit";
  const warnings = [...kit.warnings];
  if (kit.ignored)
    warnings.push(`${kit.ignored} archivos omitidos durante la importación.`);
  $("kit-warnings").hidden = !warnings.length;
  $("kit-warnings-label").textContent =
    `Observaciones del kit (${warnings.length})`;
  $("kit-warnings-list").replaceChildren(
    ...warnings.map((warning) => node("li", warning)),
  );
}

function rememberKitKey(key) {
  app.kitKey = key;
  try {
    sessionStorage.setItem("zikit-kit-key", key);
  } catch {
    /* Memory suffices when storage is unavailable. */
  }
}

function readLink() {
  const link = readKitLink(window.location.hash);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.has("clave")) {
    if (link.key) rememberKitKey(link.key);
    hash.delete("clave");
    const url = new URL(window.location.href);
    url.hash = hash.toString();
    history.replaceState(null, "", url);
  }
  return link;
}

async function recoverKit(id) {
  app.kitController?.abort();
  const controller = new AbortController();
  app.kitController = controller;
  app.pendingKit = id;
  $("kit-retry").hidden = true;
  kitMessage("Abriendo el kit…");
  try {
    const kit = await loadKit({
      id,
      timeoutMs: 10000,
      signal: controller.signal,
    });
    if (app.pendingKit !== id || controller.signal.aborted) return;
    app.kit = kit;
    renderKit();
    $("source").value = "api";
    await initialize({ preferredRun: kit.runs[0] });
    app.pendingKit = null;
  } catch (error) {
    if (app.pendingKit !== id || controller.signal.aborted) return;
    kitMessage(error.message, true);
    $("kit-retry").hidden = false;
  }
}

$("kit-toggle").addEventListener("click", () => {
  const open = $("kit-panel").hidden;
  $("kit-panel").hidden = !open;
  $("kit-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("kit-file").focus();
});
$("kit-retry").addEventListener("click", () => {
  if (app.pendingKit) void recoverKit(app.pendingKit);
});
$("kit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (app.uploading) return;
  const file = $("kit-file").files[0];
  if (!file) return;
  pause();
  app.pendingKit = null;
  app.kitController?.abort();
  app.uploading = true;
  app.uploadController = new AbortController();
  $("kit-submit").disabled = true;
  $("kit-file").disabled = true;
  $("kit-submit").textContent = "Procesando…";
  $("kit-retry").hidden = true;
  $("kit-link").hidden = true;
  $("kit-warnings").hidden = true;
  kitMessage("Subiendo y revisando el kit. Puede tardar unos minutos…");
  const key = $("kit-key").value.trim() || app.kitKey;
  let openedKit = false;
  try {
    const kit = await uploadKit({
      file,
      key,
      signal: app.uploadController.signal,
      timeoutMs: 180000,
    });
    if (key) rememberKitKey(key);
    app.kit = kit;
    renderKit();
    const url = new URL(window.location.href);
    url.searchParams.set("fuente", "api");
    url.hash = `kit=${kit.id}`;
    history.replaceState(null, "", url);
    $("source").value = "api";
    $("kit-form").reset();
    $("kit-panel").hidden = true;
    $("kit-toggle").setAttribute("aria-expanded", "false");
    await initialize({ preferredRun: kit.runs[0] });
    openedKit = true;
    $("company").focus();
  } catch (error) {
    if (error.name === "AbortError") return;
    kitMessage(error.message, true);
    if (error.status === 401) {
      $("kit-key-field").hidden = false;
      $("kit-key").focus();
    }
  } finally {
    app.uploading = false;
    if (openedKit && app.frame && app.kit?.runs.includes(app.run)) renderKit();
    app.uploadController = null;
    $("kit-submit").disabled = false;
    $("kit-file").disabled = false;
    $("kit-submit").textContent = "Abrir kit";
  }
});

$("source").addEventListener("change", () => {
  if (app.pendingKit) {
    app.pendingKit = null;
    app.kitController?.abort();
    kitMessage("Apertura del kit cancelada.");
    $("kit-retry").hidden = true;
  }
  void initialize();
});
$("company").addEventListener(
  "change",
  () => void selectRun(app.run, $("company").value),
);
$("run").addEventListener("change", () => {
  const run = $("run").value;
  void selectRun(run);
});
$("play").addEventListener("click", () => {
  if (app.playing) {
    pause();
    cancel();
    showBusy(false);
    if (app.frameUntil !== null) {
      app.until = app.frameUntil;
      syncControls();
    } else {
      void loadFrame();
    }
    return;
  }
  if (app.ready && app.until >= app.end) {
    app.until = app.start;
    app.sounded.clear();
    void loadFrame().then((ok) => {
      if (ok) {
        app.playing = true;
        syncControls();
        schedule();
      }
    });
    return;
  }
  app.playing = true;
  syncControls();
  schedule();
});
$("restart").addEventListener("click", () => seek(app.start));
$("cursor").addEventListener("input", () => {
  const minute = Number($("cursor").value);
  pause();
  cancel();
  showBusy(false);
  moveClock(app.start + minute * 60000);
  clearFrame();
  syncControls();
});
$("cursor").addEventListener("change", () => void loadFrame());
$("window").addEventListener("change", () => {
  if (app.ready) {
    pause();
    void loadFrame();
  }
});
$("speed").addEventListener("change", () => {
  if (app.playing) schedule();
});
$("follow-alerts").addEventListener("click", () => {
  app.manualSelection = null;
  app.selected = app.frame?.alerts.at(-1)?.id ?? null;
  renderSelection();
  renderDetail();
  announce(
    "El detalle seguirá las nuevas alertas y sus referencias de impacto.",
  );
});
$("retry").addEventListener("click", () =>
  app.retry === "frame"
    ? void loadFrame()
    : app.retry === "range"
      ? void selectRun(app.run)
      : void initialize(),
);
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.getElementById(link.getAttribute("href").slice(1));
    if (!target) return;
    if (target.id === "metrics-section") target.open = true;
    // Section navigation must retain the secret kit link for reload/share.
    if (app.kit || readKitLink(window.location.hash).kit) {
      event.preventDefault();
      target.scrollIntoView();
      target.focus({ preventScroll: true });
    }
  });
});
$("metrics-section").addEventListener("toggle", () => {
  if ($("metrics-section").open)
    app.charts?.charts.forEach((chart) => chart.resize());
});
window.addEventListener("pagehide", () => {
  pause();
  cancel();
  app.uploadController?.abort();
  app.kitController?.abort();
  void app.audio?.close();
});
try {
  app.charts = new MetricCharts();
  const requestedSource = new URLSearchParams(window.location.search).get(
    "fuente",
  );
  const explicitSource =
    requestedSource === "api" || requestedSource === "demo";
  $("source").value = explicitSource ? requestedSource : "api";
  try {
    app.kitKey = sessionStorage.getItem("zikit-kit-key") || "";
  } catch {
    /* Storage is optional. */
  }
  const link = readLink();
  if (link.kit) {
    // Keep a useful official view available if a shared kit expired.
    $("source").value = "api";
    void recoverKit(link.kit).then(() => {
      if (app.pendingKit === link.kit && !app.meta) void initialize();
    });
  } else {
    void initialize({ allowDemoFallback: !explicitSource });
  }
} catch (error) {
  reportError(error);
}
