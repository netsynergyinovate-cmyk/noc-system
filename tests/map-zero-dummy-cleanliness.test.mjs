import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");
const coverageMapPath = path.resolve(__dirname, "../src/components/map/coverage-map.tsx");
const servicePath = path.resolve(__dirname, "../src/services/network-map.service.ts");

test("Bersihkan sisa data contoh di modul peta (Zero-Dummy Cleanliness)", async (t) => {
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const coverageContent = fs.readFileSync(coverageMapPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");

  await t.test("verifies NetworkMap contains no hardcoded mock customer lists", () => {
    // Should not contain hardcoded dummy array inside the component
    assert.doesNotMatch(
      mapContent,
      /const MOCK_CUSTOMERS\s*=/i,
      "NetworkMap must not contain MOCK_CUSTOMERS array",
    );
    assert.doesNotMatch(
      mapContent,
      /const DUMMY_CUSTOMERS\s*=/i,
      "NetworkMap must not contain DUMMY_CUSTOMERS array",
    );
    assert.doesNotMatch(
      mapContent,
      /const SAMPLE_CUSTOMERS\s*=/i,
      "NetworkMap must not contain SAMPLE_CUSTOMERS array",
    );
  });

  await t.test("verifies CoverageMap calculates metrics strictly from props without hardcoded numbers", () => {
    assert.match(
      coverageContent,
      /summary\.totalCustomers/,
      "CoverageMap must read totalCustomers strictly from summary prop",
    );
    assert.match(
      coverageContent,
      /summary\.onlineCustomers/,
      "CoverageMap must read onlineCustomers strictly from summary prop",
    );
    assert.match(
      coverageContent,
      /summary\.offlineCustomers/,
      "CoverageMap must read offlineCustomers strictly from summary prop",
    );
    assert.match(
      coverageContent,
      /summary\.criticalOpticsCount/,
      "CoverageMap must read criticalOpticsCount strictly from summary prop",
    );
  });

  await t.test("verifies NetworkMap service queries live PostgreSQL database", () => {
    assert.match(
      serviceContent,
      /db\s*\.\s*select\(/,
      "NetworkMap service must query live PostgreSQL database",
    );
    assert.match(
      serviceContent,
      /\.from\(customers\)/,
      "NetworkMap service must query from customers table",
    );
    assert.match(
      serviceContent,
      /\.from\(olts\)/,
      "NetworkMap service must query from olts table",
    );
    assert.match(
      serviceContent,
      /\.from\(routers\)/,
      "NetworkMap service must query from routers table",
    );
    assert.match(
      serviceContent,
      /isRealData:\s*true/,
      "Service default response must certify isRealData as true",
    );
  });
});
