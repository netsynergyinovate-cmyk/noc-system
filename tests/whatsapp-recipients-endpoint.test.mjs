import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu lewat slot global src/db/index.ts: tanpa jaringan.
const ID = "11111111-1111-4111-8111-111111111111";
const MISSING = "22222222-2222-4222-8222-222222222222";
let rows = [];
const thenable = (get) => {
  const c = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    then: (a, b) => Promise.resolve(get()).then(a, b),
  };
  return c;
};
globalThis.starterPostgresDb = {
  select: () => thenable(() => rows),
  insert: () => ({
    values: (v) => ({ returning: async () => [{ id: ID, ...v }] }),
  }),
  update: () => ({
    set: (v) => ({
      where: () => ({ returning: async () => [{ ...rows[0], ...v }] }),
    }),
  }),
  delete: () => ({
    where: () => ({ returning: async () => rows.map((r) => ({ id: r.id })) }),
  }),
};

register();
const { createRecipientSchema: c, updateRecipientSchema: u } =
  await import("../src/validators/whatsapp.ts");

test("create: individual valid dan invalid", () => {
  assert.ok(
    c.safeParse({ name: "Piket", target: "081234567890", type: "individual" })
      .success,
  );
  assert.ok(
    c.safeParse({
      name: "Piket",
      target: "+6281234567890",
      type: "individual",
      isActive: false,
    }).success,
  );
  assert.ok(
    !c.safeParse({ name: "Piket", target: "12345", type: "individual" })
      .success,
  );
  assert.ok(
    !c.safeParse({ name: "Piket", target: "abc", type: "individual" }).success,
  );
});

test("create: group valid dan invalid", () => {
  assert.ok(
    c.safeParse({
      name: "Grup",
      target: "120363012345678901@g.us",
      type: "group",
    }).success,
  );
  assert.ok(
    !c.safeParse({ name: "Grup", target: "grup-abc", type: "group" }).success,
  );
});

test("create: nama, tipe, field asing", () => {
  const ok = { name: "A", target: "081234567890", type: "individual" };
  assert.ok(!c.safeParse({ ...ok, name: "" }).success);
  assert.ok(!c.safeParse({ ...ok, name: "x".repeat(101) }).success);
  assert.ok(c.safeParse({ ...ok, name: "x".repeat(100) }).success);
  assert.ok(!c.safeParse({ ...ok, type: "personal" }).success);
  assert.ok(!c.safeParse({ ...ok, extra: 1 }).success);
  assert.ok(!c.safeParse({ ...ok, isActive: "ya" }).success);
});

test("update: parsial", () => {
  assert.ok(u.safeParse({}).success);
  assert.ok(u.safeParse({ isActive: false }).success);
  assert.ok(u.safeParse({ name: "Baru", type: "group" }).success);
  assert.ok(!u.safeParse({ name: "" }).success);
  assert.ok(!u.safeParse({ type: "x" }).success);
  assert.ok(!u.safeParse({ id: "x" }).success);
});

// --- Route Handler -----------------------------------------------------------

const { auth } = await import("../src/lib/auth.ts");
const list = await import("../src/app/api/whatsapp/recipients/route.ts");
const item = await import("../src/app/api/whatsapp/recipients/[id]/route.ts");

// "anon" = tanpa sesi, "user" = tanpa izin threshold:manage, "admin" = penuh.
let role = "anon";
auth.api.getSession = async () =>
  role === "anon" ? null : { user: { id: "u1" }, session: {} };
auth.api.userHasPermission = async () => ({ success: role === "admin" });

const ORIGIN = "http://localhost:3101";
const req = (method, path, body) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const good = { name: "Piket", target: "081234567890", type: "individual" };

test.beforeEach(() => {
  role = "anon";
  rows = [
    {
      id: ID,
      name: "Piket",
      target: "6281234567890",
      type: "individual",
      isActive: true,
    },
  ];
});

test("GET tanpa sesi -> 401", async () => {
  assert.equal(
    (await list.GET(req("GET", "/api/whatsapp/recipients"))).status,
    401,
  );
});

test("GET dengan sesi -> 200 { data }", async () => {
  role = "user";
  const res = await list.GET(req("GET", "/api/whatsapp/recipients"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: rows });
});

test("POST tanpa sesi -> 401, tanpa izin -> 403", async () => {
  assert.equal(
    (await list.POST(req("POST", "/api/whatsapp/recipients", good))).status,
    401,
  );
  role = "user";
  assert.equal(
    (await list.POST(req("POST", "/api/whatsapp/recipients", good))).status,
    403,
  );
});

test("POST target tidak valid -> 422 VALIDATION_ERROR", async () => {
  role = "admin";
  const res = await list.POST(
    req("POST", "/api/whatsapp/recipients", { ...good, target: "12345" }),
  );
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "VALIDATION_ERROR");
});

test("POST valid sebagai admin -> 201, target dinormalisasi", async () => {
  role = "admin";
  const res = await list.POST(req("POST", "/api/whatsapp/recipients", good));
  assert.equal(res.status, 201);
  const { data } = await res.json();
  assert.equal(data.name, "Piket");
  assert.equal(data.target, "6281234567890");
});

test("PUT tanpa sesi -> 401, tanpa izin -> 403", async () => {
  const r = () =>
    req("PUT", `/api/whatsapp/recipients/${ID}`, { isActive: false });
  assert.equal((await item.PUT(r(), ctx(ID))).status, 401);
  role = "user";
  assert.equal((await item.PUT(r(), ctx(ID))).status, 403);
});

test("PUT admin: id tidak valid -> 422, ada -> 200, tidak ada -> 404", async () => {
  role = "admin";
  const put = (id) =>
    item.PUT(
      req("PUT", `/api/whatsapp/recipients/${id}`, { isActive: false }),
      ctx(id),
    );
  assert.equal((await put("bukan-uuid")).status, 422);
  const ok = await put(ID);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.isActive, false);
  rows = [];
  assert.equal((await put(MISSING)).status, 404);
});

test("DELETE tanpa sesi -> 401, tanpa izin -> 403", async () => {
  const r = () => req("DELETE", `/api/whatsapp/recipients/${ID}`);
  assert.equal((await item.DELETE(r(), ctx(ID))).status, 401);
  role = "user";
  assert.equal((await item.DELETE(r(), ctx(ID))).status, 403);
});

test("DELETE admin: ada -> 204, tidak ada -> 404", async () => {
  role = "admin";
  const del = (id) =>
    item.DELETE(req("DELETE", `/api/whatsapp/recipients/${id}`), ctx(id));
  assert.equal((await del(ID)).status, 204);
  rows = [];
  assert.equal((await del(MISSING)).status, 404);
});
