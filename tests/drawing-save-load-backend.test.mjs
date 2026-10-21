import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Save & Load Drawing Layers from Real Backend Suite (Fase 5)", () => {
  const validatorPath = path.resolve(
    process.cwd(),
    "src/validators/map-drawing-layers.ts",
  );
  const servicePath = path.resolve(
    process.cwd(),
    "src/services/map-drawing-layers.service.ts",
  );
  const routePath = path.resolve(
    process.cwd(),
    "src/app/api/map/drawing-layers/route.ts",
  );

  it("1. Validator batchSaveDrawingLayersSchema harus ada dan memvalidasi payload batch", () => {
    assert.ok(
      fs.existsSync(validatorPath),
      "Berkas map-drawing-layers.ts harus ada",
    );

    const content = fs.readFileSync(validatorPath, "utf-8");
    assert.match(
      content,
      /export const batchSaveDrawingLayersSchema/,
      "Validator wajib mengekspor batchSaveDrawingLayersSchema",
    );
    assert.match(
      content,
      /layers:\s*z\.array/,
      "batchSaveDrawingLayersSchema wajib memvalidasi array layers",
    );
    assert.match(
      content,
      /id:\s*z\.string\(\)\.min\(1\)/,
      "Setiap elemen layer dalam batch wajib memiliki id yang valid",
    );
  });

  it("2. Service Backend harus mengekspor fungsi batchSaveMapDrawingLayers untuk persistensi PostgreSQL atomik", () => {
    assert.ok(
      fs.existsSync(servicePath),
      "Berkas map-drawing-layers.service.ts harus ada",
    );

    const content = fs.readFileSync(servicePath, "utf-8");
    assert.match(
      content,
      /export async function batchSaveMapDrawingLayers\(/,
      "Service wajib mengekspor fungsi batchSaveMapDrawingLayers",
    );
    assert.match(
      content,
      /db\s*\.update\(mapDrawingLayers\)/,
      "batchSaveMapDrawingLayers wajib memperbarui tabel mapDrawingLayers",
    );
  });

  it("3. Endpoint API /api/map/drawing-layers harus mengekspor metode PUT untuk batch update", () => {
    assert.ok(
      fs.existsSync(routePath),
      "Berkas api/map/drawing-layers/route.ts harus ada",
    );

    const content = fs.readFileSync(routePath, "utf-8");
    assert.match(
      content,
      /export async function PUT\(/,
      "Endpoint route wajib mengekspor handler PUT",
    );
    assert.match(
      content,
      /batchSaveDrawingLayersSchema\.safeParse/,
      "Handler PUT wajib memvalidasi body dengan batchSaveDrawingLayersSchema",
    );
    assert.match(
      content,
      /batchSaveMapDrawingLayers/,
      "Handler PUT wajib memanggil fungsi service batchSaveMapDrawingLayers",
    );
  });
});
