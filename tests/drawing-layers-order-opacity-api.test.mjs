import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { reorderDrawingLayersSchema, updateLayerOpacitySchema } =
  await import("../src/validators/map-drawing-layers.ts");
const routeReorder =
  await import("../src/app/api/map/drawing-layers/reorder/route.ts");
const routeOpacity =
  await import("../src/app/api/map/drawing-layers/[id]/opacity/route.ts");

test("API Perbarui Urutan dan Transparansi Lapisan (Drawing Layers Order & Opacity API)", async (t) => {
  await t.test(
    "1. Validator reorderDrawingLayersSchema memvalidasi array urutan lapisan",
    () => {
      // Valid array
      const valid = reorderDrawingLayersSchema.safeParse({
        layers: [
          { id: "layer-1", zIndex: 10 },
          { id: "layer-2", zIndex: 5 },
        ],
      });
      assert.equal(valid.success, true);

      // Invalid: array kosong
      const empty = reorderDrawingLayersSchema.safeParse({ layers: [] });
      assert.equal(empty.success, false);

      // Invalid: id kosong
      const noId = reorderDrawingLayersSchema.safeParse({
        layers: [{ id: "", zIndex: 1 }],
      });
      assert.equal(noId.success, false);

      // Invalid: zIndex non-integer
      const floatZIndex = reorderDrawingLayersSchema.safeParse({
        layers: [{ id: "l1", zIndex: 1.5 }],
      });
      assert.equal(floatZIndex.success, false);
    },
  );

  await t.test(
    "2. Validator updateLayerOpacitySchema memvalidasi batas transparansi (0.0 - 1.0)",
    () => {
      assert.equal(
        updateLayerOpacitySchema.safeParse({ opacity: 0.0 }).success,
        true,
      );
      assert.equal(
        updateLayerOpacitySchema.safeParse({ opacity: 0.75 }).success,
        true,
      );
      assert.equal(
        updateLayerOpacitySchema.safeParse({ opacity: 1.0 }).success,
        true,
      );

      // Di bawah 0
      assert.equal(
        updateLayerOpacitySchema.safeParse({ opacity: -0.1 }).success,
        false,
      );
      // Di atas 1.0
      assert.equal(
        updateLayerOpacitySchema.safeParse({ opacity: 1.05 }).success,
        false,
      );
    },
  );

  await t.test(
    "3. Route POST /api/map/drawing-layers/reorder menolak request tanpa sesi dengan 401",
    async () => {
      const req = new Request(
        "http://localhost:3000/api/map/drawing-layers/reorder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            layers: [{ id: "layer-1", zIndex: 2 }],
          }),
        },
      );
      const res = await routeReorder.POST(req);
      assert.equal(res.status, 401);
    },
  );

  await t.test(
    "4. Route PATCH /api/map/drawing-layers/reorder menolak request tanpa sesi dengan 401",
    async () => {
      const req = new Request(
        "http://localhost:3000/api/map/drawing-layers/reorder",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            layers: [{ id: "layer-1", zIndex: 2 }],
          }),
        },
      );
      const res = await routeReorder.PATCH(req);
      assert.equal(res.status, 401);
    },
  );

  await t.test(
    "5. Route PATCH /api/map/drawing-layers/[id]/opacity menolak request tanpa sesi dengan 401",
    async () => {
      const req = new Request(
        "http://localhost:3000/api/map/drawing-layers/dummy-id/opacity",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opacity: 0.8 }),
        },
      );
      const res = await routeOpacity.PATCH(req, {
        params: Promise.resolve({ id: "dummy-id" }),
      });
      assert.equal(res.status, 401);
    },
  );

  await t.test(
    "6. Service mengekspor fungsi reorderMapDrawingLayers dan updateMapDrawingLayerOpacity",
    () => {
      const serviceContent = fs.readFileSync(
        path.resolve("src/services/map-drawing-layers.service.ts"),
        "utf-8",
      );
      assert.match(
        serviceContent,
        /export async function reorderMapDrawingLayers\(/,
      );
      assert.match(
        serviceContent,
        /export async function updateMapDrawingLayerOpacity\(/,
      );
    },
  );
});
