import { chromium } from "playwright";
import fs from "node:fs";
import pg from "pg";

if (!fs.existsSync("screenshots")) {
  fs.mkdirSync("screenshots", { recursive: true });
}

const pool = new pg.Pool({
  connectionString:
    "postgresql://starter:starter_password@127.0.0.1:5432/starter",
});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    consoleErrors.push(msg.text());
  }
});
page.on("pageerror", (err) => {
  consoleErrors.push(err.message);
});

try {
  console.log("--> 1. Mengautentikasi pengguna operator...");
  await page.goto("http://localhost:3000/sign-up");
  await page.getByLabel("Nama", { exact: true }).fill("Operator NOC");
  const testEmail = "operator-" + Date.now() + "@noc.local";
  await page.getByLabel("Email", { exact: true }).fill(testEmail);
  await page
    .getByLabel("Kata sandi", { exact: true })
    .fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 10000 });

  console.log("--> 2. Membuka halaman peta /app/peta...");
  await page.goto("http://localhost:3000/app/peta");
  await page.waitForTimeout(3000);

  // Ambil tangkapan layar tampilan awal peta
  await page.screenshot({ path: "screenshots/plot-step-1-initial-map.png" });
  console.log("    Tersimpan: screenshots/plot-step-1-initial-map.png");

  // Periksa ketersediaan tombol pemicu plotting
  console.log("--> 3. Membuka modal pemilih pelanggan koordinat...");
  const startPlotBtn = page.locator(
    '[data-testid="start-plot-customer-button"]',
  );
  const toolbarPlotBtn = page.locator(
    '[data-testid="open-customer-coordinate-picker-button"]',
  );

  if (await startPlotBtn.isVisible()) {
    console.log(
      "    Mengklik tombol 'Tentukan Titik di Peta Sekarang' dari banner empty state...",
    );
    await startPlotBtn.click();
  } else {
    console.log("    Mengklik tombol 'Tentukan Titik' dari bilah alat atas...");
    await toolbarPlotBtn.click();
  }

  // Tunggu modal muncul
  await page.waitForSelector(
    '[data-testid="customer-coordinate-picker-dialog"]',
    { timeout: 5000 },
  );
  await page.screenshot({ path: "screenshots/plot-step-2-picker-modal.png" });
  console.log("    Tersimpan: screenshots/plot-step-2-picker-modal.png");

  // Cari FEBRIANTO di input pencarian
  console.log(
    "--> 4. Mencari pelanggan belum terpetakan 'FEBRIANTO' di daftar...",
  );
  await page.locator('[data-testid="picker-search-input"]').fill("FEBRIANTO");
  await page.waitForTimeout(500);

  // Pilih item pelanggan FEBRIANTO
  const custItem = page
    .locator('[data-testid^="customer-picker-item-"]')
    .first();
  await custItem.waitFor({ state: "visible", timeout: 5000 });
  await page.screenshot({
    path: "screenshots/plot-step-3-filtered-customer.png",
  });
  console.log("    Tersimpan: screenshots/plot-step-3-filtered-customer.png");

  console.log("    Memilih pelanggan FEBRIANTO untuk di-plot...");
  const selectPlotBtn = page
    .locator('[data-testid^="select-customer-plot-"]')
    .first();
  if (await selectPlotBtn.isVisible()) {
    await selectPlotBtn.click();
  } else {
    await custItem.click();
  }

  // Tunggu dialog tertutup dan banner plotting aktif muncul
  await page.waitForSelector(
    '[data-testid="customer-coordinate-picker-dialog"]',
    { state: "hidden", timeout: 5000 },
  );
  await page.waitForSelector('[data-testid="customer-plotting-banner"]', {
    timeout: 5000,
  });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: "screenshots/plot-step-4-plotting-mode-active.png",
  });
  console.log(
    "    Tersimpan: screenshots/plot-step-4-plotting-mode-active.png",
  );

  // Klik di kanvas peta Leaflet untuk meletakkan titik
  console.log(
    "--> 5. Menentukan titik koordinat dengan mengklik kanvas peta...",
  );
  const mapElement = page.locator(".leaflet-container");
  const mapBox = await mapElement.boundingBox();
  if (mapBox) {
    // Klik di tengah peta
    const clickX = mapBox.x + mapBox.width / 2;
    const clickY = mapBox.y + mapBox.height / 2;
    await page.mouse.click(clickX, clickY);
  }

  await page.waitForTimeout(1000);

  // Periksa floating card konfirmasi muncul
  console.log("--> 6. Memvalidasi floating card konfirmasi plotting...");
  const confirmCard = page.locator(
    '[data-testid="customer-coordinate-confirmation-card"]',
  );
  await confirmCard.waitFor({ state: "visible", timeout: 5000 });
  await page.screenshot({
    path: "screenshots/plot-step-5-confirmation-card.png",
  });
  console.log("    Tersimpan: screenshots/plot-step-5-confirmation-card.png");

  // Klik Simpan ke Database
  console.log("--> 7. Mengklik 'Simpan ke Database'...");
  const saveBtn = page.locator(
    '[data-testid="save-customer-coordinate-button"]',
  );
  await saveBtn.click();

  // Tunggu proses penyimpanan PATCH selesai
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "screenshots/plot-step-6-saved-marker.png" });
  console.log("    Tersimpan: screenshots/plot-step-6-saved-marker.png");

  // Verifikasi langsung ke database PostgreSQL
  console.log(
    "--> 8. Memverifikasi data riil di tabel customers PostgreSQL...",
  );
  const dbResult = await pool.query(
    "SELECT id, name, pppoe_username, latitude, longitude FROM customers WHERE name ILIKE '%FEBRIANTO%';",
  );
  console.log("    Hasil PostgreSQL FEBRIANTO:", dbResult.rows[0]);

  if (!dbResult.rows[0]?.latitude || !dbResult.rows[0]?.longitude) {
    throw new Error(
      "Gagal: Kolom latitude atau longitude di PostgreSQL masih null!",
    );
  }

  console.log(
    "✅ BERHASIL: Koordinat pelanggan FEBRIANTO tersimpan di database:",
  );
  console.log(`   Latitude: ${dbResult.rows[0].latitude}`);
  console.log(`   Longitude: ${dbResult.rows[0].longitude}`);

  // ==========================================
  // ALUR 2: Klik Peta Bebas -> Card Inspeksi -> Tautkan ke Pelanggan -> Simpan
  // ==========================================
  console.log(
    "--> 9. Menguji Alur 2: Klik peta bebas untuk inspeksi koordinat...",
  );
  if (mapBox) {
    // Klik di area kanan peta
    const clickX2 = mapBox.x + mapBox.width * 0.65;
    const clickY2 = mapBox.y + mapBox.height * 0.45;
    await page.mouse.click(clickX2, clickY2);
  }

  await page.waitForTimeout(1000);
  const inspectCard = page.locator('[data-testid="inspected-map-coord-card"]');
  await inspectCard.waitFor({ state: "visible", timeout: 5000 });
  await page.screenshot({
    path: "screenshots/plot-step-7-map-click-inspected.png",
  });
  console.log("    Tersimpan: screenshots/plot-step-7-map-click-inspected.png");

  // Klik tombol Plot Pelanggan dari card inspeksi
  console.log("--> 10. Mengklik 'Plot Pelanggan' dari kartu inspeksi...");
  await page.locator('[data-testid="plot-inspected-customer-button"]').click();

  // Dialog pemilih terbuka dengan banner koordinat terisi (prefilled)
  await page.waitForSelector(
    '[data-testid="customer-coordinate-picker-dialog"]',
    { timeout: 5000 },
  );
  await page.screenshot({
    path: "screenshots/plot-step-8-prefilled-modal.png",
  });
  console.log("    Tersimpan: screenshots/plot-step-8-prefilled-modal.png");

  // Cari MAS HASAN
  console.log("--> 11. Mencari dan memilih 'MAS HASAN'...");
  await page.locator('[data-testid="picker-search-input"]').fill("MAS HASAN");
  await page.waitForTimeout(500);

  const hasanPlotBtn = page
    .locator('[data-testid^="select-customer-plot-"]')
    .first();
  await hasanPlotBtn.waitFor({ state: "visible", timeout: 5000 });
  await hasanPlotBtn.click();

  // Mode plotting dengan koordinat yang sudah ditentukan dari klik awal
  await page.waitForSelector(
    '[data-testid="customer-coordinate-confirmation-card"]',
    { timeout: 5000 },
  );
  await page.screenshot({
    path: "screenshots/plot-step-9-hasan-confirmation.png",
  });
  console.log("    Tersimpan: screenshots/plot-step-9-hasan-confirmation.png");

  // Klik Simpan ke Database
  console.log("--> 12. Menyimpan koordinat MAS HASAN ke database...");
  await page.locator('[data-testid="save-customer-coordinate-button"]').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "screenshots/plot-step-10-hasan-saved.png" });
  console.log("    Tersimpan: screenshots/plot-step-10-hasan-saved.png");

  // Verifikasi di PostgreSQL
  const dbResult2 = await pool.query(
    "SELECT id, name, pppoe_username, latitude, longitude FROM customers WHERE name ILIKE '%MAS HASAN%';",
  );
  console.log("    Hasil PostgreSQL MAS HASAN:", dbResult2.rows[0]);

  if (!dbResult2.rows[0]?.latitude || !dbResult2.rows[0]?.longitude) {
    throw new Error(
      "Gagal: Kolom latitude atau longitude MAS HASAN di PostgreSQL masih null!",
    );
  }

  console.log(
    "✅ BERHASIL: Koordinat MAS HASAN berhasil tersimpan di database:",
  );
  console.log(`   Latitude: ${dbResult2.rows[0].latitude}`);
  console.log(`   Longitude: ${dbResult2.rows[0].longitude}`);
} catch (err) {
  console.error("❌ Terjadi kegagalan verifikasi:", err);
  process.exit(1);
} finally {
  await browser.close();
  await pool.end();
}

console.log("==========================================");
console.log(`TOTAL CONSOLE ERRORS: ${consoleErrors.length}`);
if (consoleErrors.length > 0) {
  console.log("CONSOLE ERRORS DETECTED:", consoleErrors);
}
console.log("E2E VERIFIKASI SELESAI DENGAN SUKSES!");
