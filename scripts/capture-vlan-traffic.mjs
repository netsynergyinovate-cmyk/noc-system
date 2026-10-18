import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function captureVlanTraffic() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: "dark",
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  console.log("1. Mendaftar / login akun operator...");
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `operator-vlan-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator VLAN PON");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });

  console.log("2. Menunggu render dashboard dan data telemetri VLAN...");
  await page.waitForTimeout(3000);

  // Verifikasi keberadaan header VLAN per PON
  const vlanHeading = page.getByText("Trafik VLAN per PON OLT (MikroTik Core CIARA)", { exact: false });
  await vlanHeading.waitFor({ state: "visible", timeout: 10000 });
  console.log("✓ Bagian 'Trafik VLAN per PON OLT (MikroTik Core CIARA)' ditemukan di DOM.");

  // Tunggu agar data polling pertama selesai
  await page.waitForTimeout(2000);

  fs.mkdirSync(path.resolve(process.cwd(), "screenshots"), { recursive: true });

  const screenshotPath1 = path.resolve(process.cwd(), "screenshots", "08-vlan-pon-traffic-board.png");
  await page.screenshot({ path: screenshotPath1, fullPage: true });
  console.log(`✓ Screenshot board tersimpan di ${screenshotPath1}`);

  // Hover di kanvas PON 1 untuk verifikasi inspeksi kursor
  console.log("3. Menguji hover inspeksi titik pada grafik PON 1 (vlan1101)...");
  const canvasPon1 = page.locator("canvas").first();
  const box = await canvasPon1.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5);
    await page.waitForTimeout(600);
    const screenshotPath2 = path.resolve(process.cwd(), "screenshots", "08-vlan-pon-hover-inspection.png");
    await page.screenshot({ path: screenshotPath2 });
    console.log(`✓ Screenshot hover inspeksi tersimpan di ${screenshotPath2}`);
  }

  // 4. Uji interaksi rentang waktu (1 jam dan 24 jam)
  console.log("4. Menguji seleksi rentang waktu pada RangePicker...");
  const rangePickerButtons = page.getByRole("group", { name: "Rentang waktu grafik" });
  const vlanSection = page.locator("div").filter({ hasText: "Trafik VLAN per PON OLT" }).last();
  
  // Klik tombol "1 jam" pada board VLAN
  const btn1h = vlanSection.getByRole("button", { name: "1 jam" });
  if (await btn1h.count() > 0) {
    await btn1h.first().click();
    console.log("✓ Tombol rentang '1 jam' diklik.");
    await page.waitForTimeout(1500);
    const screenshotPath3 = path.resolve(process.cwd(), "screenshots", "08-vlan-pon-range-1h.png");
    await page.screenshot({ path: screenshotPath3 });
    console.log(`✓ Screenshot rentang 1 jam tersimpan di ${screenshotPath3}`);
  }

  // Klik tombol "24 jam" pada board VLAN
  const btn24h = vlanSection.getByRole("button", { name: "24 jam" });
  if (await btn24h.count() > 0) {
    await btn24h.first().click();
    console.log("✓ Tombol rentang '24 jam' diklik.");
    await page.waitForTimeout(1500);
    const screenshotPath4 = path.resolve(process.cwd(), "screenshots", "08-vlan-pon-range-24h.png");
    await page.screenshot({ path: screenshotPath4 });
    console.log(`✓ Screenshot rentang 24 jam tersimpan di ${screenshotPath4}`);
  }

  // Kembalikan ke "5 menit" (live)
  const btn5m = vlanSection.getByRole("button", { name: "5 menit" });
  if (await btn5m.count() > 0) {
    await btn5m.first().click();
    console.log("✓ Dikembalikan ke rentang '5 menit' (live).");
    await page.waitForTimeout(1000);
  }

  await browser.close();
  console.log("✓ Selesai menguji seluruh rentang dan mengambil bukti visual trafik VLAN per PON.");
}

captureVlanTraffic().catch((err) => {
  console.error("Gagal capture VLAN:", err);
  process.exit(1);
});
