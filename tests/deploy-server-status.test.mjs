import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??=
  "postgresql://starter:starter@127.0.0.1:5432/starter";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.NOC_DEVICE_SECRET ??= "k".repeat(32);

register();

const routeServerStatus =
  await import("../src/app/api/deploy/server-status/route.ts");

test("GET /api/deploy/server-status: Autentikasi dan Struktur Data Diagnostik", async (t) => {
  const originalToken = process.env.MONITOR_TOKEN;

  await t.test(
    "Mengembalikan 403 jika MONITOR_TOKEN belum dikonfigurasi di server",
    async () => {
      delete process.env.MONITOR_TOKEN;
      const req = new Request(
        "http://localhost:3000/api/deploy/server-status",
        {
          headers: { "x-monitor-token": "any-token" },
        },
      );
      const res = await routeServerStatus.GET(req);
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.ok(body.error.includes("MONITOR_TOKEN belum dikonfigurasi"));
    },
  );

  await t.test(
    "Mengembalikan 401 jika token monitor salah atau tidak disertakan",
    async () => {
      process.env.MONITOR_TOKEN = "kunci-rahasia-test-123";
      const reqNoToken = new Request(
        "http://localhost:3000/api/deploy/server-status",
      );
      const resNoToken = await routeServerStatus.GET(reqNoToken);
      assert.equal(resNoToken.status, 401);

      const reqWrong = new Request(
        "http://localhost:3000/api/deploy/server-status",
        {
          headers: { "x-monitor-token": "token-salah" },
        },
      );
      const resWrong = await routeServerStatus.GET(reqWrong);
      assert.equal(resWrong.status, 401);
    },
  );

  await t.test(
    "Mengembalikan 200 dan data spesifikasi, fitur, proses aktif, dan diagnostik lengkap",
    async () => {
      process.env.MONITOR_TOKEN = "kunci-rahasia-test-123";
      const req = new Request(
        "http://localhost:3000/api/deploy/server-status",
        {
          headers: { "x-monitor-token": "kunci-rahasia-test-123" },
        },
      );
      const res = await routeServerStatus.GET(req);
      assert.equal(res.status, 200);

      const body = await res.json();
      assert.equal(body.ok, true);

      // 1. Verifikasi Spesifikasi Server
      assert.ok(body.specs, "Harus menyertakan objek specs");
      assert.equal(typeof body.specs.os, "string");
      assert.equal(typeof body.specs.arch, "string");
      assert.ok(body.specs.cpu, "Harus menyertakan specs.cpu");
      assert.ok(body.specs.cpu.cores >= 1, "CPU cores minimal 1");
      assert.ok(body.specs.memory, "Harus menyertakan specs.memory");
      assert.ok(body.specs.memory.totalMb > 0, "Total RAM harus > 0");
      assert.ok(body.specs.swap, "Harus menyertakan specs.swap");
      assert.ok(body.specs.disk, "Harus menyertakan specs.disk");

      // 2. Verifikasi Fitur Ekosistem (7 komponen)
      assert.ok(body.features, "Harus menyertakan objek features");
      assert.ok(body.features.web, "Harus ada fitur web");
      assert.ok(body.features.backend, "Harus ada fitur backend");
      assert.ok(body.features.postgres, "Harus ada fitur postgres");
      assert.ok(body.features.genieacs, "Harus ada fitur genieacs");
      assert.ok(body.features.osrm, "Harus ada fitur osrm");
      assert.ok(body.features.nineRouter, "Harus ada fitur 9router");
      assert.ok(body.features.netflow, "Harus ada fitur netflow");

      // 3. Verifikasi Status Layanan Inti
      assert.ok(body.services, "Harus menyertakan objek services");
      assert.ok(["active", "inactive", "unknown"].includes(body.services.web));
      assert.ok(
        ["active", "inactive", "unknown"].includes(body.services.backend),
      );

      // 4. Verifikasi Diagnostik & Terminal Logs
      assert.ok(body.diagnostics, "Harus menyertakan objek diagnostics");
      assert.ok(
        Array.isArray(body.diagnostics.warnings),
        "diagnostics.warnings harus array",
      );
      assert.equal(typeof body.diagnostics.oomDetected, "boolean");
      assert.ok(Array.isArray(body.terminalLogs), "terminalLogs harus array");
      assert.ok(Array.isArray(body.recentErrors), "recentErrors harus array");

      // 5. Verifikasi Active Process
      assert.ok(body.activeProcess, "Harus menyertakan objek activeProcess");
      assert.equal(typeof body.activeProcess.running, "boolean");
    },
  );

  // Pulihkan environment
  if (originalToken) {
    process.env.MONITOR_TOKEN = originalToken;
  } else {
    delete process.env.MONITOR_TOKEN;
  }
});
