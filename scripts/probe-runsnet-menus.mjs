import { chromium } from "playwright";
import fs from "node:fs";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("1. Logging in...");
  await page.goto("https://app.runsnet.id/login.php", {
    waitUntil: "networkidle",
  });
  await page.fill('input[name="username"]', "netsynergyinovate@yahoo.com");
  await page.fill('input[name="password"]', "netsynergyinovate@yahoo.com");
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }),
    page.click('button[name="simpan"]'),
  ]);

  console.log("Logged in at:", page.url());

  // Function to get current sidebar items
  async function getSidebarItems() {
    return await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll("#metismenu li, #metismenu a"),
      );
      return items
        .map((el) => ({
          tag: el.tagName,
          text: (el.textContent || "").trim().replace(/\s+/g, " "),
          href: el.getAttribute("href"),
          onclick: el.getAttribute("onclick"),
        }))
        .filter((x) => x.text.length > 0);
    });
  }

  // 1. Check default getmenu_utama
  console.log("\n--- Checking getmenu_utama() ---");
  await page.evaluate(() => window.getmenu_utama && window.getmenu_utama());
  await page.waitForTimeout(1000);
  console.log("Main menu items:", await getSidebarItems());
  await page.screenshot({ path: "screenshots/runsnet/02-main-menu.png" });

  // 2. Check each icon / module
  const modules = ["previewb", "previewc", "previewd"];
  for (const mod of modules) {
    console.log(`\n--- Calling setmenu_utama('${mod}', 'LVL06') ---`);
    await page.evaluate(
      (m) => window.setmenu_utama && window.setmenu_utama(m, "LVL06"),
      mod,
    );
    await page.waitForTimeout(1500);
    const items = await getSidebarItems();
    console.log(`Module ${mod} items:`, items);
    await page.screenshot({ path: `screenshots/runsnet/03-module-${mod}.png` });
  }

  await browser.close();
}

run().catch(console.error);
