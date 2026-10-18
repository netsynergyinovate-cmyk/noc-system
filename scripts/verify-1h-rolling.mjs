import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function verify1hRolling() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  console.log("1. Mendaftar / login akun operator...");
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `operator-traffic-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator NOC Telemetri");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });

  console.log("2. Memastikan halaman dashboard /app siap...");
  await page.waitForTimeout(2000);

  // Cari tombol '1 jam' pada RangePicker
  console.log("3. Memilih rentang '1 jam'...");
  const btn1h = page.getByRole("button", { name: "1 jam", exact: true });
  await btn1h.click();

  // Tunggu data histori terisi
  await page.waitForTimeout(1500);

  const initialDownload = await page.locator("#traffic-download-val").textContent();
  console.log(`Initial 1h Download Speed: ${initialDownload}`);

  // Simpan screenshot saat pertama kali dibuka pada 1h
  const screenshotPath1 = path.resolve(process.cwd(), "screenshots", "07-traffic-1h-t0.png");
  await page.screenshot({ path: screenshotPath1 });
  console.log(`Screenshot t0 tersimpan di ${screenshotPath1}`);

  console.log("4. Menunggu 6 detik untuk auto-refresh dan pergerakan rolling...");
  await page.waitForTimeout(6000);

  const updatedDownload = await page.locator("#traffic-download-val").textContent();
  console.log(`Updated 1h Download Speed (t+6s): ${updatedDownload}`);

  const screenshotPath2 = path.resolve(process.cwd(), "screenshots", "07-traffic-1h-running.png");
  await page.screenshot({ path: screenshotPath2 });
  console.log(`Screenshot t+6s tersimpan di ${screenshotPath2}`);

  // Verifikasi hover inspeksi pada grafik 1h
  console.log("5. Melakukan hover inspeksi pada grafik 1h...");
  const chartBox = await page.locator("div[role='img']").first().boundingBox();
  if (chartBox) {
    await page.mouse.move(chartBox.x + chartBox.width * 0.75, chartBox.y + chartBox.height * 0.5);
    await page.waitForTimeout(500);
    const inspectedDownload = await page.locator("#traffic-download-val").textContent();
    console.log(`Inspected point speed: ${inspectedDownload}`);
    const screenshotPath3 = path.resolve(process.cwd(), "screenshots", "07-traffic-1h-inspected.png");
    await page.screenshot({ path: screenshotPath3 });
    console.log(`Screenshot inspected tersimpan di ${screenshotPath3}`);
  }

  await browser.close();
  console.log("✓ Selesai memverifikasi 1h rolling traffic.");
}

verify1hRolling().catch((err) => {
  console.error("Gagal verifikasi:", err);
  process.exit(1);
});

