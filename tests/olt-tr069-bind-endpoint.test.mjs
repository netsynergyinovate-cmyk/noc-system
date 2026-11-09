import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";
process.env.DEVICE_SECRET = "d".repeat(32);
process.env.REALTIME_TOKEN_SECRET = "r".repeat(32);
process.env.BACKEND_URL = "http://backend.local:8080";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu: hanya dipakai withAudit (insert ke audit_log); route ini sendiri
// tidak menyentuh database.
globalThis.starterPostgresDb = {
  insert: () => ({
    values: (v) => {
      const p = Promise.resolve([{ id: "a1", ...v }]);
      return Object.assign(p, { returning: () => p });
    },
  }),
};

register();
const { auth } = await import("../src/lib/auth.ts");
const { POST: bindOnu } =
  await import("../src/app/api/olts/[id]/onus/[pon]/[onu]/tr069-bind/route.ts");

let sessionOk = true;
let permOk = true;
auth.api.getSession = async () =>
  sessionOk
    ? { user: { id: "u1", name: "Budi", email: "b@x.id" }, session: {} }
    : null;
auth.api.userHasPermission = async () => ({ success: permOk });

const OLT_ID = "11111111-1111-4111-8111-111111111111";
const req = () =>
  new Request(`http://localhost:3101/api/olts/${OLT_ID}/onus/1/22/tr069-bind`, {
    method: "POST",
    headers: { origin: "http://localhost:3101" },
  });
const call = async (pon = "1", onu = "22") => {
  const res = await bindOnu(req(), {
    params: Promise.resolve({ id: OLT_ID, pon, onu }),
  });
  return { status: res.status, json: await res.json() };
};

const realFetch = globalThis.fetch;
let lastFetch = null;
const stubFetch = (status, body) => {
  globalThis.fetch = async (url, init) => {
    lastFetch = { url: String(url), init };
    return new Response(JSON.stringify(body ?? {}), { status });
  };
};
test.afterEach(() => {
  globalThis.fetch = realFetch;
  sessionOk = true;
  permOk = true;
  lastFetch = null;
});

test("tanpa sesi: 401, tidak memanggil backend", async () => {
  sessionOk = false;
  stubFetch(200, { ok: true });
  const { status } = await call();
  assert.equal(status, 401);
  assert.equal(lastFetch, null);
});

test("sesi tanpa izin cpe:manage: 403, tidak memanggil backend", async () => {
  permOk = false;
  stubFetch(200, { ok: true });
  const { status } = await call();
  assert.equal(status, 403);
  assert.equal(lastFetch, null);
});

test("pon/onu bukan angka: ditolak (422, validasi zod) tanpa memanggil backend", async () => {
  stubFetch(200, { ok: true });
  const { status } = await call("x", "22");
  assert.equal(status, 422);
  assert.equal(lastFetch, null);
});

test("oltId bukan uuid: ditolak (422, validasi zod) tanpa memanggil backend", async () => {
  stubFetch(200, { ok: true });
  const res = await bindOnu(req(), {
    params: Promise.resolve({ id: "bukan-uuid", pon: "1", onu: "22" }),
  });
  assert.equal(res.status, 422);
  assert.equal(lastFetch, null);
});

test("sukses: tiket terkirim dengan izin cpe:manage, path diteruskan apa adanya", async () => {
  stubFetch(200, { ok: true, message: "ONU 1/22 diikat ke profil TR-069" });
  const { status, json } = await call();
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.match(json.message, /diikat/);
  assert.equal(
    lastFetch.url,
    `http://backend.local:8080/api/v1/olts/${OLT_ID}/onus/1/22/tr069-bind`,
  );
  assert.equal(lastFetch.init.method, "POST");
  const auth64 = lastFetch.init.headers.Authorization.replace(/^Bearer /, "");
  const [payloadB64] = auth64.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  assert.deepEqual(payload.perms, ["cpe:manage"]);
  assert.equal(payload.sub, "u1");
});

test("backend 404 -> OLT_NOT_FOUND", async () => {
  stubFetch(404, { error: "olt_not_found" });
  const { status, json } = await call();
  assert.equal(status, 404);
  assert.equal(json.error.code, "OLT_NOT_FOUND");
});

test("backend 409 (profil belum ada) -> PROFILE_MISSING", async () => {
  stubFetch(409, { error: "profile_missing" });
  const { status, json } = await call();
  assert.equal(status, 409);
  assert.equal(json.error.code, "PROFILE_MISSING");
});

test("backend 502 (ditolak OLT) -> BIND_FAILED, pesan umum tanpa bocoran backend", async () => {
  stubFetch(502, {
    error: "bind_rejected",
    message: "rahasia internal jangan bocor",
  });
  const { status, json } = await call();
  assert.equal(status, 502);
  assert.equal(json.error.code, "BIND_FAILED");
  assert.ok(!JSON.stringify(json).includes("rahasia internal"));
});

test("backend 400 (mis. driver OLT tak dikenal) -> BAD_REQUEST, pesan backend diteruskan", async () => {
  stubFetch(400, {
    error: "driver_unsupported",
    message: "olt: driver tidak terdaftar",
  });
  const { status, json } = await call();
  assert.equal(status, 400);
  assert.equal(json.error.code, "BAD_REQUEST");
  assert.match(json.error.message, /driver/);
});

test("backend tidak terjangkau -> 502 BACKEND_UNREACHABLE", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const { status, json } = await call();
  assert.equal(status, 502);
  assert.equal(json.error.code, "BACKEND_UNREACHABLE");
});
