import { chromium } from "playwright";
import fs from "node:fs";

async function run() {
  console.log("=== 1. Launching browser to test runsnet.id login ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`[PAGE LOG] ${msg.type()}: ${msg.text()}`));
  page.on("response", (res) => {
    if (res.status() >= 400) {
      console.log(`[HTTP ERROR] ${res.status()} ${res.url()}`);
    }
  });

  console.log("Navigating to https://app.runsnet.id/login.php...");
  await page.goto("https://app.runsnet.id/login.php", { waitUntil: "networkidle" });

  console.log("Filling login form...");
  await page.fill('input[name="username"]', "netsynergyinovate@yahoo.com");
  await page.fill('input[name="password"]', "netsynergyinovate@yahoo.com");

  console.log("Submitting login form...");
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch((e) => console.log("Navigation note:", e.message)),
    page.click('button[name="simpan"]'),
  ]);

  console.log("Current URL after login:", page.url());
  await page.waitForTimeout(2000);

  fs.mkdirSync("screenshots/runsnet", { recursive: true });
  await page.screenshot({ path: "screenshots/runsnet/01-after-login.png" });
  console.log("Screenshot after login saved to screenshots/runsnet/01-after-login.png");

  // Inspect navigation links / menu
  const menuLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a, button, [onclick]"));
    return links
      .map((el) => ({
        tag: el.tagName,
        text: (el.textContent || "").trim().replace(/\s+/g, " "),
        href: el.getAttribute("href"),
        onclick: el.getAttribute("onclick"),
      }))
      .filter((l) => l.text.length > 0 && l.text.length < 50);
  });

  console.log("Detected Menu items (sample):");
  console.log(menuLinks.slice(0, 30));

  await fs.promises.writeFile("runsnet-dashboard.html", await page.content(), "utf-8");

  await browser.close();
}

run().catch(console.error);

