import test from "node:test";
import assert from "node:assert/strict";

const { PAGE_TIPS_REGISTRY, PAGE_TIPS_MOCK_ENTRY, getPageTips } =
  await import("../src/lib/dashboard/page-tips-data.ts");

test("PAGE_TIPS_REGISTRY memuat panduan untuk seluruh halaman penting", () => {
  const paths = Object.keys(PAGE_TIPS_REGISTRY);
  assert.ok(paths.includes("/app"));
  assert.ok(paths.includes("/app/alert"));
  assert.ok(paths.includes("/app/anomali"));
  assert.ok(paths.includes("/app/traffic"));
  assert.ok(paths.includes("/app/cpe"));
  assert.ok(paths.includes("/app/router"));
  assert.ok(paths.includes("/app/netflow"));
  assert.ok(paths.includes("/app/pelanggan"));
  assert.ok(paths.includes("/app/billing"));
  assert.ok(paths.includes("/app/pengaturan"));
  assert.ok(paths.includes("/app/migrasi"));
  assert.ok(paths.includes("/app/sinkronisasi"));
  assert.ok(paths.includes("/app/pengaman-deploy"));
  assert.ok(paths.includes("/app/jejak-aktivitas"));
  assert.ok(paths.includes("/app/ekspor"));
  assert.ok(paths.includes("/app/onboarding"));
});

test("Setiap entri tips memuat fungsi, metrik, dan troubleshooting", () => {
  for (const [p, item] of Object.entries(PAGE_TIPS_REGISTRY)) {
    assert.equal(item.pagePath, p);
    assert.ok(item.summary.length > 10, `Summary halaman ${p} harus jelas`);
    assert.ok(
      item.metrics.length > 0,
      `Metrik halaman ${p} tidak boleh kosong`,
    );
    assert.ok(
      item.troubleshooting.length > 0,
      `Troubleshooting halaman ${p} tidak boleh kosong`,
    );
  }
});

test("getPageTips mengembalikan tips yang sesuai dengan rute", () => {
  const onboardingTips = getPageTips("/app/onboarding");
  assert.ok(onboardingTips);
  assert.equal(onboardingTips.pageTitle, "Pusat Onboarding & Tutorial Wajib");

  const alertTips = getPageTips("/app/alert");
  assert.ok(alertTips);
  assert.equal(alertTips.pageTitle, "Pusat Alert & Insiden Gangguan");

  const nestedRouter = getPageTips("/app/router/queues");
  assert.ok(nestedRouter);
  assert.equal(nestedRouter.pageTitle, "Manajemen Router MikroTik");
});

test("PAGE_TIPS_MOCK_ENTRY terdaftar dengan status dummy", () => {
  assert.equal(PAGE_TIPS_MOCK_ENTRY.status, "dummy");
  assert.ok(PAGE_TIPS_MOCK_ENTRY.readPath.includes("page-tips-data"));
});
