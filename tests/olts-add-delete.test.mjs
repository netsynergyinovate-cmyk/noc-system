import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";
import { eq } from "drizzle-orm";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { auth } = await import("../src/lib/auth.ts");
const { db } = await import("../src/db/index.ts");
const { olts, oltOnus } = await import("../src/db/schema/index.ts");
const { POST: addOlt } = await import("../src/app/api/olts/route.ts");
const { DELETE: deleteOlt } = await import("../src/app/api/olts/[id]/route.ts");

let role = "admin";
auth.api.getSession = async () =>
  role === "anon" ? null : { user: { id: "u1" }, session: {} };
auth.api.userHasPermission = async () => ({ success: role === "admin" });

const body = {
  name: "OLT uji hapus",
  host: "10.255.255.1",
  brand: "HSGQ",
  driver: "hsgq-telnet",
  username: "admin",
  password: "rahasia",
};
const post = () =>
  addOlt(
    new Request("http://localhost/api/olts?skipTest=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3101",
      },
      body: JSON.stringify(body),
    }),
  );
const del = (id) =>
  deleteOlt(
    new Request(`http://localhost/api/olts/${id}`, {
      method: "DELETE",
      headers: { Origin: "http://localhost:3101" },
    }),
    { params: Promise.resolve({ id }) },
  );

test("tambah OLT (skipTest) lalu hapus: ONU ikut terhapus", async () => {
  role = "admin";
  const res = await post();
  assert.equal(res.status, 201);
  const { data } = await res.json();
  await db.insert(oltOnus).values({ oltId: data.id, ponIndex: 1, onuIndex: 1 });
  assert.equal(
    (await db.select().from(oltOnus).where(eq(oltOnus.oltId, data.id))).length,
    1,
  );

  assert.equal((await del(data.id)).status, 204);
  assert.equal(
    (await db.select().from(olts).where(eq(olts.id, data.id))).length,
    0,
  );
  assert.equal(
    (await db.select().from(oltOnus).where(eq(oltOnus.oltId, data.id))).length,
    0,
  );
  assert.equal((await del(data.id)).status, 404);
});

test("tanpa izin router:manage: tambah dan hapus ditolak", async () => {
  role = "user";
  assert.equal((await post()).status, 403);
  assert.equal((await del("550e8400-e29b-41d4-a716-446655440000")).status, 403);
});
