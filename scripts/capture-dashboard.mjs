import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT_FILE = path.resolve(process.cwd(), "screenshots", "01-dashboard-redesign.png");

async function captureDashboard() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  console.log("Melakukan registrasi/sign-in akun pengujian...");
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `operator-test-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator NOC");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });

  console.log("Menunggu render dashboard dan grafik Canvas...");
  await page.waitForTimeout(2000);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  await page.screenshot({ path: OUTPUT_FILE, fullPage: true });

  const stat = fs.statSync(OUTPUT_FILE);
  console.log(`✓ Screenshot dashboard tersimpan di ${OUTPUT_FILE} (${(stat.size / 1024).toFixed(1)} KB)`);

  await browser.close();
}

captureDashboard().catch((err) => {
  console.error("Gagal capture:", err);
  process.exit(1);
});

