// Uji banding akses data: Drizzle ORM vs SQL langsung (node-postgres).
// Memakai klien DB tiruan terkalibrasi (deterministik, tanpa PostgreSQL), jadi
// yang terukur adalah biaya lapisan akses (pembangun query, validasi, pemetaan
// baris), bukan latensi jaringan/disk basis data.
// Tulis hasil ke src/lib/dashboard/benchmark-db-results.json.
// Pakai: npm run benchmark:db
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import v8 from "node:v8";
import vm from "node:vm";
import { register } from "tsx/esm/api";
import { calculateStats } from "./run-benchmark-comparison.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = resolve(root, "src/lib/dashboard/benchmark-db-results.json");
export const ITERATIONS = 50;
const WARMUP = 5;
const NOW = 1_791_400_000;
const RANGES = ["1h", "6h", "24h", "7d"];

const round = (n) => Math.round(n * 1e6) / 1e6;

// --- Data & klien DB tiruan ---------------------------------------------------

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROUTERS = Array.from({ length: 20 }, (_, i) => uuid(i + 1));

/** 1.000 sampel: 10 router x 100 detik, nilai deterministik. */
export function makeSamples() {
  const base = Date.parse("2026-10-12T10:00:00.000Z");
  const out = [];
  for (let r = 0; r < 10; r += 1)
    for (let s = 0; s < 100; s += 1)
      out.push({
        routerId: ROUTERS[r],
        sampledAt: new Date(base + s * 1000 + 250),
        rxMbps: ((r * 31 + s * 7) % 500) / 10,
        txMbps: ((r * 13 + s * 3) % 300) / 10,
      });
  return out;
}

const routerSeed = (id) => parseInt(id.slice(-4), 10) % 97;

// Baris hasil agregasi per bucket, bentuk sama dengan keluaran driver pg
// (bigint dan numeric kembali sebagai string).
function historyRows(fromIso, toIso, step, routerId) {
  const from = Date.parse(fromIso) / 1000;
  const to = Date.parse(toIso) / 1000;
  const seeds = (routerId ? [routerId] : ROUTERS).map(routerSeed);
  const rows = [];
  for (let b = from; b < to; b += step) {
    const n = b / step;
    if (n % 17 === 16) continue; // celah data, bukan traffic nol
    let rx = 0;
    let tx = 0;
    for (const s of seeds) {
      rx += ((n * 37 + s * 11) % 1000) / 10;
      tx += ((n * 17 + s * 5) % 600) / 10;
    }
    rows.push({ bucket: String(b), rx: (rx + 0.04).toFixed(4), tx: (tx + 0.26).toFixed(4) });
  }
  return rows;
}

const metricRows = () =>
  ROUTERS.map((id, i) => ({
    id,
    total: 40 + i * 3,
    online: 30 + i,
    isolir: i % 5,
  }));

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function applyUpsert(store, id, iso, rx, tx) {
  store.set(`${id}|${iso}`, [rx, tx]);
}

/** DB tiruan untuk jalur Drizzle: execute / insert / select. */
function makeDrizzleDb(PgDialect, state) {
  const dialect = new PgDialect();
  return {
    execute: async (q) => {
      const { params } = dialect.sqlToQuery(q);
      const isos = params.filter((p) => typeof p === "string" && ISO.test(p));
      const step = params.find((p) => typeof p === "number");
      const routerId = params.find((p) => typeof p === "string" && UUID_RE.test(p));
      return { rows: historyRows(isos[0], isos[1], step, routerId) };
    },
    insert: () => ({
      values: (rows) => ({
        onConflictDoUpdate: async () => {
          for (const r of rows)
            applyUpsert(state.store, r.routerId, r.sampledAt.toISOString(), r.rxMbps, r.txMbps);
        },
      }),
    }),
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        groupBy: () => chain,
        orderBy: async () =>
          metricRows().map((m) => ({
            routerId: m.id,
            totalCustomers: String(m.total),
            onlineCustomers: String(m.online),
            isolirCustomers: String(m.isolir),
          })),
      };
      return chain;
    },
  };
}

/** Klien SQL tiruan untuk jalur SQL langsung: query(text, params). */
function makeRawClient(state) {
  return {
    query: async (text, params) => {
      if (text.includes("INSERT INTO traffic_samples")) {
        const [ids, isos, rx, tx] = params;
        for (let i = 0; i < ids.length; i += 1) applyUpsert(state.store, ids[i], isos[i], rx[i], tx[i]);
        return { rows: [] };
      }
      if (text.includes("FROM customers")) {
        return {
          rows: metricRows().map((m) => ({
            router_id: m.id,
            total_customers: String(m.total),
            online_customers: String(m.online),
            isolir_customers: String(m.isolir),
          })),
        };
      }
      const [fromIso, toIso, step, routerId] = params;
      return { rows: historyRows(fromIso, toIso, step, routerId) };
    },
  };
}

// --- Harness ------------------------------------------------------------------

/**
 * Menyiapkan service (stub `server-only`, DB palsu) dan daftar skenario. Tiap
 * skenario punya fungsi drizzle() dan raw() dengan hasil yang bisa dibandingkan
 * lewat normalize().
 */
export async function createHarness() {
  process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
  process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
  process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

  // "server-only" melempar di luar bundler Next; ganti dengan modul kosong.
  const require = createRequire(import.meta.url);
  const so = require.resolve("server-only");
  require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

  const { PgDialect } = await import("drizzle-orm/pg-core");
  const state = { store: new Map() };
  // src/db/index.ts memakai globalThis.starterPostgresDb bila ada, sehingga
  // tidak ada koneksi/pool nyata yang dibuat.
  const fakeDb = makeDrizzleDb(PgDialect, state);
  globalThis.starterPostgresDb = fakeDb;

  register();
  const drz = await import("../src/services/traffic-archive.service.ts");
  const raw = await import("../src/services/traffic-archive-raw.service.ts");
  const rawClient = makeRawClient(state);
  const samples = makeSamples();

  const stripSource = (r) => {
    const { source: _source, ...rest } = r;
    return rest;
  };
  const upsertResult = async (fn) => {
    state.store = new Map();
    const count = await fn();
    return { count, store: state.store };
  };

  const scenarios = [];
  for (const range of RANGES)
    scenarios.push({
      group: "trafficAggregation",
      key: range,
      drizzle: () => drz.queryTrafficHistoryDrizzle({ range, nowSec: NOW }, fakeDb),
      raw: () => raw.queryTrafficHistoryRaw({ range, nowSec: NOW }, rawClient),
      normalize: stripSource,
    });
  scenarios.push({
    group: "batchUpsert",
    key: "1000",
    drizzle: () => upsertResult(() => drz.insertTrafficSamplesDrizzle(samples, fakeDb)),
    raw: () => upsertResult(() => raw.insertTrafficSamplesRaw(samples, rawClient)),
    normalize: ({ count, store }) => ({
      count,
      entries: [...store.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    }),
  });
  scenarios.push({
    group: "customerMetrics",
    key: "all",
    drizzle: () => drz.queryCustomerMetricsPerRouterDrizzle(undefined, fakeDb),
    raw: () => raw.queryCustomerMetricsPerRouterRaw(undefined, rawClient),
    normalize: (r) => r,
  });
  return { scenarios, samples };
}

// --- Pengukuran ---------------------------------------------------------------

let gc = () => {};
try {
  v8.setFlagsFromString("--expose-gc");
  gc = vm.runInNewContext("gc");
} catch {
  // tanpa gc: delta heap sedikit lebih berisik, tetap valid.
}

async function measure(fn) {
  for (let i = 0; i < WARMUP; i += 1) await fn();
  gc();
  const samples = [];
  let heap = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const h0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    await fn();
    const dt = performance.now() - t0;
    const h1 = process.memoryUsage().heapUsed;
    // GC di tengah iterasi bisa membuat delta negatif; alokasi tidak pernah negatif.
    heap += Math.max(0, h1 - h0);
    samples.push(dt);
  }
  return { latency: calculateStats(samples), heapAllocatedBytes: Math.max(1, heap) };
}

export async function runDbBenchmark() {
  const { scenarios } = await createHarness();
  const out = { trafficAggregation: {}, batchUpsert: null, customerMetrics: null };
  for (const sc of scenarios) {
    // Keluaran kedua jalur wajib identik sebelum latensinya dibandingkan.
    const [d, r] = [await sc.drizzle(), await sc.raw()];
    assert.deepEqual(sc.normalize(d), sc.normalize(r), `${sc.group}/${sc.key}: hasil beda`);

    const drizzle = await measure(sc.drizzle);
    const rawStats = await measure(sc.raw);
    const pair = {
      drizzle,
      raw: rawStats,
      avgSpeedup: round(drizzle.latency.avg / rawStats.latency.avg),
      heapSavings: round(drizzle.heapAllocatedBytes / rawStats.heapAllocatedBytes),
    };
    if (sc.group === "trafficAggregation") out.trafficAggregation[sc.key] = pair;
    else out[sc.group] = pair;
  }
  return {
    generatedAt: new Date().toISOString(),
    iterations: ITERATIONS,
    unit: "ms",
    mode: "mock",
    verified: true,
    scenarios: out,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = await runDbBenchmark();
  writeFileSync(OUTPUT, `${JSON.stringify(results, null, 2)}\n`);
  const line = (name, p) =>
    console.log(
      `${name.padEnd(12)} drizzle ${p.drizzle.latency.avg} ms | raw ${p.raw.latency.avg} ms (x${p.avgSpeedup}) | heap x${p.heapSavings}`,
    );
  const s = results.scenarios;
  for (const range of RANGES) line(`traffic ${range}`, s.trafficAggregation[range]);
  line("upsert 1000", s.batchUpsert);
  line("metrics", s.customerMetrics);
  console.log(`Ditulis ke ${OUTPUT}`);
}
