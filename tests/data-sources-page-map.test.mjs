import test from "node:test";
import assert from "node:assert/strict";

const { PAGE_DATA_SOURCES, getPageDataSourceSummary } = await import(
  "../src/lib/dashboard/data-sources-page-map.ts"
);

test("PAGE_DATA_SOURCES memetakan seluruh rute utama", () => {
  assert.ok(PAGE_DATA_SOURCES.length >= 15);
  const paths = new Set(PAGE_DATA_SOURCES.map((p) => p.pagePath));
  assert.ok(paths.has("/app"));
  assert.ok(paths.has("/app/alert"));
  assert.ok(paths.has("/app/router"));
  assert.ok(paths.has("/app/cpe"));
  assert.ok(paths.has("/app/billing"));
  assert.ok(paths.has("/app/migrasi"));
  assert.ok(paths.has("/app/sinkronisasi"));
  assert.ok(paths.has("/app/pengaman-deploy"));
});

test("getPageDataSourceSummary menghitung metrik kesiapan go-live", () => {
  const sum = getPageDataSourceSummary();
  assert.equal(sum.totalPages, PAGE_DATA_SOURCES.length);
  assert.equal(sum.dummyPages, PAGE_DATA_SOURCES.length);
  assert.equal(sum.nyataPages, 0);
  assert.equal(sum.readinessPercentage, 0);
  assert.ok(sum.totalModules >= 20);
});

test("getPageDataSourceSummary merespons perubahan status dummy ke nyata", () => {
  const modified = PAGE_DATA_SOURCES.map((p, i) =>
    i < 5 ? { ...p, status: "nyata" } : p,
  );
  const sum = getPageDataSourceSummary(modified);
  assert.equal(sum.nyataPages, 5);
  assert.ok(sum.readinessPercentage > 0);
});
