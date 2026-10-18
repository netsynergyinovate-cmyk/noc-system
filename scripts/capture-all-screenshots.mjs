import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "screenshots");
const DARK_OUTPUT_DIR = path.resolve(process.cwd(), "screenshots", "dark");
const LIGHT_OUTPUT_DIR = path.resolve(process.cwd(), "screenshots", "light");

for (const dir of [OUTPUT_DIR, DARK_OUTPUT_DIR, LIGHT_OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const PAGES = [
  { file: "01-dashboard.png", url: "/app", name: "Dashboard NOC Utama" },
  { file: "02-kelola-router.png", url: "/app/router", name: "Kelola Router MikroTik" },
  { file: "03-simple-queue.png", url: "/app/router/queues", name: "Daftar Simple Queue" },
  { file: "04-uji-koneksi-router.png", url: "/app/router/test", name: "Uji Koneksi Router" },
  { file: "05-tambah-router.png", url: "/app/router/new", name: "Tambah Router Baru" },
  { file: "06-daftar-pelanggan.png", url: "/app/pelanggan", name: "Daftar Pelanggan PPPoE" },
  { file: "07-perangkat-cpe-olt.png", url: "/app/cpe", name: "Perangkat CPE & OLT Optik" },
  { file: "08-genieacs-server.png", url: "/app/genieacs", name: "Server GenieACS TR-069" },
  { file: "09-trafik-bandwidth.png", url: "/app/traffic", name: "Trafik & Tren Bandwidth" },
  { file: "10-alert-gangguan.png", url: "/app/alert", name: "Alert & Gangguan Jaringan" },
  { file: "11-riwayat-whatsapp.png", url: "/app/alert/whatsapp", name: "Riwayat Notifikasi WhatsApp" },
  { file: "12-penerima-whatsapp.png", url: "/app/alert/whatsapp/penerima", name: "Penerima Notifikasi WhatsApp" },
  { file: "13-status-billing.png", url: "/app/billing", name: "Status Pembayaran & Billing" },
  { file: "14-deteksi-anomali.png", url: "/app/anomali", name: "Deteksi Anomali Jaringan" },
  { file: "15-analisis-netflow.png", url: "/app/netflow", name: "Analisis Aliran Trafik NetFlow" },
  { file: "16-riwayat-migrasi.png", url: "/app/migrasi", name: "Riwayat Migrasi Skema Database" },
  { file: "17-sinkronisasi-data.png", url: "/app/sinkronisasi", name: "Sinkronisasi & Penyelarasan Data" },
  { file: "18-ekspor-laporan.png", url: "/app/ekspor", name: "Ekspor Data & Laporan" },
  { file: "19-jejak-aktivitas.png", url: "/app/jejak-aktivitas", name: "Jejak Aktivitas & Audit Log" },
  { file: "20-pengaman-deploy.png", url: "/app/pengaman-deploy", name: "Pengaman Deploy & Kesiapan Rilis" },
  { file: "21-pusat-onboarding.png", url: "/app/onboarding", name: "Pusat Onboarding & Tutorial Wajib" },
  { file: "22-uji-banding-stack.png", url: "/app/uji-stack", name: "Hasil Uji Banding Stack" },
  { file: "23-pengaturan-sistem.png", url: "/app/pengaturan", name: "Pengaturan Sistem & Operasional" },
  { file: "24-pengaturan-perangkat.png", url: "/app/pengaturan/perangkat", name: "Pengaturan & Integrasi Perangkat" },
];

async function captureAllDark() {
  console.log(`Menghubungkan ke ${BASE_URL} untuk capture DARK MODE...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  // 1. Ambil screenshot halaman login sebelum autentikasi (Dark Mode)
  console.log("Mengambil screenshot halaman Sign-In (Dark Mode)...");
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(600);
  
  await page.screenshot({
    path: path.join(DARK_OUTPUT_DIR, "00-sign-in.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "00-sign-in.png"),
    fullPage: true,
  });

  // 2. Buat akun / Login untuk sesi autentikasi
  console.log("Melakukan autentikasi...");
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `darkmode-capture-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator NOC Dark");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
  await page.getByRole("button", { name: "Buat akun", exact: true }).click();
  await page.waitForURL("**/app**", { timeout: 15000 });
  console.log("Berhasil masuk ke aplikasi!");

  // Pastikan dark mode tersimpan di localStorage browser context
  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(500);

  // 3. Tangkap setiap halaman secara berurutan dalam Dark Mode
  for (const item of PAGES) {
    const fullUrl = `${BASE_URL}${item.url}`;
    console.log(`Mengambil [${item.file}] - ${item.name} (${item.url})...`);
    try {
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Pastikan class dark aktif di setiap halaman
      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
      });
      // Beri jeda render chart SVG / Leaflet / Tabel
      await page.waitForTimeout(1000);

      // Simpan ke folder screenshots/dark/ dan folder utama screenshots/
      const darkTarget = path.join(DARK_OUTPUT_DIR, item.file);
      const rootTarget = path.join(OUTPUT_DIR, item.file);

      await page.screenshot({ path: darkTarget, fullPage: true });
      fs.copyFileSync(darkTarget, rootTarget);

      const stat = fs.statSync(darkTarget);
      console.log(`  ✓ Tersimpan: ${(stat.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error(`  ✗ Gagal mengambil ${item.url}:`, err.message);
    }
  }

  await browser.close();
  console.log("\nSemua screenshot Dark Mode berhasil diambil dan disimpan!");
}

captureAllDark().catch((err) => {
  console.error("Terjadi galat:", err);
  process.exit(1);
});
