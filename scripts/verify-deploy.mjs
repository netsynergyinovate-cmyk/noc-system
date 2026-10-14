// Verifikator status deploy server, per fase. Hanya membaca; tidak mengubah apa pun.
//
//   npm run deploy:verify                       semua fase
//   node scripts/verify-deploy.mjs --phase 3 --tag 1.2.0
//   node scripts/verify-deploy.mjs --format json
//
// Fase: 1 env server, 2 database & migrasi, 3 image Docker, 4 health endpoint.
// Status: ready | pending (belum dikerjakan / belum terjangkau) | failed (ada yang salah).
// Exit code 0 hanya bila semua fase terpilih ready.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDockerDaemon, verifyImage } from "./build-images.mjs";
import { getMigrationStatus } from "./migrate-server.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PHASES = ["1", "2", "3", "4", "all"];
const FORMATS = ["text", "json"];
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const ENV_FILE = ".env.server";
const ENV_TEMPLATE = ".env.server.example";
const MIN_SECRET_LENGTH = 32;
// Kunci yang wajib acak & panjang. Semua juga berisi placeholder <...> di template.
const SECRET_KEYS = [
  "BETTER_AUTH_SECRET",
  "REALTIME_TOKEN_SECRET",
  "PPP_WEBHOOK_TOKEN",
  "DEVICE_SECRET",
  "ROUTER_SECRET_KEY",
];
const BADGES = { ready: "[READY]", pending: "[PENDING]", failed: "[FAILED]" };
const HEALTH_TIMEOUT_MS = 5000;

export function parseArgs(argv = []) {
  const options = {
    phase: "all",
    format: "text",
    tag: "latest",
    envFile: ENV_FILE,
    webUrl: "http://127.0.0.1:3000",
    backendUrl: "http://127.0.0.1:8080",
  };
  const flags = {
    "--phase": "phase",
    "--format": "format",
    "--tag": "tag",
    "--env-file": "envFile",
    "--web-url": "webUrl",
    "--backend-url": "backendUrl",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const key = flags[arg];
    if (!key) throw new Error(`Argumen tidak dikenal: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} butuh nilai.`);
    if (key === "phase" && !PHASES.includes(value))
      throw new Error(`--phase harus salah satu: ${PHASES.join(", ")}.`);
    if (key === "format" && !FORMATS.includes(value))
      throw new Error(`--format harus salah satu: ${FORMATS.join(", ")}.`);
    if (key === "tag" && !TAG_PATTERN.test(value))
      throw new Error(`Tag tidak valid: "${value}".`);
    options[key] = value;
  }
  return options;
}

/** Parser .env sederhana: KEY=VALUE, komentar # dan baris kosong diabaikan. */
function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return map;
}

const hasPlaceholder = (v) => /<[^<>]+>/.test(v);
const errMsg = (e) => (e instanceof Error ? e.message : String(e));

/** Baca berkas; null bila tidak ada. Error lain dilempar. */
async function readOptional(readFileFn, path) {
  try {
    return await readFileFn(path, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

const result = (phase, name, status, summary, details = []) => ({
  phase,
  name,
  status,
  summary,
  details,
});

/**
 * @param {{ cwd?: string, envFile?: string, templateFile?: string,
 *           readFileFn?: (path: string, enc: string) => Promise<string> }} [options]
 */
export async function verifyPhase1Env(options = {}) {
  const {
    cwd = root,
    envFile = ENV_FILE,
    templateFile = ENV_TEMPLATE,
    readFileFn = readFile,
  } = options;
  const name = "Env server";
  const envPath = resolve(cwd, envFile);
  let envText;
  let templateText;
  try {
    envText = await readOptional(readFileFn, envPath);
    templateText = await readOptional(readFileFn, resolve(cwd, templateFile));
  } catch (e) {
    return result(1, name, "failed", "Gagal membaca berkas env.", [errMsg(e)]);
  }
  if (templateText === null)
    return result(1, name, "failed", `Template ${templateFile} tidak ditemukan.`);
  if (envText === null)
    return result(1, name, "pending", `${envFile} belum dibuat.`, [
      `Salin ${templateFile} ke ${envFile}, lalu isi semua placeholder <...>.`,
    ]);

  const env = parseEnv(envText);
  const template = parseEnv(templateText);
  const missing = [...template.keys()].filter((k) => !env.has(k));
  const placeholders = [...env].filter(([, v]) => hasPlaceholder(v)).map(([k]) => k);
  const short = SECRET_KEYS.filter(
    (k) => env.has(k) && !hasPlaceholder(env.get(k)) && env.get(k).length < MIN_SECRET_LENGTH,
  );

  const problems = [
    ...missing.map((k) => `Kunci hilang: ${k}`),
    ...short.map((k) => `${k} kurang dari ${MIN_SECRET_LENGTH} karakter`),
  ];
  // Kunci hilang atau secret lemah = salah; placeholder = belum diisi.
  if (problems.length) {
    const details = [...problems, ...placeholders.map((k) => `Placeholder belum diganti: ${k}`)];
    return result(1, name, "failed", `${problems.length} masalah pada ${envFile}.`, details);
  }
  if (placeholders.length)
    return result(
      1,
      name,
      "pending",
      `${placeholders.length} placeholder belum diganti di ${envFile}.`,
      placeholders.map((k) => `Placeholder belum diganti: ${k}`),
    );
  return result(1, name, "ready", `${envFile} lengkap (${env.size} kunci).`);
}

async function defaultCreateClient(url) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {});
  return { query: (sql, params) => pool.query(sql, params), end: () => pool.end() };
}

/**
 * URL database: options.databaseUrl > DATABASE_URL di berkas env > options.env.
 * @param {{ databaseUrl?: string, env?: Record<string,string|undefined>,
 *           createClient?: (url: string) => Promise<{query: Function, end?: Function}>,
 *           migrationStatusFn?: typeof getMigrationStatus, migrationsFolder?: string }} [options]
 */
export async function verifyPhase2Database(options = {}) {
  const {
    cwd = root,
    envFile = ENV_FILE,
    readFileFn = readFile,
    env = process.env,
    createClient = defaultCreateClient,
    migrationStatusFn = getMigrationStatus,
    migrationsFolder,
  } = options;
  const name = "Database & migrasi";
  let url = options.databaseUrl;
  if (!url) {
    try {
      const text = await readOptional(readFileFn, resolve(cwd, envFile));
      if (text !== null) url = parseEnv(text).get("MIGRATION_DATABASE_URL") || parseEnv(text).get("DATABASE_URL");
    } catch (e) {
      return result(2, name, "failed", "Gagal membaca berkas env.", [errMsg(e)]);
    }
  }
  url ||= env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!url) return result(2, name, "pending", "DATABASE_URL belum tersedia.");
  if (hasPlaceholder(url))
    return result(2, name, "pending", "DATABASE_URL masih berisi placeholder <...>.");

  let client;
  try {
    client = await createClient(url);
    const s = await migrationStatusFn(client, migrationsFolder ? { migrationsFolder } : {});
    if (!s.hashValid)
      return result(
        2,
        name,
        "failed",
        "Hash migrasi tidak cocok (berkas .sql diubah setelah diterapkan).",
        s.hashMismatches.map((m) => `Hash tidak cocok: ${m.tag}`),
      );
    if (!s.isUpToDate)
      return result(
        2,
        name,
        "pending",
        `${s.pendingCount} migrasi tertunda dari ${s.totalCount}.`,
        [...s.pending.map((t) => `Tertunda: ${t}`), "Jalankan: npm run db:migrate:server"],
      );
    return result(2, name, "ready", `Semua ${s.totalCount} migrasi sudah diterapkan.`);
  } catch (e) {
    // Pesan driver bisa memuat host/kredensial; hanya kode/ringkasan pendek yang ditampilkan.
    return result(2, name, "failed", "Koneksi database gagal.", [
      String(e?.code ?? e?.name ?? "Error"),
    ]);
  } finally {
    await client?.end?.().catch(() => {});
  }
}

/**
 * @param {{ tag?: string, spawnFn?: Function }} [options]
 */
export async function verifyPhase3Images(options = {}) {
  const { tag = "latest", spawnFn } = options;
  const name = "Image Docker";
  const args = spawnFn ? [spawnFn] : [];
  const daemon = await checkDockerDaemon(...args);
  if (!daemon.ok) return result(3, name, "failed", "Docker daemon tidak tersedia.", [daemon.error]);

  const images = [`noc-web:${tag}`, `noc-backend:${tag}`];
  const missing = [];
  const invalid = [];
  const details = [];
  for (const image of images) {
    const v = await verifyImage(image, ...args);
    if (v.ok) continue;
    const notFound = v.problems.some((p) => p.includes("tidak ditemukan"));
    (notFound ? missing : invalid).push(image);
    details.push(...v.problems.map((p) => `${image}: ${p}`));
  }
  if (invalid.length)
    return result(3, name, "failed", `Image tidak sesuai: ${invalid.join(", ")}.`, details);
  if (missing.length) {
    details.push(`Jalankan: node scripts/build-images.mjs --tag ${tag}`);
    return result(3, name, "pending", `Image belum dibuild: ${missing.join(", ")}.`, details);
  }
  return result(3, name, "ready", `Image siap: ${images.join(", ")}.`);
}

async function probe(fetchFn, url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctl.signal });
    return { reached: true, status: res.status, ok: res.ok };
  } catch (e) {
    return { reached: false, error: e?.cause?.code ?? e?.name ?? "Error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ webUrl?: string, backendUrl?: string, fetchFn?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function verifyPhase4Health(options = {}) {
  const {
    webUrl = "http://127.0.0.1:3000",
    backendUrl = "http://127.0.0.1:8080",
    fetchFn = globalThis.fetch,
    timeoutMs = HEALTH_TIMEOUT_MS,
  } = options;
  const name = "Health endpoint";
  const targets = [
    ["Web", new URL("/api/health", webUrl).href],
    ["Backend", new URL("/healthz", backendUrl).href],
  ];
  const probes = await Promise.all(
    targets.map(async ([label, url]) => ({ label, url, ...(await probe(fetchFn, url, timeoutMs)) })),
  );
  const details = probes.map((p) =>
    p.reached ? `${p.label} ${p.url}: HTTP ${p.status}` : `${p.label} ${p.url}: tidak terjangkau (${p.error})`,
  );
  // Respons non-2xx (termasuk 5xx) = layanan hidup tapi sakit; tak terjangkau = belum jalan.
  const bad = probes.filter((p) => p.reached && !p.ok);
  if (bad.length)
    return result(4, name, "failed", `Health gagal: ${bad.map((p) => p.label).join(", ")}.`, details);
  const down = probes.filter((p) => !p.reached);
  if (down.length)
    return result(4, name, "pending", `Belum terjangkau: ${down.map((p) => p.label).join(", ")}.`, details);
  return result(4, name, "ready", "Web dan Backend sehat.", details);
}

const RUNNERS = {
  1: verifyPhase1Env,
  2: verifyPhase2Database,
  3: verifyPhase3Images,
  4: verifyPhase4Health,
};

export function formatReport(report) {
  const lines = [];
  for (const p of report.phases) {
    lines.push(`${BADGES[p.status]} Fase ${p.phase} - ${p.name}: ${p.summary}`);
    for (const d of p.details) lines.push(`    - ${d}`);
  }
  lines.push(`${BADGES[report.status]} Keseluruhan`);
  return lines.join("\n");
}

/**
 * Jalankan fase terpilih berurutan. Exception tak terduga pada satu fase
 * dijadikan failed supaya fase lain tetap dilaporkan.
 * @param {ReturnType<typeof parseArgs> & { runners?: Record<string, Function>, logFn?: (s: string) => void }} [options]
 */
export async function runDeployVerify(options = {}) {
  const { phase = "all", format = "text", logFn = console.log, runners = RUNNERS } = options;
  const selected = phase === "all" ? ["1", "2", "3", "4"] : [phase];
  const phases = [];
  for (const id of selected) {
    try {
      phases.push(await runners[id](options));
    } catch (e) {
      phases.push(result(Number(id), `Fase ${id}`, "failed", "Verifikasi gagal dijalankan.", [errMsg(e)]));
    }
  }
  const status = phases.some((p) => p.status === "failed")
    ? "failed"
    : phases.some((p) => p.status === "pending")
      ? "pending"
      : "ready";
  const report = { status, exitCode: status === "ready" ? 0 : 1, phases };
  logFn(format === "json" ? JSON.stringify(report, null, 2) : formatReport(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runDeployVerify(parseArgs(process.argv.slice(2)));
    process.exitCode = report.exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
