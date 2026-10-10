import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  KIT_MAX_BYTES,
  deliveryUrl,
  kitRunLabel,
  kitSummary,
  loadCompanies,
  loadKit,
  readKitLink,
  runLabel,
  uploadKit,
} from "../web/data.mjs";

const ID = "0123456789abcdef0123456789abcdef";
const payload = (extra = {}) => ({
  id: ID,
  creado: "2026-10-10T09:00:00",
  corridas: [`kit-${ID}`, `kit-${ID}-corrida_01`, `kit-${ID}-corrida_02`],
  empresas: ["gracko", "kaiku"],
  empresas_por_corrida: {
    [`kit-${ID}`]: ["gracko", "kaiku"],
    [`kit-${ID}-corrida_01`]: ["kaiku"],
    [`kit-${ID}-corrida_02`]: ["gracko"],
  },
  avisos: ["Sin contexto.md, se usa el calendario manual de respaldo"],
  ignorados: 2,
  ...extra,
});
const zip = (size = 3, name = "kit.zip") =>
  new File([new Uint8Array(size)], name, { type: "application/zip" });
function fakeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: { "Content-Type": "application/json" } },
    );
  };
  return { calls, fetchImpl };
}

test("the link keeps a valid kit id and the upload key", () => {
  assert.deepEqual(readKitLink(`#kit=${ID}&clave=abc-123`), {
    kit: ID,
    key: "abc-123",
  });
  assert.deepEqual(readKitLink("#kit=../../etc&clave=%20"), {
    kit: null,
    key: null,
  });
  assert.deepEqual(readKitLink(""), { kit: null, key: null });
});

test("a kit summary preserves all companies per run, including runs without gracko", () => {
  const kit = kitSummary(payload());
  assert.equal(kit.id, ID);
  assert.deepEqual(kit.runs, payload().corridas);
  assert.deepEqual(kit.companiesByRun, payload().empresas_por_corrida);
  assert.deepEqual(kit.companies, ["gracko", "kaiku"]);
  assert.equal(kit.ignored, 2);
  assert.equal(kit.warnings.length, 1);
  assert.equal(kitRunLabel(`kit-${ID}`, ID), "Su kit · Conjunto principal");
  assert.equal(kitRunLabel(`kit-${ID}-corrida_02`, ID), "Su kit · Conjunto 02");
  assert.equal(kitRunLabel("raiz", ID), "Conjunto principal");
  assert.equal(kitRunLabel("corrida_02", ID), "Conjunto 02");
  assert.equal(kitRunLabel("corrida_02", "id-invalido"), "Conjunto 02");
  const differentKitRun = `kit-${"f".repeat(32)}-corrida_02`;
  assert.equal(kitRunLabel(differentKitRun, ID), differentKitRun);
  assert.equal(runLabel("raiz"), "Conjunto principal");
  assert.equal(runLabel("corrida_01"), "Conjunto 01");
  assert.equal(runLabel("corrida_nueva"), "Conjunto nueva");
  assert.equal(runLabel("otro_conjunto"), "otro_conjunto");
  const own = kitSummary(
    payload({
      corridas: [`kit-${ID}`],
      empresas: ["empresa_nueva"],
      empresas_por_corrida: { [`kit-${ID}`]: ["empresa_nueva"] },
    }),
  );
  assert.deepEqual(own.companiesByRun[own.runs[0]], ["empresa_nueva"]);
});

test("a kit summary rejects ids and runs that do not belong together", () => {
  for (const bad of [
    payload({ id: "corto" }),
    payload({ corridas: [] }),
    payload({ corridas: ["corrida_01"] }),
    payload({ corridas: [`kit-${ID}`, `kit-${ID}`] }),
    payload({ empresas_por_corrida: undefined }),
    payload({ empresas_por_corrida: { [`kit-${ID}`]: "gracko" } }),
    payload({
      empresas_por_corrida: {
        ...payload().empresas_por_corrida,
        [`kit-${ID}`]: [],
      },
    }),
    payload({
      empresas_por_corrida: {
        ...payload().empresas_por_corrida,
        [`kit-${ID}`]: ["gracko", "gracko"],
      },
    }),
    payload({
      empresas_por_corrida: {
        ...payload().empresas_por_corrida,
        [`kit-${ID}`]: ["otra"],
      },
    }),
    payload({ empresas: ["gracko"] }),
    payload({ empresas: ["gracko", "kaiku", "kaiku"] }),
    payload({ empresas: ["../gracko"] }),
    payload({ ignorados: -1 }),
    payload({ ignorados: "2" }),
    payload({ corridas: [`kit-${ID}-corrida_../../otra`] }),
  ])
    assert.throws(() => kitSummary(bad), /Datos no válidos/);
});

test("uploading sends one zip in «archivo» with the key header", async () => {
  const { calls, fetchImpl } = fakeFetch(200, payload());
  const kit = await uploadKit({ file: zip(), key: "secreta", fetchImpl });
  assert.equal(kit.id, ID);
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(url, "/api/kit");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["X-Zikit-Clave"], "secreta");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["Content-Type"], undefined);
  assert.ok(options.body instanceof FormData);
  assert.deepEqual([...options.body.keys()], ["archivo"]);
  assert.equal(options.body.get("archivo").name, "kit.zip");

  const open = fakeFetch(200, payload());
  await uploadKit({ file: zip(), fetchImpl: open.fetchImpl });
  assert.equal(open.calls[0].options.headers["X-Zikit-Clave"], undefined);
});

test("uploading shows the server explanation and keeps its status", async () => {
  for (const [status, detail] of [
    [401, "Falta la clave de subida o no es correcta."],
    [413, "El zip pasa de 80 MB."],
    [422, "No se pudo analizar ninguna empresa del zip: gracko"],
  ]) {
    const { fetchImpl } = fakeFetch(status, { detail });
    await assert.rejects(uploadKit({ file: zip(), fetchImpl }), (error) => {
      assert.equal(error.message, detail);
      assert.equal(error.status, status);
      return true;
    });
  }
  const { fetchImpl } = fakeFetch(502, "<html>Bad gateway</html>");
  await assert.rejects(
    uploadKit({ file: zip(), fetchImpl }),
    /No se pudo subir el kit \(HTTP 502\)/,
  );
  await assert.rejects(
    uploadKit({
      file: zip(),
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    /el servidor no responde/,
  );
});

test("uploading checks the file before sending anything", async () => {
  const { calls, fetchImpl } = fakeFetch(200, payload());
  await assert.rejects(uploadKit({ fetchImpl }), /Elige primero/);
  await assert.rejects(
    uploadKit({ file: zip(3, "kit.tar.gz"), fetchImpl }),
    /debe ser un archivo \.zip/,
  );
  const big = { name: "kit.zip", size: KIT_MAX_BYTES + 1 };
  await assert.rejects(uploadKit({ file: big, fetchImpl }), /pasa de 80 MB/);
  assert.equal(calls.length, 0);
  await assert.rejects(uploadKit({ file: zip(0), fetchImpl }), /vacío/);
  await assert.rejects(
    uploadKit({ file: zip(), key: "x\r\nInjected: y", fetchImpl }),
    /clave/,
  );
  assert.equal(calls.length, 0);
});

test("a kit is recovered by its id; download links point to the delivery files", async () => {
  const { calls, fetchImpl } = fakeFetch(200, payload());
  assert.equal((await loadKit({ id: ID, fetchImpl })).id, ID);
  assert.equal(calls[0].url, `/api/kit/${ID}`);
  assert.equal(calls[0].options.method, undefined);
  await assert.rejects(loadKit({ id: "../salud", fetchImpl }), /no trae/);
  assert.equal(calls.length, 1);
  const gone = fakeFetch(404, { detail: "Ese kit no existe o ya se borró." });
  await assert.rejects(
    loadKit({ id: ID, fetchImpl: gone.fetchImpl }),
    /ya se borró/,
  );
  assert.equal(
    deliveryUrl(`kit-${ID}-corrida_01`),
    `/api/entrega.csv?corrida=kit-${ID}-corrida_01`,
  );
  assert.equal(
    deliveryUrl("raiz", { tenant: "gracko" }),
    "/api/gracko/alertas.csv?corrida=raiz",
  );
  assert.equal(deliveryUrl("a&b=c"), "/api/entrega.csv?corrida=a%26b%3Dc");
});

test("kit lookup must return the requested id and all links stay on the local API", async () => {
  const { fetchImpl } = fakeFetch(200, payload());
  await assert.rejects(
    loadKit({ id: "f".repeat(32), fetchImpl }),
    /no corresponde al enlace/,
  );
  for (const base of [
    "https://other.test/api",
    "//other.test/api",
    "/api/../private",
    "/api?x=1",
  ]) {
    assert.throws(() => deliveryUrl("raiz", { base }), /mismo origen/);
    await assert.rejects(loadKit({ id: ID, base, fetchImpl }), /mismo origen/);
    await assert.rejects(
      uploadKit({ file: zip(), base, fetchImpl }),
      /mismo origen/,
    );
    await assert.rejects(loadCompanies({ base, fetchImpl }), /mismo origen/);
  }
  for (const tenant of [
    "../gracko",
    "a/b",
    "gracko?x=1",
    "",
    "a".repeat(41),
    null,
  ]) {
    if (tenant === null) continue; // null explicitly requests the complete delivery.
    assert.throws(() => deliveryUrl("raiz", { tenant }), /empresa/);
  }
  assert.equal(
    deliveryUrl("raiz", { base: "/api/", tenant: "nueva-empresa_1" }),
    "/api/nueva-empresa_1/alertas.csv?corrida=raiz",
  );
});

test("company discovery preserves scope and calibration without inventing a name", async () => {
  const companies = [
    { tenant: "gracko", giro: "Contabilidad", calibrada: true },
    { tenant: "empresa_nueva", giro: "", calibrada: false },
  ];
  const { calls, fetchImpl } = fakeFetch(200, companies);
  assert.deepEqual(await loadCompanies({ fetchImpl }), companies);
  assert.equal(calls[0].url, "/api/empresas");
  assert.deepEqual(
    await loadCompanies({ run: "corrida & otra", fetchImpl }),
    companies,
  );
  assert.equal(calls[1].url, "/api/empresas?corrida=corrida+%26+otra");
  assert.equal(calls[1].options.credentials, "same-origin");
  const legacy = fakeFetch(200, [{ tenant: "kaiku", giro: "" }]);
  assert.deepEqual(await loadCompanies({ fetchImpl: legacy.fetchImpl }), [
    { tenant: "kaiku", giro: "" },
  ]);
  assert.deepEqual(
    await loadCompanies({ fetchImpl: fakeFetch(200, []).fetchImpl }),
    [],
  );
  for (const bad of [
    {},
    [null],
    [{ tenant: "../kaiku" }],
    [{ tenant: "kaiku" }, { tenant: "kaiku" }],
    [{ tenant: "kaiku", giro: null }],
    [{ tenant: "kaiku", calibrada: "false" }],
  ]) {
    await assert.rejects(
      loadCompanies({ fetchImpl: fakeFetch(200, bad).fetchImpl }),
      /Datos no válidos/,
    );
  }
});

test("safe failure messages handle invalid JSON, structured details and bounded plain text", async () => {
  await assert.rejects(
    loadKit({ id: ID, fetchImpl: fakeFetch(200, "not JSON").fetchImpl }),
    /no es JSON válido/,
  );
  await assert.rejects(
    uploadKit({
      file: zip(),
      fetchImpl: fakeFetch(422, { detail: [{ msg: "private" }] }).fetchImpl,
    }),
    /No se pudo subir el kit \(HTTP 422\)/,
  );
  await assert.rejects(
    uploadKit({
      file: zip(),
      fetchImpl: fakeFetch(422, { detail: "dato\u0000\n" + "x".repeat(1500) })
        .fetchImpl,
    }),
    (error) =>
      error.status === 422 &&
      error.message.length === 1200 &&
      !/[\u0000-\u001f]/.test(error.message),
  );
});

test("kit requests time out while waiting for headers or body even if fetch ignores abort", async () => {
  for (const operation of [
    (options) => uploadKit({ file: zip(), ...options }),
    (options) => loadKit({ id: ID, ...options }),
    (options) => loadCompanies(options),
  ])
    for (const phase of ["headers", "body"]) {
      const never = () => new Promise(() => {});
      let requestSignal;
      const controller = new AbortController();
      const fetchImpl = async (url, { signal }) => {
        requestSignal = signal;
        return phase === "headers" ? never() : { ok: true, json: never };
      };
      await assert.rejects(
        operation({ fetchImpl, signal: controller.signal, timeoutMs: 20 }),
        (error) =>
          error.name === "TimeoutError" && /reintentar/.test(error.message),
      );
      assert.equal(requestSignal.aborted, true);
      assert.equal(controller.signal.aborted, false);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    }
});

test("cancelled kit requests cannot complete later or retain caller listeners", async () => {
  for (const phase of ["headers", "body"]) {
    const controller = new AbortController();
    let requestSignal;
    let release;
    let started;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = async (url, { signal }) => {
      requestSignal = signal;
      started();
      return phase === "headers" ? pending : { ok: true, json: () => pending };
    };
    const result = assert.rejects(
      uploadKit({
        file: zip(),
        fetchImpl,
        signal: controller.signal,
        timeoutMs: 200,
      }),
      (error) => error.name === "AbortError",
    );
    await began;
    controller.abort();
    await result;
    assert.equal(requestSignal.aborted, true);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    release(
      phase === "headers"
        ? { ok: true, json: async () => payload() }
        : payload(),
    );
  }
  const controller = new AbortController();
  controller.abort();
  const { calls, fetchImpl } = fakeFetch(200, payload());
  await assert.rejects(
    uploadKit({ file: zip(), fetchImpl, signal: controller.signal }),
    { name: "AbortError" },
  );
  await assert.rejects(
    loadKit({ id: ID, fetchImpl, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(calls.length, 0);
});

test("completed and rejected kit requests clear deadlines; timeout settings are validated", async () => {
  const signals = [];
  const controller = new AbortController();
  for (const status of [200, 401, 422]) {
    const fetchImpl = async (url, { signal }) => {
      signals.push(signal);
      return new Response(
        JSON.stringify(
          status === 200 ? payload() : { detail: "No disponible" },
        ),
        { status },
      );
    };
    const request = loadKit({
      id: ID,
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 20,
    });
    if (status === 200) await request;
    else await assert.rejects(request);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
  await delay(40);
  controller.abort();
  assert.ok(signals.every((signal) => !signal.aborted));
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, "100", 2_147_483_648])
    await assert.rejects(loadKit({ id: ID, timeoutMs }), /tiempo límite/);
});
