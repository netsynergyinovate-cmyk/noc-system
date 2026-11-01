#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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

function getAppVersion() {
  const now = new Date();
  const timeSuffix = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
    const gitHash = execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf-8" }).trim();
    return `${pkgJson.version || "1.0.0"}+${gitHash || "local"}.${timeSuffix}`;
  } catch {
    return `1.0.0+build.${timeSuffix}`;
  }
}
function recordDeploymentToDatabase(version, jenis, status, titikBalikVersi) {
  try {
    let pgCid = "";
    try {
      const lines = execSync('docker ps --filter "name=noc-postgres" --format "{{.Names}}"', { encoding: "utf-8" }).trim().split("\n");
      pgCid = lines[0]?.trim();
      if (!pgCid) {
        const p5432 = execSync('docker ps --filter "publish=5432" --format "{{.Names}}"', { encoding: "utf-8" }).trim().split("\n");
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
    execSync(`docker exec -i "${pgCid}" psql -U "${dbUser}" -d "${dbName}" -c "${sql}" 2>/dev/null || true`);
  } catch {}
}

function updateServerStatusSnapshot(version, rollbackTarget, status) {
  try {
    const statusPath = "/srv/noc/shared/server-status.json";
    let recentErrors = [];
    try {
      const errOut = execSync("journalctl -u noc-web -u noc-backend -p err -n 50 --no-pager 2>/dev/null || echo ''", { encoding: "utf-8" }).trim();
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
  log(`${ANSI.bold}Memulai Instalasi NOC System di Server Native Ubuntu...${ANSI.reset}`);

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
  const hasValidMonitorToken = (text) => /^MONITOR_TOKEN=[^<\s]\S*/m.test(text);
  if (!fs.existsSync(targetEnv)) {
    const templatePath = path.join(REPO_ROOT, ".env.server.example");
    if (fs.existsSync(templatePath)) {
      let content = fs.readFileSync(templatePath, "utf-8");
      if (!hasValidMonitorToken(content)) {
        if (/^MONITOR_TOKEN=.*$/m.test(content)) {
          content = content.replace(/^MONITOR_TOKEN=.*$/m, `MONITOR_TOKEN=${genMonitorToken}`);
        } else {
          content += `\nMONITOR_TOKEN=${genMonitorToken}\n`;
        }
      }
      fs.writeFileSync(targetEnv, content, "utf-8");
      ok(`Disalin dari .env.server.example ke ${targetEnv}`);
    } else {
      fs.writeFileSync(
        targetEnv,
        [
          "NODE_ENV=production",
          "PORT=3000",
          "DATABASE_URL=postgresql://starter:starter_password@127.0.0.1:5432/starter",
          "BETTER_AUTH_SECRET=ganti-dengan-rahasia-32-karakter-acak",
          "BETTER_AUTH_URL=http://localhost:3000",
          "DEVICE_SECRET=kunci-enkripsi-device-32-karakter-ok",
          "BACKEND_URL=http://localhost:8080",
          "REALTIME_TOKEN_SECRET=rahasia-tiket-realtime-sama-dengan-backend",
          `MONITOR_TOKEN=${genMonitorToken}`,
        ].join("\n") + "\n",
      );
      ok(`Template dasar ${targetEnv} dibuat.`);
    }
    warn(`PENTING: Periksa dan lengkapi rahasia di ${targetEnv} sebelum rilis.`);
  } else {
    let curEnv = fs.readFileSync(targetEnv, "utf-8");
    if (!hasValidMonitorToken(curEnv)) {
      if (/^MONITOR_TOKEN=.*$/m.test(curEnv)) {
        curEnv = curEnv.replace(/^MONITOR_TOKEN=.*$/m, `MONITOR_TOKEN=${genMonitorToken}`);
        fs.writeFileSync(targetEnv, curEnv, "utf-8");
      } else {
        fs.appendFileSync(targetEnv, `\nMONITOR_TOKEN=${genMonitorToken}\n`, "utf-8");
      }
      ok(`MONITOR_TOKEN baru ditambahkan ke ${targetEnv}`);
    }
    ok(`Berkas ${targetEnv} sudah ada.`);
  }

  // 3. Menjalankan Docker PostgreSQL
  log("3. Menyalakan database PostgreSQL di Docker...");
  const composePath = path.join(REPO_ROOT, "compose.postgres.yaml");
  if (fs.existsSync(composePath)) {
    try {
      runCmd(`docker compose -f "${composePath}" up -d`);
      ok("Kontainer Docker PostgreSQL (noc-postgres) berhasil dinyalakan.");
    } catch (err) {
      warn(`Gagal menjalankan docker compose: ${err.message}. Pastikan Docker daemon aktif.`);
    }
  }

  // 4. Pasang Systemd Units
  log("4. Memasang unit systemd untuk noc-web dan noc-backend...");
  const unitWebPath = path.join(REPO_ROOT, "systemd", "noc-web.service");
  const unitBackendPath = path.join(REPO_ROOT, "systemd", "noc-backend.service");

  if (fs.existsSync(unitWebPath) && fs.existsSync(unitBackendPath)) {
    try {
      runCmd(`sudo cp "${unitWebPath}" "${unitBackendPath}" /etc/systemd/system/`);
      runCmd("sudo systemctl daemon-reload");
      runCmd("sudo systemctl enable noc-web noc-backend");
      ok("Unit systemd noc-web dan noc-backend berhasil dipasang dan diaktifkan (enable).");
    } catch (err) {
      warn(`Tidak dapat memasang unit systemd otomatis: ${err.message}. Jalankan perintah sudo manual.`);
    }
  }

  // 5. Jalankan migrasi database awal
  log("5. Menjalankan migrasi database awal...");
  try {
    runCmd("node scripts/migrate-server.mjs");
    ok("Migrasi database berhasil dieksekusi.");
  } catch (err) {
    warn(`Migrasi database tertunda: ${err.message}.`);
  }

  console.log(`\n${ANSI.green}${ANSI.bold}Instalasi awal selesai!${ANSI.reset}`);
  console.log(`Langkah berikutnya: Jalankan ${ANSI.cyan}noc-system deploy${ANSI.reset} untuk merilis versi terbaru.`);
}

// -----------------------------------------------------------------------------
// 2. COMMAND: deploy
// -----------------------------------------------------------------------------
async function cmdDeploy(args = [], options = {}) {
  const isUpdate = options.isUpdate || args.includes("--pull");
  const filteredArgs = args.filter((a) => a !== "--pull");

  if (isUpdate) {
    log(`${ANSI.bold}Menjalankan pembaruan kode dari repositori git...${ANSI.reset}`);
    try {
      runCmd("git fetch --all --prune", { cwd: REPO_ROOT });
      const targetRef = filteredArgs[0];
      if (targetRef && !targetRef.includes("+")) {
        log(`Berpindah ke ref/tag git: ${targetRef}...`);
        runCmd(`git checkout "${targetRef}"`, { cwd: REPO_ROOT });
      } else {
        const curBranch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
          cwd: REPO_ROOT,
          encoding: "utf-8",
        }).trim() || "main";
        log(`Menyinkronkan branch ${curBranch} dengan origin...`);
        runCmd(`git reset --hard "origin/${curBranch}"`, { cwd: REPO_ROOT });
      }
      log("Memasang dependensi project terbaru (npm ci)...");
      runCmd("npm ci", { cwd: REPO_ROOT });
      ok("Kode sumber dan dependensi berhasil diperbarui dari git.");
    } catch (err) {
      warn(`Gagal memperbarui dari git: ${err.message}. Melanjutkan rilis dengan kode lokal.`);
    }
  }

  const version = (filteredArgs[0] && filteredArgs[0].includes("+")) ? filteredArgs[0] : getAppVersion();
  log(`${ANSI.bold}Memulai Deployment Versi: ${version}${ANSI.reset}`);

  const releasePath = `/srv/noc/releases/${version}`;
  const currentLink = "/srv/noc/current";
  const rollbackTargetFile = "/srv/noc/shared/.rollback-target";

  // Langkah 1: Backup Database
  log("Langkah 1/6: Membuat cadangan (backup) database...");
  const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `/srv/noc/backups/backup-${timestampStr}.sql.gz`;
  runCmd(`mkdir -p /srv/noc/backups`);

  let pgCid = "";
  try {
    const lines = execSync('docker ps --filter "name=noc-postgres" --format "{{.Names}}"', { encoding: "utf-8" }).trim().split("\n");
    pgCid = lines[0]?.trim();
    if (!pgCid) {
      const p5432 = execSync('docker ps --filter "publish=5432" --format "{{.Names}}"', { encoding: "utf-8" }).trim().split("\n");
      pgCid = p5432[0]?.trim();
    }
  } catch {}

  if (!pgCid) {
    fail("Kontainer Docker PostgreSQL (noc-postgres / port 5432) tidak ditemukan di server. Deployment dibatalkan.");
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
    runCmd(`bash -c 'set -o pipefail && docker exec "${pgCid}" pg_dump -U "${dbUser}" -d "${dbName}" | gzip > "${backupFile}" && test -s "${backupFile}"'`);
    ok(`Backup database tersimpan di: ${backupFile}`);
  } catch (err) {
    fail(`Backup database gagal: ${err.message}. Deployment dihentikan demi keamanan data.`);
    process.exit(1);
  }

  // Langkah 2: Kompilasi Backend Go
  log("Langkah 2/6: Mengompilasi backend Go untuk server native...");
  const backendBinDir = path.join(REPO_ROOT, "backend", "bin");
  if (!fs.existsSync(backendBinDir)) fs.mkdirSync(backendBinDir, { recursive: true });
  const backendBinPath = path.join(backendBinDir, "noc-backend");

  runCmd(`go build -ldflags="-s -w" -o "${backendBinPath}" ./cmd/server`, {
    cwd: path.join(REPO_ROOT, "backend"),
    env: { ...process.env, CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64" },
  });
  ok(`Backend Go terkompilasi: ${backendBinPath}`);

  // Langkah 3: Build Frontend Next.js Standalone
  log("Langkah 3/6: Membangun bundle Next.js Standalone...");
  runCmd("npm run build");
  ok("Bundle Next.js standalone berhasil dibuat.");

  // Langkah 4: Siapkan Direktori Rilis
  log(`Langkah 4/6: Menyiapkan direktori rilis di ${releasePath}...`);
  if (!fs.existsSync(releasePath)) fs.mkdirSync(releasePath, { recursive: true });

  // Salin bundle Next.js (termasuk .next di dalam standalone)
  runCmd(`cp -a "${path.join(REPO_ROOT, ".next", "standalone", ".")}" "${releasePath}/"`);
  runCmd(`mkdir -p "${releasePath}/.next" && cp -r "${path.join(REPO_ROOT, ".next", "static")}" "${releasePath}/.next/"`);
  const publicDir = path.join(REPO_ROOT, "public");
  if (fs.existsSync(publicDir)) {
    runCmd(`cp -r "${publicDir}" "${releasePath}/"`);
  }

  // Salin backend Go
  runCmd(`mkdir -p "${releasePath}/backend/bin"`);
  runCmd(`cp "${backendBinPath}" "${releasePath}/backend/bin/noc-backend"`);
  runCmd(`chmod +x "${releasePath}/backend/bin/noc-backend"`);

  // Salin skrip migrasi
  runCmd(`cp -r "${path.join(REPO_ROOT, "scripts")}" "${path.join(REPO_ROOT, "drizzle")}" "${path.join(REPO_ROOT, "package.json")}" "${releasePath}/"`);
  // Hubungkan symlink .env dari shared
  runCmd(`ln -sfn /srv/noc/shared/.env "${releasePath}/.env"`);
  runCmd(`ln -sfn /srv/noc/shared/.env "${releasePath}/backend/.env" 2>/dev/null || true`);
  ok(`Artefak rilis terpasang di ${releasePath}`);

  // Langkah 5: Migrasi Database
  log("Langkah 5/6: Menjalankan migrasi database skema baru...");
  try {
    runCmd("node scripts/migrate-server.mjs", { cwd: releasePath });
    ok("Migrasi database berhasil dijalankan.");
  } catch (err) {
    fail(`Migrasi database gagal: ${err.message}`);
    throw err;
  }

  // Langkah 6: Swap Symlink & Restart Layanan
  log("Langkah 6/6: Melakukan swap symlink dan me-restart layanan systemd...");

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
    runCmd("sudo systemctl restart noc-backend noc-web");
    ok("Layanan noc-backend dan noc-web berhasil di-restart.");
  } catch (err) {
    fail(`Gagal me-restart systemctl: ${err.message}.`);
    if (oldVersion) {
      warn(`Memutar balik symlink ke versi sebelumnya: ${oldVersion}`);
      runCmd(`ln -sfn "${oldVersion}" "${currentLink}"`);
    }
    throw err;
  }

  // Health check pasca-swap (polling hingga 45 detik agar Next.js punya waktu cold-start)
  log("Memverifikasi kesehatan layanan pasca-deploy (Health Check, polling hingga 45 detik)...");
  let webOk = false;
  let backendOk = false;
  const maxAttempts = 15;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const webRes = execSync("curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || echo '000'", { encoding: "utf-8" }).trim();
      webOk = webRes === "200";
    } catch {}

    try {
      const beRes = execSync("curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8080/healthz 2>/dev/null || echo '000'", { encoding: "utf-8" }).trim();
      backendOk = beRes === "200";
    } catch {}

    if (webOk && backendOk) {
      ok(`Layanan sehat dan merespons 200 OK (terkonfirmasi pada detik ke-${attempt * 3}).`);
      break;
    }
    log(`Menunggu layanan aktif (percobaan ${attempt}/${maxAttempts}): web=${webOk ? "OK" : "pending"}, backend=${backendOk ? "OK" : "pending"}...`);
  }

  if (webOk && backendOk) {
    recordDeploymentToDatabase(version, "deploy", "berhasil", oldVersion);
    updateServerStatusSnapshot(version, oldVersion, "berhasil");
    console.log(`\n${ANSI.green}${ANSI.bold}✓ DEPLOYMENT SUKSES! Versi ${version} aktif di SERVER NATIVE!${ANSI.reset}`);
  } else {
    recordDeploymentToDatabase(version, "deploy", "gagal", oldVersion);
    updateServerStatusSnapshot(version, oldVersion, "gagal");
    fail(`Health check tidak sempurna: web=${webOk ? "OK" : "GAGAL"}, backend=${backendOk ? "OK" : "GAGAL"}`);
    if (oldVersion) {
      warn(`Memicu rollback otomatis ke: ${oldVersion}`);
      runCmd(`ln -sfn "${oldVersion}" "${currentLink}"`);
      try {
        runCmd("sudo systemctl restart noc-backend noc-web");
        warn("Rollback selesai.");
      } catch {}
    }
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// 3. COMMAND: rollback
// -----------------------------------------------------------------------------
async function cmdRollback() {
  const currentLink = "/srv/noc/current";
  const rollbackTargetFile = "/srv/noc/shared/.rollback-target";

  if (!fs.existsSync(rollbackTargetFile)) {
    fail(`Berkas ${rollbackTargetFile} tidak ditemukan. Tidak ada titik balik rollback yang tercatat.`);
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
    runCmd("sudo systemctl restart noc-backend noc-web");
    ok("Layanan systemd noc-backend dan noc-web berhasil di-restart.");
    recordDeploymentToDatabase(targetRelease, "rollback", "berhasil", null);
    updateServerStatusSnapshot(targetRelease, null, "rollback");
  } catch (err) {
    warn(`Gagal me-restart layanan: ${err.message}`);
  }
  console.log(`\n${ANSI.green}${ANSI.bold}✓ ROLLBACK BERHASIL! Versi aktif sekarang: ${targetRelease}${ANSI.reset}`);
}

// -----------------------------------------------------------------------------
// 4. COMMAND: status
// -----------------------------------------------------------------------------
async function cmdStatus() {
  console.log(`\n${ANSI.bold}=== NOC SYSTEM - STATUS SERVER NATIVE ===${ANSI.reset}`);

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
    const webStatus = execSync("systemctl is-active noc-web 2>/dev/null || echo 'inactive'", { encoding: "utf-8" }).trim();
    const beStatus = execSync("systemctl is-active noc-backend 2>/dev/null || echo 'inactive'", { encoding: "utf-8" }).trim();
    console.log(`- noc-web service:     ${webStatus === "active" ? ANSI.green + "ACTIVE" : ANSI.red + webStatus.toUpperCase()}${ANSI.reset}`);
    console.log(`- noc-backend service: ${beStatus === "active" ? ANSI.green + "ACTIVE" : ANSI.red + beStatus.toUpperCase()}${ANSI.reset}`);
  } catch {
    console.log("- Status systemd: Tidak dapat membaca (perlu izin systemctl)");
  }

  // 3. Kontainer Docker PostgreSQL
  try {
    const pgPs = execSync("docker ps --filter 'name=noc-postgres' --format '{{.Names}} ({{.Status}})'", { encoding: "utf-8" }).trim();
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
    const webRes = execSync("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health", { encoding: "utf-8" }).trim();
    const beRes = execSync("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz", { encoding: "utf-8" }).trim();
    console.log(`- Web Health (:3000):     ${webRes === "200" ? ANSI.green + "200 OK" : ANSI.red + webRes}${ANSI.reset}`);
    console.log(`- Backend Health (:8080): ${beRes === "200" ? ANSI.green + "200 OK" : ANSI.red + beRes}${ANSI.reset}`);
  } catch {}

  console.log("=========================================\n");
}

// -----------------------------------------------------------------------------
// 5. COMMAND: logs
// -----------------------------------------------------------------------------
function cmdLogs(args = []) {
  const service = args.includes("--web") ? "noc-web" : args.includes("--backend") ? "noc-backend" : null;
  const unitArgs = service ? `-u ${service}` : "-u noc-web -u noc-backend";
  const lines = args.find((a) => a.startsWith("-n")) || "-n 50";

  console.log(`${ANSI.cyan}Menampilkan log jurnal (${unitArgs} ${lines})... Tekan Ctrl+C untuk keluar.${ANSI.reset}`);
  spawn(`journalctl ${unitArgs} ${lines} -f`, {
    shell: true,
    stdio: "inherit",
  });
}

// -----------------------------------------------------------------------------
// MAIN ENTRYPOINT
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
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

  case "verify":
    try {
      runCmd("node scripts/verify-deploy.mjs");
    } catch (err) {
      process.exit(1);
    }
    break;

  case "help":
  default:
    console.log(`
${ANSI.bold}NOC SYSTEM - Server Native Deployment CLI${ANSI.reset}

Penggunaan:
  ${ANSI.cyan}noc-system <perintah> [opsi]${ANSI.reset}

Perintah Tersedia:
  ${ANSI.green}install / setup${ANSI.reset}  Siapkan hierarki /srv/noc, docker postgres, dan systemd
  ${ANSI.green}deploy [versi]${ANSI.reset}   Rilis versi baru (backup, build, migrasi, swap symlink, health check)
  ${ANSI.green}rollback${ANSI.reset}         Kembalikan symlink /srv/noc/current ke rilis sebelumnya
  ${ANSI.green}status${ANSI.reset}           Periksa versi aktif, status unit systemd, docker & health
  ${ANSI.green}logs${ANSI.reset}             Pantau log live systemd (opsi: --web, --backend, -n <jumlah>)
  ${ANSI.green}verify${ANSI.reset}           Jalankan verifikasi integritas rilis (scripts/verify-deploy.mjs)
  ${ANSI.green}help${ANSI.reset}             Tampilkan bantuan ini
`);
    break;
}
