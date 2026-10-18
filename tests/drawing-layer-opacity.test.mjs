import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createDrawingLayerSchema,
  updateDrawingLayerSchema,
  batchSaveDrawingLayersSchema,
} from "../src/validators/map-drawing-layers.ts";

const PANEL_PATH = path.resolve(
  process.cwd(),
  "src/components/map/drawing-layer-manager-panel.tsx",
);
const BOARD_PATH = path.resolve(
  process.cwd(),
  "src/components/map/drawing-layer-map-board.tsx",
);

test("DrawingLayerManagerPanel memiliki slider transparansi dan preset cepat lengkap", () => {
  const content = fs.readFileSync(PANEL_PATH, "utf8");

  // Periksa slider range
  assert.ok(
    content.includes('data-testid={`opacity-slider-${layer.id}`}'),
    "Harus ada input range slider transparansi dengan testid opacity-slider",
  );
  assert.ok(
    content.includes('min="0"'),
    "Slider harus memiliki batas minimum 0 (transparan total)",
  );
  assert.ok(
    content.includes('max="1.0"'),
    "Slider harus memiliki batas maksimum 1.0 (opak)",
  );

  // Periksa label persentase dan preview visual
  assert.ok(
    content.includes('data-testid={`opacity-value-${layer.id}`}'),
    "Harus ada label nilai persentase transparansi",
  );
  assert.ok(
    content.includes('data-testid={`opacity-preview-${layer.id}`}'),
    "Harus ada kotak pratinjau visual transparansi",
  );

  // Periksa tombol quick preset 25%, 50%, 75%, 100%
  assert.ok(
    content.includes("data-testid={`opacity-preset-${preset}-${layer.id}`}"),
    "Harus ada tombol quick preset dengan testid dinamis opacity-preset-${preset}-${layer.id}",
  );
  assert.ok(
    content.includes("[25, 50, 75, 100]"),
    "Harus menyertakan preset 25%, 50%, 75%, dan 100%",
  );

  // Periksa atribut aksesibilitas ARIA
  assert.ok(
    content.includes("aria-label="),
    "Harus memiliki aria-label untuk pembaca layar",
  );
  assert.ok(
    content.includes("aria-valuenow="),
    "Harus memiliki aria-valuenow",
  );
  assert.ok(
    content.includes("aria-valuemin={0}"),
    "Harus memiliki aria-valuemin 0",
  );
  assert.ok(
    content.includes("aria-valuemax={100}"),
    "Harus memiliki aria-valuemax 100",
  );
});

test("DrawingLayerMapBoard menerapkan transparansi (globalAlpha) ke kanvas saat render", () => {
  const content = fs.readFileSync(BOARD_PATH, "utf8");

  assert.ok(
    content.includes("ctx.globalAlpha = Number(layer.opacity ?? 1.0)"),
    "Kanvas render harus menerapkan ctx.globalAlpha sesuai properti layer.opacity",
  );
  assert.ok(
    content.includes("ctx.save()"),
    "Harus menyimpan context sebelum mengubah alpha",
  );
});

test("Validator Zod memvalidasi rentang nilai opacity (0.0 sampai 1.0)", () => {
  // Valid opacity
  const validLayer = {
    name: "Jalur FO ODP",
    opacity: 0.75,
  };
  const parsedCreate = createDrawingLayerSchema.safeParse(validLayer);
  assert.equal(parsedCreate.success, true);

  const parsedUpdate = updateDrawingLayerSchema.safeParse({ opacity: 0.5 });
  assert.equal(parsedUpdate.success, true);

  const parsedBatch = batchSaveDrawingLayersSchema.safeParse({
    layers: [{ id: "l-1", opacity: 0.25 }],
  });
  assert.equal(parsedBatch.success, true);

  // Invalid opacity (< 0 atau > 1)
  const invalidLow = updateDrawingLayerSchema.safeParse({ opacity: -0.1 });
  assert.equal(invalidLow.success, false);

  const invalidHigh = updateDrawingLayerSchema.safeParse({ opacity: 1.5 });
  assert.equal(invalidHigh.success, false);
});

test("Simulasi sanitasi dan pembaruan nilai slider transparansi", () => {
  function sanitizeOpacity(raw) {
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return 1.0;
    return Math.max(0, Math.min(1, Math.round(parsed * 100) / 100));
  }

  assert.equal(sanitizeOpacity("0.85"), 0.85);
  assert.equal(sanitizeOpacity("1.0"), 1.0);
  assert.equal(sanitizeOpacity("0"), 0.0);
  assert.equal(sanitizeOpacity("1.5"), 1.0);
  assert.equal(sanitizeOpacity("-0.2"), 0.0);
  assert.equal(sanitizeOpacity("invalid"), 1.0);
});
