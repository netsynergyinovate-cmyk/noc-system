// Verifikator otomatis: Nol Data Dummy sebagai syarat promosi ke server (Go-Live Guard, Fase 5).
// Memastikan tidak ada sisa data tiruan, mode simulator, atau dummy source yang lolos ke server.
// Exit code 0 hanya jika lolos verifikasi nol data dummy.
//
//   node scripts/verify-zero-dummy.mjs
//   node scripts/verify-zero-dummy.mjs --strict
//   node scripts/verify-zero-dummy.mjs --format json

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Parser sederhana file .env
 */
export function parseEnvFile(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
    if (m) {
      map.set(m[1], m[2].trim().replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  return Object.fromEntries(map);
}

export function parseArgs(argv = []) {
  const options = {
    strict: false,
    format: "text",
    envFile: ".env.server",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--format") {
      const val = argv[++i];
      if (val !== "text" && val !== "json") {
        throw new Error("--format harus salah satu: text, json.");
      }
      options.format = val;
    } else if (arg === "--env-file") {
      const val = argv[++i];
      if (!val || val.startsWith("--")) {
        throw new Error("--env-file butuh nilai path.");
      }
      options.envFile = val;
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }

  return options;
}

/**
 * Memverifikasi ketiadaan data dummy dan mode simulator.
 */
export async function verifyZeroDummy(options = {}) {
  const {
    cwd = root,
    envFile = ".env.server",
    strict = false,
    env = process.env,
    readFileFn = readFile,
  } = options;

  let loadedEnv = { ...env };

  try {
    const fullPath = resolve(cwd, envFile);
    const content = await readFileFn(fullPath, "utf8");
    const parsed = parseEnvFile(content);
    loadedEnv = { ...loadedEnv, ...parsed };
  } catch (err) {
    // Jika file env server tidak ada, gunakan loadedEnv yang ada
  }

  const errors = [];
  const warnings = [];
  const checkedModules = [];

  const rawDataMode = (loadedEnv.DATA_MODE ?? loadedEnv.DASHBOARD_DATA ?? "")
    .trim()
    .toLowerCase();
  const isModeNyata = rawDataMode === "nyata" || rawDataMode === "live";

  // 1. Verifikasi saklar mode data
  if (!isModeNyata && strict) {
    errors.push(
      `DATA_MODE/DASHBOARD_DATA disetel ke "${rawDataMode || "kosong"}" (harus "nyata" atau "live" untuk promosi ke server).`,
    );
  }

  // 2. Verifikasi mode simulator perangkat
  const simulatorFlags = [
    { key: "DEVICE_MODE", label: "Mode Perangkat Global" },
    { key: "MIKROTIK_MODE", label: "Mode Router MikroTik" },
    { key: "OLT_MODE", label: "Mode OLT HSGQ" },
    { key: "BILLING_MODE", label: "Mode Sistem Billing" },
    { key: "NETFLOW_MODE", label: "Mode NetFlow Collector" },
  ];

  for (const { key, label } of simulatorFlags) {
    const val = loadedEnv[key]?.trim().toLowerCase();
    if (val === "simulator" || val === "dummy" || val === "demo") {
      errors.push(
        `${label} (${key}) masih dalam mode "${val}". Wajib dialihkan ke perangkat asli sebelum go-live.`,
      );
    }
  }

  // 3. Verifikasi flag data dummy eksplisit
  const dummyOverrides = [
    { key: "DUMMY_OLT", page: "/app/cpe", name: "Port PON & OLT" },
    { key: "DUMMY_BILLING", page: "/app/billing", name: "Status Billing" },
    { key: "DUMMY_NETFLOW", page: "/app/netflow", name: "Papan NetFlow" },
    { key: "DUMMY_ANOMALY", page: "/app/anomali", name: "Deteksi Anomali" },
    { key: "DUMMY_MAP", page: "/app/peta", name: "Peta Jaringan & Topologi" },
  ];

  for (const item of dummyOverrides) {
    checkedModules.push(item.name);
    if (loadedEnv[item.key] === "true") {
      errors.push(
        `Halaman ${item.name} (${item.page}) masih mengaktifkan data dummy (${item.key}=true).`,
      );
    }
  }

  // 4. Verifikasi kelengkapan koneksi router wajib
  if (isModeNyata || strict) {
    if (!loadedEnv.MIKROTIK_REST_HOST) {
      errors.push(
        "Router MikroTik belum memiliki MIKROTIK_REST_HOST nyata terisi.",
      );
    }
  }

  const ok = errors.length === 0;
  const status = ok ? "ready" : "failed";

  return {
    ok,
    status,
    exitCode: ok ? 0 : 1,
    isModeNyata,
    totalChecked: checkedModules.length + simulatorFlags.length + 2,
    errors,
    warnings,
    summary: ok
      ? "Verifikasi nol data dummy LULUS. Seluruh sumber data siap dipromosikan ke server."
      : `Verifikasi GAGAL: Ditemukan ${errors.length} sumber data tiruan / mode simulator yang menghalangi promosi ke server.`,
  };
}

export function formatZeroDummyReport(result) {
  const lines = [
    "================ VERIFIKASI NOL DATA DUMMY (GO-LIVE GUARD) ================",
    `Status           : ${result.ok ? "[LULUS / READY]" : "[DITAHAN / BLOCKED]"}`,
    `Mode Data Nyata  : ${result.isModeNyata ? "Aktif" : "Non-aktif (Demo/Dummy)"}`,
    `Komponen Diperiksa: ${result.totalChecked}`,
    `Ringkasan        : ${result.summary}`,
  ];

  if (result.errors.length > 0) {
    lines.push("\nPelanggaran Go-Live (Wajib Diperbaiki Sebelum Promosi):");
    for (const err of result.errors) {
      lines.push(`  - ✗ ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("\nPeringatan:");
    for (const w of result.warnings) {
      lines.push(`  - ! ${w}`);
    }
  }

  lines.push("==========================================================================");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = await verifyZeroDummy(opts);
    if (opts.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatZeroDummyReport(result));
    }
    process.exitCode = result.exitCode;
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
  }
}
