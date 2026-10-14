import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("configuration-status-badge.tsx file exists and exports ConfigurationStatusBadge", () => {
  const filePath = path.resolve("src/components/dashboard/configuration-status-badge.tsx");
  assert.ok(fs.existsSync(filePath), "File configuration-status-badge.tsx harus ada");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function ConfigurationStatusBadge"));
  assert.ok(content.includes("config-incomplete-badge"));
  assert.ok(content.includes("Konfigurasi Belum Selesai"));
  assert.ok(content.includes("config-complete-badge"));
  assert.ok(content.includes("Konfigurasi Selesai"));
});
