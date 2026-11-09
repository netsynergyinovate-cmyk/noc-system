import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";
process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { parseCustomerLive, getRunsnetCustomerLive } =
  await import("../src/services/runsnet-billing.service.ts");

const row = (label, value) =>
  `<div class='col-4'><b>${label}</b></div> <div class='col-8'>: ${value}</div>`;

test("parseCustomerLive: hanya kolom sesi; kata sandi, NIK, dan kontak tidak ikut", () => {
  const html = [
    row("CustomerName", "FEBRIANTO"),
    row("Nik", "1771000000000001"),
    row("Kontak", "0812"),
    row("Username", "17060001813@runsnet.id"),
    row("Password", "4321"),
    row("IP Address", "172.16.15.236"),
    row("Mac Address", "90:88:A9:02:F9:61 "),
    row("Last Login", "2026-11-03 11:24:04"),
    row("Last Logout", ""),
    row("Session Time", "7h, 12m, 48s"),
    row("Status Layanan", "Layanan Sudah Sesuai"),
  ].join("\n");
  const r = parseCustomerLive(html);
  assert.deepEqual(r, {
    ipAddress: "172.16.15.236",
    macAddress: "90:88:A9:02:F9:61",
    lastLogin: "2026-11-03 11:24:04",
    lastLogout: null,
    sessionTime: "7h, 12m, 48s",
    statusLayanan: "Layanan Sudah Sesuai",
    uploadUsage: null,
    downloadUsage: null,
  });
  assert.doesNotMatch(JSON.stringify(r), /4321|1771000000000001|0812/);
});

test("parseCustomerLive: pemakaian upload/download dibaca bila ada", () => {
  const r = parseCustomerLive(
    row("Pemakaian Upload", "1.2 GB") + row("Pemakaian Download", "30 GB"),
  );
  assert.equal(r.uploadUsage, "1.2 GB");
  assert.equal(r.downloadUsage, "30 GB");
});

test("getRunsnetCustomerLive menolak ID yang bisa menyisipkan parameter", async () => {
  await assert.rejects(getRunsnetCustomerLive("1&data2=x"), /tidak valid/);
  await assert.rejects(getRunsnetCustomerLive("../etc"), /tidak valid/);
});
