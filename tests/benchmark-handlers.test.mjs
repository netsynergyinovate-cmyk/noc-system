import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";
import { startSimulatorLab } from "../scripts/simulator-lab.mjs";

// "server-only" melempar di luar bundler Next; traffic() memuat service DB
// secara dinamis, jadi ganti dengan modul kosong.
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
process.env.BENCHMARK_SECRET = "test-secret";

const lab = await startSimulatorLab({
  health: 0,
  mikrotik: 0,
  olt: 0,
  billing: 0,
  genieacs: 0,
});
process.env.SIMULATOR_MIKROTIK_URL = `http://127.0.0.1:${lab.ports.mikrotik}`;
after(() => lab.close());

const { GET: collector } = await import("../src/app/api/benchmark/node-collector/route.ts");
const { GET: evalRoute } = await import("../src/app/api/benchmark/node-eval/route.ts");
const { GET: trafficRoute } = await import("../src/app/api/benchmark/node-traffic/route.ts");
const { GET: compare } = await import("../src/app/api/benchmark/compare/route.ts");
const { isBenchmarkAuthorized } = await import("../src/lib/benchmark/auth.ts");

const req = (path, key = "test-secret") =>
  new Request(`http://localhost/api/benchmark/${path}`, {
    headers: key ? { "x-benchmark-key": key } : {},
  });

test("auth: kunci benar lolos, salah atau kosong ditolak", async () => {
  assert.equal(await isBenchmarkAuthorized(req("x")), true);
  assert.equal(await isBenchmarkAuthorized(req("x", "salah")), false);
  assert.equal(await isBenchmarkAuthorized(req("x", "test-secret-lebih-panjang")), false);
  assert.equal(await isBenchmarkAuthorized(req("x", null)), false);
});

test("semua endpoint menjawab 401 tanpa kunci", async () => {
  for (const handler of [collector, evalRoute, trafficRoute, compare]) {
    const res = await handler(req("x", null));
    assert.equal(res.status, 401);
  }
});

test("collector: ambil resource dan jumlah antrean dari simulator", async () => {
  const res = await collector(req("node-collector"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("server-timing"), /^app;dur=\d/);
  const body = await res.json();
  assert.equal(body.engine, "node");
  assert.equal(body.subsystem, "collector");
  assert.equal(body.data.resource["cpu-load"], 15);
  assert.equal(body.data.queueCount, 2);
  assert.ok(body.durationMs >= 0);
  assert.equal(typeof body.memoryUsage.heapUsed, "number");
});

test("collector: url di luar loopback ditolak, simulator mati = 502", async () => {
  const bad = await collector(req("node-collector?url=http://169.254.169.254"));
  assert.equal(bad.status, 400);
  const down = await collector(req("node-collector?url=http://127.0.0.1:1"));
  assert.equal(down.status, 502);
});

test("eval: deterministik, ambang benar", async () => {
  const a = await (await evalRoute(req("node-eval?t=1791400000"))).json();
  const b = await (await evalRoute(req("node-eval?t=1791400000"))).json();
  assert.equal(a.engine, "node");
  assert.equal(a.subsystem, "rule_engine");
  assert.equal(a.anomaliesCount, a.anomalies.length);
  assert.deepEqual(a.anomalies, b.anomalies);
  assert.ok(a.anomalies.some((x) => x.kind === "offline"));
  for (const x of a.anomalies) {
    if (x.kind === "cpu") assert.ok(x.measured > 85);
    if (x.kind === "queue") assert.ok(x.measured > 95);
  }
  assert.equal((await evalRoute(req("node-eval?t=abc"))).status, 400);
});

test("traffic: tiap rentang punya langkah dan jumlah titik sesuai Go", async () => {
  const expect = { "1h": [10, 360], "6h": [60, 360], "24h": [300, 288], "7d": [1800, 336] };
  for (const [range, [step, points]] of Object.entries(expect)) {
    const body = await (await trafficRoute(req(`node-traffic?range=${range}&t=1791400000`))).json();
    assert.equal(body.step, step, range);
    assert.equal(body.points, points, range);
    assert.equal(body.times.length, points);
    assert.equal(body.rx.length, points);
    assert.equal(body.tx.length, points);
    assert.ok(body.to - body.from >= (points - 1) * step);
  }
  assert.equal((await trafficRoute(req("node-traffic?range=30d"))).status, 400);
});

test("compare: menggabungkan tiga langkah", async () => {
  const res = await compare(req("compare?range=6h&t=1791400000"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.engine, "node");
  const { collector: c, eval: e, traffic: t } = body.steps;
  assert.equal(c.data.queueCount, 2);
  assert.equal(typeof e.anomaliesCount, "number");
  assert.equal(t.points, 360);
  assert.ok(body.totalDurationMs >= c.durationMs + e.durationMs + t.durationMs - 0.01);
  assert.equal(typeof body.memoryUsage.rss, "number");
});
