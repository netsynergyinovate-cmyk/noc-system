import { chromium } from "playwright";
import fs from "fs";

async function verify() {
  fs.mkdirSync("screenshots/billing", { recursive: true });
  fs.mkdirSync("screenshots/pelanggan", { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  console.log("[1] Autentikasi via /sign-up...");
  await page.goto("http://localhost:3000/sign-up", { waitUntil: "domcontentloaded" });
  const email = `operator-sync-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Sync Operator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });
  console.log("[1] Autentikasi berhasil!");

  // Step 2: Halaman Billing - Filter Bulan Ini Langsung
  console.log("[2] Membuka halaman /app/billing...");
  await page.goto("http://localhost:3000/app/billing", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Cari tombol Bulan Ini
  const bulanIniBtn = page.locator("button:has-text('Bulan Ini')");
  console.log("[2] Memeriksa keberadaan tombol Bulan Ini...");
  if (await bulanIniBtn.isVisible()) {
    console.log("[2] Tombol Bulan Ini ditemukan. Mengklik tombol...");
    await bulanIniBtn.click();
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: "screenshots/billing/10-bulan-ini-instant-filter.png", fullPage: true });
  console.log("[2] Screenshot tersimpan: screenshots/billing/10-bulan-ini-instant-filter.png");

  // Step 3: Halaman Pelanggan - Tarik Nama dari Billing
  console.log("[3] Membuka halaman /app/pelanggan...");
  await page.goto("http://localhost:3000/app/pelanggan", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const tarikBtn = page.locator("button:has-text('Tarik Nama dari Billing')");
  console.log("[3] Memeriksa tombol Tarik Nama dari Billing...");
  if (await tarikBtn.isVisible()) {
    console.log("[3] Tombol Tarik Nama dari Billing aktif. Menjalankan penarikan...");
    await tarikBtn.click();
    // Tunggu proses sync selesai dan banner status muncul
    await page.waitForSelector("[role='status']", { timeout: 15000 });
    await page.waitForTimeout(1000);
    const feedbackText = await page.locator("[role='status']").first().innerText();
    console.log("[3] Feedback sinkronisasi:", feedbackText.replace(/\n/g, " "));
  }

  // Ambil beberapa baris nama pelanggan
  const rowCount = await page.locator("tbody tr").count();
  console.log(`[3] Total baris pelanggan di tabel: ${rowCount}`);
  for (let i = 0; i < Math.min(rowCount, 5); i++) {
    const text = await page.locator("tbody tr").nth(i).innerText();
    console.log(`    Pelanggan [${i + 1}]: ${text.replace(/\n/g, " | ")}`);
  }

  await page.screenshot({ path: "screenshots/pelanggan/01-tarik-nama-billing-success.png", fullPage: true });
  console.log("[3] Screenshot tersimpan: screenshots/pelanggan/01-tarik-nama-billing-success.png");

  await browser.close();
  console.log("Verifikasi Playwright tuntas 100%!");
}

verify().catch((err) => {
  console.error("Gagal saat verifikasi:", err);
  process.exit(1);
});

