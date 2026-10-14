import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

register();

const {
  getPageTipContent,
  getAllPageTipsContent,
  savePageTipContent,
  resetTutorialContentOverrides,
} = await import("../src/services/tutorial-content.service.ts");

test("getPageTipContent membaca tips untuk rute dasbor utama /app", async () => {
  resetTutorialContentOverrides();
  const tip = await getPageTipContent("/app");
  assert.ok(tip);
  assert.equal(tip.pagePath, "/app");
  assert.equal(tip.pageTitle, "Dasbor Utama NOC");
  assert.ok(tip.summary);
  assert.ok(tip.metrics.length > 0);
  assert.ok(tip.troubleshooting.length > 0);
});

test("savePageTipContent menyimpan konten tips kustom dan dapat dibaca kembali", async () => {
  const customTip = {
    pagePath: "/app/custom-test",
    pageTitle: "Halaman Uji Coba",
    summary: "Ringkasan uji coba penyimpanan tips.",
    metrics: [{ name: "Uji Metrik", description: "Deskripsi metrik uji" }],
    troubleshooting: [{ issue: "Masalah uji", solution: "Solusi uji" }],
  };

  await savePageTipContent(customTip);

  const retrieved = await getPageTipContent("/app/custom-test");
  assert.ok(retrieved);
  assert.equal(retrieved.pageTitle, "Halaman Uji Coba");
  assert.equal(retrieved.summary, customTip.summary);
});

test("getAllPageTipsContent mengembalikan seluruh daftar tips terdaftar", async () => {
  const all = await getAllPageTipsContent();
  assert.ok(Object.keys(all).length >= 10);
  assert.ok(all["/app"]);
  assert.ok(all["/app/alert"]);
  assert.ok(all["/app/cpe"]);
});

test("Route handler /api/tutorial/content mengekspor method GET dan POST", async () => {
  const route = await import("../src/app/api/tutorial/content/route.ts");
  assert.equal(typeof route.GET, "function");
  assert.equal(typeof route.POST, "function");
});
