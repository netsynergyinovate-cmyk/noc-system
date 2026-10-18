import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1560, height: 900 } });
  const page = await context.newPage();
  
  await page.goto("http://localhost:3000/sign-up");
  const email = `operator-test-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator Debug");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("MapSecretFull123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.goto("http://localhost:3000/app/peta");
  await page.waitForTimeout(2000);

  const btn = page.locator('[data-testid="open-manual-coord-input-button"]');
  const box = await btn.boundingBox();
  console.log("Button bounding box:", box);

  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const domInfo = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="open-manual-coord-input-button"]');
    const board = document.querySelector('[data-testid="realtime-network-map-board"]');
    const container = document.querySelector('[data-testid="network-map-container"]');
    const leaflet = document.querySelector('[data-testid="leaflet-map-canvas"]');
    return {
      hasBtn: !!btn,
      btnParent: btn?.parentElement?.className,
      btnRect: btn?.getBoundingClientRect(),
      boardRect: board?.getBoundingClientRect(),
      containerRect: container?.getBoundingClientRect(),
      leafletRect: leaflet?.getBoundingClientRect(),
    };
  });
  console.log("DOM Info:", domInfo);

  const scrollMetrics = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    hasScroll: document.documentElement.scrollHeight > window.innerHeight
  }));
  console.log("Scroll metrics:", scrollMetrics);

  await page.screenshot({ path: "screenshots/debug-peta-click.png" });
  await browser.close();
}

main().catch(console.error);
