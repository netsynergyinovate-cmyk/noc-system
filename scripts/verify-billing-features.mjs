import { chromium } from "playwright";
import fs from "node:fs";

async function verifyBillingFeatures() {
  console.log(
    "=== 1. Starting Playwright Verification for Billing Features ===",
  );
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  console.log("2. Sign up / login operator...");
  await page.goto("http://localhost:3000/sign-up", {
    waitUntil: "domcontentloaded",
  });
  const email = `operator-billing-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Billing Inspector");
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
  await page.waitForTimeout(3000);

  fs.mkdirSync("screenshots/billing", { recursive: true });

  // 1. Screenshot Tab Pelanggan Menunggak
  console.log("4. Capturing screenshot: Tab Pelanggan Menunggak...");
  await page.screenshot({
    path: "screenshots/billing/05-delinquent-customers.png",
    fullPage: true,
  });

  // 2. Click Detail on first delinquent customer
  console.log("5. Opening detail modal for first delinquent customer...");
  const detailBtn = page.getByRole("button", { name: "Detail" }).first();
  if ((await detailBtn.count()) > 0) {
    await detailBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: "screenshots/billing/06-customer-detail-modal.png",
    });
    console.log("Screenshot modal saved.");

    // Close modal
    const closeBtn = page.locator("button:has(svg.lucide-x)").first();
    if ((await closeBtn.count()) > 0) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  }

  // 3. Filter per Bulan: pilih "2026-10" (Oktober 2026)
  console.log("6. Testing filter per bulan: Oktober 2026 (2026-10)...");
  const periodSelect = page.locator("select").first();
  if ((await periodSelect.count()) > 0) {
    await periodSelect.selectOption("2026-10");
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: "screenshots/billing/07-filter-month-october.png",
      fullPage: true,
    });
    console.log("Screenshot filter month saved.");
  }

  // 4. Switch to Invoice Tab & click "Belum Bayar"
  console.log(
    "7. Switching to Invoice Tagihan tab & filtering 'Belum Bayar'...",
  );
  const invoiceTabBtn = page.getByRole("button", { name: /Invoice Tagihan/i });
  await invoiceTabBtn.click();
  await page.waitForTimeout(1500);

  const unpaidBtn = page.getByRole("button", { name: "Belum Bayar" });
  if ((await unpaidBtn.count()) > 0) {
    await unpaidBtn.click();
    await page.waitForTimeout(1500);
  }
  await page.screenshot({
    path: "screenshots/billing/08-unpaid-invoices.png",
    fullPage: true,
  });
  console.log("Screenshot unpaid invoices saved.");

  // 5. Switch to Payment Tab
  console.log("8. Switching to Riwayat Payment tab...");
  const paymentTabBtn = page.getByRole("button", { name: /Riwayat Payment/i });
  await paymentTabBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: "screenshots/billing/09-payments-history.png",
    fullPage: true,
  });
  console.log("Screenshot payments history saved.");

  await browser.close();
  console.log("All verifications completed successfully!");
}

verifyBillingFeatures().catch(console.error);
