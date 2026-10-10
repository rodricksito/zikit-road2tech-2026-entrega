import { parseTime, isoTime } from "./data.mjs?v=claridad-r31-20261010";

export const METRICS = [
  { key: "cpu", label: "CPU", unit: "%", percent: true },
  { key: "ram", label: "RAM", unit: "%", percent: true },
  { key: "disco", label: "Disco", unit: "%", percent: true },
  { key: "latencia_ms", label: "Tiempo de respuesta", unit: "ms" },
  { key: "errores", label: "Errores", unit: "errores/min" },
];

function stamp(value) {
  const text = isoTime(value);
  return `${text.slice(8, 10)}/${text.slice(5, 7)} ${text.slice(11, 16)}`;
}

function createContextPlugin(theme) {
  return {
    id: "zikitContext",
    beforeDatasetsDraw(chart) {
      const context = chart.$zikit;
      if (!context) return;
      const {
        ctx,
        chartArea,
        scales: { x },
      } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        chartArea.left,
        chartArea.top,
        chartArea.width,
        chartArea.height,
      );
      ctx.clip();
      for (const [intervals, color] of [
        [context.calendar, theme.expected],
        [context.apagones, theme.gap],
      ]) {
        for (const interval of intervals) {
          const start = Math.max(parseTime(interval.inicio), context.from);
          const end = Math.min(parseTime(interval.fin), context.until);
          if (end <= start) continue;
          ctx.fillStyle = color;
          ctx.fillRect(
            x.getPixelForValue(start),
            chartArea.top,
            x.getPixelForValue(end) - x.getPixelForValue(start),
            chartArea.height,
          );
        }
      }
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const context = chart.$zikit;
      if (!context) return;
      const {
        ctx,
        chartArea,
        scales: { x },
      } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        chartArea.left,
        chartArea.top,
        chartArea.width,
        chartArea.height,
      );
      ctx.clip();
      const marks = [
        ...context.alerts.map((a) => ({
          t: a.timestamp,
          color: theme.alert,
          dash: [6, 3],
        })),
        ...context.phones.map((p) => ({
          t: p.timestamp,
          color: theme.impact,
          dash: [2, 3],
        })),
      ];
      for (const mark of marks) {
        const t = parseTime(mark.t);
        if (t < context.from || t > context.until) continue;
        const pixel = x.getPixelForValue(t);
        ctx.strokeStyle = mark.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(mark.dash);
        ctx.beginPath();
        ctx.moveTo(pixel, chartArea.top);
        ctx.lineTo(pixel, chartArea.bottom);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

export class MetricCharts {
  constructor() {
    if (typeof globalThis.Chart !== "function")
      throw new Error(
        "No se pudo cargar la biblioteca local de gráficas. Recarga la página.",
      );
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) =>
      styles.getPropertyValue(name).trim() || fallback;
    const theme = {
      line: token("--signal-line", "#087367"),
      expected: token("--signal-expected", "#e6f3ef"),
      gap: token("--signal-gap", "#dce1e5"),
      alert: token("--signal-alert", "#985915"),
      impact: token("--signal-impact", "#ab3f37"),
      grid: token("--chart-grid", "#e3ebe8"),
      muted: token("--muted", "#536974"),
    };
    const font = { family: styles.fontFamily, size: 12 };
    const contextPlugin = createContextPlugin(theme);
    this.charts = METRICS.map(
      (metric) =>
        new globalThis.Chart(document.getElementById(`chart-${metric.key}`), {
          type: "line",
          data: {
            datasets: [
              {
                label: `${metric.label} (${metric.unit})`,
                data: [],
                borderColor: theme.line,
                backgroundColor: theme.line,
                borderWidth: 1.8,
                pointRadius: 0,
                pointHitRadius: 14,
                tension: 0,
                spanGaps: false,
              },
            ],
          },
          plugins: [contextPlugin],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            normalized: true,
            interaction: { mode: "nearest", axis: "x", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                titleFont: font,
                bodyFont: font,
                callbacks: {
                  title: (items) =>
                    items.length ? stamp(items[0].parsed.x) : "",
                  label: (item) =>
                    `${metric.label}: ${item.parsed.y ?? "Sin datos"} ${metric.unit}`,
                },
              },
            },
            scales: {
              x: {
                type: "linear",
                grid: { display: false },
                border: { display: false },
                ticks: {
                  maxTicksLimit: 3,
                  maxRotation: 0,
                  color: theme.muted,
                  font,
                  callback: (value) => stamp(value),
                },
              },
              y: {
                beginAtZero: true,
                ...(metric.percent ? { max: 100 } : {}),
                grid: { color: theme.grid },
                border: { display: false },
                ticks: {
                  maxTicksLimit: 3,
                  color: theme.muted,
                  font,
                  precision: metric.key === "errores" ? 0 : undefined,
                },
              },
            },
          },
        }),
    );
  }
  update(frame, from, until, phones = [], focus = null) {
    const inWindow = (item) => {
      const time = parseTime(item.timestamp);
      return time >= from && time <= until;
    };
    // The detail keeps the replay's series, but its markers belong to the
    // selected alert. The caller supplies only its validated impact reference.
    const selected = focus?.alert
      ? frame.alerts.find(
          (alert) =>
            alert.id === focus.alert.id && parseTime(alert.timestamp) <= until,
        )
      : null;
    this.charts.forEach((chart, i) => {
      const metric = METRICS[i];
      const focused = metric.key === focus?.signal;
      const alerts = focused ? (selected ? [selected] : []) : frame.alerts;
      const impactReferences = focused
        ? selected
          ? (focus.phones ?? [])
          : []
        : phones;
      chart.$zikit = {
        from,
        until,
        calendar: frame.calendar,
        apagones: frame.apagones,
        alerts: alerts.filter(inWindow),
        phones: impactReferences.filter(inWindow),
      };
      chart.options.scales.x.min = Math.min(from, until - 60000);
      chart.options.scales.x.max = until;
      chart.data.datasets[0].data = frame.series.map((row) => ({
        x: parseTime(row.t),
        y: row[metric.key],
      }));
      chart.update("none");
      const last = frame.metrics[metric.key];
      chart.canvas.setAttribute(
        "aria-label",
        `${metric.label} (${metric.unit}), hasta ${stamp(until)}. Última lectura: ${last === null || last === undefined ? "sin datos" : last + " " + metric.unit}. Hay una tabla de lecturas debajo de las gráficas.`,
      );
    });
  }
  clear() {
    this.charts.forEach((chart, i) => {
      chart.$zikit = null;
      chart.data.datasets[0].data = [];
      chart.canvas.setAttribute(
        "aria-label",
        `${METRICS[i].label} (${METRICS[i].unit}). Sin datos cargados. Hay una tabla de lecturas debajo de las gráficas.`,
      );
      chart.update("none");
    });
  }
}
