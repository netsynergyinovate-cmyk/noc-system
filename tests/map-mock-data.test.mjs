import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mockModulePath = path.resolve(__dirname, "../src/services/network-map-mock.ts");
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");
const pagePath = path.resolve(__dirname, "../src/app/(protected)/app/peta/page.tsx");

test("Local Mock Map Data and Fallback Implementation", async (t) => {
  const mockContent = fs.readFileSync(mockModulePath, "utf8");
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const pageContent = fs.readFileSync(pagePath, "utf8");

  await t.test("verifies mock map data structure adheres to NetworkMapData contract", () => {
    assert.match(
      mockContent,
      /export const LOCAL_MOCK_NETWORK_MAP_DATA: NetworkMapData/,
      "LOCAL_MOCK_NETWORK_MAP_DATA must be exported with strict type",
    );
    assert.match(
      mockContent,
      /export function getLocalMockMapData\(\): NetworkMapData/,
      "getLocalMockMapData function must be exported",
    );
    assert.match(
      mockContent,
      /isRealData:\s*false/,
      "Mock data source must explicitly set isRealData to false for zero-dummy transparency",
    );
  });

  await t.test("verifies mock customer points have valid coordinates and optical levels", () => {
    assert.match(mockContent, /id:\s*"mock-cust-01"/, "Must contain mock customer points");
    assert.match(mockContent, /latitude:\s*MUKOMUKO_CENTER\.lat/, "Must use Mukomuko coordinates");
    assert.match(mockContent, /opticalPower:\s*-18\.4/, "Must include realistic optical power levels");
    assert.match(mockContent, /odpName:\s*"ODP-TTJ-01"/, "Must associate with ODP");
  });

  await t.test("verifies mock infrastructure contains Router, OLT, and ODPs", () => {
    assert.match(mockContent, /type:\s*"router"/, "Must contain router infrastructure point");
    assert.match(mockContent, /type:\s*"olt"/, "Must contain OLT infrastructure point");
    assert.match(mockContent, /type:\s*"odp"/, "Must contain ODP distribution boxes");
  });

  await t.test("verifies UI displays transparent badge and indicators when mock data is used", () => {
    assert.match(
      pageContent,
      /data-testid="data-source-badge"/,
      "Peta page must display data-source-badge reflecting whether data is real or mock",
    );
    assert.match(
      pageContent,
      /Data Mock Lokal/,
      "Peta page must indicate Data Mock Lokal when isRealData is false",
    );
    assert.match(
      mapContent,
      /data-testid="mock-data-indicator"/,
      "NetworkMap must render mock-data-indicator banner when isRealData is false",
    );
  });
});
