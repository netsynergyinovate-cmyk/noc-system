import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("scripts/install.sh memuat penanganan user, keamanan, dan bootstrap lengkap", () => {
  const installPath = path.resolve("scripts/install.sh");
  assert.ok(fs.existsSync(installPath), "scripts/install.sh harus ada");

  const content = fs.readFileSync(installPath, "utf-8");

  // 1. Dedicated noc system user
  assert.ok(
    content.includes(
      "useradd --system --no-create-home --home-dir /srv/noc --shell /usr/sbin/nologin noc",
    ),
    "User sistem 'noc' harus dibuat",
  );
  assert.ok(
    content.includes("usermod -aG docker noc"),
    "User 'noc' harus masuk grup docker",
  );

  // 2. Multi-user handling
  assert.ok(
    content.includes("DEPLOY_USER="),
    "DEPLOY_USER harus dideteksi secara dinamis",
  );

  // 3. Paket dasar sistem
  assert.ok(
    content.includes("build-essential"),
    "build-essential harus ada di apt install",
  );
  assert.ok(content.includes("openssl"), "openssl harus ada di apt install");
  assert.ok(content.includes("sudo"), "sudo harus ada di apt install");

  // 4. Go Compiler architecture & download
  assert.ok(content.includes("GO_ARCH="), "Arsitektur Go harus dideteksi");
  assert.ok(
    content.includes(
      'wget -q "https://go.dev/dl/${GO_TAR}" -O "/tmp/${GO_TAR}"',
    ),
    "Tarball Go harus diunduh sebelum diekstrak",
  );

  // 5. Aturan sudoers NOPASSWD yang aman
  assert.ok(
    content.includes("/etc/sudoers.d/noc-systemd"),
    "Berkas sudoers harus dikonfigurasi",
  );
  assert.ok(
    content.includes("restart noc-web noc-backend"),
    "Izin restart harus spesifik unit",
  );
  assert.ok(
    content.includes("restart noc-backend noc-web"),
    "Izin restart harus mencakup urutan bolak-balik",
  );
  assert.ok(
    content.includes("visudo"),
    "Validasi visudo harus dijalankan sebelum install",
  );

  // 6. Branch sync repositori lama
  assert.ok(
    content.includes("git checkout -B noc-system-main origin/noc-system-main"),
    "Branch sinkronisasi harus noc-system-main",
  );

  // 7. Unit systemd dipasang root
  assert.ok(
    content.includes(
      'install -m 0644 "${SRC_DIR}/systemd/noc-web.service" /etc/systemd/system/noc-web.service',
    ),
    "Unit noc-web harus dipasang root",
  );
  assert.ok(
    content.includes(
      'install -m 0644 "${SRC_DIR}/systemd/noc-backend.service" /etc/systemd/system/noc-backend.service',
    ),
    "Unit noc-backend harus dipasang root",
  );

  // 8. Izin direktori dan .env yang aman
  assert.ok(
    content.includes('chmod 0640 "${SHARED_ENV}"'),
    "File .env harus chmod 0640",
  );
  assert.ok(
    content.includes("chmod 2775"),
    "Direktori harus diberi setgid 2775",
  );
});

test("bin/noc-system.mjs menghasilkan konfigurasi server valid dan aman", () => {
  const cliPath = path.resolve("bin/noc-system.mjs");
  assert.ok(fs.existsSync(cliPath), "bin/noc-system.mjs harus ada");

  const content = fs.readFileSync(cliPath, "utf-8");

  // 1. DEVICE_SECRET tepat 32 karakter (16 bytes hex)
  assert.ok(
    content.includes('crypto.randomBytes(16).toString("hex")'),
    "DEVICE_SECRET acak harus 16 bytes (32 hex characters)",
  );

  // 2. Docker compose menggunakan env-file
  assert.ok(
    content.includes('--env-file "${targetEnv}"'),
    "Docker compose harus menggunakan --env-file targetEnv",
  );

  // 3. Menunggu pg_isready sebelum migrasi
  assert.ok(
    content.includes("pg_isready"),
    "Harus menunggu pg_isready sebelum migrasi",
  );

  // 4. Migrasi tidak menelan error
  assert.ok(
    content.includes("throw err;"),
    "Error migrasi harus dilempar (fail loudly)",
  );

  // 5. Restart layanan konsisten
  assert.ok(
    content.includes("sudo systemctl restart noc-web noc-backend"),
    "Perintah restart harus noc-web noc-backend",
  );
});

test("Route API /api/deploy/write-guard/logs terdefinisi dan mengekspor method GET & DELETE", () => {
  const routePath = path.resolve(
    "src/app/api/deploy/write-guard/logs/route.ts",
  );
  assert.ok(fs.existsSync(routePath), "Route write-guard/logs harus ada");

  const content = fs.readFileSync(routePath, "utf-8");
  assert.ok(
    content.includes("export function GET"),
    "GET method harus diekspor",
  );
  assert.ok(
    content.includes("export function DELETE"),
    "DELETE method harus diekspor",
  );
});

test("Route API /api/deploy/install.sh terdefinisi dan mengekspor method GET", () => {
  const routePath = path.resolve("src/app/api/deploy/install.sh/route.ts");
  assert.ok(fs.existsSync(routePath), "Route install.sh harus ada");

  const content = fs.readFileSync(routePath, "utf-8");
  assert.ok(
    content.includes("export async function GET"),
    "GET method harus diekspor",
  );
  assert.ok(
    content.includes("text/x-shellscript"),
    "Content-Type text/x-shellscript harus disetel",
  );
});
