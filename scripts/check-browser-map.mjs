import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("http://localhost:3000/sign-up");
await page.getByLabel("Nama", { exact: true }).fill("Test");
await page.getByLabel("Email", { exact: true }).fill("test-" + Date.now() + "@noc.local");
await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
await page.getByRole("button", { name: "Buat akun", exact: true }).click();
await page.waitForURL("**/app**");

await page.goto("http://localhost:3000/app/peta");
await page.waitForTimeout(2000);
console.log("Current URL after goto /app/peta:", page.url());
console.log("Body text:", await page.locator("body").innerText());

await browser.close();

