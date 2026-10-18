import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const routeDrawingLayers = await import("../src/app/api/map/drawing-layers/route.ts");
const routeDrawingLayersDetail = await import(
  "../src/app/api/map/drawing-layers/[id]/route.ts"
);

test("Endpoint API Lapisan Gambar: Proteksi Sesi & Validasi Input", async (t) => {
  await t.test("GET: Menolak akses tanpa sesi dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/drawing-layers");
    const res = await routeDrawingLayers.GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  await t.test("POST: Menolak akses tanpa sesi dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/drawing-layers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lapisan Baru" }),
    });
    const res = await routeDrawingLayers.POST(req);
    assert.equal(res.status, 401);
  });

  await t.test("PUT: Menolak akses tanpa sesi dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/drawing-layers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: [{ id: "l1", name: "Lapisan A" }] }),
    });
    const res = await routeDrawingLayers.PUT(req);
    assert.equal(res.status, 401);
  });

  await t.test("GET [id]: Menolak akses tanpa sesi dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/drawing-layers/dummy-id");
    const res = await routeDrawingLayersDetail.GET(req, {
      params: Promise.resolve({ id: "dummy-id" }),
    });
    assert.equal(res.status, 401);
  });

  await t.test("PATCH: Menolak akses tanpa sesi dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/drawing-layers/dummy-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Update" }),
    });
    const res = await routeDrawingLayersDetail.PATCH(req, {
      params: Promise.resolve({ id: "dummy-id" }),
    });
    assert.equal(res.status, 401);
  });

  await t.test("DELETE: Menolak akses tanpa sesi dengan status HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/drawing-layers/dummy-id", {
      method: "DELETE",
    });
    const res = await routeDrawingLayersDetail.DELETE(req, {
      params: Promise.resolve({ id: "dummy-id" }),
    });
    assert.equal(res.status, 401);
  });
});
