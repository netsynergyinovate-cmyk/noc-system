import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("route /api/deploy/health terdefinisi dan mengekspor method GET", () => {
  const filePath = path.resolve("src/app/api/deploy/health/route.ts");
  assert.ok(
    fs.existsSync(filePath),
    "File /api/deploy/health/route.ts harus ada",
  );

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export async function GET"));
  assert.ok(content.includes("getRealSystemHealthChecks"));
  assert.ok(content.includes("getRealDeploySafetyOverview"));
  assert.ok(content.includes("healthScore"));
  assert.ok(content.includes("checks"));
});
