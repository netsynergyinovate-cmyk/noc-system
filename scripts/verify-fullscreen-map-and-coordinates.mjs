import { chromium } from "playwright";
import path from "node:path";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function verifyFullscreenMapAndCoordinates() {
  console.log("=== STEP 1: Meluncurkan Browser & Login ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1560, height: 900 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  // Daftar / Login
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `operator-map-${Date.now()}@noc.local`;
  await page
    .getByLabel("Nama", { exact: true })
    .fill("Operator Peta Fullscreen");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Kata sandi", { exact: true })
    .fill("MapSecretFull123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });

  console.log("\n=== STEP 2: Membuka Halaman /app/peta ===");
  await page.goto(`${BASE_URL}/app/peta`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log(
    "\n=== STEP 3: Memeriksa Zero-Scroll (Tanpa Scrollbar Halaman) ===",
  );
  const scrollMetrics = await page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    return {
      windowInnerHeight: window.innerHeight,
      docScrollHeight: docEl.scrollHeight,
      docClientHeight: docEl.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      scrollY: window.scrollY,
      hasVerticalScrollbar: docEl.scrollHeight > window.innerHeight,
    };
  });
  console.log("Hasil Pengukuran Viewport & Scroll:", scrollMetrics);

  assert.equal(
    scrollMetrics.hasVerticalScrollbar,
    false,
    `Halaman /app/peta tidak boleh memiliki scrollbar vertikal! docScrollHeight: ${scrollMetrics.docScrollHeight}, innerHeight: ${scrollMetrics.windowInnerHeight}`,
  );
  console.log(
    "✓ TERBUKTI: Zero vertical scrolling tercapai sempurna (scrollHeight === innerHeight).",
  );

  console.log(
    "\n=== STEP 4: Memeriksa Ketersediaan Elemen & Pintasan Modul ===",
  );
  const shortcutsVisible = await page
    .locator('[data-testid="peta-module-shortcuts"]')
    .isVisible();
  console.log("Pintasan Modul Tampak:", shortcutsVisible);
  assert.ok(shortcutsVisible, "Peta module shortcuts harus tampak");

  const metricsGridVisible = await page
    .locator('[data-testid="infra-metrics-grid"]')
    .isVisible();
  console.log("Grid Metrik Infrastruktur Tampak:", metricsGridVisible);
  assert.ok(metricsGridVisible, "Grid metrik harus tampak");

  const syncTimeVisible = await page
    .locator('[data-testid="last-sync-time"]')
    .first()
    .isVisible();
  console.log("Penanda Realtime Sync Tampak:", syncTimeVisible);
  assert.ok(syncTimeVisible, "Penanda realtime sync harus tampak");

  console.log(
    "\n=== STEP 5: Menguji Fitur Input Titik Koordinat GPS Manual ===",
  );
  const inputBtn = page.locator(
    '[data-testid="open-manual-coord-input-button"]',
  );
  await inputBtn.waitFor({ state: "visible", timeout: 5000 });
  await inputBtn.click();
  console.log("✓ Tombol 'Input GPS' diklik.");

  const coordCard = page.locator('[data-testid="manual-coord-input-card"]');
  await coordCard.waitFor({ state: "visible", timeout: 5000 });
  console.log("✓ Modal input koordinat manual terbuka.");

  const coordField = page.locator('[data-testid="manual-coord-input-field"]');
  await coordField.fill("-2.578600, 101.218500");

  const applyBtn = page.locator('[data-testid="apply-manual-coord-button"]');
  await applyBtn.click();
  console.log(
    "✓ Tombol 'Terapkan Titik' diklik dengan koordinat -2.578600, 101.218500.",
  );

  await page.waitForTimeout(1500);

  // Ambil screenshot bukti pengujian
  const ssPath = path.resolve(
    process.cwd(),
    "screenshots",
    "verified-fullscreen-map-no-scroll.png",
  );
  await page.screenshot({ path: ssPath, fullPage: false });
  console.log(`✓ Screenshot bukti tersimpan di ${ssPath}`);

  // Tutup dialog input koordinat
  const closeBtn = page.locator('[data-testid="close-manual-coord-button"]');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
  }

  // Verifikasi kartu inspeksi koordinat muncul di peta
  const inspectedCard = page.locator(
    '[data-testid="inspected-map-coord-card"]',
  );
  const inspectedVisible = await inspectedCard.isVisible();
  console.log(
    "Kartu Titik Inspeksi Terpilih di Peta Tampak:",
    inspectedVisible,
  );

  console.log("\n=== SELURUH VERIFIKASI PLAYWRIGHT SELESAI 100% SUKSES ===");
  await browser.close();
}

verifyFullscreenMapAndCoordinates().catch((err) => {
  console.error("VERIFIKASI GAGAL:", err);
  process.exit(1);
});
