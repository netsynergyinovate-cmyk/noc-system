import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
process.env.DEVICE_SECRET ??= "d".repeat(32);

// "server-only" melempar di luar bundler Next; ganti dengan modul kosong.
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu lewat slot global yang dipakai src/db/index.ts (tanpa jaringan).
let existing = [];
const inserted = [];
const chain = (result) => {
  const c = { from: () => c, where: () => c, limit: async () => result };
  return c;
};
globalThis.starterPostgresDb = {
  select: () => chain(existing),
  insert: () => ({
    values: (v) => {
      inserted.push(v);
      return { returning: async () => [{ id: "r1", ...v }] };
    },
  }),
};

register();
const { createRouterSchema } = await import("../src/validators/routers.ts");
const { createRouter } = await import("../src/services/routers.service.ts");

const valid = { name: "Core", host: "10.0.0.5", username: "admin", password: "x" };
const ok = (o) => createRouterSchema.safeParse({ ...valid, ...o }).success;
const fail = async (o) => {
  try {
    await createRouter({ ...valid, mode: "simulator", ...o });
  } catch (e) {
    return e;
  }
  assert.fail("seharusnya gagal");
};

test("skema: field opsional valid, host kosong/panjang ditolak", () => {
  assert.ok(ok({}));
  assert.ok(ok({ port: 8728, useSsl: true, mode: "simulator", validateConnection: false }));
  assert.ok(!ok({ host: "" }));
  assert.ok(!ok({ host: "a".repeat(256) }));
  assert.ok(!ok({ name: "a".repeat(101) }));
  assert.ok(!ok({ port: 0 }));
  assert.ok(!ok({ mode: "fake" }));
  assert.ok(!ok({ extra: 1 }));
});

test("host berbahaya ditolak 422 INVALID_HOST", async () => {
  for (const host of [
    "http://10.0.0.5/admin",
    "10.0.0.5/?a=1",
    "http://u:p@10.0.0.5",
    "ftp://10.0.0.5",
  ]) {
    const e = await fail({ host });
    assert.deepEqual([e.status, e.code], [422, "INVALID_HOST"], host);
  }
  assert.equal(inserted.length, 0);
});

test("simulator host .0 -> 400 TIMEOUT, .255 -> 400 AUTH_FAILED", async () => {
  const t = await fail({ host: "10.0.0.0" });
  assert.deepEqual([t.status, t.code], [400, "TIMEOUT"]);
  const a = await fail({ host: "10.0.0.255" });
  assert.deepEqual([a.status, a.code], [400, "AUTH_FAILED"]);
  assert.equal(inserted.length, 0);
});

test("simulator normal: pre-flight lulus dan host ternormalisasi disimpan", async () => {
  const r = await createRouter({ ...valid, host: " http://10.0.0.5 ", mode: "simulator" });
  assert.equal(r.host, "10.0.0.5");
  assert.equal(inserted.length, 1);
});

test("host duplikat -> 409 DUPLICATE_HOST", async () => {
  existing = [{ id: "x" }];
  const e = await fail({});
  assert.deepEqual([e.status, e.code], [409, "DUPLICATE_HOST"]);
  existing = [];
});

test("validateConnection:false melewati pre-flight", async () => {
  const before = inserted.length;
  const r = await createRouter({ ...valid, host: "10.0.0.0", mode: "simulator", validateConnection: false });
  assert.equal(r.host, "10.0.0.0");
  assert.equal(inserted.length, before + 1);
});
