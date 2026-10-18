import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const screenshotsDir = path.resolve(process.cwd(), "screenshots", "router");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1560, height: 1100 }, colorScheme: "dark" });
const page = await context.newPage();

console.log("[1/7] Sign-in / Sign-up...");
await page.goto("http://localhost:3000/sign-up", { waitUntil: "domcontentloaded" });
const email = "operator-modal-" + Date.now() + "@noc.local";
await page.getByLabel("Nama", { exact: true }).fill("Operator Modal");
await page.getByLabel("Email", { exact: true }).fill(email);
await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
await page.getByRole("button", { name: "Buat akun", exact: true }).click();
await page.waitForURL("**/app**", { timeout: 15000 });

console.log("[2/7] Menuju halaman router...");
await page.goto("http://localhost:3000/app/router", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// Buka rincian router primary (Core CIARA)
const btnRincian = page.getByRole("button", { name: "Rincian Router" }).first();
await btnRincian.click();
await page.waitForTimeout(1000);

console.log("[3/7] Screenshot Tab 1: Hardware & Sistem...");
const dialog = page.locator("div[role='dialog']");
await dialog.screenshot({ path: path.join(screenshotsDir, "modal-tab-1-hardware.png") });

console.log("[4/7] Screenshot Tab 2: Trafik Live...");
await page.getByRole("tab", { name: "Trafik Live" }).click();
await page.waitForTimeout(1200);
await dialog.screenshot({ path: path.join(screenshotsDir, "modal-tab-2-traffic.png") });

console.log("[5/7] Screenshot Tab 3: Simple Queue...");
await page.getByRole("tab", { name: "Simple Queue" }).click();
await page.waitForTimeout(2000);
await dialog.screenshot({ path: path.join(screenshotsDir, "modal-tab-3-queues.png") });

console.log("[6/7] Screenshot Tab 4: Sesi PPPoE (Live Real MikroTik)...");
await page.getByRole("tab", { name: "Sesi PPPoE" }).click();
await page.waitForTimeout(2500);
await dialog.screenshot({ path: path.join(screenshotsDir, "modal-tab-4-pppoe.png") });

console.log("[7/7] Screenshot Tab 5: Tool Ping ICMP & Eksekusi...");
await page.getByRole("tab", { name: "Tool Ping ICMP" }).click();
await page.waitForTimeout(1000);
await dialog.screenshot({ path: path.join(screenshotsDir, "modal-tab-5-ping-ready.png") });

// Klik Kirim Ping (ICMP) untuk menguji tool langsung ke router MikroTik
const btnKirimPing = page.getByRole("button", { name: "Kirim Ping (ICMP)" });
await btnKirimPing.click();
console.log("   Ping dikirim, menunggu respon ICMP MikroTik...");
await page.waitForTimeout(4000);
await dialog.screenshot({ path: path.join(screenshotsDir, "modal-tab-5-ping-executed.png") });

// Tutup modal rincian dengan tombol escape atau close
const btnClose = page.getByRole("button", { name: "Close" }).first();
if (await btnClose.isVisible()) {
  await btnClose.click();
} else {
  await page.keyboard.press("Escape");
}
await page.waitForTimeout(1000);

// Buka Ping & Trace Modal terpisah
console.log("[+] Menguji Ping & Trace Modal terpisah...");
const btnPingModal = page.getByRole("button", { name: "Ping & Trace" }).first();
await btnPingModal.click();
await page.waitForTimeout(1000);
const pingDialog = page.locator("div[role='dialog']").last();
await pingDialog.screenshot({ path: path.join(screenshotsDir, "modal-ping-trace-standalone.png") });

console.log("✓ Semua tab & modal berhasil diverifikasi!");
await browser.close();

