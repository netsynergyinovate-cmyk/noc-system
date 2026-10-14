// Uji banding latensi Node.js (padanan Route Handlers) vs Go, lawan simulator
// MikroTik lokal. Tulis hasil ke src/lib/dashboard/benchmark-results.json.
// Pakai: npm run benchmark:run   (butuh Go terpasang)
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { register } from "tsx/esm/api";
import { startSimulatorLab } from "./simulator-lab.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = resolve(root, "src/lib/dashboard/benchmark-results.json");
export const ITERATIONS = 50;
const WARMUP = 5;
const FIXED_NOW = 1_700_000_000;

const round = (n) => Math.round(n * 1e6) / 1e6;

/** Statistik distribusi; persentil nearest-rank pada data terurut. */
export function calculateStats(values) {
  if (!Array.isArray(values) || values.length === 0)
    throw new Error("calculateStats butuh array angka tidak kosong.");
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v)))
    throw new Error("calculateStats hanya menerima angka berhingga.");
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    samples: sorted.length,
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    avg: round(sum / sorted.length),
    p50: round(pct(50)),
    p95: round(pct(95)),
    p99: round(pct(99)),
  };
}

async function measureNode(baseUrl) {
  register();
  const { collect, evaluate, traffic } = await import("../src/lib/benchmark/engine.ts");
  const step = {
    collector: () => collect(baseUrl),
    eval: () => evaluate(FIXED_NOW),
    traffic: () => traffic("1h", FIXED_NOW),
    pipeline: async () => {
      await collect(baseUrl);
      evaluate(FIXED_NOW);
      traffic("1h", FIXED_NOW);
    },
  };
  const out = {};
  for (const [name, fn] of Object.entries(step)) {
    for (let i = 0; i < WARMUP; i += 1) await fn();
    const samples = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();
      await fn();
      samples.push(performance.now() - start);
    }
    out[name] = calculateStats(samples);
  }
  const mem = process.memoryUsage();
  out.memory = { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed };
  return out;
}

// Harus async: simulator berjalan di proses ini, spawnSync akan memblokirnya.
async function measureGo(baseUrl) {
  const { stdout: raw } = await run(
    "go",
    [
      "-C", "backend", "run", "./cmd/benchcompare",
      "-url", baseUrl, "-n", String(ITERATIONS), "-warmup", String(WARMUP),
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 20, timeout: 180_000 },
  );
  const data = JSON.parse(raw);
  const out = { goVersion: data.goVersion };
  for (const name of ["collector", "eval", "traffic", "pipeline"])
    out[name] = calculateStats(data[name]);
  out.memory = {
    sysBytes: data.memory.sysBytes,
    heapAllocBytes: data.memory.heapAllocBytes,
  };
  return out;
}

export async function runBenchmark() {
  const lab = await startSimulatorLab({ health: 0, mikrotik: 0, olt: 0, billing: 0, genieacs: 0 });
  const baseUrl = `http://127.0.0.1:${lab.ports.mikrotik}`;
  try {
    const node = await measureNode(baseUrl);
    const go = await measureGo(baseUrl);
    return {
      generatedAt: new Date().toISOString(),
      iterations: ITERATIONS,
      unit: "ms",
      node,
      go,
      ratios: {
        // >1 = Go lebih unggul. Dibandingkan pada rata-rata dan p95 pipeline.
        pipelineAvgSpeedup: round(node.pipeline.avg / go.pipeline.avg),
        pipelineP95Speedup: round(node.pipeline.p95 / go.pipeline.p95),
        // RSS proses Node vs memori yang diminta runtime Go dari OS.
        memorySavings: round(node.memory.rssBytes / go.memory.sysBytes),
      },
    };
  } finally {
    await lab.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = await runBenchmark();
  writeFileSync(OUTPUT, `${JSON.stringify(results, null, 2)}\n`);
  const { node, go, ratios } = results;
  console.log(`Pipeline avg  node ${node.pipeline.avg} ms | go ${go.pipeline.avg} ms (x${ratios.pipelineAvgSpeedup})`);
  console.log(`Pipeline p95  node ${node.pipeline.p95} ms | go ${go.pipeline.p95} ms (x${ratios.pipelineP95Speedup})`);
  console.log(`Memori        node ${(node.memory.rssBytes / 1048576).toFixed(1)} MB | go ${(go.memory.sysBytes / 1048576).toFixed(1)} MB (x${ratios.memorySavings})`);
  console.log(`Ditulis ke ${OUTPUT}`);
}
