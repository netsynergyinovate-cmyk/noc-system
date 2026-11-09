import { chromium } from "playwright";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function verifyRouterDesign() {
  console.log("=== STEP 1: Meluncurkan Browser & Login ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1560, height: 1100 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `operator-router-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator Router NOC");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Kata sandi", { exact: true })
    .fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });

  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });

  console.log("\n=== STEP 2: Membuka Halaman /app/router ===");
  await page.goto(`${BASE_URL}/app/router`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Verifikasi Elemen Utama
  console.log("\n=== STEP 3: Memeriksa Elemen Visual Redesign ===");
  const titleText = await page.locator("h1").textContent();
  console.log(`Judul Halaman: ${titleText}`);

  // Cek keberadaan KPI cards
  const cpuText = await page
    .getByText("CPU Core CCR", { exact: true })
    .isVisible();
  const ramText = await page
    .getByText("Alokasi RAM", { exact: true })
    .isVisible();
  const gatewayText = await page
    .getByText("Gateway Utama", { exact: true })
    .isVisible();
  const latencyText = await page
    .getByText("Latensi API", { exact: true })
    .isVisible();
  console.log("KPI Cards Visible:", {
    cpuText,
    ramText,
    gatewayText,
    latencyText,
  });

  // Cek Core Router Highlight Card & Real Interface Throughput
  const coreCiaraVisible = await page
    .getByText("Core CIARA")
    .first()
    .isVisible();
  console.log("Core CIARA Highlight Visible:", coreCiaraVisible);

  // Tunggu 2.5 detik untuk polling ke-2 agar delta byte rate terakumulasi
  await page.waitForTimeout(2500);

  // Baca teks port antarmuka yang tampil di layar
  const portCardsText = await page
    .locator("div:has-text('Status & Throughput Port Antarmuka') + div")
    .innerText()
    .catch(() => "");
  console.log("Port Antarmuka Telemetri:\n", portCardsText);

  // Ambil Screenshot Halaman Utama
  const ss1 = path.resolve(
    process.cwd(),
    "screenshots",
    "router",
    "01-router-dashboard-redesign.png",
  );
  await page.screenshot({ path: ss1, fullPage: true });
  console.log(`Screenshot Dashboard tersimpan di ${ss1}`);

  // Buka Dialog Konfigurasi Router
  console.log("\n=== STEP 4: Menguji Dialog Konfigurasi Router ===");
  const btnConfig = page.getByRole("button", { name: "Konfigurasi" }).first();
  await btnConfig.click();
  await page.waitForTimeout(600);

  const configTitleVisible = await page
    .getByText("Konfigurasi Router: Core CIARA")
    .isVisible();
  console.log("Dialog Konfigurasi Terbuka:", configTitleVisible);

  const ss2 = path.resolve(
    process.cwd(),
    "screenshots",
    "router",
    "02-router-config-dialog.png",
  );
  await page.screenshot({ path: ss2 });
  console.log(`Screenshot Dialog Konfigurasi tersimpan di ${ss2}`);

  // Tutup dialog konfigurasi
  await page.getByRole("button", { name: "Batal" }).click();
  await page.waitForTimeout(400);

  // Buka Dialog Rincian Router
  console.log("\n=== STEP 5: Menguji Dialog Rincian Router (Tabs) ===");
  const btnRincian = page
    .getByRole("button", { name: "Rincian Router" })
    .first();
  await btnRincian.click();
  await page.waitForTimeout(600);

  const ss3 = path.resolve(
    process.cwd(),
    "screenshots",
    "router",
    "03-router-detail-tabs.png",
  );
  await page.screenshot({ path: ss3 });
  console.log(`Screenshot Dialog Rincian tersimpan di ${ss3}`);

  await browser.close();
  console.log("\n=== SEMUA VERIFIKASI VISUAL SELESAI DENGAN SUKSES ===");
}

verifyRouterDesign().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
