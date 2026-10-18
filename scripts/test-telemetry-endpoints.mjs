import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  // Monitor network requests and console
  page.on("console", (msg) => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on("requestfailed", (req) => console.log(`[REQ FAILED] ${req.url()}: ${req.failure()?.errorText}`));
  page.on("response", async (res) => {
    if (res.url().includes("/api/network/latency") || res.url().includes("/api/olts/critical-optics") || res.url().includes("/api/alerts")) {
      try {
        const text = await res.text();
        console.log(`[API RESPONSE] ${res.status()} ${res.url()} => ${text.slice(0, 300)}`);
      } catch (e) {
        console.log(`[API RESPONSE ERROR] ${res.status()} ${res.url()}`);
      }
    }
  });

  console.log("1. Sign in to dashboard...");
  await page.goto("http://localhost:3000/sign-up", { waitUntil: "domcontentloaded" });
  const email = `test-verify-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Telemetry Verifier");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  console.log("2. Waiting on /app for telemetry cycles...");
  await page.waitForTimeout(6000);

  // Take fullpage screenshot and focused right-column screenshot
  await page.screenshot({ path: "screenshots/09-real-telemetry-panels.png", fullPage: true });
  console.log("Full screenshot saved to screenshots/09-real-telemetry-panels.png");

  // Also capture specifically the right-column container
  const rightColumn = page.locator("div.space-y-4").first();
  if (await rightColumn.count() > 0) {
    await rightColumn.screenshot({ path: "screenshots/09-right-telemetry-column.png" });
    console.log("Focused screenshot saved to screenshots/09-right-telemetry-column.png");
  }

  await browser.close();
}

main().catch(console.error);

