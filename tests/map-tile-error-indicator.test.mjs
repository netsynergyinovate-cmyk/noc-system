import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");

test("Tile Error Indicator verification", async (t) => {
  const content = fs.readFileSync(networkMapPath, "utf8");

  await t.test("verifies TileLayer attaches tileerror event handler", () => {
    assert.match(
      content,
      /eventHandlers=\{\{\s*tileerror:\s*\(\)\s*=>/,
      "TileLayer should listen to tileerror event to track failed tile requests",
    );
    assert.match(
      content,
      /setTileErrorCount\(\(prev\)\s*=>\s*prev\s*\+\s*1\)/,
      "tileerror handler should increment tile error counter",
    );
  });

  await t.test("verifies tile error banner indicator element and accessibility", () => {
    assert.match(
      content,
      /data-testid="tile-error-banner"/,
      "Map should render a visible banner with data-testid='tile-error-banner' when tiles fail",
    );
    assert.match(
      content,
      /role="alert"/,
      "Tile error banner should have role='alert' for screen-reader accessibility",
    );
    assert.match(
      content,
      /data-testid="dismiss-tile-error"/,
      "Tile error banner must provide a dismiss button",
    );
  });

  await t.test("verifies fallback layer switches and retry action", () => {
    assert.match(
      content,
      /data-testid="switch-to-streets-fallback"/,
      "Tile error banner should offer fallback button to switch to OpenStreetMap",
    );
    assert.match(
      content,
      /data-testid="switch-to-satellite-fallback"/,
      "Tile error banner should offer fallback button to switch to Esri Satellite",
    );
    assert.match(
      content,
      /data-testid="retry-tiles-button"/,
      "Tile error banner should provide a retry button to reload tiles",
    );
  });

  await t.test("verifies switching layer resets tile error counter", () => {
    assert.match(
      content,
      /const handleLayerChange = useCallback/,
      "handleLayerChange should be a callback that resets tile error count on layer switch",
    );
    assert.match(
      content,
      /setTileErrorCount\(0\)/,
      "handleLayerChange must reset tileErrorCount to 0",
    );
  });
});
