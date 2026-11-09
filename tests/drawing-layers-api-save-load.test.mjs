import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("API Simpan dan Ambil Lapisan Anotasi (Drawing Layers Save & Load API)", async (t) => {
  const routeLayersPath = path.resolve(
    "src/app/api/map/drawing-layers/route.ts",
  );
  const routeDetailPath = path.resolve(
    "src/app/api/map/drawing-layers/[id]/route.ts",
  );
  const servicePath = path.resolve(
    "src/services/map-drawing-layers.service.ts",
  );
  const validatorPath = path.resolve("src/validators/map-drawing-layers.ts");

  assert.equal(fs.existsSync(routeLayersPath), true, "File route.ts harus ada");
  assert.equal(
    fs.existsSync(routeDetailPath),
    true,
    "File [id]/route.ts harus ada",
  );
  assert.equal(
    fs.existsSync(servicePath),
    true,
    "File map-drawing-layers.service.ts harus ada",
  );
  assert.equal(
    fs.existsSync(validatorPath),
    true,
    "File validators/map-drawing-layers.ts harus ada",
  );

  const routeLayersContent = fs.readFileSync(routeLayersPath, "utf-8");
  const routeDetailContent = fs.readFileSync(routeDetailPath, "utf-8");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");
  const validatorContent = fs.readFileSync(validatorPath, "utf-8");

  await t.test(
    "1. Route collection mengekspor handler GET, POST, dan PUT",
    () => {
      assert.match(
        routeLayersContent,
        /export async function GET\(/,
        "Harus ada handler GET",
      );
      assert.match(
        routeLayersContent,
        /export async function POST\(/,
        "Harus ada handler POST",
      );
      assert.match(
        routeLayersContent,
        /export async function PUT\(/,
        "Harus ada handler PUT",
      );
      assert.match(
        routeLayersContent,
        /withApiSession/,
        "Harus diproteksi dengan withApiSession",
      );
      assert.match(
        routeLayersContent,
        /visibleOnly/,
        "Mendukung filter visible",
      );
      assert.match(routeLayersContent, /search/, "Mendukung filter pencarian");
    },
  );

  await t.test(
    "2. Route detail mengekspor handler GET, PATCH, dan DELETE",
    () => {
      assert.match(
        routeDetailContent,
        /export async function GET\(/,
        "Harus ada handler GET by id",
      );
      assert.match(
        routeDetailContent,
        /export async function PATCH\(/,
        "Harus ada handler PATCH",
      );
      assert.match(
        routeDetailContent,
        /export async function DELETE\(/,
        "Harus ada handler DELETE",
      );
      assert.match(
        routeDetailContent,
        /getMapDrawingLayerById/,
        "Menggunakan service getMapDrawingLayerById",
      );
    },
  );

  await t.test("3. Service menyediakan operasi lengkap CRUD dan batch", () => {
    assert.match(
      serviceContent,
      /export async function getMapDrawingLayers\(/,
      "Harus mengekspor getMapDrawingLayers",
    );
    assert.match(
      serviceContent,
      /export async function getMapDrawingLayerById\(/,
      "Harus mengekspor getMapDrawingLayerById",
    );
    assert.match(
      serviceContent,
      /export async function createMapDrawingLayer\(/,
      "Harus mengekspor createMapDrawingLayer",
    );
    assert.match(
      serviceContent,
      /export async function updateMapDrawingLayer\(/,
      "Harus mengekspor updateMapDrawingLayer",
    );
    assert.match(
      serviceContent,
      /export async function deleteMapDrawingLayer\(/,
      "Harus mengekspor deleteMapDrawingLayer",
    );
    assert.match(
      serviceContent,
      /export async function batchSaveMapDrawingLayers\(/,
      "Harus mengekspor batchSaveMapDrawingLayers",
    );
  });

  await t.test(
    "4. Validator Zod memvalidasi skema payload dengan ketat",
    () => {
      assert.match(
        validatorContent,
        /export const createDrawingLayerSchema/,
        "Harus mengekspor createDrawingLayerSchema",
      );
      assert.match(
        validatorContent,
        /export const updateDrawingLayerSchema/,
        "Harus mengekspor updateDrawingLayerSchema",
      );
      assert.match(
        validatorContent,
        /export const batchSaveDrawingLayersSchema/,
        "Harus mengekspor batchSaveDrawingLayersSchema",
      );
      assert.match(
        validatorContent,
        /drawingShapeSchema/,
        "Harus memvalidasi drawingShapeSchema",
      );
    },
  );
});
