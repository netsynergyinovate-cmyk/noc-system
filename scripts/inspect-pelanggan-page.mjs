import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/sign-in");
  await page.fill('input[type="email"]', "admin@noc.local");
  await page.fill('input[type="password"]', "admin12345");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/app**");
  await page.goto("http://localhost:3000/app/pelanggan");
  await page.waitForTimeout(2500);
  const rows = await page.locator("tbody tr").count();
  console.log("Customer rows count:", rows);
  for (let i = 0; i < Math.min(rows, 5); i++) {
    const text = await page.locator("tbody tr").nth(i).innerText();
    console.log(`Customer row [${i}]:`, text.replace(/\n/g, " | "));
  }
  await page.screenshot({ path: "screenshots/pelanggan-current.png" });
  await browser.close();
}

run().catch(console.error);

