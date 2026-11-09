import { chromium } from "playwright";
import fs from "node:fs";

async function verifyBilling() {
  console.log(
    "=== 1. Launching browser to test Billing page & live RunsNet sync ===",
  );
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  page.on("console", (msg) =>
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`),
  );

  console.log("2. Sign up / login operator...");
  await page.goto("http://localhost:3000/sign-up", {
    waitUntil: "domcontentloaded",
  });
  const email = `operator-billing-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Billing Operator");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Kata sandi", { exact: true })
    .fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });

  console.log("3. Navigating to /app/billing...");
  await page.goto("http://localhost:3000/app/billing", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);

  fs.mkdirSync("screenshots/billing", { recursive: true });
  await page.screenshot({ path: "screenshots/billing/01-before-sync.png" });
  console.log("Screenshot before sync saved.");

  console.log("4. Clicking 'Sinkronkan Sekarang' button...");
  const syncBtn = page.getByRole("button", { name: "Sinkronkan Sekarang" });
  await syncBtn.waitFor({ state: "visible", timeout: 5000 });
  await syncBtn.click();

  console.log(
    "5. Waiting for live sync from https://app.runsnet.id to finish (may take 10-25s)...",
  );
  // Tunggu sampai tombol tidak lagi berputar / teks kembali ke "Sinkronkan Sekarang"
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(
        'button[data-testid="runsnet-billing-board"] button, button:has-text("Sinkronkan")',
      );
      return !btn || !btn.textContent?.includes("Menyinkronkan");
    },
    { timeout: 60000 },
  );

  await page.waitForTimeout(3000);

  // Screenshot tab 1: Pelanggan
  await page.screenshot({
    path: "screenshots/billing/02-after-sync-customers.png",
    fullPage: true,
  });
  console.log("Screenshot tab Pelanggan saved.");

  // Screenshot tab 2: Invoices
  console.log("6. Clicking tab 'Invoice Tagihan'...");
  await page.getByRole("button", { name: /Invoice Tagihan/i }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: "screenshots/billing/03-invoices-tab.png",
    fullPage: true,
  });
  console.log("Screenshot tab Invoice saved.");

  // Screenshot tab 3: Payments
  console.log("7. Clicking tab 'Riwayat Payment'...");
  await page.getByRole("button", { name: /Riwayat Payment/i }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: "screenshots/billing/04-payments-tab.png",
    fullPage: true,
  });
  console.log("Screenshot tab Payment saved.");

  await browser.close();
}

verifyBilling().catch(console.error);
