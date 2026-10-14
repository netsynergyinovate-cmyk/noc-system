import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  runDeployVerify,
  verifyPhase1Env,
  verifyPhase2Database,
  verifyPhase3Images,
  verifyPhase4Health,
} from "../scripts/verify-deploy.mjs";

const SECRET = "a".repeat(40);
const TEMPLATE = [
  "# komentar",
  "DATABASE_URL=postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DB_NAME>",
  "BETTER_AUTH_SECRET=<GANTI>",
  "REALTIME_TOKEN_SECRET=<GANTI>",
  "PORT=8080",
].join("\n");
const goodEnv = (over = {}) => {
  const base = {
    DATABASE_URL: "postgresql://u:p@db:5432/noc",
    BETTER_AUTH_SECRET: SECRET,
    REALTIME_TOKEN_SECRET: SECRET,
    PORT: "8080",
    ...over,
  };
  return Object.entries(base)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
};
const fsWith = (files) => async (path) => {
  const key = Object.keys(files).find((k) => path.endsWith(k));
  if (key === undefined) throw Object.assign(new Error("nope"), { code: "ENOENT" });
  return files[key];
};
const env1 = (envText) =>
  verifyPhase1Env({
    cwd: "/x",
    readFileFn: fsWith({
      ".env.server.example": TEMPLATE,
      ...(envText === undefined ? {} : { ".env.server": envText }),
    }),
  });

test("parseArgs: bawaan dan flag kustom", () => {
  assert.deepEqual(parseArgs([]), {
    phase: "all",
    format: "text",
    tag: "latest",
    envFile: ".env.server",
    webUrl: "http://127.0.0.1:3000",
    backendUrl: "http://127.0.0.1:8080",
  });
  const o = parseArgs([
    "--phase", "3", "--format", "json", "--tag", "1.2.0",
    "--env-file", "x.env", "--web-url", "http://w", "--backend-url", "http://b",
  ]);
  assert.deepEqual(o, {
    phase: "3", format: "json", tag: "1.2.0", envFile: "x.env", webUrl: "http://w", backendUrl: "http://b",
  });
  assert.throws(() => parseArgs(["--phase", "9"]), /--phase/);
  assert.throws(() => parseArgs(["--format", "xml"]), /--format/);
  assert.throws(() => parseArgs(["--tag"]), /butuh nilai/);
  assert.throws(() => parseArgs(["--tag", "a b"]), /Tag/);
  assert.throws(() => parseArgs(["--nope"]), /tidak dikenal/);
});

test("fase 1: env lengkap = ready", async () => {
  const r = await env1(goodEnv());
  assert.equal(r.status, "ready");
});

test("fase 1: placeholder = pending", async () => {
  const r = await env1(goodEnv({ BETTER_AUTH_SECRET: "<GANTI>" }));
  assert.equal(r.status, "pending");
  assert.ok(r.details.some((d) => d.includes("BETTER_AUTH_SECRET")));
});

test("fase 1: secret pendek dan kunci hilang = failed", async () => {
  const short = await env1(goodEnv({ REALTIME_TOKEN_SECRET: "pendek" }));
  assert.equal(short.status, "failed");
  assert.ok(short.details.some((d) => d.includes("REALTIME_TOKEN_SECRET")));
  const missing = await env1(goodEnv({ PORT: null }));
  assert.equal(missing.status, "failed");
  assert.ok(missing.details.includes("Kunci hilang: PORT"));
  // nilai secret tidak boleh bocor ke laporan
  assert.ok(!JSON.stringify(short).includes("pendek\""));
});

test("fase 1: berkas env absen = pending, template absen = failed", async () => {
  assert.equal((await env1(undefined)).status, "pending");
  const r = await verifyPhase1Env({ readFileFn: fsWith({}) });
  assert.equal(r.status, "failed");
});

const dbStatus = (over = {}) => ({
  totalCount: 3, appliedCount: 3, pendingCount: 0, pending: [], isUpToDate: true,
  hashValid: true, hashMismatches: [], ...over,
});
const db = (status, extra = {}) => {
  let ended = false;
  return verifyPhase2Database({
    databaseUrl: "postgresql://u:p@h/db",
    createClient: async () => ({ query: async () => ({ rows: [] }), end: async () => { ended = true; } }),
    migrationStatusFn: async () => (status instanceof Error ? Promise.reject(status) : status),
    ...extra,
  }).then((r) => ({ ...r, ended }));
};

test("fase 2: up-to-date = ready, pending, hash mismatch, koneksi gagal", async () => {
  const ok = await db(dbStatus());
  assert.equal(ok.status, "ready");
  assert.ok(ok.ended, "koneksi ditutup");
  const pending = await db(dbStatus({ isUpToDate: false, pendingCount: 1, pending: ["0007_x"] }));
  assert.equal(pending.status, "pending");
  assert.ok(pending.details.includes("Tertunda: 0007_x"));
  const bad = await db(dbStatus({ hashValid: false, hashMismatches: [{ tag: "0002_y" }] }));
  assert.equal(bad.status, "failed");
  assert.ok(bad.details.includes("Hash tidak cocok: 0002_y"));
  const down = await db(Object.assign(new Error("password=rahasia host"), { code: "ECONNREFUSED" }));
  assert.equal(down.status, "failed");
  assert.ok(!JSON.stringify(down).includes("rahasia"));
});

test("fase 2: tanpa URL atau URL placeholder = pending; URL dibaca dari env file", async () => {
  const none = await verifyPhase2Database({ env: {}, readFileFn: fsWith({}) });
  assert.equal(none.status, "pending");
  const ph = await verifyPhase2Database({
    env: {},
    readFileFn: fsWith({ ".env.server": "DATABASE_URL=postgresql://<DB_USER>@h/d" }),
  });
  assert.equal(ph.status, "pending");
  let seen;
  const r = await verifyPhase2Database({
    env: {},
    readFileFn: fsWith({ ".env.server": "DATABASE_URL=postgresql://u:p@h/d" }),
    createClient: async (url) => ((seen = url), { query: async () => ({ rows: [] }) }),
    migrationStatusFn: async () => dbStatus(),
  });
  assert.equal(r.status, "ready");
  assert.equal(seen, "postgresql://u:p@h/d");
});

const inspect = (config) => ({ code: 0, stdout: JSON.stringify([{ Config: config }]), stderr: "" });
const webCfg = { User: "nextjs", ExposedPorts: { "3000/tcp": {} } };
const backCfg = { ExposedPorts: { "8080/tcp": {}, "2055/udp": {}, "514/udp": {} } };
const spawnFor = ({ daemon = true, images = {} } = {}) => async (cmd, args) => {
  if (args[0] === "info")
    return daemon ? { code: 0, stdout: "27", stderr: "" } : { code: 1, stdout: "", stderr: "cannot connect" };
  const name = args[2];
  const cfg = images[name.split(":")[0]];
  return cfg ? inspect(cfg) : { code: 1, stdout: "", stderr: "No such image" };
};

test("fase 3: image valid, belum dibuild, tidak sesuai, daemon mati", async () => {
  const ok = await verifyPhase3Images({
    tag: "1.0",
    spawnFn: spawnFor({ images: { "noc-web": webCfg, "noc-backend": backCfg } }),
  });
  assert.equal(ok.status, "ready");
  const none = await verifyPhase3Images({ spawnFn: spawnFor({ images: { "noc-web": webCfg } }) });
  assert.equal(none.status, "pending");
  assert.match(none.summary, /noc-backend:latest/);
  const root = await verifyPhase3Images({
    spawnFn: spawnFor({ images: { "noc-web": { ExposedPorts: webCfg.ExposedPorts }, "noc-backend": backCfg } }),
  });
  assert.equal(root.status, "failed");
  const off = await verifyPhase3Images({ spawnFn: spawnFor({ daemon: false }) });
  assert.equal(off.status, "failed");
  assert.match(off.summary, /Docker daemon/);
});

const res = (status) => ({ status, ok: status >= 200 && status < 300 });
const health = (fetchFn) =>
  verifyPhase4Health({ webUrl: "http://w:3000", backendUrl: "http://b:8080", fetchFn });

test("fase 4: 200 = ready, refused = pending, 500 = failed", async () => {
  const urls = [];
  const ok = await health(async (u) => (urls.push(u), res(200)));
  assert.equal(ok.status, "ready");
  assert.deepEqual(urls.sort(), ["http://b:8080/healthz", "http://w:3000/api/health"]);
  const down = await health(async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  });
  assert.equal(down.status, "pending");
  assert.ok(down.details[0].includes("ECONNREFUSED"));
  const five = await health(async (u) => (u.endsWith("/healthz") ? res(500) : res(200)));
  assert.equal(five.status, "failed");
  // 5xx menang atas unreachable
  const mixed = await health(async (u) => {
    if (u.endsWith("/healthz")) return res(503);
    throw new Error("x");
  });
  assert.equal(mixed.status, "failed");
});

test("fase 4: timeout membatalkan permintaan yang menggantung", async () => {
  const r = await verifyPhase4Health({
    timeoutMs: 10,
    fetchFn: (u, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" }))),
      ),
  });
  assert.equal(r.status, "pending");
});

const fake = (status) => async () => ({ phase: 0, name: "n", status, summary: `s-${status}`, details: ["d"] });

test("runDeployVerify: text, exit code, badge", async () => {
  const lines = [];
  const all = { 1: fake("ready"), 2: fake("ready"), 3: fake("ready"), 4: fake("ready") };
  const ok = await runDeployVerify({ runners: all, logFn: (s) => lines.push(s) });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.status, "ready");
  assert.ok(lines[0].includes("[READY]") && lines[0].includes("Keseluruhan"));

  lines.length = 0;
  const pend = await runDeployVerify({ runners: { ...all, 3: fake("pending") }, logFn: (s) => lines.push(s) });
  assert.equal(pend.exitCode, 1);
  assert.equal(pend.status, "pending");
  assert.match(lines[0], /\[PENDING\]/);

  const fail = await runDeployVerify({ runners: { ...all, 3: fake("pending"), 4: fake("failed") }, logFn() {} });
  assert.equal(fail.status, "failed");
  assert.equal(fail.exitCode, 1);
});

test("runDeployVerify: json, fase tunggal, exception jadi failed", async () => {
  const out = [];
  const r = await runDeployVerify({
    phase: "2",
    format: "json",
    runners: { 2: async () => { throw new Error("boom"); } },
    logFn: (s) => out.push(s),
  });
  assert.equal(r.phases.length, 1);
  assert.equal(r.phases[0].status, "failed");
  const parsed = JSON.parse(out[0]);
  assert.equal(parsed.exitCode, 1);
  assert.equal(parsed.phases[0].details[0], "boom");
});
