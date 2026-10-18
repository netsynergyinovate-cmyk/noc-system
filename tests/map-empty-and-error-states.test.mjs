import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");

test("Tambah empty state dan error state peta", async (t) => {
  const content = fs.readFileSync(networkMapPath, "utf8");

  await t.test("verifies Error State component and accessibility attributes", () => {
    assert.match(
      content,
      /data-testid="map-error-state"/,
      "Map must render error state container with map-error-state testid",
    );
    assert.match(
      content,
      /role="alert"/,
      "Map error state must have role='alert' for accessibility",
    );
    assert.match(
      content,
      /data-testid="map-error-retry-button"/,
      "Map error state must provide a retry button with map-error-retry-button testid",
    );
    assert.match(
      content,
      /zero-dummy/,
      "Map error state must reinforce zero-dummy policy by explaining fake data is not displayed",
    );
  });

  await t.test("verifies Empty State for uninitialized network", () => {
    assert.match(
      content,
      /data-testid="map-empty-state"/,
      "Map must render empty state container with map-empty-state testid when no devices exist",
    );
    assert.match(
      content,
      /href="\/setup"/,
      "Map empty state must provide a direct shortcut to /setup to onboard devices",
    );
    assert.match(
      content,
      /customers\.length === 0 && data\.infrastructure\.length === 0/,
      "Empty state condition must verify total absence of network infrastructure and customers",
    );
  });

  await t.test("verifies Search Empty State when search query yields no matches", () => {
    assert.match(
      content,
      /data-testid="search-empty-state"/,
      "Map must render search-empty-state when filtering returns no coordinates",
    );
    assert.match(
      content,
      /data-testid="reset-search-button"/,
      "Search empty state must provide a reset button to clear searchQuery",
    );
  });
});
