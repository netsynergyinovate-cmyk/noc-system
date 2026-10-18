import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mapConfigPath = path.resolve(__dirname, "../src/config/map.ts");
const envExamplePath = path.resolve(__dirname, "../.env.example");

test("Baca URL tile peta dari pengaturan env", async (t) => {
  const configContent = fs.readFileSync(mapConfigPath, "utf8");
  const envContent = fs.readFileSync(envExamplePath, "utf8");

  await t.test("verifies config reads NEXT_PUBLIC_MAP_SATELLITE_URL from process.env", () => {
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_SATELLITE_URL/,
      "Map config must read NEXT_PUBLIC_MAP_SATELLITE_URL",
    );
  });

  await t.test("verifies config reads NEXT_PUBLIC_MAP_STREETS_URL from process.env", () => {
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_STREETS_URL/,
      "Map config must read NEXT_PUBLIC_MAP_STREETS_URL",
    );
  });

  await t.test("verifies config reads NEXT_PUBLIC_MAP_TOPO_URL from process.env", () => {
    assert.match(
      configContent,
      /process\.env\.NEXT_PUBLIC_MAP_TOPO_URL/,
      "Map config must read NEXT_PUBLIC_MAP_TOPO_URL",
    );
  });

  await t.test("verifies fallback defaults are safe free tile providers", () => {
    assert.match(
      configContent,
      /server\.arcgisonline\.com/,
      "Fallback satellite url must point to Esri World Imagery",
    );
    assert.match(
      configContent,
      /tile\.openstreetmap\.org/,
      "Fallback streets url must point to OpenStreetMap",
    );
  });

  await t.test("verifies .env.example documents map tile environment variables", () => {
    assert.match(
      envContent,
      /NEXT_PUBLIC_MAP_SATELLITE_URL/,
      ".env.example must document NEXT_PUBLIC_MAP_SATELLITE_URL",
    );
    assert.match(
      envContent,
      /NEXT_PUBLIC_MAP_STREETS_URL/,
      ".env.example must document NEXT_PUBLIC_MAP_STREETS_URL",
    );
    assert.match(
      envContent,
      /NEXT_PUBLIC_MAP_TOPO_URL/,
      ".env.example must document NEXT_PUBLIC_MAP_TOPO_URL",
    );
  });
});
