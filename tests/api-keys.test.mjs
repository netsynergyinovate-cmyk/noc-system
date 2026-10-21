import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const dataRoute = await import("../src/app/api/v1/data/route.ts");
const keysRoute = await import("../src/app/api/api-keys/route.ts");
const keyRoute = await import("../src/app/api/api-keys/[id]/route.ts");

const URL_DATA = "http://localhost:3101/api/v1/data";
const bearer = (key, init = {}) =>
  new Request(init.url ?? URL_DATA, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });

test("GET /api/v1/data: 401 tanpa sesi atau key", async () => {
  const res = await dataRoute.GET(new Request(URL_DATA));
  assert.equal(res.status, 401);
});

test("GET /api/v1/data: key berformat salah ditolak tanpa menyentuh database", async () => {
  const res = await dataRoute.GET(bearer("bukan-key"));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "INVALID_API_KEY");
});

// Bagian berikut butuh PostgreSQL sekali pakai dari `npm test`.
const withDb = process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-");

test("API key: baca data tanpa rahasia, hanya-baca menolak tulis, cabut berlaku", { skip: !withDb && "jalankan lewat npm test" }, async () => {
  const { db } = await import("../src/db/index.ts");
  const { user, routers } = await import("../src/db/schema/index.ts");
  const { createApiKey } = await import("../src/services/api-keys.service.ts");

  const suffix = randomBytes(4).toString("hex");
  const userId = `apikey-test-${suffix}`;
  await db.insert(user).values({ id: userId, name: "Uji Key", email: `${userId}@test.local`, role: "admin" });
  await db.insert(routers).values({ name: `r-${suffix}`, host: `10.99.0.${Number.parseInt(suffix.slice(0, 2), 16)}`, username: "api", passwordEnc: "iv:tag:rahasia" });

  const { key: readKey } = await createApiKey(userId, { name: "baca", access: "read" });
  const { key: rwKey, apiKey: rw } = await createApiKey(userId, { name: "tulis", access: "read-write" });

  const list = await dataRoute.GET(bearer(readKey));
  assert.equal(list.status, 200);
  const names = (await list.json()).data;
  assert.ok(names.includes("routers") && names.includes("customers"));
  assert.ok(!names.includes("billing-credentials") && !names.includes("api-keys"));

  const rows = await dataRoute.GET(bearer(readKey, { url: `${URL_DATA}?dataset=routers&limit=1000` }));
  assert.equal(rows.status, 200);
  const body = await rows.json();
  const mine = body.data.find((r) => r.name === `r-${suffix}`);
  assert.ok(mine, "router uji ikut terbaca");
  assert.equal("passwordEnc" in mine, false);
  assert.equal(JSON.stringify(body).includes("rahasia"), false);

  // Kunci utama gabungan juga bisa diurutkan.
  const samples = await dataRoute.GET(bearer(readKey, { url: `${URL_DATA}?dataset=traffic-samples&limit=5` }));
  assert.equal(samples.status, 200);

  const unknown = await dataRoute.GET(bearer(readKey, { url: `${URL_DATA}?dataset=account` }));
  assert.equal(unknown.status, 404);

  const post = { url: "http://localhost:3101/api/api-keys", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) };
  const readOnlyWrite = await keysRoute.POST(bearer(readKey, post));
  assert.equal(readOnlyWrite.status, 403);
  assert.equal((await readOnlyWrite.json()).error.code, "READ_ONLY_API_KEY");

  // Key tidak boleh membuat key baru, walau baca+tulis dan pemiliknya admin.
  const keyMakesKey = await keysRoute.POST(bearer(rwKey, post));
  assert.equal(keyMakesKey.status, 403);
  assert.equal((await keyMakesKey.json()).error.code, "SESSION_REQUIRED");

  const revoke = await keyRoute.DELETE(
    bearer(rwKey, { url: `http://localhost:3101/api/api-keys/${rw.id}`, method: "DELETE" }),
    { params: Promise.resolve({ id: rw.id }) },
  );
  assert.equal(revoke.status, 403, "pencabutan juga hanya dari sesi login");

  const { revokeApiKeyAny } = await import("../src/services/api-keys.service.ts");
  assert.equal(await revokeApiKeyAny(rw.id), true);
  const afterRevoke = await dataRoute.GET(bearer(rwKey));
  assert.equal(afterRevoke.status, 401);

  const { eq } = await import("drizzle-orm");
  await db.delete(routers).where(eq(routers.name, `r-${suffix}`));
  await db.delete(user).where(eq(user.id, userId));
  await (await import("../src/db/index.ts")).getRawPool().end();
});
