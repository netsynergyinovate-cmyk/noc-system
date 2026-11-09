import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const { getOnboardingMikrotikStatus, executeOnboardingMikrotikTest } =
  await import("../src/services/onboarding-mikrotik.service.ts");

test("getOnboardingMikrotikStatus membaca status konfigurasi MikroTik", async () => {
  const status = await getOnboardingMikrotikStatus();
  assert.ok(typeof status.configured === "boolean");
  assert.ok(typeof status.isGateUnlocked === "boolean");
  assert.ok(typeof status.routerCount === "number");
  assert.ok(status.checkedAt);
});

test("executeOnboardingMikrotikTest menolak isian yang tidak valid", async () => {
  const invalidRes = await executeOnboardingMikrotikTest({
    name: "",
    host: "",
    port: 0,
    username: "",
    useTls: true,
    mode: "simulator",
  });

  assert.equal(invalidRes.ok, false);
  assert.ok(invalidRes.errors && invalidRes.errors.length > 0);
});

test("executeOnboardingMikrotikTest berhasil menguji koneksi pada simulator mode", async () => {
  const validRes = await executeOnboardingMikrotikTest({
    name: "Router Core Test",
    host: "10.200.0.1",
    port: 443,
    username: "admin_test",
    password: "secret_password",
    useTls: true,
    mode: "simulator",
  });

  assert.equal(validRes.ok, true);
  assert.ok(validRes.details);
  assert.ok(validRes.details.version);
  assert.ok(validRes.details.boardName);
  assert.ok(validRes.details.uptime);
});

test("Route handler /api/onboarding/mikrotik mengekspor method GET dan POST", async () => {
  const route = await import("../src/app/api/onboarding/mikrotik/route.ts");
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "function");
});

test("mode real: kegagalan dilaporkan jujur dengan kode dan saran, tanpa data karangan", async () => {
  const base = {
    name: "R",
    username: "admin",
    password: "pw",
    useTls: false,
    mode: "real",
  };
  const refused = await executeOnboardingMikrotikTest({
    ...base,
    host: "127.0.0.1",
    port: 1,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.details, undefined);
  assert.ok(refused.code && refused.errors?.length);
  assert.ok(!refused.message.includes("pw"));

  const apiPort = await executeOnboardingMikrotikTest({
    ...base,
    host: "10.0.0.5",
    port: 8728,
  });
  assert.equal(apiPort.code, "WRONG_PORT");

  const badHost = await executeOnboardingMikrotikTest({
    ...base,
    host: "ftp://10.0.0.5",
    port: 80,
  });
  assert.equal(badHost.ok, false);
});
