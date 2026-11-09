#!/usr/bin/env node
import { execSync, spawn, spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function log(msg) {
  console.log(`${ANSI.cyan}[noc-system]${ANSI.reset} ${msg}`);
}
function ok(msg) {
  console.log(`${ANSI.green}✓${ANSI.reset} ${msg}`);
}
function warn(msg) {
  console.warn(`${ANSI.yellow}⚠${ANSI.reset} ${msg}`);
}
function fail(msg) {
  console.error(`${ANSI.red}✗${ANSI.reset} ${msg}`);
}

// Port backend Go dari BACKEND_ADDR di /srv/noc/shared/.env (bawaan 8080), karena
// 8080 bisa sudah dipakai layanan lain di server (mis. Caddy).
function backendPort() {
  try {
    const m = fs
      .readFileSync("/srv/noc/shared/.env", "utf-8")
      .match(/^BACKEND_ADDR=.*:(\d+)\s*$/m);
    if (m) return m[1];
  } catch {}
  return "8080";
}

function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, {
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      cwd: options.cwd || REPO_ROOT,
      ...options,
    });
  } catch (err) {
    if (options.ignoreError) return null;
    throw err;
  }
}
function runCmdWithHeartbeat(cmd, stageName, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const intervalSeconds = 15;

    const timer = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `${ANSI.cyan}[noc-system]${ANSI.reset} ⏳ ${stageName} masih aktif berjalan di background (${elapsedSeconds} detik)... Harap tunggu, bukan membeku.`,
      );
    }, intervalSeconds * 1000);

    const child = spawn(cmd, {
      shell: true,
      stdio: options.silent ? "pipe" : "inherit",
      cwd: options.cwd || REPO_ROOT,
      env: options.env || process.env,
    });

    child.on("error", (err) => {
      clearInterval(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearInterval(timer);
      if (code === 0) {
        resolve();
      } else {
        const err = new Error(`Command failed with exit code ${code}: ${cmd}`);
        err.code = code;
        reject(err);
      }
    });
  });
}

function parseFourPartVersion(v) {
  if (!v || typeof v !== "string") return [1, 0, 0, 0];
  const clean = v.trim().replace(/^v/i, "").split("+")[0].trim();
  const segments = clean.split(".");
  const parsed = segments.map((s) => {
    const num = Number.parseInt(s, 10);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  });
  return [parsed[0] ?? 1, parsed[1] ?? 0, parsed[2] ?? 0, parsed[3] ?? 0];
}

function formatFourPartVersion(parts) {
  return `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`;
}

function bumpMinorVersion(v) {
  const [major, minor] = parseFourPartVersion(v);
  return formatFourPartVersion([major, minor + 1, 0, 0]);
}

function bumpBuildVersion(v) {
  const [major, minor, patch, build] = parseFourPartVersion(v);
  return formatFourPartVersion([major, minor, patch, build + 1]);
}

function getNextDeployVersion(explicitVersion) {
  if (explicitVersion) {
    return formatFourPartVersion(parseFourPartVersion(explicitVersion));
  }

  let baseVersion = "1.0.0.0";
  try {
    const pkgPath = path.join(REPO_ROOT, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.version) baseVersion = pkg.version;
    }
  } catch {}

  const [major, minor, patch, baseBuild] = parseFourPartVersion(baseVersion);
  const prefix = `${major}.${minor}.${patch}.`;

  const releasesDir = "/srv/noc/releases";
  let maxBuild = -1;

  if (fs.existsSync(releasesDir)) {
    try {
      const entries = fs.readdirSync(releasesDir);
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          const parts = parseFourPartVersion(entry);
          if (parts[0] === major && parts[1] === minor && parts[2] === patch) {
            if (parts[3] > maxBuild) {
              maxBuild = parts[3];
            }
          }
        }
      }
    } catch {}
  }

  if (maxBuild >= 0) {
    return formatFourPartVersion([major, minor, patch, maxBuild + 1]);
  }

  return formatFourPartVersion([major, minor, patch, baseBuild]);
}

function getAppVersion() {
  return getNextDeployVersion();
}
function recordDeploymentToDatabase(version, jenis, status, titikBalikVersi) {
  try {
    let pgCid = "";
    try {
      const lines = execSync(
        'docker ps --filter "name=noc-postgres" --format "{{.Names}}"',
        { encoding: "utf-8" },
      )
        .trim()
        .split("\n");
      pgCid = lines[0]?.trim();
      if (!pgCid) {
        const p5432 = execSync(
          'docker ps --filter "publish=5432" --format "{{.Names}}"',
          { encoding: "utf-8" },
        )
          .trim()
          .split("\n");
        pgCid = p5432[0]?.trim();
      }
    } catch {}

    if (!pgCid) return;

    let dbUser = "starter";
    let dbName = "starter";
    if (fs.existsSync("/srv/noc/shared/.env")) {
      const envContent = fs.readFileSync("/srv/noc/shared/.env", "utf-8");
      const match = envContent.match(/^DATABASE_URL=(.+)$/m);
      if (match) {
        const rawUrl = match[1].trim().replace(/^["']|["']$/g, "");
        const parsed = new URL(rawUrl);
        if (parsed.username) dbUser = parsed.username;
        if (parsed.pathname) dbName = parsed.pathname.replace(/^\//, "");
      }
    }

    const tbVal = titikBalikVersi ? `'${titikBalikVersi}'` : "NULL";
    const sql = `INSERT INTO deploy_runs (versi, jenis, status, titik_balik_versi, dijalankan_oleh, selesai) VALUES ('${version}', '${jenis}', '${status}', ${tbVal}, 'CLI noc-system', NOW());`;
    execSync(
      `docker exec -i "${pgCid}" psql -U "${dbUser}" -d "${dbName}" -c "${sql}" 2>/dev/null || true`,
    );
  } catch {}
}

function updateServerStatusSnapshot(version, rollbackTarget, status) {
  try {
    const statusPath = "/srv/noc/shared/server-status.json";
    let recentErrors = [];
    try {
      const errOut = execSync(
        "journalctl -u noc-web -u noc-backend -p err -n 50 --no-pager 2>/dev/null || echo ''",
        { encoding: "utf-8" },
      ).trim();
      if (errOut) recentErrors = errOut.split("\n").filter(Boolean);
    } catch {}

    const data = {
      version,
      rollbackTarget,
      status,
      updatedAt: new Date().toISOString(),
      recentErrors,
    };
    fs.mkdirSync("/srv/noc/shared", { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

// -----------------------------------------------------------------------------
// 1. COMMAND: install / setup
// -----------------------------------------------------------------------------
async function cmdInstall() {
  log(
    `${ANSI.bold}Memulai Instalasi NOC System di Server Native Ubuntu...${ANSI.reset}`,
  );

  // 1. Buat hierarki direktori /srv/noc
  log("1. Membuat direktori rilis dan data di /srv/noc...");
  const dirs = [
    "/srv/noc",
    "/srv/noc/releases",
    "/srv/noc/shared",
    "/srv/noc/backups",
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      try {
        fs.mkdirSync(d, { recursive: true });
        ok(`Direktori ${d} siap.`);
      } catch {
        runCmd(`sudo mkdir -p ${d} && sudo chown -R $USER:$USER ${d}`);
        ok(`Direktori ${d} dibuat via sudo.`);
      }
    }
  }

  // 2. Siapkan /srv/noc/shared/.env
  log("2. Menyiapkan environment di /srv/noc/shared/.env...");
  const targetEnv = "/srv/noc/shared/.env";
  const genMonitorToken = crypto.randomBytes(24).toString("hex");
  const genPgPass = crypto.randomBytes(16).toString("hex");
  const genAuthSecret = crypto.randomBytes(32).toString("hex");
  const genDeviceSecret =
    process.env.NOC_DEVICE_SECRET ||
    process.env.DEVICE_SECRET ||
    crypto.randomBytes(16).toString("hex");
  const genRouterSecret =
    process.env.NOC_ROUTER_SECRET_KEY ||
    process.env.ROUTER_SECRET_KEY ||
    genDeviceSecret;
  const genRealtimeSecret = crypto.randomBytes(32).toString("hex");
  const genWebhookToken = crypto.randomBytes(32).toString("hex");
  const lanIp = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/^(docker|br-|veth|tailscale|wg|virbr)/.test(name))
    .flatMap(([, list]) => list)
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  const genPublicUrl =
    process.env.NOC_PUBLIC_URL || `http://${lanIp || "localhost"}:3000`;
  // Nilai turunan dari URL publik: tanpa ini WebSocket dan CORS tetap menunjuk placeholder contoh.
  const finalizeEnv = (text) => {
    const u = new URL(genPublicUrl);
    // 8080 sering sudah dipakai layanan lain (mis. Caddy); pindah ke 8090 bila terisi.
    let port = text.match(/^BACKEND_ADDR=.*:(\d+)\s*$/m)?.[1] || "8080";
    try {
      if (
        port === "8080" &&
        execSync("ss -ltn 'sport = :8080' 2>/dev/null", {
          encoding: "utf-8",
        }).split("\n").length > 2
      )
        port = "8090";
    } catch {}
    // BACKEND_URL dipakai BROWSER (tiket WebSocket + REST), jadi harus alamat yang bisa dijangkau klien;
    // BACKEND_INTERNAL_URL dipakai server Next.js sendiri dan boleh loopback.
    const browserBackend =
      u.protocol === "https:" ? u.origin : `http://${u.hostname}:${port}`;
    const ws =
      u.protocol === "https:"
        ? `wss://${u.host}/ws`
        : `ws://${u.hostname}:${port}/ws`;
    let out = text
      .replace(/^BACKEND_ADDR=.*$/m, `BACKEND_ADDR=0.0.0.0:${port}`)
      .replace(
        /^BACKEND_URL=http:\/\/(?:127\.0\.0\.1|localhost):\d+\s*$/m,
        `BACKEND_URL=${browserBackend}`,
      )
      .replace(
        /^NEXT_PUBLIC_REALTIME_WS_URL=(.*<.*>.*|wss:\/\/noc\.example\.com\/ws)$/m,
        `NEXT_PUBLIC_REALTIME_WS_URL=${ws}`,
      )
      .replace(
        /^ALLOWED_ORIGINS=(.*<.*>.*|https:\/\/noc\.example\.com)$/m,
        `ALLOWED_ORIGINS=${u.origin}`,
      )
      // Placeholder billing yang aktif membuat backend mencoba sinkron ke billing.example.com tiap 5 menit.
      .replace(
        /^(BILLING_(?:URL|USERNAME|PASSWORD))=(.*<.*>.*|https:\/\/billing\.example\.com)$/gm,
        "# $1=$2",
      )
      // Web berjalan native (bukan di jaringan Docker): nama layanan `genieacs` tidak ter-resolve; NBI ada di loopback.
      .replace(
        /^(GENIEACS_URL|GENIEACS_NBI_URL)=http:\/\/genieacs:7557\s*$/gm,
        "$1=http://127.0.0.1:7557",
      )
      .replace(
        /^(GENIEACS_(?:NBI_)?(?:USER|USERNAME|PASSWORD)=.*<.*>.*)$/gm,
        "# $1",
      );
    if (!/^BACKEND_INTERNAL_URL=/m.test(out))
      out = out.replace(
        /\s*$/,
        `\nBACKEND_INTERNAL_URL=http://127.0.0.1:${port}\n`,
      );
    // URL aplikasi berupa domain tapi server juga dibuka lewat IP LAN: Better Auth menolak origin lain (403).
    if (
      u.protocol === "http:" &&
      lanIp &&
      u.hostname !== lanIp &&
      !/^BETTER_AUTH_TRUSTED_ORIGINS=/m.test(out)
    ) {
      out = out.replace(
        /\s*$/,
        `\nBETTER_AUTH_TRUSTED_ORIGINS=http://${lanIp}:3000\n`,
      );
    }
    return out;
  };
  if (
    !process.env.NOC_DEVICE_SECRET &&
    !process.env.DEVICE_SECRET &&
    !fs.existsSync(targetEnv)
  ) {
    warn(
      "DEVICE_SECRET dibuat acak (32 karakter). Jika Anda menggunakan halaman Deploy dari localhost untuk mengontrol server ini, samakan nilai DEVICE_SECRET di /srv/noc/shared/.env dengan localhost agar verifikasi kesiapan (dry-run) lulus.",
    );
  }

  if (fs.existsSync(targetEnv)) {
    let curEnv = fs.readFileSync(targetEnv, "utf-8");
    curEnv = curEnv
      .replace(
        /^DATABASE_URL=.*<.*>.*$/m,
        `DATABASE_URL=postgresql://starter:${genPgPass}@127.0.0.1:5432/starter`,
      )
      .replace(
        /^BETTER_AUTH_SECRET=.*<.*>.*$/m,
        `BETTER_AUTH_SECRET=${genAuthSecret}`,
      )
      .replace(/^DEVICE_SECRET=.*<.*>.*$/m, `DEVICE_SECRET=${genDeviceSecret}`)
      .replace(
        /^ROUTER_SECRET_KEY=.*<.*>.*$/m,
        `ROUTER_SECRET_KEY=${genRouterSecret}`,
      )
      .replace(
        /^REALTIME_TOKEN_SECRET=.*<.*>.*$/m,
        `REALTIME_TOKEN_SECRET=${genRealtimeSecret}`,
      )
      .replace(
        /^PPP_WEBHOOK_TOKEN=.*<.*>.*$/m,
        `PPP_WEBHOOK_TOKEN=${genWebhookToken}`,
      );

    if (process.env.NOC_PUBLIC_URL) {
      curEnv = curEnv
        .replace(
          /^BETTER_AUTH_URL=.*$/m,
          `BETTER_AUTH_URL=${process.env.NOC_PUBLIC_URL}`,
        )
        .replace(
          /^NEXT_PUBLIC_APP_URL=.*$/m,
          `NEXT_PUBLIC_APP_URL=${process.env.NOC_PUBLIC_URL}`,
        );
    } else {
      curEnv = curEnv
        .replace(
          /^BETTER_AUTH_URL=(.*<.*>.*|https:\/\/noc\.example\.com)$/m,
          `BETTER_AUTH_URL=${genPublicUrl}`,
        )
        .replace(
          /^NEXT_PUBLIC_APP_URL=(.*<.*>.*|https:\/\/noc\.example\.com)$/m,
          `NEXT_PUBLIC_APP_URL=${genPublicUrl}`,
        );
    }

    if (!/^POSTGRES_USER=/m.test(curEnv)) curEnv += "\nPOSTGRES_USER=starter";
    if (!/^POSTGRES_PASSWORD=/m.test(curEnv)) {
      const dbMatch = curEnv.match(
        /^DATABASE_URL=postgresql:\/\/[^:]+:([^@]+)@/m,
      );
      const pass = dbMatch ? dbMatch[1] : genPgPass;
      curEnv += `\nPOSTGRES_PASSWORD=${pass}`;
    }
    if (!/^POSTGRES_DB=/m.test(curEnv)) curEnv += "\nPOSTGRES_DB=starter";
    if (!/^MONITOR_TOKEN=[^<\s]\S*/m.test(curEnv)) {
      if (/^MONITOR_TOKEN=.*$/m.test(curEnv)) {
        curEnv = curEnv.replace(
          /^MONITOR_TOKEN=.*$/m,
          `MONITOR_TOKEN=${genMonitorToken}`,
        );
      } else {
        curEnv += `\nMONITOR_TOKEN=${genMonitorToken}`;
      }
    }
    fs.writeFileSync(targetEnv, finalizeEnv(curEnv.trim() + "\n"), "utf-8");
    ok(`Berkas ${targetEnv} diselaraskan tanpa placeholder.`);
  } else {
    const templatePath = path.join(REPO_ROOT, ".env.server.example");
    let content = "";
    if (fs.existsSync(templatePath)) {
      content = fs
        .readFileSync(templatePath, "utf-8")
        .replace(
          /^DATABASE_URL=.*<.*>.*$/m,
          `DATABASE_URL=postgresql://starter:${genPgPass}@127.0.0.1:5432/starter`,
        )
        .replace(
          /^BETTER_AUTH_SECRET=.*<.*>.*$/m,
          `BETTER_AUTH_SECRET=${genAuthSecret}`,
        )
        .replace(/^BETTER_AUTH_URL=.*$/m, `BETTER_AUTH_URL=${genPublicUrl}`)
        .replace(
          /^NEXT_PUBLIC_APP_URL=.*$/m,
          `NEXT_PUBLIC_APP_URL=${genPublicUrl}`,
        )
        .replace(
          /^DEVICE_SECRET=.*<.*>.*$/m,
          `DEVICE_SECRET=${genDeviceSecret}`,
        )
        .replace(
          /^ROUTER_SECRET_KEY=.*<.*>.*$/m,
          `ROUTER_SECRET_KEY=${genRouterSecret}`,
        )
        .replace(
          /^REALTIME_TOKEN_SECRET=.*<.*>.*$/m,
          `REALTIME_TOKEN_SECRET=${genRealtimeSecret}`,
        )
        .replace(
          /^PPP_WEBHOOK_TOKEN=.*<.*>.*$/m,
          `PPP_WEBHOOK_TOKEN=${genWebhookToken}`,
        );
      content += `\nPOSTGRES_USER=starter\nPOSTGRES_PASSWORD=${genPgPass}\nPOSTGRES_DB=starter\nMONITOR_TOKEN=${genMonitorToken}\n`;
    } else {
      content =
        [
          "NODE_ENV=production",
          "PORT=3000",
          "POSTGRES_USER=starter",
          `POSTGRES_PASSWORD=${genPgPass}`,
          "POSTGRES_DB=starter",
          `DATABASE_URL=postgresql://starter:${genPgPass}@127.0.0.1:5432/starter`,
          `BETTER_AUTH_SECRET=${genAuthSecret}`,
          `BETTER_AUTH_URL=${genPublicUrl}`,
          `NEXT_PUBLIC_APP_URL=${genPublicUrl}`,
          `DEVICE_SECRET=${genDeviceSecret}`,
          `ROUTER_SECRET_KEY=${genRouterSecret}`,
          "BACKEND_URL=http://localhost:8080",
          `REALTIME_TOKEN_SECRET=${genRealtimeSecret}`,
          `PPP_WEBHOOK_TOKEN=${genWebhookToken}`,
          `MONITOR_TOKEN=${genMonitorToken}`,
        ].join("\n") + "\n";
    }
    fs.writeFileSync(targetEnv, finalizeEnv(content), "utf-8");
    ok(`Berkas ${targetEnv} berhasil dibuat dengan konfigurasi aman.`);
  }

  // 3. Menjalankan Docker PostgreSQL
  log("3. Menyalakan database PostgreSQL di Docker...");
  const composePath = path.join(REPO_ROOT, "compose.postgres.yaml");
  if (fs.existsSync(composePath)) {
    try {
      runCmd(
        `docker compose --env-file "${targetEnv}" -f "${composePath}" up -d`,
      );
      ok("Kontainer Docker PostgreSQL (noc-postgres) berhasil dinyalakan.");
    } catch (err) {
      warn(
        `Gagal menjalankan docker compose: ${err.message}. Pastikan Docker daemon aktif.`,
      );
    }
  }

  // Tunggu PostgreSQL siap menerima koneksi (pg_isready)
  log("Menunggu PostgreSQL siap menerima koneksi (pg_isready)...");
  let pgReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const out = execSync(
        'docker exec noc-postgres pg_isready -U starter -d starter 2>/dev/null || echo ""',
        { encoding: "utf-8" },
      );
      if (out.includes("accepting connections")) {
        pgReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (pgReady) {
    ok("PostgreSQL siap menerima koneksi.");
  } else {
    warn("PostgreSQL belum merespons; mencoba melanjutkan migrasi database...");
  }

  // 4. Pasang Systemd Units
  log("4. Memeriksa unit systemd untuk noc-web dan noc-backend...");
  const unitWebPath = path.join(REPO_ROOT, "systemd", "noc-web.service");
  const unitBackendPath = path.join(
    REPO_ROOT,
    "systemd",
    "noc-backend.service",
  );

  if (
    fs.existsSync("/etc/systemd/system/noc-web.service") &&
    fs.existsSync("/etc/systemd/system/noc-backend.service")
  ) {
    ok(
      "Unit systemd noc-web dan noc-backend sudah terpasang di /etc/systemd/system/.",
    );
    try {
      runCmd("sudo systemctl enable noc-web noc-backend", { silent: true });
    } catch {}
  } else if (fs.existsSync(unitWebPath) && fs.existsSync(unitBackendPath)) {
    try {
      runCmd(
        `sudo cp "${unitWebPath}" "${unitBackendPath}" /etc/systemd/system/`,
      );
      runCmd("sudo systemctl daemon-reload");
      runCmd("sudo systemctl enable noc-web noc-backend");
      ok(
        "Unit systemd noc-web dan noc-backend berhasil dipasang dan diaktifkan (enable).",
      );
    } catch (err) {
      warn(
        `Tidak dapat memasang unit systemd otomatis: ${err.message}. Jalankan perintah sudo manual.`,
      );
    }
  }

  // 5. Jalankan migrasi database awal
  log("5. Menjalankan migrasi database awal...");
  let dbUrl = "";
  if (fs.existsSync(targetEnv)) {
    const envText = fs.readFileSync(targetEnv, "utf-8");
    const match = envText.match(/^DATABASE_URL=(.+)$/m);
    if (match) dbUrl = match[1].trim().replace(/^["']|["']$/g, "");
  }
  try {
    runCmd("node scripts/migrate-server.mjs", {
      env: { ...process.env, ...(dbUrl ? { DATABASE_URL: dbUrl } : {}) },
    });
    ok("Migrasi database berhasil dieksekusi.");
  } catch (err) {
    fail(`Migrasi database gagal: ${err.message}.`);
    throw err;
  }

  // 6. Akun superadmin pertama, agar pemasang langsung bisa masuk (kata sandi acak dicetak sekali)
  log("6. Menyiapkan akun superadmin pertama...");
  try {
    runCmd("node scripts/create-superadmin.mjs", {
      env: { ...process.env, ...(dbUrl ? { DATABASE_URL: dbUrl } : {}) },
    });
  } catch (err) {
    warn(
      `Akun superadmin belum dibuat: ${err.message}. Jalankan manual: noc-system admin create`,
    );
  }

  console.log(
    `\n${ANSI.green}${ANSI.bold}Instalasi awal selesai!${ANSI.reset}`,
  );
  console.log(
    `Langkah berikutnya: Jalankan ${ANSI.cyan}noc-system deploy${ANSI.reset} untuk merilis versi terbaru.`,
  );
}

// -----------------------------------------------------------------------------
// 2. COMMAND: deploy
// -----------------------------------------------------------------------------
async function cmdDeploy(args = [], options = {}) {
  const isUpdate = options.isUpdate || args.includes("--pull");
  const filteredArgs = args.filter((a) => a !== "--pull");

  if (isUpdate) {
    log(
      `${ANSI.bold}Menjalankan pembaruan kode dari repositori git...${ANSI.reset}`,
    );
    try {
      // Jalan sebagai root (sudo) tapi repo milik user biasa: git harus memakai pemilik repo,
      // jika tidak berkas di .git (FETCH_HEAD, dll.) jadi milik root dan update berikutnya gagal.
      const st = fs.statSync(REPO_ROOT);
      const asOwner =
        process.getuid?.() === 0 && st.uid !== 0
          ? { uid: st.uid, gid: st.gid }
          : {};
      runCmd("git fetch --all --prune", { cwd: REPO_ROOT, ...asOwner });
      const targetRef = filteredArgs[0];
      if (targetRef && !targetRef.includes("+")) {
        log(`Berpindah ke ref/tag git: ${targetRef}...`);
        runCmd(`git checkout "${targetRef}"`, { cwd: REPO_ROOT, ...asOwner });
      } else {
        const curBranch =
          execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
            cwd: REPO_ROOT,
            encoding: "utf-8",
            ...asOwner,
          }).trim() || "noc-system-main";
        if (curBranch === "HEAD")
          throw new Error(
            "repositori ter-detach (bukan di cabang); jalankan: noc-system update <cabang-atau-tag>",
          );
        log(`Menyinkronkan branch ${curBranch} dengan origin...`);
        runCmd(`git reset --hard "origin/${curBranch}"`, {
          cwd: REPO_ROOT,
          ...asOwner,
        });
      }
      log("Memasang dependensi project terbaru (npm ci)...");
      log(
        "Mengunduh & mengekstrak dependensi (~500MB, butuh 1–3 menit). Harap tunggu...",
      );
      await runCmdWithHeartbeat(
        "npm ci --no-audit",
        "Pemasangan dependensi project (npm ci)",
        { cwd: REPO_ROOT },
      );
      ok("Kode sumber dan dependensi berhasil diperbarui dari git.");
      // Kode CLI baru sudah ada di disk, tapi proses ini masih memuat yang lama:
      // jalankan ulang sebagai `deploy` supaya build memakai kode yang baru ditarik.
      const rerun = spawnSync(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          "deploy",
          ...filteredArgs.filter((a) => a.startsWith("-")),
        ],
        { stdio: "inherit" },
      );
      process.exit(rerun.status ?? 1);
    } catch (err) {
      warn(
        `Gagal memperbarui dari git: ${err.message}. Melanjutkan rilis dengan kode lokal.`,
      );
    }
  }

  const explicitVersionArg = filteredArgs.find((a) => !a.startsWith("-"));
  const version = getNextDeployVersion(explicitVersionArg);
  log(`${ANSI.bold}Memulai Deployment Versi: ${version}${ANSI.reset}`);

  const lockFile = "/srv/noc/shared/.deploy-lock";
  const cleanupLock = () => {
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch {}
  };
  try {
    fs.writeFileSync(
      lockFile,
      JSON.stringify({
        pid: process.pid,
        command: `noc-system ${isUpdate ? "update" : "deploy"}`,
        version,
        startedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
  } catch {}
  process.once("exit", cleanupLock);
  process.once("SIGINT", () => {
    cleanupLock();
    process.exit(1);
  });
  process.once("SIGTERM", () => {
    cleanupLock();
    process.exit(1);
  });
  try {
    const releasePath = `/srv/noc/releases/${version}`;
    const currentLink = "/srv/noc/current";
    const rollbackTargetFile = "/srv/noc/shared/.rollback-target";

    // Langkah 1: Backup Database
    log("Langkah 1/6: Membuat cadangan (backup) database...");
    const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = `/srv/noc/backups/backup-${timestampStr}.sql.gz`;
    runCmd(`mkdir -p /srv/noc/backups`);

    let pgCid = "";
    let dockerErr = "";
    try {
      const lines = execSync(
        'docker ps --filter "name=noc-postgres" --format "{{.Names}}"',
        { encoding: "utf-8" },
      )
        .trim()
        .split("\n");
      pgCid = lines[0]?.trim();
      if (!pgCid) {
        const p5432 = execSync(
          'docker ps --filter "publish=5432" --format "{{.Names}}"',
          { encoding: "utf-8" },
        )
          .trim()
          .split("\n");
        pgCid = p5432[0]?.trim();
      }
    } catch (err) {
      dockerErr = err.message || "";
    }

    if (!pgCid) {
      if (
        dockerErr.includes("permission denied") ||
        dockerErr.includes("docker.sock")
      ) {
        fail(
          "Akses ke Docker ditolak (permission denied). Jalankan dengan 'sudo noc-system deploy' atau masukkan user ke grup docker: sudo usermod -aG docker $USER && newgrp docker",
        );
      } else {
        fail(
          "Kontainer Docker PostgreSQL (noc-postgres / port 5432) tidak ditemukan di server. Deployment dibatalkan.",
        );
      }
      process.exit(1);
    }

    let dbUser = "starter";
    let dbName = "starter";
    try {
      if (fs.existsSync("/srv/noc/shared/.env")) {
        const envContent = fs.readFileSync("/srv/noc/shared/.env", "utf-8");
        const match = envContent.match(/^DATABASE_URL=(.+)$/m);
        if (match) {
          const rawUrl = match[1].trim().replace(/^["']|["']$/g, "");
          const parsed = new URL(rawUrl);
          if (parsed.username) dbUser = parsed.username;
          if (parsed.pathname) dbName = parsed.pathname.replace(/^\//, "");
        }
      }
    } catch {}

    try {
      runCmd(
        `bash -c 'set -o pipefail && docker exec "${pgCid}" pg_dump -U "${dbUser}" -d "${dbName}" | gzip > "${backupFile}" && test -s "${backupFile}"'`,
      );
      ok(`Backup database tersimpan di: ${backupFile}`);
    } catch (err) {
      fail(
        `Backup database gagal: ${err.message}. Deployment dihentikan demi keamanan data.`,
      );
      process.exit(1);
    }

    // Langkah 2: Kompilasi Backend Go
    log("Langkah 2/6: Mengompilasi backend Go untuk server native...");
    log("Mengunduh toolchain/modul Go dan mengompilasi biner noc-backend...");
    log(
      "Proses ini membutuhkan waktu 1–2 menit (tampilan unduhan Go mungkin terhenti sejenak saat mengekstrak, harap tunggu)...",
    );
    const backendBinDir = path.join(REPO_ROOT, "backend", "bin");
    if (!fs.existsSync(backendBinDir))
      fs.mkdirSync(backendBinDir, { recursive: true });
    const backendBinPath = path.join(backendBinDir, "noc-backend");

    await runCmdWithHeartbeat(
      `go build -v -ldflags="-s -w" -o "${backendBinPath}" ./cmd/server`,
      "Kompilasi backend Go (noc-backend)",
      {
        cwd: path.join(REPO_ROOT, "backend"),
        env: {
          ...process.env,
          CGO_ENABLED: "0",
          GOOS: "linux",
          GOARCH: "amd64",
        },
      },
    );
    ok(`Backend Go terkompilasi: ${backendBinPath}`);

    // Langkah 3: Build Frontend Next.js Standalone
    log("Langkah 3/6: Membangun bundle Next.js Standalone (npm run build)...");
    log(
      "Tahap 'Creating an optimized production build...' membundel puluhan rute & TypeScript.",
    );
    log(
      "Layar akan diam selama 1–3 menit di VPS. Harap tunggu dan JANGAN tekan Ctrl+C...",
    );
    // NEXT_PUBLIC_* ditanam ke bundle klien saat build, jadi env server harus ikut
    // terbaca di sini. Placeholder hanya cadangan agar validasi env build lolos;
    // nilai nyata dibaca saat runtime dari /srv/noc/shared/.env.
    const sharedEnv = {};
    try {
      for (const line of fs
        .readFileSync("/srv/noc/shared/.env", "utf-8")
        .split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m && m[2].trim() !== "")
          sharedEnv[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      }
    } catch {}
    // RAM sempit (mis. 3 GB) + OSRM (~1 GB) membuat build berjam-jam karena swap thrash. OSRM hanya dipakai untuk
    // snap jalur kabel, jadi dihentikan selama build dan SELALU dinyalakan lagi (juga bila build gagal).
    const pausedAddons = [];
    try {
      const availMb = Math.round(
        Number(
          fs
            .readFileSync("/proc/meminfo", "utf-8")
            .match(/MemAvailable:\s+(\d+)\s+kB/)?.[1] ?? "0",
        ) / 1024,
      );
      if (availMb > 0 && availMb < 2500) {
        const running = execSync(
          'docker ps --filter "name=nocsystem-osrm" --format "{{.Names}}"',
          { encoding: "utf-8" },
        )
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const name of running) {
          warn(
            `RAM tersedia ${availMb} MB: ${name} dihentikan sementara selama build agar tidak swap thrash (dinyalakan lagi sesudahnya).`,
          );
          execSync(`docker stop ${name}`, { stdio: "ignore" });
          pausedAddons.push(name);
        }
      }
    } catch {}
    try {
      await runCmdWithHeartbeat(
        "npm run build",
        "Bundle Next.js Standalone (Turbopack)",
        {
          env: {
            DATABASE_URL: "postgresql://build:build@127.0.0.1:5432/build",
            BETTER_AUTH_SECRET:
              "placeholder-for-build-only-replaced-at-runtime",
            ...process.env,
            ...sharedEnv,
            NEXT_TELEMETRY_DISABLED: "1",
            // tsc di type check Next.js kena batas heap V8 bawaan (~1,8 GB) di server RAM kecil.
            NODE_OPTIONS:
              `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=3072`.trim(),
          },
        },
      );
    } finally {
      for (const name of pausedAddons) {
        try {
          execSync(`docker start ${name}`, { stdio: "ignore" });
        } catch {
          warn(`Gagal menyalakan ${name}; jalankan: docker start ${name}`);
        }
      }
    }
    ok("Bundle Next.js standalone berhasil dibuat.");

    // Langkah 4: Siapkan Direktori Rilis
    log(`Langkah 4/6: Menyiapkan direktori rilis di ${releasePath}...`);
    if (!fs.existsSync(releasePath))
      fs.mkdirSync(releasePath, { recursive: true });

    // Salin isi bundle Next.js. Akhiran "/." sengaja ditulis manual: path.join menghapusnya
    // sehingga cp menyalin folder `standalone` itu sendiri ke dalam rilis.
    runCmd(
      `cp -a "${path.join(REPO_ROOT, ".next", "standalone")}/." "${releasePath}/"`,
    );
    runCmd(
      `mkdir -p "${releasePath}/.next" && cp -r "${path.join(REPO_ROOT, ".next", "static")}" "${releasePath}/.next/"`,
    );
    const publicDir = path.join(REPO_ROOT, "public");
    if (fs.existsSync(publicDir)) {
      runCmd(`cp -r "${publicDir}" "${releasePath}/"`);
    }

    // Salin backend Go ke akar rilis (sesuai ExecStart di systemd/noc-backend.service)
    runCmd(`cp "${backendBinPath}" "${releasePath}/noc-backend"`);
    runCmd(`chmod +x "${releasePath}/noc-backend"`);

    // Salin skrip migrasi
    runCmd(
      `cp -r "${path.join(REPO_ROOT, "scripts")}" "${path.join(REPO_ROOT, "drizzle")}" "${path.join(REPO_ROOT, "package.json")}" "${releasePath}/"`,
    );
    // Hubungkan symlink .env dari shared
    runCmd(`ln -sfn /srv/noc/shared/.env "${releasePath}/.env"`);
    runCmd(
      `ln -sfn /srv/noc/shared/.env "${releasePath}/backend/.env" 2>/dev/null || true`,
    );
    ok(`Artefak rilis terpasang di ${releasePath}`);

    // Langkah 5: Migrasi Database
    log("Langkah 5/6: Menjalankan migrasi database skema baru...");
    try {
      // Dari REPO_ROOT, bukan folder rilis: bundle standalone tidak memuat paket `pg`.
      runCmd("node scripts/migrate-server.mjs", {
        env: {
          ...process.env,
          ...(sharedEnv.DATABASE_URL
            ? { DATABASE_URL: sharedEnv.DATABASE_URL }
            : {}),
          APP_VERSION: version,
        },
      });
      ok("Migrasi database berhasil dijalankan.");
    } catch (err) {
      fail(`Migrasi database gagal: ${err.message}`);
      throw err;
    }

    // Langkah 6: Swap Symlink & Restart Layanan
    log(
      "Langkah 6/6: Melakukan swap symlink dan me-restart layanan systemd...",
    );

    // Catat titik balik sebelum swap
    let oldVersion = null;
    if (fs.existsSync(currentLink)) {
      try {
        oldVersion = fs.readlinkSync(currentLink);
        fs.writeFileSync(rollbackTargetFile, oldVersion, "utf-8");
        log(`Titik balik rilis sebelumnya dicatat: ${oldVersion}`);
      } catch {}
    }

    // Tukar symlink secara atomik
    runCmd(`ln -sfn "${releasePath}" "${currentLink}"`);
    ok(`Symlink ${currentLink} -> ${releasePath}`);

    // Restart layanan systemd
    try {
      runCmd("sudo systemctl restart noc-web noc-backend");
      ok("Layanan noc-web dan noc-backend berhasil di-restart.");
    } catch (err) {
      fail(`Gagal me-restart systemctl: ${err.message}.`);
      if (oldVersion) {
        warn(`Memutar balik symlink ke versi sebelumnya: ${oldVersion}`);
        runCmd(`ln -sfn "${oldVersion}" "${currentLink}"`);
      }
      throw err;
    }

    // Health check pasca-swap (polling hingga 45 detik agar Next.js punya waktu cold-start)
    log(
      "Memverifikasi kesehatan layanan pasca-deploy (Health Check, polling hingga 45 detik)...",
    );
    let webOk = false;
    let backendOk = false;
    const maxAttempts = 15;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const webRes = execSync(
          "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || echo '000'",
          { encoding: "utf-8" },
        ).trim();
        webOk = webRes === "200";
      } catch {}

      try {
        const beRes = execSync(
          `curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${backendPort()}/healthz 2>/dev/null || echo '000'`,
          { encoding: "utf-8" },
        ).trim();
        backendOk = beRes === "200";
      } catch {}

      if (webOk && backendOk) {
        ok(
          `Layanan sehat dan merespons 200 OK (terkonfirmasi pada detik ke-${attempt * 3}).`,
        );
        break;
      }
      log(
        `Menunggu layanan aktif (percobaan ${attempt}/${maxAttempts}): web=${webOk ? "OK" : "pending"}, backend=${backendOk ? "OK" : "pending"}...`,
      );
    }

    if (webOk && backendOk) {
      recordDeploymentToDatabase(version, "deploy", "berhasil", oldVersion);
      updateServerStatusSnapshot(version, oldVersion, "berhasil");
      console.log(
        `\n${ANSI.green}${ANSI.bold}✓ DEPLOYMENT SUKSES! Versi ${version} aktif di SERVER NATIVE!${ANSI.reset}`,
      );
    } else {
      recordDeploymentToDatabase(version, "deploy", "gagal", oldVersion);
      updateServerStatusSnapshot(version, oldVersion, "gagal");
      fail(
        `Health check tidak sempurna: web=${webOk ? "OK" : "GAGAL"}, backend=${backendOk ? "OK" : "GAGAL"}`,
      );

      // Diagnostik Akar Masalah (Fail-Loudly)
      console.log(
        `\n${ANSI.yellow}${ANSI.bold}--- 30 Baris Terakhir Log noc-web ---${ANSI.reset}`,
      );
      try {
        const webLog = execSync(
          "journalctl -u noc-web -n 30 --no-pager 2>/dev/null",
          { encoding: "utf-8" },
        ).trim();
        console.log(webLog || "(tidak ada entri log)");
      } catch {}

      console.log(
        `\n${ANSI.yellow}${ANSI.bold}--- 30 Baris Terakhir Log noc-backend ---${ANSI.reset}`,
      );
      try {
        const beLog = execSync(
          "journalctl -u noc-backend -n 30 --no-pager 2>/dev/null",
          { encoding: "utf-8" },
        ).trim();
        console.log(beLog || "(tidak ada entri log)");
      } catch {}

      try {
        let oom = execSync(
          'dmesg -T 2>/dev/null | grep -iE "oom[- ]killer|out of memory" | tail -n 5 2>/dev/null || echo ""',
          { encoding: "utf-8" },
        ).trim();
        if (!oom) {
          oom = execSync(
            'journalctl -k -n 50 --no-pager 2>/dev/null | grep -iE "oom[- ]killer|out of memory" | tail -n 5 2>/dev/null || echo ""',
            { encoding: "utf-8" },
          ).trim();
        }
        if (oom) {
          console.log(
            `\n${ANSI.red}${ANSI.bold}⚠ PERINGATAN KRITIS: Terdeteksi Linux OOM Killer!${ANSI.reset}`,
          );
          console.log(`${ANSI.red}${oom}${ANSI.reset}`);
          console.log(
            `${ANSI.yellow}Penyebab: Server kehabisan RAM. Pastikan swapfile minimal 2GB aktif: sudo swapon --show${ANSI.reset}`,
          );
        }
      } catch {}

      try {
        const portConflict = execSync(
          "ss -tulpn 2>/dev/null | grep -E ':3000|:8080|:5432' 2>/dev/null || netstat -tlpn 2>/dev/null | grep -E ':3000|:8080|:5432' || echo ''",
          { encoding: "utf-8" },
        ).trim();
        if (portConflict) {
          console.log(
            `\n${ANSI.cyan}${ANSI.bold}--- Status Penggunaan Port (3000, 8080, 5432) ---${ANSI.reset}`,
          );
          console.log(portConflict);
        }
      } catch {}

      console.log(
        `\n${ANSI.cyan}${ANSI.bold}Langkah Pemulihan Mandiri Operator:${ANSI.reset}`,
      );
      console.log(`  1. Periksa log detail : noc-system logs`);
      console.log(`  2. Periksa kesiapan   : noc-system doctor`);
      console.log(
        `  3. Cek database docker: docker ps --filter "name=noc-postgres"`,
      );
      console.log(
        `  4. Uji jalan manual   : cd /srv/noc/current && node server.js\n`,
      );

      if (oldVersion) {
        warn(`Memicu rollback otomatis ke: ${oldVersion}`);
        runCmd(`ln -sfn "${oldVersion}" "${currentLink}"`);
        try {
          runCmd("sudo systemctl restart noc-web noc-backend");
          warn("Rollback selesai.");
        } catch {}
      }
      process.exit(1);
    }
  } finally {
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch {}
  }
}

// -----------------------------------------------------------------------------
// 3. COMMAND: rollback
// -----------------------------------------------------------------------------
async function cmdRollback() {
  const currentLink = "/srv/noc/current";
  const rollbackTargetFile = "/srv/noc/shared/.rollback-target";

  if (!fs.existsSync(rollbackTargetFile)) {
    fail(
      `Berkas ${rollbackTargetFile} tidak ditemukan. Tidak ada titik balik rollback yang tercatat.`,
    );
    process.exit(1);
  }

  const targetRelease = fs.readFileSync(rollbackTargetFile, "utf-8").trim();
  if (!fs.existsSync(targetRelease)) {
    fail(`Direktori target rollback tidak ditemukan: ${targetRelease}`);
    process.exit(1);
  }

  log(`Memulai Rollback ke versi: ${targetRelease}...`);
  runCmd(`ln -sfn "${targetRelease}" "${currentLink}"`);
  ok(`Symlink ${currentLink} diarahkan kembali ke ${targetRelease}`);

  try {
    runCmd("sudo systemctl restart noc-web noc-backend");
    ok("Layanan systemd noc-web dan noc-backend berhasil di-restart.");
    recordDeploymentToDatabase(targetRelease, "rollback", "berhasil", null);
    updateServerStatusSnapshot(targetRelease, null, "rollback");
  } catch (err) {
    warn(`Gagal me-restart layanan: ${err.message}`);
  }
  console.log(
    `\n${ANSI.green}${ANSI.bold}✓ ROLLBACK BERHASIL! Versi aktif sekarang: ${targetRelease}${ANSI.reset}`,
  );
}

// -----------------------------------------------------------------------------
// 4. COMMAND: status
// -----------------------------------------------------------------------------
async function cmdStatus() {
  console.log(
    `\n${ANSI.bold}=== NOC SYSTEM - STATUS SERVER NATIVE ===${ANSI.reset}`,
  );

  // 1. Versi Rilis
  const currentLink = "/srv/noc/current";
  if (fs.existsSync(currentLink)) {
    try {
      const activePath = fs.realpathSync(currentLink);
      ok(`Versi Aktif: ${path.basename(activePath)} (${activePath})`);
    } catch {
      warn(`Symlink ${currentLink} putus.`);
    }
  } else {
    warn(`Symlink ${currentLink} belum dibuat (belum pernah deploy).`);
  }

  // 2. Unit Systemd
  try {
    const webStatus = execSync(
      "systemctl is-active noc-web 2>/dev/null || echo 'inactive'",
      { encoding: "utf-8" },
    ).trim();
    const beStatus = execSync(
      "systemctl is-active noc-backend 2>/dev/null || echo 'inactive'",
      { encoding: "utf-8" },
    ).trim();
    console.log(
      `- noc-web service:     ${webStatus === "active" ? ANSI.green + "ACTIVE" : ANSI.red + webStatus.toUpperCase()}${ANSI.reset}`,
    );
    console.log(
      `- noc-backend service: ${beStatus === "active" ? ANSI.green + "ACTIVE" : ANSI.red + beStatus.toUpperCase()}${ANSI.reset}`,
    );
  } catch {
    console.log("- Status systemd: Tidak dapat membaca (perlu izin systemctl)");
  }

  // 3. Kontainer Docker PostgreSQL
  try {
    const pgPs = execSync(
      "docker ps --filter 'name=noc-postgres' --format '{{.Names}} ({{.Status}})'",
      { encoding: "utf-8" },
    ).trim();
    if (pgPs) {
      ok(`Docker PostgreSQL: ${pgPs}`);
    } else {
      warn("Docker PostgreSQL: Kontainer 'noc-postgres' tidak berjalan.");
    }
  } catch {
    warn("Docker PostgreSQL: Tidak dapat membaca docker daemon.");
  }

  // 4. Endpoint Health
  try {
    const webRes = execSync(
      "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health",
      { encoding: "utf-8" },
    ).trim();
    const beRes = execSync(
      `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${backendPort()}/healthz`,
      { encoding: "utf-8" },
    ).trim();
    console.log(
      `- Web Health (:3000):     ${webRes === "200" ? ANSI.green + "200 OK" : ANSI.red + webRes}${ANSI.reset}`,
    );
    console.log(
      `- Backend Health (:${backendPort()}): ${beRes === "200" ? ANSI.green + "200 OK" : ANSI.red + beRes}${ANSI.reset}`,
    );
  } catch {}

  // 5. Info Pemantau (Dashboard /app/deploy)
  const sharedEnvPath = "/srv/noc/shared/.env";
  if (fs.existsSync(sharedEnvPath)) {
    try {
      const envText = fs.readFileSync(sharedEnvPath, "utf-8");
      const tokenMatch = envText.match(/^MONITOR_TOKEN=(.+)$/m);
      if (tokenMatch) {
        console.log(
          `- Token Monitor:          ${ANSI.cyan}${tokenMatch[1].trim()}${ANSI.reset}`,
        );
      }
    } catch {}
  }

  console.log("=========================================\n");
}

// -----------------------------------------------------------------------------
// 5. COMMAND: logs
// -----------------------------------------------------------------------------
function cmdLogs(args = []) {
  const service = args.includes("--web")
    ? "noc-web"
    : args.includes("--backend")
      ? "noc-backend"
      : null;
  const unitArgs = service ? `-u ${service}` : "-u noc-web -u noc-backend";
  const lines = args.find((a) => a.startsWith("-n")) || "-n 50";

  console.log(
    `${ANSI.cyan}Menampilkan log jurnal (${unitArgs} ${lines})... Tekan Ctrl+C untuk keluar.${ANSI.reset}`,
  );
  spawn(`journalctl ${unitArgs} ${lines} -f`, {
    shell: true,
    stdio: "inherit",
  });
}

// -----------------------------------------------------------------------------
// 6. COMMAND: upgrade
// -----------------------------------------------------------------------------
async function cmdUpgrade() {
  const pkgPath = path.join(REPO_ROOT, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fail(`Berkas package.json tidak ditemukan di ${REPO_ROOT}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(raw);
  const currentVersion = pkg.version || "1.0.0.0";
  const newVersion = bumpMinorVersion(currentVersion);

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

  ok(
    `Versi aplikasi di-upgrade menjadi: ${newVersion} (dari ${currentVersion})`,
  );
  console.log(`\n${ANSI.bold}Langkah selanjutnya sebelum deploy:${ANSI.reset}`);
  console.log(
    `  1. Commit perubahan:   ${ANSI.cyan}git commit -am "chore: upgrade to v${newVersion}"${ANSI.reset}`,
  );
  console.log(
    `  2. Push ke GitHub:     ${ANSI.cyan}git push origin noc-system-main${ANSI.reset}`,
  );
  console.log(
    `  3. Update di server:   ${ANSI.cyan}noc-system update${ANSI.reset}\n`,
  );
}

// -----------------------------------------------------------------------------
// 7. COMMAND: version
// -----------------------------------------------------------------------------
async function cmdVersion() {
  console.log(
    `\n${ANSI.bold}=== NOC SYSTEM - INFORMASI VERSI ===${ANSI.reset}`,
  );

  let localVersion = "1.0.0.0";
  try {
    const pkgPath = path.join(REPO_ROOT, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.version) localVersion = pkg.version;
    }
  } catch {}

  console.log(
    `- Versi lokal (package.json):  ${ANSI.cyan}${localVersion}${ANSI.reset}`,
  );

  const currentLink = "/srv/noc/current";
  let activeVersion = null;
  if (fs.existsSync(currentLink)) {
    try {
      const target = fs.realpathSync(currentLink);
      activeVersion = path.basename(target);
    } catch {}
  }

  if (activeVersion) {
    console.log(
      `- Versi server aktif (/srv/noc/current): ${ANSI.green}${activeVersion}${ANSI.reset}`,
    );
  } else {
    console.log(
      `- Versi server aktif (/srv/noc/current): ${ANSI.gray}(belum terpasang / bukan server native)${ANSI.reset}`,
    );
  }

  try {
    const statusFile = "/srv/noc/shared/server-status.json";
    if (fs.existsSync(statusFile)) {
      const statusData = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
      if (statusData.version) {
        console.log(
          `- Snapshot server-status.json: ${statusData.version} (status: ${statusData.status || "unknown"})`,
        );
      }
    }
  } catch {}
  console.log();
}
// -----------------------------------------------------------------------------
// 8. COMMAND: doctor
// -----------------------------------------------------------------------------
async function cmdDoctor() {
  console.log(
    `\n${ANSI.bold}${ANSI.cyan}==========================================================${ANSI.reset}`,
  );
  console.log(
    `${ANSI.bold}${ANSI.cyan}       NOC SYSTEM - PRE-FLIGHT SERVER DOCTOR & SPECS      ${ANSI.reset}`,
  );
  console.log(
    `${ANSI.bold}${ANSI.cyan}==========================================================${ANSI.reset}\n`,
  );

  let passes = 0;
  let warnings = 0;
  let failures = 0;

  function report(label, status, detail) {
    if (status === "PASS") {
      passes++;
      console.log(
        `  ${ANSI.green}✓ [PASS]${ANSI.reset} ${ANSI.bold}${label}:${ANSI.reset} ${detail}`,
      );
    } else if (status === "WARN") {
      warnings++;
      console.log(
        `  ${ANSI.yellow}⚠ [WARN]${ANSI.reset} ${ANSI.bold}${label}:${ANSI.reset} ${detail}`,
      );
    } else {
      failures++;
      console.log(
        `  ${ANSI.red}✗ [FAIL]${ANSI.reset} ${ANSI.bold}${label}:${ANSI.reset} ${detail}`,
      );
    }
  }

  // 1. Sistem Operasi & Distribusi
  const isLinux = process.platform === "linux";
  let osName = `${process.platform} (${process.arch})`;
  if (fs.existsSync("/etc/os-release")) {
    try {
      const match = fs
        .readFileSync("/etc/os-release", "utf-8")
        .match(/PRETTY_NAME="?([^"\n]+)"?/);
      if (match?.[1]) osName = `${match[1]} (${process.arch})`;
    } catch {}
  }
  if (isLinux) {
    report("Sistem Operasi", "PASS", osName);
  } else {
    report(
      "Sistem Operasi",
      "WARN",
      `${osName} (Produksi native disarankan di Ubuntu 20.04/22.04/24.04 LTS)`,
    );
  }

  // 2. CPU Cores & Load
  const cpus = os.cpus();
  const cpuCount = cpus.length;
  if (cpuCount >= 2) {
    report(
      "CPU Cores",
      "PASS",
      `${cpuCount} Cores (${cpus[0]?.model || "Standard"})`,
    );
  } else {
    report(
      "CPU Cores",
      "WARN",
      `${cpuCount} Core (Minimal 2 Cores direkomendasikan agar Next.js dan Go kompilasi tidak lemot)`,
    );
  }

  // 3. RAM & Swap
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  let swapTotalMb = 0;
  let swapFreeMb = 0;
  if (fs.existsSync("/proc/meminfo")) {
    try {
      const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
      const matchTotal = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/i);
      const matchFree = meminfo.match(/SwapFree:\s+(\d+)\s+kB/i);
      if (matchTotal?.[1])
        swapTotalMb = Math.round(Number.parseInt(matchTotal[1], 10) / 1024);
      if (matchFree?.[1])
        swapFreeMb = Math.round(Number.parseInt(matchFree[1], 10) / 1024);
    } catch {}
  }

  if (totalMemMb >= 2048) {
    report(
      "Memori RAM",
      "PASS",
      `${(totalMemMb / 1024).toFixed(1)} GB Total (Bebas: ${freeMemMb} MB)`,
    );
  } else if (totalMemMb + swapTotalMb >= 2048) {
    report(
      "Memori RAM",
      "WARN",
      `${(totalMemMb / 1024).toFixed(1)} GB Total (Terbantu Swap: ${(swapTotalMb / 1024).toFixed(1)} GB)`,
    );
  } else {
    report(
      "Memori RAM",
      "FAIL",
      `${totalMemMb} MB Total tanpa swap memadai! Wajib aktifkan swap minimal 2GB.`,
    );
  }

  if (swapTotalMb >= 1024) {
    report(
      "Swap Memori",
      "PASS",
      `${(swapTotalMb / 1024).toFixed(1)} GB Total (Bebas: ${swapFreeMb} MB) - Bebas dari OOM Killer`,
    );
  } else if (swapTotalMb > 0) {
    report(
      "Swap Memori",
      "WARN",
      `${swapTotalMb} MB (Direkomendasikan minimal 2048 MB swapfile)`,
    );
  } else {
    report(
      "Swap Memori",
      "WARN",
      "Tidak aktif! Disarankan mengaktifkan swapfile: sudo fallocate -l 2G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile",
    );
  }

  // 3b. AVX: MongoDB >= 5.0 (GenieACS bawaan mongo:6.0) mati dengan SIGILL tanpa AVX
  try {
    if (process.platform === "linux") {
      const hasAvx = /\bavx\b/.test(fs.readFileSync("/proc/cpuinfo", "utf-8"));
      report(
        "CPU AVX",
        hasAvx ? "PASS" : "WARN",
        hasAvx
          ? "Tersedia (MongoDB 6.0 untuk GenieACS aman)"
          : "Tidak ada: GenieACS otomatis memakai mongo:4.4 (features up genieacs)",
      );
    }
  } catch {}

  // 4. Ruang Disk
  try {
    const targetDir = fs.existsSync("/srv/noc")
      ? "/srv/noc"
      : process.platform === "win32"
        ? "C:\\"
        : "/";
    const stat = fs.statfsSync(targetDir);
    const totalMb = Math.round((stat.blocks * stat.bsize) / 1024 / 1024);
    const freeMb = Math.round((stat.bavail * stat.bsize) / 1024 / 1024);
    if (freeMb >= 5120) {
      report(
        "Ruang Disk",
        "PASS",
        `${(freeMb / 1024).toFixed(1)} GB Bebas dari ${(totalMb / 1024).toFixed(1)} GB Total (${targetDir})`,
      );
    } else if (freeMb >= 2048) {
      report(
        "Ruang Disk",
        "WARN",
        `${(freeMb / 1024).toFixed(1)} GB Bebas tersisa dari ${(totalMb / 1024).toFixed(1)} GB (Direkomendasikan minimal 5 GB)`,
      );
    } else {
      report(
        "Ruang Disk",
        "FAIL",
        `Hanya tersisa ${freeMb} MB dari ${(totalMb / 1024).toFixed(1)} GB! Risiko gagal build/deploy sangat tinggi.`,
      );
    }
  } catch {
    report("Ruang Disk", "PASS", "Pemeriksaan disk dilewati (izin terbatas)");
  }

  // 5. Node.js & Go Runtime
  const nodeVer = process.version;
  const majorNode = Number.parseInt(
    nodeVer.replace(/^v/, "").split(".")[0],
    10,
  );
  if (majorNode >= 22) {
    report("Node.js Runtime", "PASS", `${nodeVer} (LTS Kompatibel)`);
  } else {
    report("Node.js Runtime", "FAIL", `${nodeVer} (Wajib Node.js >= 22.12.0)`);
  }

  try {
    const goVer = execSync("go version 2>/dev/null", {
      encoding: "utf-8",
    }).trim();
    report("Go Compiler", "PASS", goVer);
  } catch {
    report(
      "Go Compiler",
      "WARN",
      "Biner 'go' tidak ditemukan di PATH. Backend Go membutuhkan Go 1.25+ untuk kompilasi",
    );
  }

  // 6. Docker Daemon
  try {
    const dVer = execSync("docker --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    execSync("docker ps", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    report("Docker Daemon", "PASS", `${dVer} (Akses daemon aktif)`);
  } catch (err) {
    const errMsg = `${err.stderr || ""} ${err.stdout || ""} ${err.message || ""}`;
    if (
      errMsg.includes("permission denied") ||
      errMsg.includes("docker.sock")
    ) {
      report(
        "Docker Daemon",
        "FAIL",
        "Izin socket Docker ditolak! Jalankan: sudo usermod -aG docker $USER && newgrp docker",
      );
    } else {
      report(
        "Docker Daemon",
        "WARN",
        `Docker tidak ditemukan atau daemon tidak aktif: ${errMsg.trim().split("\n")[0]}`,
      );
    }
  }

  // 7. Status Port Penting
  const portsToCheck = [
    { port: 3000, name: "Web Dashboard (Next.js)" },
    { port: 8080, name: "Backend Core (Go)" },
    { port: 5432, name: "PostgreSQL Database" },
  ];
  for (const p of portsToCheck) {
    try {
      const portOut = execSync(
        `ss -tlpn 'sport = :${p.port}' 2>/dev/null || netstat -tlpn 2>/dev/null | grep ':${p.port} ' || echo ''`,
        { encoding: "utf-8" },
      ).trim();
      const hasPort = portOut.split("\n").some((l) => l.includes(`:${p.port}`));
      if (hasPort) {
        report(`Port ${p.port}`, "PASS", `Aktif digunakan oleh: ${p.name}`);
      } else {
        report(`Port ${p.port}`, "PASS", `Port bebas (Siap untuk ${p.name})`);
      }
    } catch {
      report(`Port ${p.port}`, "PASS", `Status port siap`);
    }
  }
  // 8. Konektivitas Internet
  try {
    execSync("curl -s -m 3 -o /dev/null https://github.com", {
      encoding: "utf-8",
    });
    report("Koneksi GitHub", "PASS", "Terhubung (200 OK)");
  } catch {
    report(
      "Koneksi GitHub",
      "WARN",
      "Gagal menghubungi github.com dalam 3 detik",
    );
  }
  try {
    execSync("curl -s -m 3 -o /dev/null https://registry.npmjs.org", {
      encoding: "utf-8",
    });
    report("Koneksi Registry NPM", "PASS", "Terhubung (200 OK)");
  } catch {
    report(
      "Koneksi Registry NPM",
      "WARN",
      "Gagal menghubungi registry.npmjs.org",
    );
  }

  console.log(
    `\n${ANSI.bold}Ringkasan Kesiapan:${ANSI.reset} ${passes} Lulus, ${warnings} Catatan, ${failures} Masalah Kritis.`,
  );
  if (failures > 0) {
    console.log(
      `${ANSI.red}${ANSI.bold}Harap atasi kendala kritis di atas sebelum menjalankan 'noc-system deploy'.${ANSI.reset}\n`,
    );
  } else {
    console.log(
      `${ANSI.green}${ANSI.bold}Server siap untuk instalasi dan deployment NOC SYSTEM!${ANSI.reset}\n`,
    );
  }
}

// -----------------------------------------------------------------------------
// 9. COMMAND: features
// -----------------------------------------------------------------------------
async function cmdFeatures(args = []) {
  console.log(
    `\n${ANSI.bold}${ANSI.cyan}==========================================================${ANSI.reset}`,
  );
  console.log(
    `${ANSI.bold}${ANSI.cyan}        NOC SYSTEM - FEATURE STACK & COMPOSER MATRIX      ${ANSI.reset}`,
  );
  console.log(
    `${ANSI.bold}${ANSI.cyan}==========================================================${ANSI.reset}\n`,
  );

  const features = [
    {
      id: "web",
      name: "Core Web Dashboard",
      tech: "Next.js 16 (App Router / Turbopack)",
      port: "3000 (TCP)",
      check: "systemctl is-active noc-web 2>/dev/null",
      compose: "systemd: sudo systemctl start/restart noc-web",
      logs: "journalctl -u noc-web -f -n 50",
      url: "http://{host}:3000",
    },
    {
      id: "backend",
      name: "Core Backend Engine",
      tech: "Go 1.25 (Concurrent Poller & REST)",
      port: "8080 (TCP)",
      check: "systemctl is-active noc-backend 2>/dev/null",
      compose: "systemd: sudo systemctl start/restart noc-backend",
      logs: "journalctl -u noc-backend -f -n 50",
    },
    {
      id: "postgres",
      name: "Database PostgreSQL 17",
      tech: "Docker (postgres:17-alpine / noc-postgres)",
      port: "5432 (TCP)",
      check:
        'docker ps --filter "name=noc-postgres" --format "{{.Status}}" 2>/dev/null',
      compose:
        "docker compose --env-file /srv/noc/shared/.env -f compose.postgres.yaml up -d",
      logs: "docker logs -f noc-postgres --tail 50",
    },
    {
      id: "genieacs",
      name: "GenieACS TR-069 CPE Provisioning",
      tech: "Docker (NBI, CWMP, FS, UI)",
      port: "7547 (CWMP), 7557 (NBI), 7558 (UI)",
      check:
        'docker ps --filter "name=genieacs" --format "{{.Status}}" 2>/dev/null',
      compose:
        "docker network create nocsystem_default 2>/dev/null || true && docker compose -f compose.genieacs.yaml up -d",
      logs: "docker compose -f compose.genieacs.yaml logs -f --tail 50",
      url: "http://{host}:7558 (UI GenieACS)",
    },
    {
      id: "osrm",
      name: "OSRM Road Snap & Fiber Routing",
      tech: "Docker (OSRM Backend Engine)",
      port: "5000 (TCP)",
      check:
        'docker ps --filter "name=osrm" --format "{{.Status}}" 2>/dev/null',
      compose:
        "docker network create nocsystem_default 2>/dev/null || true && npm run osrm:download && npm run osrm:prepare && docker compose -f compose.osrm.yaml up -d osrm",
      logs: "docker compose -f compose.osrm.yaml logs -f --tail 50 osrm",
    },
    {
      id: "9router",
      name: "9router Decolua AI Proxy & Lab",
      tech: "Docker (Decolua 9router AI /v1 Proxy & UI)",
      port: "20128 (TCP)",
      check:
        'docker ps --filter "name=9router" --format "{{.Status}}" 2>/dev/null',
      compose:
        "docker network create nocsystem_default 2>/dev/null || true && docker compose -f compose.9router.yaml up -d",
      logs: "docker compose -f compose.9router.yaml logs -f --tail 50",
      url: "http://{host}:20128 (9router UI & /v1 proxy)",
    },
    {
      id: "logto",
      name: "Logto SSO (login GitHub/Google)",
      tech: "Docker (Logto Core + Postgres)",
      port: "3301 (OIDC), 3002 (Admin Console) - bind 127.0.0.1",
      check:
        'docker ps --filter "name=nocsystem-logto" --format "{{.Status}}" 2>/dev/null',
      compose:
        "docker network create nocsystem_default 2>/dev/null || true && docker compose -f compose.logto.yaml up -d",
      logs: "docker compose -f compose.logto.yaml logs -f --tail 50",
      url: "http://localhost:3002 (Admin Console, akses via SSH tunnel: ssh -L 3002:127.0.0.1:3002 user@{host})",
    },
    {
      id: "netflow",
      name: "NetFlow Traffic Collector",
      tech: "Go Engine Subsystem (IPFIX)",
      port: "2055 (UDP)",
      check: "systemctl is-active noc-backend 2>/dev/null",
      compose: "systemd noc-backend: otomatis aktif",
      logs: "journalctl -u noc-backend | grep -i netflow",
    },
  ];

  const ENV_FILE = "/srv/noc/shared/.env";
  const envHost = (() => {
    try {
      const url =
        process.env.NOC_PUBLIC_URL ||
        fs
          .readFileSync(ENV_FILE, "utf-8")
          .match(/^BETTER_AUTH_URL=(.+)$/m)?.[1];
      return url
        ? new URL(url.trim().replace(/^["']|["']$/g, "")).hostname
        : "";
    } catch {
      return "";
    }
  })();
  const host =
    process.env.NOC_HOST ||
    envHost ||
    Object.entries(os.networkInterfaces())
      .filter(([name]) => !/^(docker|br-|veth|tailscale|wg|virbr)/.test(name))
      .flatMap(([, list]) => list)
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address ||
    "localhost";

  // Langkah pasang per fitur: `noc-system features up <id|all>` (hanya fitur Docker).
  if (args[0] === "up") {
    const addons = ["logto", "genieacs", "osrm", "9router"];
    const targets = args[1] === "all" ? addons : [args[1]];
    const failed = [];
    for (const id of targets) {
      const f = features.find(
        (x) => x.id === id && !x.compose.startsWith("systemd"),
      );
      if (!f) {
        fail(
          `Fitur '${id}' tidak bisa dipasang lewat 'up'. Pilihan: ${addons.join(", ")}, all`,
        );
        process.exit(1);
      }
      console.log(
        `\n${ANSI.bold}${ANSI.cyan}>>> Memasang ${f.name}${ANSI.reset}`,
      );
      try {
        if (
          id === "genieacs" &&
          fs.existsSync(ENV_FILE) &&
          !/^GENIEACS_JWT_SECRET=\S+/m.test(fs.readFileSync(ENV_FILE, "utf-8"))
        ) {
          // compose.genieacs.yaml menolak start tanpa rahasia ini dan installer tidak membuatnya.
          fs.appendFileSync(
            ENV_FILE,
            `\nGENIEACS_JWT_SECRET=${crypto.randomBytes(32).toString("hex")}\n`,
          );
          ok(`GENIEACS_JWT_SECRET dibuat di ${ENV_FILE}`);
        }
        if (
          id === "genieacs" &&
          fs.existsSync(ENV_FILE) &&
          !/^GENIEACS_MONGO_IMAGE=\S+/m.test(fs.readFileSync(ENV_FILE, "utf-8"))
        ) {
          let hasAvx = true;
          try {
            hasAvx = /\bavx\b/.test(fs.readFileSync("/proc/cpuinfo", "utf-8"));
          } catch {}
          if (!hasAvx) {
            fs.appendFileSync(ENV_FILE, "\nGENIEACS_MONGO_IMAGE=mongo:4.4\n");
            warn(
              "CPU tanpa AVX: GenieACS memakai mongo:4.4 (MongoDB >= 5.0 tidak bisa jalan di CPU ini).",
            );
          }
        }
        const envFlag = fs.existsSync(ENV_FILE)
          ? `--env-file ${ENV_FILE} `
          : "";
        let cmd = f.compose.replaceAll(
          "docker compose -f",
          `docker compose ${envFlag}-f`,
        );
        if (id === "osrm") {
          // Wilayah lewat NOC_OSRM_REGION (nama Geofabrik Indonesia); unduh/olah hanya sekali per wilayah.
          const region = process.env.NOC_OSRM_REGION || "sumatra";
          if (
            !/^(sumatra|java|kalimantan|sulawesi|maluku|nusa-tenggara|papua)$/.test(
              region,
            )
          ) {
            throw new Error(
              `NOC_OSRM_REGION '${region}' tidak dikenal (sumatra|java|kalimantan|sulawesi|maluku|nusa-tenggara|papua)`,
            );
          }
          const dataDir = path.join(REPO_ROOT, "docker", "osrm", "data");
          const has = (part) =>
            fs.existsSync(dataDir) &&
            fs
              .readdirSync(dataDir)
              .some(
                (n) => n.startsWith(`${region}-latest`) && n.includes(part),
              );
          const compose = `OSRM_REGION=${region} docker compose ${envFlag}-f compose.osrm.yaml`;
          const steps = [
            "docker network create nocsystem_default 2>/dev/null || true",
          ];
          if (!has(".osrm")) {
            if (!has(".osm.pbf")) {
              steps.push(
                `curl -fL --create-dirs -o docker/osrm/data/${region}-latest.osm.pbf https://download.geofabrik.de/asia/indonesia/${region}-latest.osm.pbf`,
              );
            }
            steps.push(`${compose} run --rm osrm-prepare`);
          }
          steps.push(`${compose} up -d osrm`);
          cmd = steps.join(" && ");
          console.log(`Wilayah OSRM: ${region}`);
        }
        runCmd(cmd);
        let up = false;
        for (let i = 0; i < 10 && !up; i++) {
          try {
            // Semua kontainer fitur harus "Up": filter name=genieacs juga memuat mongo yang bisa crash-loop.
            const states = execSync(f.check, { encoding: "utf-8" })
              .trim()
              .split("\n")
              .filter(Boolean);
            up = states.length > 0 && states.every((l) => l.startsWith("Up"));
          } catch {}
          if (!up) execSync("sleep 3");
        }
        if (!up)
          throw new Error(
            "kontainer tidak berstatus Up setelah 30 detik; cek: " + f.logs,
          );
        if (id === "genieacs") {
          // Pasang provision/preset/virtual parameter dari repo (idempoten); NBI butuh beberapa detik.
          let applied = false;
          for (let i = 0; i < 6 && !applied; i++) {
            try {
              runCmd("node scripts/genieacs-apply-config.mjs");
              applied = true;
            } catch {
              execSync("sleep 5");
            }
          }
          if (!applied)
            warn(
              "Konfigurasi GenieACS belum terpasang; ulangi nanti: npm run genieacs:config",
            );
        }
        ok(
          `${f.name} aktif. Tautan: ${f.url ? f.url.replace("{host}", host) : f.port}`,
        );
        if (id === "logto") {
          console.log(`${ANSI.bold}Langkah Logto selanjutnya:${ANSI.reset}
  1. Admin Console hanya di loopback: ssh -L 3002:127.0.0.1:3002 user@${host}, buka http://localhost:3002
  2. Buat aplikasi Traditional Web + konektor GitHub; daftarkan redirect ${envHost ? "https://" + envHost : "<URL-APP>"}/api/auth/callback/logto-github (tanpa spasi di akhir)
  3. Di ${ENV_FILE}: LOGTO_ENDPOINT=<URL publik Logto lewat reverse proxy ke 127.0.0.1:3301>, LOGTO_INTERNAL_ENDPOINT=http://127.0.0.1:3301, LOGTO_CLIENT_ID, LOGTO_CLIENT_SECRET
  4. sudo systemctl restart noc-web`);
        }
      } catch (err) {
        fail(`${f.name} gagal: ${err.message}`);
        failed.push(id);
      }
    }
    if (failed.length) process.exit(1);
    return;
  }

  for (const f of features) {
    let isActive = false;
    try {
      const out = execSync(f.check, { encoding: "utf-8" }).trim();
      isActive = out === "active" || out.includes("Up");
    } catch {}

    const statusBadge = isActive
      ? `${ANSI.green}${ANSI.bold}[ONLINE / ACTIVE]${ANSI.reset}`
      : `${ANSI.gray}[INACTIVE / OFF]${ANSI.reset}`;

    console.log(`${ANSI.bold}• ${f.name}${ANSI.reset} - ${statusBadge}`);
    console.log(`  Teknologi      : ${f.tech} • Port: ${f.port}`);
    if (f.url)
      console.log(
        `  Tautan         : ${ANSI.cyan}${f.url.replace("{host}", host)}${ANSI.reset}`,
      );
    console.log(`  Perintah Up    : ${ANSI.cyan}${f.compose}${ANSI.reset}`);
    console.log(`  Perintah Logs  : ${ANSI.cyan}${f.logs}${ANSI.reset}\n`);
  }
  console.log(
    `Pasang per fitur: ${ANSI.cyan}noc-system features up <logto|genieacs|osrm|9router|all>${ANSI.reset}\n`,
  );
}

// -----------------------------------------------------------------------------
// MAIN ENTRYPOINT
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
// Pindah data antar server. Sengaja terpisah dari `install`/`deploy`, yang hanya
// membuat skema kosong: data pelanggan tidak ikut ke server lain tanpa perintah ini.
function dataDbTarget() {
  const q = (filter) =>
    execSync(`docker ps ${filter} --format "{{.Names}}"`, { encoding: "utf-8" })
      .trim()
      .split("\n")[0]
      ?.trim();
  const cid = q('--filter "name=noc-postgres"') || q('--filter "publish=5432"');
  if (!cid)
    throw new Error(
      "Kontainer PostgreSQL (noc-postgres / port 5432) tidak ditemukan atau akses Docker ditolak (coba sudo).",
    );
  let user = "starter",
    db = "starter",
    url = "";
  try {
    const m = fs
      .readFileSync("/srv/noc/shared/.env", "utf-8")
      .match(/^DATABASE_URL=(.+)$/m);
    if (m) {
      url = m[1].trim().replace(/^["']|["']$/g, "");
      const u = new URL(url);
      if (u.username) user = decodeURIComponent(u.username);
      if (u.pathname.length > 1) db = u.pathname.slice(1);
    }
  } catch {}
  return { cid, user, db, url };
}

// Tanpa shell (bash/gzip): berjalan sama di Linux server dan Windows dev.
async function dumpDatabase({ cid, user, db }, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const child = spawn(
    "docker",
    [
      "exec",
      cid,
      "pg_dump",
      "-U",
      user,
      "-d",
      db,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const { promise: exited, resolve, reject } = Promise.withResolvers();
  child.on("error", reject);
  child.on("close", resolve);
  let streamErr;
  try {
    await pipeline(
      child.stdout,
      zlib.createGzip(),
      fs.createWriteStream(out, { mode: 0o600 }),
    );
  } catch (err) {
    streamErr = err;
    child.kill();
  }
  const code = await exited;
  if (code !== 0 || streamErr) {
    fs.rmSync(out, { force: true });
    throw new Error(
      code !== 0
        ? `pg_dump gagal (kode ${code}): ${stderr.trim().slice(-300)}`
        : streamErr.message,
    );
  }
}

async function restoreDatabase({ cid, user, db }, file) {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      cid,
      "psql",
      "-U",
      user,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "--single-transaction",
      "-q",
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const { promise: exited, resolve, reject } = Promise.withResolvers();
  child.on("error", reject);
  child.on("close", resolve);
  let streamErr;
  try {
    await pipeline(fs.createReadStream(file), zlib.createGunzip(), child.stdin);
  } catch (err) {
    streamErr = err; // psql yang berhenti lebih dulu menimbulkan EPIPE; galat psql lebih informatif
    child.kill();
  }
  const code = await exited;
  if (code !== 0)
    throw new Error(`psql gagal (kode ${code}): ${stderr.trim().slice(-300)}`);
  if (streamErr) throw streamErr;
}

async function cmdData(args) {
  const [sub, ...rest] = args;
  const file = rest.find((a) => !a.startsWith("--"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (sub === "export") {
    const target = dataDbTarget();
    const out = path.resolve(file || `/srv/noc/backups/data-${stamp}.sql.gz`);
    log(`Mengekspor database ke ${out} ...`);
    await dumpDatabase(target, out);
    ok(`Ekspor selesai: ${out}`);
    warn(
      "Berkas ini berisi SEMUA data (pelanggan, akun, kredensial router terenkripsi). Simpan aman dan hapus setelah dipakai.",
    );
    warn(
      "Salin juga DEVICE_SECRET (dan ROUTER_SECRET_KEY bila ada) dari /srv/noc/shared/.env ke server tujuan; tanpa itu kredensial router tidak bisa dibuka.",
    );
    return;
  }
  if (sub === "import") {
    if (!file || !fs.existsSync(file))
      throw new Error("Pakai: noc-system data import <berkas.sql.gz> --yes");
    if (!rest.includes("--yes")) {
      throw new Error(
        "Impor MENIMPA data database server ini. Cadangan otomatis dibuat dulu. Ulangi dengan --yes bila yakin.",
      );
    }
    const target = dataDbTarget();
    const backup = `/srv/noc/backups/pre-import-${stamp}.sql.gz`;
    log(`Cadangan data saat ini: ${backup}`);
    await dumpDatabase(target, backup);
    const units = "noc-web noc-backend";
    try {
      runCmd(`systemctl stop ${units}`);
    } catch {}
    try {
      log(`Memulihkan ${file} ke database ${target.db} ...`);
      await restoreDatabase(target, path.resolve(file));
      ok("Data dipulihkan.");
      runCmd("node scripts/migrate-server.mjs", {
        env: {
          ...process.env,
          ...(target.url ? { DATABASE_URL: target.url } : {}),
        },
      });
      ok("Skema disesuaikan dengan versi kode ini.");
    } catch (err) {
      fail(`Impor gagal: ${err.message}. Cadangan sebelum impor: ${backup}`);
      throw err;
    } finally {
      try {
        runCmd(`systemctl start ${units}`);
      } catch {}
    }
    return;
  }
  throw new Error(
    "Pakai: noc-system data export [berkas] | noc-system data import <berkas.sql.gz> --yes",
  );
}

// Membuat/menaikkan akun superadmin. Email lewat --email atau NOC_ADMIN_EMAIL; kata sandi
// hanya lewat env NOC_ADMIN_PASSWORD (kosong = dibuat acak dan dicetak sekali).
async function cmdAdmin(args) {
  if (args[0] !== "create")
    throw new Error(
      "Pakai: noc-system admin create [--email <email>] [--name <nama>] [--reset-password]",
    );
  const usage =
    'Pakai: noc-system admin create --email <email> [--name "<nama>"] [--reset-password]';
  // Jangan jatuh diam-diam ke email bawaan: flag salah ketik atau nama tanpa tanda kutip harus gagal.
  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--reset-password") continue;
    if (a === "--email" || a === "--name") {
      const v = rest[i + 1];
      if (!v || v.startsWith("--"))
        throw new Error(`${a} butuh nilai. ${usage}`);
      i++;
      continue;
    }
    throw new Error(
      `Argumen tidak dikenal: ${a}. Nama berspasi harus diberi tanda kutip. ${usage}`,
    );
  }
  const flag = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let dbUrl = "";
  try {
    const m = fs
      .readFileSync("/srv/noc/shared/.env", "utf-8")
      .match(/^DATABASE_URL=(.+)$/m);
    if (m) dbUrl = m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  runCmd(
    "node scripts/create-superadmin.mjs" +
      (args.includes("--reset-password") ? " --reset-password" : ""),
    {
      env: {
        ...process.env,
        ...(dbUrl ? { DATABASE_URL: dbUrl } : {}),
        ...(flag("--email") ? { NOC_ADMIN_EMAIL: flag("--email") } : {}),
        ...(flag("--name") ? { NOC_ADMIN_NAME: flag("--name") } : {}),
      },
    },
  );
}

// Hapus SEMUA data aplikasi lalu mulai dari awal (skema baru + superadmin baru). Hanya database aplikasi:
// Logto (cluster sendiri) dan MongoDB GenieACS tidak tersentuh. Cadangan otomatis dibuat dulu.
async function cmdReset(args) {
  const extra = args.filter((a) => a !== "--yes");
  if (extra.length)
    throw new Error(
      `Argumen tidak dikenal: ${extra[0]}. Pakai: noc-system reset --yes`,
    );
  if (!args.includes("--yes")) {
    throw new Error(
      "reset MENGHAPUS seluruh data aplikasi (pelanggan, router, akun, riwayat) dan membuat superadmin baru. " +
        "Cadangan `pre-reset-*.sql.gz` dibuat dulu di /srv/noc/backups. Ulangi dengan --yes bila yakin.",
    );
  }
  const target = dataDbTarget();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `/srv/noc/backups/pre-reset-${stamp}.sql.gz`;
  log(`Cadangan data saat ini: ${backup}`);
  await dumpDatabase(target, backup);
  const units = "noc-web noc-backend";
  try {
    runCmd(`systemctl stop ${units}`);
  } catch {}
  try {
    log(`Menghapus semua objek di database ${target.db} ...`);
    const wipe = spawnSync(
      "docker",
      [
        "exec",
        target.cid,
        "psql",
        "-U",
        target.user,
        "-d",
        target.db,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
      ],
      { encoding: "utf-8" },
    );
    if (wipe.status !== 0)
      throw new Error(`psql gagal: ${(wipe.stderr || "").trim().slice(-300)}`);
    ok("Database dikosongkan.");
    const env = {
      ...process.env,
      ...(target.url ? { DATABASE_URL: target.url } : {}),
    };
    runCmd("node scripts/migrate-server.mjs", { env });
    ok("Skema dibuat ulang.");
    runCmd("node scripts/create-superadmin.mjs", { env });
  } catch (err) {
    fail(`Reset gagal: ${err.message}. Cadangan sebelum reset: ${backup}`);
    throw err;
  } finally {
    try {
      runCmd(`systemctl start ${units}`);
    } catch {}
  }
}

// Diagnosa koneksi REST ke router MikroTik dari server ini (tanpa kredensial): menjelaskan KENAPA gagal.
// Tanpa argumen: semua router di database. Argumen: host[:port] atau http(s)://host[:port].
async function cmdRouter(args) {
  if (args[0] !== "check")
    throw new Error("Pakai: noc-system router check [host[:port]]");
  let hosts = args.slice(1).filter((a) => !a.startsWith("--"));
  if (!hosts.length) {
    const t = dataDbTarget();
    const out = execSync(
      `docker exec ${t.cid} psql -U ${t.user} -d ${t.db} -Atc "select name||'|'||host from routers"`,
      { encoding: "utf-8" },
    );
    hosts = out
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("|")[1]);
    if (!hosts.length)
      throw new Error(
        "Belum ada router di database. Beri argumen: noc-system router check <host[:port]>",
      );
  }
  for (const raw of hosts) {
    const h = raw.trim();
    const url = new URL(/^https?:\/\//.test(h) ? h : `http://${h}`);
    const tls =
      url.protocol === "https:" || url.port === "443" || url.port === "8443";
    const port = Number(url.port || (tls ? 443 : 80));
    console.log(
      `\n${ANSI.bold}${ANSI.cyan}>>> ${url.hostname}:${port} (${tls ? "HTTPS" : "HTTP"})${ANSI.reset}`,
    );
    if (!url.port)
      warn(
        "Host tanpa port: backend memakai port 80 (HTTP) atau 443 (HTTPS). Jika layanan www dipindah port, isi host sebagai IP:port.",
      );
    const verdict = await new Promise((resolve) => {
      const mod = tls ? https : http;
      const req = mod.request(
        {
          host: url.hostname,
          port,
          path: "/rest/system/resource",
          method: "GET",
          timeout: 5000,
          rejectUnauthorized: false,
        },
        (res) => {
          res.resume();
          const local = res.socket.localAddress;
          if (res.statusCode === 401)
            resolve({
              level: "ok",
              text: `REST hidup (HTTP 401): jaringan dan allow-list beres. Periksa username/password akun router. IP sumber server ini: ${local} (router bisa melihat alamat lain bila ada NAT di jalur: /ip firewall connection print where dst-address~"${url.hostname}:${port}").`,
            });
          else if (res.statusCode === 200)
            resolve({
              level: "ok",
              text: "REST hidup dan menjawab tanpa kredensial (HTTP 200).",
            });
          else if (res.statusCode === 404)
            resolve({
              level: "fail",
              text: "HTTP 404: layanan web hidup tetapi /rest tidak ada. RouterOS harus v7.1+; atau port ini bukan layanan www.",
            });
          else
            resolve({
              level: "fail",
              text: `HTTP ${res.statusCode}: bukan jawaban REST MikroTik yang diharapkan.`,
            });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({
          level: "fail",
          text: "Timeout: paket dijatuhkan (firewall) atau tidak ada rute ke router. Cek `ip route get`, firewall router (chain input), dan ping.",
        });
      });
      req.on("error", (e) => {
        const local = req.socket?.localAddress;
        const code = e.code || e.message;
        if (code === "ECONNREFUSED")
          resolve({
            level: "fail",
            text: 'Ditolak (ECONNREFUSED): layanan www/www-ssl mati atau port salah. Di router: /ip service print where name~"www|api".',
          });
        else if (
          code === "ECONNRESET" ||
          /hang up|reset|EPIPE/i.test(String(code))
        )
          resolve({
            level: "fail",
            text: `Koneksi diputus router setelah TCP tersambung: IP server tidak ada di address= layanan www. IP sumber server ini: ${local || "?"}, tetapi jika ada NAT di jalur router melihat alamat lain; cek yang sebenarnya di router: /ip firewall connection print where dst-address~"${url.hostname}:${port}". Lalu TAMBAHKAN (jangan ganti): /ip service set www address=<daftar-lama>,<sumber-nyata>/32.`,
          });
        else if (code === "EHOSTUNREACH" || code === "ENETUNREACH")
          resolve({
            level: "fail",
            text: `Tidak ada rute ke router (${code}). Cek gateway dan routing server.`,
          });
        else resolve({ level: "fail", text: `Galat ${code}.` });
      });
      req.end();
    });
    (verdict.level === "ok" ? ok : fail)(verdict.text);
  }
}

const command = args[0] || "help";
switch (command) {
  case "upgrade":
    cmdUpgrade().catch((err) => {
      fail(`Upgrade versi gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "version":
  case "-v":
  case "--version":
    cmdVersion().catch((err) => {
      fail(`Gagal membaca versi: ${err.message}`);
      process.exit(1);
    });
    break;
  case "install":
  case "setup":
    cmdInstall().catch((err) => {
      fail(`Instalasi gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "deploy":
    cmdDeploy(args.slice(1), { isUpdate: false }).catch((err) => {
      fail(`Deploy gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "update":
    cmdDeploy(args.slice(1), { isUpdate: true }).catch((err) => {
      fail(`Update gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "rollback":
    cmdRollback().catch((err) => {
      fail(`Rollback gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "status":
    cmdStatus().catch((err) => {
      fail(`Gagal membaca status: ${err.message}`);
      process.exit(1);
    });
    break;

  case "logs":
    cmdLogs(args.slice(1));
    break;

  case "doctor":
  case "specs":
    cmdDoctor().catch((err) => {
      fail(`Pemeriksaan doctor gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "features":
    cmdFeatures(args.slice(1)).catch((err) => {
      fail(`Gagal membaca fitur: ${err.message}`);
      process.exit(1);
    });
    break;

  case "verify":
    try {
      runCmd("node scripts/verify-deploy.mjs");
    } catch (err) {
      process.exit(1);
    }
    break;

  case "reset":
    cmdReset(args.slice(1)).catch((err) => {
      fail(`Perintah reset gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "router":
    cmdRouter(args.slice(1)).catch((err) => {
      fail(`Perintah router gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "admin":
    cmdAdmin(args.slice(1)).catch((err) => {
      fail(`Perintah admin gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "data":
    cmdData(args.slice(1)).catch((err) => {
      fail(`Perintah data gagal: ${err.message}`);
      process.exit(1);
    });
    break;

  case "help":
  default:
    console.log(`
${ANSI.bold}NOC SYSTEM - Server Native Deployment CLI${ANSI.reset}

Penggunaan:
  ${ANSI.cyan}noc-system <perintah> [opsi]${ANSI.reset}

Perintah Tersedia:
  ${ANSI.green}upgrade${ANSI.reset}          Naikkan versi minor aplikasi (1.0.x.y -> 1.1.0.0) di package.json
  ${ANSI.green}version${ANSI.reset}          Tampilkan versi lokal package.json dan rilis aktif server
  ${ANSI.green}install / setup${ANSI.reset}  Siapkan hierarki /srv/noc, docker postgres, dan systemd
  ${ANSI.green}router check${ANSI.reset}   Diagnosa koneksi REST ke router dari server ini (jelaskan penyebab gagal)
  ${ANSI.green}reset --yes${ANSI.reset}    Hapus SEMUA data aplikasi, buat skema + superadmin baru (cadangan otomatis)
  ${ANSI.green}admin create${ANSI.reset}   Buat akun superadmin (--email, --name, --reset-password; kata sandi via NOC_ADMIN_PASSWORD)
  ${ANSI.green}data export|import${ANSI.reset} Pindahkan data antar server (terpisah dari install; impor butuh --yes)
  ${ANSI.green}deploy [versi]${ANSI.reset}   Rilis versi baru (auto-bump build jika tanpa argumen versi)
  ${ANSI.green}update [ref]${ANSI.reset}     Tarik kode git terbaru lalu deploy otomatis
  ${ANSI.green}doctor / specs${ANSI.reset}   Periksa kelayakan server (CPU, RAM, Swap, Disk, Port, Docker)
  ${ANSI.green}features${ANSI.reset}         Tampilkan ringkasan status semua fitur aplikasi & Docker
  ${ANSI.green}rollback${ANSI.reset}         Kembalikan symlink /srv/noc/current ke rilis sebelumnya
  ${ANSI.green}status${ANSI.reset}           Periksa versi aktif, status unit systemd, docker & health
  ${ANSI.green}logs${ANSI.reset}             Pantau log live systemd (opsi: --web, --backend, -n <jumlah>)
  ${ANSI.green}verify${ANSI.reset}           Jalankan verifikasi integritas rilis (scripts/verify-deploy.mjs)
  ${ANSI.green}help${ANSI.reset}             Tampilkan bantuan ini
`);
    break;
}
