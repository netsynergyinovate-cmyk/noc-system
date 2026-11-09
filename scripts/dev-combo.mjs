import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("=== Mengaktifkan Mode Dev Combo (Hybrid) ===");

// 1. Matikan kontainer duplikat lokal yang sudah berjalan di server
const heavyContainers = [
  "nocsystem-app-1",
  // nocsystem-backend-1 sengaja TIDAK dimatikan: poller MikroTik lokal harus berjalan berdampingan dengan server.
  "nocsystem-logto",
  "nocsystem-logto-postgres",
  "nocsystem-studio-1",
  "nocsystem-db-ui-1",
];

console.log(
  "\n1. Mematikan kontainer duplikat lokal (menghemat ~1.5 GB RAM)...",
);
for (const c of heavyContainers) {
  try {
    spawnSync("docker", ["stop", c], { stdio: "ignore" });
  } catch {}
}

// 2. Pastikan kontainer dev penting lokal tetap menyala (tanpa recreate yang membongkar live TR-069)
console.log("\n2. Memastikan Postgres Dev, GenieACS, dan OSRM aktif...");
const keepRunning = [
  "nocsystem-postgres-1",
  "nocsystem-backend-1",
  "noc-genieacs-genieacs-1",
  "noc-genieacs-genieacs-mongo-1",
  "nocsystem-osrm",
];

for (const c of keepRunning) {
  try {
    spawnSync("docker", ["start", c], { stdio: "ignore" });
  } catch {}
}

// 3. Selaraskan .env.local untuk memakai Logto SSO Server
console.log("\n3. Menghubungkan Auth lokal ke Logto Server...");
const envLocalPath = path.join(rootDir, ".env.local");
if (fs.existsSync(envLocalPath)) {
  let content = fs.readFileSync(envLocalPath, "utf8");
  const updates = {
    LOGTO_ENDPOINT: "http://192.168.0.25:3301",
    LOGTO_INTERNAL_ENDPOINT: "http://192.168.0.25:3301",
    LOGTO_ADMIN_ENDPOINT: "http://localhost:3002", // SSH tunnel: ssh -L 3002:127.0.0.1:3002 netsi@192.168.0.25
    DATABASE_URL:
      "postgresql://starter:starter_password@127.0.0.1:5432/starter",
  };

  for (const [k, v] of Object.entries(updates)) {
    const regex = new RegExp(`^${k}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${k}="${v}"`);
    } else {
      content += `\n${k}="${v}"`;
    }
  }
  fs.writeFileSync(envLocalPath, content, "utf8");
  console.log("   .env.local tersinkronisasi ke server Logto SSO!");
}

// 4. Jalankan Next.js Dev Server lokal
console.log(
  "\n4. Menjalankan Next.js Dev Server di http://localhost:3001...\n",
);
const nextDev = spawn("npx", ["next", "dev", "-p", "3001"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: true,
});

process.on("SIGINT", () => {
  nextDev.kill("SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  nextDev.kill("SIGTERM");
  process.exit(0);
});
