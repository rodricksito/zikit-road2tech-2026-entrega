import test from "node:test";
import assert from "node:assert/strict";
import { MetricCharts, METRICS } from "../web/charts.mjs";
import { parseTime } from "../web/data.mjs";

const at = (hour) => `2026-10-10T${hour}:00:00`;
const selected = { id: "disk-1", timestamp: at("10") };
const unrelated = { id: "response-1", timestamp: at("12") };
const future = { id: "future", timestamp: at("15") };
const selectedImpact = { id: "disk-impact", timestamp: at("11") };
const otherImpact = { id: "response-impact", timestamp: at("13") };
const futureImpact = { id: "future-impact", timestamp: at("16") };
const frame = {
  calendar: [],
  apagones: [],
  alerts: [selected, unrelated, future],
  series: [
    { t: at("14"), cpu: 30, ram: 40, disco: 76.6, latencia_ms: 40, errores: 0 },
  ],
  metrics: { cpu: 30, ram: 40, disco: 76.6, latencia_ms: 40, errores: 0 },
};

function chartsWithoutCanvas() {
  // Exercise the real update logic without depending on Chart.js rendering.
  const charts = Object.create(MetricCharts.prototype);
  charts.charts = METRICS.map(() => ({
    options: { scales: { x: {} } },
    data: { datasets: [{ data: [] }] },
    canvas: { setAttribute() {} },
    update() {},
  }));
  return charts;
}

test("focused chart isolates the selected alert and impact while other charts keep the replay markers", () => {
  const charts = chartsWithoutCanvas();
  charts.update(
    frame,
    parseTime(at("09")),
    parseTime(at("14")),
    [selectedImpact, otherImpact, futureImpact],
    {
      signal: "disco",
      alert: selected,
      phones: [selectedImpact, futureImpact],
    },
  );
  const disk = charts.charts[2];
  assert.deepEqual(disk.$zikit.alerts, [selected]);
  assert.deepEqual(disk.$zikit.phones, [selectedImpact]);
  assert.deepEqual(charts.charts[0].$zikit.alerts, [selected, unrelated]);
  assert.deepEqual(charts.charts[0].$zikit.phones, [
    selectedImpact,
    otherImpact,
  ]);
  assert.deepEqual(disk.data.datasets[0].data, [
    { x: parseTime(at("14")), y: 76.6 },
  ]);
});

test("an older selected alert keeps only its in-window impact and cannot leak another alert's marker", () => {
  const charts = chartsWithoutCanvas();
  charts.update(
    frame,
    parseTime(at("11")),
    parseTime(at("14")),
    [selectedImpact, otherImpact],
    {
      signal: "disco",
      alert: selected,
      phones: [selectedImpact],
    },
  );
  assert.deepEqual(charts.charts[2].$zikit.alerts, []);
  assert.deepEqual(charts.charts[2].$zikit.phones, [selectedImpact]);
});

test("rewinding before the selected alert removes both its marker and impact", () => {
  const charts = chartsWithoutCanvas();
  charts.update(frame, parseTime(at("08")), parseTime(at("09")), [], {
    signal: "disco",
    alert: selected,
    phones: [selectedImpact],
  });
  assert.deepEqual(charts.charts[2].$zikit.alerts, []);
  assert.deepEqual(charts.charts[2].$zikit.phones, []);
});

test("changing the focused signal restores general markers to the previous detail chart", () => {
  const charts = chartsWithoutCanvas();
  const args = [
    frame,
    parseTime(at("09")),
    parseTime(at("14")),
    [selectedImpact, otherImpact],
  ];
  charts.update(...args, {
    signal: "disco",
    alert: selected,
    phones: [selectedImpact],
  });
  charts.update(...args, {
    signal: "latencia_ms",
    alert: unrelated,
    phones: [otherImpact],
  });
  assert.deepEqual(charts.charts[2].$zikit.alerts, [selected, unrelated]);
  assert.deepEqual(charts.charts[2].$zikit.phones, [
    selectedImpact,
    otherImpact,
  ]);
  assert.deepEqual(charts.charts[3].$zikit.alerts, [unrelated]);
  assert.deepEqual(charts.charts[3].$zikit.phones, [otherImpact]);
});
