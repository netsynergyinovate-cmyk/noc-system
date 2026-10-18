import { chromium } from "playwright";
import fs from "node:fs";

async function interceptAll() {
  console.log("=== Launching browser to capture exact DataTables payloads ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on("request", (req) => {
    if (req.url().includes("query/")) {
      console.log(`\n[DT REQ] ${req.method()} ${req.url()}`);
      console.log(`[DT REQ POST DATA]:`, req.postData());
    }
  });

  page.on("response", async (res) => {
    if (res.url().includes("query/")) {
      try {
        const text = await res.text();
        console.log(`[DT RES] ${res.status()} ${res.url()} => length: ${text.length}`);
        fs.writeFileSync(`dt-response-${Date.now()}.json`, text);
        console.log(`Snippet:`, text.slice(0, 300));
      } catch (e) {
        console.log(`[DT RES ERROR]`, e.message);
      }
    }
  });

  console.log("Logging in...");
  await page.goto("https://app.runsnet.id/login.php", { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', "netsynergyinovate@yahoo.com");
  await page.fill('input[name="password"]', "netsynergyinovate@yahoo.com");
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }),
    page.click('button[name="simpan"]'),
  ]);

  const paramName = "WmxBZ3o0TVVUd1ZWYlc1TnZhUDVQQT09";
  const targets = [
    { name: "pelanggan", token: "MVAxWkxyRHRIRDF2MU9EbUg1a0hUSm8wMU1GL3BFTHNaNitvcmRUNXJkZz0=" },
    { name: "invoice", token: "QVIxVmlWNUMwRzBFaENsa2hlZVM2MS9PNnpBejNBMzl2L05xeUx6dXZ2TT0=" },
    { name: "payment", token: "Qy90UHNlSmZVclhuUjd5TWNFZnF4SG94dnU2aFNBTFVJbWxEaUd1SWVZZz0=" },
  ];

  for (const t of targets) {
    console.log(`\n================ Navigating to ${t.name} page ================`);
    const pageUrl = `https://app.runsnet.id/view/?${paramName}=${encodeURIComponent(t.token)}`;
    await page.goto(pageUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `screenshots/runsnet/dt-${t.name}.png` });
    console.log(`Captured screenshots/runsnet/dt-${t.name}.png`);
  }

  await browser.close();
}

interceptAll().catch(console.error);

