import { chromium } from "playwright";
import fs from "node:fs";

if (!fs.existsSync("screenshots")) {
  fs.mkdirSync("screenshots", { recursive: true });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    consoleErrors.push(msg.text());
  }
});

page.on("pageerror", (err) => {
  consoleErrors.push(err.message);
});

// 1. Sign in or sign up
console.log("--> Navigating to sign up...");
await page.goto("http://localhost:3000/sign-up");
await page.getByLabel("Nama", { exact: true }).fill("Operator NOC");
await page.getByLabel("Email", { exact: true }).fill("verify-" + Date.now() + "@noc.local");
await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
await page.getByRole("button", { name: "Buat akun", exact: true }).click();
await page.waitForURL("**/app**");

// 2. Test /app/peta
console.log("--> Navigating to /app/peta...");
await page.goto("http://localhost:3000/app/peta");
await page.waitForTimeout(4000);
await page.screenshot({ path: "screenshots/verified-peta.png" });
console.log("Captured screenshots/verified-peta.png");

// 3. Test /app/pelanggan/peta
console.log("--> Navigating to /app/pelanggan/peta...");
await page.goto("http://localhost:3000/app/pelanggan/peta");
await page.waitForTimeout(4000);
await page.screenshot({ path: "screenshots/verified-pelanggan-peta.png" });
console.log("Captured screenshots/verified-pelanggan-peta.png");

await browser.close();

console.log("==========================================");
console.log(`TOTAL CONSOLE ERRORS: ${consoleErrors.length}`);
if (consoleErrors.length > 0) {
  console.log("ERRORS DETECTED:", consoleErrors);
  process.exit(1);
} else {
  console.log("SUCCESS: 0 console errors detected on map pages!");
  process.exit(0);
}

