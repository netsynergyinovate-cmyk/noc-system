import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("http://localhost:3000/sign-up");
await page.getByLabel("Nama", { exact: true }).fill("Test");
await page
  .getByLabel("Email", { exact: true })
  .fill("test-" + Date.now() + "@noc.local");
await page
  .getByLabel("Kata sandi", { exact: true })
  .fill("DesignRefSecret123!");
await page.getByRole("button", { name: "Buat akun", exact: true }).click();
await page.waitForURL("**/app**");

await page.addInitScript(() => {
  let realSubdomain = undefined;
  Object.defineProperty(Object.prototype, "_getSubdomain", {
    configurable: true,
    enumerable: false,
    get() {
      return realSubdomain;
    },
    set(fn) {
      realSubdomain = function (tilePoint) {
        console.log("--> _getSubdomain called!");
        console.log("this._url:", this._url);
        console.log("this.options.subdomains value:", this.options?.subdomains);
        console.log(
          "this.options hasOwnProperty('subdomains'):",
          this.options?.hasOwnProperty("subdomains"),
        );
        console.log(
          "Proto subdomains:",
          Object.getPrototypeOf(this.options || {})?.subdomains,
        );
        return fn.call(this, tilePoint);
      };
    },
  });
});

page.on("console", (msg) => {
  console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
});

await page.goto("http://localhost:3000/app/peta");
await page.waitForTimeout(3000);

await browser.close();
