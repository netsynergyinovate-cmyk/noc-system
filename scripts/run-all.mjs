// Satu perintah untuk menjalankan semuanya: persiapan (PostgreSQL Docker dan
// migrasi), dashboard Next.js, dan backend Go. Ctrl+C menghentikan ketiganya.
// Backend Go bersifat tambahan: kalau gagal atau Go belum terpasang, dashboard
// tetap jalan dengan data mock.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { assertNode, loadEnvironment, root } from "./lib.mjs";
import { managesLocalDatabase } from "./postgres.mjs";

assertNode();
await loadEnvironment();

// `npm run all:server`: baca DB server lewat tunnel dengan akun hanya-baca (scripts/dev-readonly-role.sql).
// Nilai di .env.server-db.local menimpa .env.local; proses anak mewarisinya dan @next/env tidak menimpa ulang.
const serverMode = process.argv.includes("--server");
if (serverMode) {
  const file = path.join(root, ".env.server-db.local");
  const values = fs.existsSync(file)
    ? parseEnv(fs.readFileSync(file, "utf8"))
    : {};
  const missing = ["DATABASE_URL", "DEVICE_SECRET"].filter(
    (k) => !values[k] || values[k].includes("ISI_"),
  );
  if (missing.length || !process.env.GENIEACS_TUNNEL_TARGET) {
    console.error(
      `Mode DB server butuh ${missing.join(", ") || "GENIEACS_TUNNEL_TARGET (.env)"} di .env.server-db.local. Lihat komentar di berkas itu.`,
    );
    process.exit(1);
  }
  Object.assign(process.env, values, {
    NOC_READONLY_DB: "1",
    SKIP_STARTUP_MIGRATION: "true",
  });
  console.log(
    "[run-all] Mode DB server (hanya-baca): menulis data akan gagal; migrasi dan pekerja latar Next dilewati.",
  );
}

const dockerReady = () =>
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

// Docker Desktop tidak selalu menyala sendiri. Bila mesinnya belum aktif,
// aplikasinya dibuka lalu ditunggu sampai siap (maksimal 3 menit).
async function ensureDocker() {
  // DATABASE_URL buatan sendiri (bukan database Docker bawaan starter) tidak
  // butuh Docker sama sekali.
  // Tunnel ke server juga butuh Docker.
  if (
    (!managesLocalDatabase() && !process.env.GENIEACS_TUNNEL_TARGET) ||
    dockerReady()
  )
    return;

  let launch;
  if (process.platform === "win32") {
    const exe = `${process.env.ProgramFiles ?? "C:\\Program Files"}\\Docker\\Docker\\Docker Desktop.exe`;
    launch = () => spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    launch = () =>
      spawn("open", ["-a", "Docker"], {
        detached: true,
        stdio: "ignore",
      }).unref();
  }
  if (!launch) {
    console.error("Docker belum aktif. Nyalakan Docker daemon lalu coba lagi.");
    process.exit(1);
  }

  console.log("Docker belum aktif, membuka Docker Desktop...");
  try {
    launch();
  } catch {
    console.error(
      "Docker Desktop tidak bisa dibuka. Buka manual lalu coba lagi.",
    );
    process.exit(1);
  }
  for (let waited = 0; waited < 180; waited += 3) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (dockerReady()) {
      console.log("Docker siap.");
      return;
    }
  }
  console.error(
    "Docker belum siap setelah 3 menit. Cek Docker Desktop lalu coba lagi.",
  );
  process.exit(1);
}
await ensureDocker();

// Sama dengan hook `predev`: dijalankan sekali di sini supaya dua proses di
// bawah tidak berebut membuat .env.local.
const prepared = spawnSync(process.execPath, ["scripts/prepare.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (prepared.status !== 0) process.exit(prepared.status ?? 1);

// Container app/backend dari compose.yaml memegang port 3001/8080 dan ikut polling router yang sama.
const docker = (args) =>
  spawnSync("docker", args, { cwd: root, encoding: "utf8" });
const running = docker([
  "compose",
  "ps",
  "--status",
  "running",
  "--services",
  "app",
  "backend",
]).stdout?.trim();
if (running) {
  console.log(
    `[run-all] Menghentikan container Docker ${running.split(/\s+/).join(", ")} (diganti proses lokal).`,
  );
  docker(["compose", "stop", "app", "backend"]);
}

// GenieACS (localhost:7557) dan DB server hanya-baca (localhost:15432) lewat SSH tunnel ke server.
if (process.env.GENIEACS_TUNNEL_TARGET) {
  // -p wajib: COMPOSE_PROJECT_NAME dari .env.local menimpa `name:` di berkas.
  const tunnel = docker([
    "compose",
    "-p",
    "noc-tunnel-server",
    "-f",
    "compose.tunnel-server.yaml",
    "up",
    "-d",
  ]);
  console.log(
    tunnel.status === 0
      ? `[run-all] Tunnel ke ${process.env.GENIEACS_TUNNEL_TARGET} aktif: GenieACS localhost:7557, DB server (hanya-baca) localhost:15432.`
      : `[run-all] Tunnel gagal dinyalakan, GenieACS tidak terbaca:\n${tunnel.stderr}`,
  );
  if (tunnel.status !== 0 && serverMode) process.exit(1); // tanpa tunnel tidak ada DB
}

const children = new Set();

function run(label, command, { required }) {
  const child = spawn(command, { cwd: root, shell: true });
  children.add(child);
  const prefix = (stream, target) => {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) target.write(`[${label}] ${line}\n`);
    });
    stream.on("end", () => rest && target.write(`[${label}] ${rest}\n`));
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.once("exit", (code) => {
    children.delete(child);
    if (required) return stop(code ?? 1);
    console.error(
      `[${label}] berhenti (kode ${code ?? "?"}); dashboard tetap berjalan.`,
    );
  });
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // `shell: true` membuat satu lapis perantara; taskkill /T menutup seluruh
    // pohon prosesnya di Windows.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

run("web", "npx next dev -p 3001", { required: true });
run("backend", "node scripts/backend-dev.mjs", { required: false });
