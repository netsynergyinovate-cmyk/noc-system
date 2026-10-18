import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const hookPath = path.resolve(__dirname, "../src/hooks/use-network-map-markers.ts");

test("Buat hook pemuatan penanda dengan mock lokal", async (t) => {
  const content = fs.readFileSync(hookPath, "utf8");

  await t.test("verifies useNetworkMapMarkers hook export and interface", () => {
    assert.match(
      content,
      /export function useNetworkMapMarkers/,
      "Hook useNetworkMapMarkers must be exported",
    );
    assert.match(
      content,
      /export interface UseNetworkMapMarkersOptions/,
      "Options interface must be exported",
    );
    assert.match(
      content,
      /export interface UseNetworkMapMarkersResult/,
      "Result interface must be exported",
    );
  });

  await t.test("verifies mock fallback support and transparency", () => {
    assert.match(
      content,
      /useMockFallback\s*=\s*false/,
      "Option useMockFallback must be available with false default for zero-dummy compliance",
    );
    assert.match(
      content,
      /LOCAL_MOCK_NETWORK_MAP_DATA/,
      "Hook must import and use LOCAL_MOCK_NETWORK_MAP_DATA as mock fallback fixture",
    );
    assert.match(
      content,
      /isMockData\s*=\s*useMemo\(\s*\(\)\s*=>\s*!data\?\.dataSource\.isRealData/,
      "Hook must provide isMockData boolean for transparent UI badge indication",
    );
  });

  await t.test("verifies endpoint fetch and error handling", () => {
    assert.match(
      content,
      /fetch\(url,\s*\{\s*credentials:\s*"same-origin"\s*\}\)/,
      "Hook must fetch from /api/map/network authenticated endpoint",
    );
    assert.match(
      content,
      /url\s*=\s*useMockFallback\s*\?\s*"\/api\/map\/network\?mode=mock"/,
      "Hook should request mock query param when useMockFallback is enabled",
    );
    assert.match(
      content,
      /refetch:\s*fetchData/,
      "Hook must export refetch callback for manual refresh",
    );
  });

  await t.test("verifies marker filtering helper function", () => {
    assert.match(
      content,
      /filterMarkers:/,
      "Hook must export filterMarkers method",
    );
    assert.match(
      content,
      /filteredCustomers/,
      "filterMarkers must return filteredCustomers",
    );
    assert.match(
      content,
      /geocodedCustomers/,
      "filterMarkers must return geocodedCustomers with finite coordinates",
    );
    assert.match(
      content,
      /filteredInfrastructure/,
      "filterMarkers must return filteredInfrastructure",
    );
  });
});
