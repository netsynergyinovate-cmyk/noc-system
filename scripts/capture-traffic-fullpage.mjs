import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://starter:starter_password@127.0.0.1:5432/starter";
const ARTIFACT_DIR = "C:/Users/afria/.gemini/antigravity-cli/brain/39e15711-7525-4e18-a5ca-d54bd3cb8c04";
const SCREENSHOTS_DIR = path.resolve(process.cwd(), "screenshots");

for (const dir of [SCREENSHOTS_DIR, ARTIFACT_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function getOrCreateSessionToken() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    const res = await pool.query(`
      SELECT token FROM session 
      WHERE expires_at > NOW() 
      ORDER BY expires_at DESC LIMIT 1
    `);
    if (res.rows.length > 0) {
      return res.rows[0].token;
    }
  } catch (e) {
    console.warn("Could not query session from DB:", e.message);
  } finally {
    await pool.end();
  }
  return null;
}

async function run() {
  console.log("=== Mengambil Screenshot Panjang Halaman Trafik ===");
  const browser = await chromium.launch({ headless: true });

  const token = await getOrCreateSessionToken();
  console.log("Session token found:", token ? `${token.substring(0, 8)}...` : "None");

  // --- 1. DARK MODE SCREENSHOT ---
  {
    console.log("\n--- Menangkap Dark Mode ---");
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
      deviceScaleFactor: 1.5,
    });

    if (token) {
      await context.addCookies([
        {
          name: "ngodingpakeai-postgres.session_token",
          value: token,
          url: "http://localhost:3000",
        },
      ]);
    }

    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      document.documentElement.classList.add("dark");
    });

    console.log(`Navigasi ke ${BASE_URL}/app/traffic ...`);
    await page.goto(`${BASE_URL}/app/traffic`, { waitUntil: "networkidle", timeout: 20000 });
    
    if (page.url().includes("/sign-in")) {
      console.log("Redirected to sign-in. Melakukan sign-up akun baru...");
      await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
      const email = `operator-traffic-${Date.now()}@noc.local`;
      await page.getByLabel("Nama", { exact: true }).fill("Operator NOC Telemetri");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
      await page.getByRole("button", { name: "Buat akun", exact: true }).click();
      await page.waitForURL("**/app**", { timeout: 15000 });
      await page.goto(`${BASE_URL}/app/traffic`, { waitUntil: "networkidle", timeout: 20000 });
    }

    await page.waitForSelector('[data-testid="traffic-trend-board"]', { timeout: 15000 });
    await page.waitForTimeout(2500); // Tunggu render chart SVG & data telemetri

    const darkFileDedicated = path.join(SCREENSHOTS_DIR, "traffic-fullpage-dark.png");
    const darkFileArtifact = path.join(ARTIFACT_DIR, "traffic-fullpage-dark.png");

    await page.screenshot({ path: darkFileDedicated, fullPage: true });
    fs.copyFileSync(darkFileDedicated, darkFileArtifact);

    console.log(`✓ Dark mode screenshot tersimpan di:`);
    console.log(`  - ${darkFileDedicated}`);
    console.log(`  - ${darkFileArtifact}`);
    await context.close();
  }

  // --- 2. LIGHT MODE SCREENSHOT ---
  {
    console.log("\n--- Menangkap Light Mode ---");
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      deviceScaleFactor: 1.5,
    });

    if (token) {
      await context.addCookies([
        {
          name: "ngodingpakeai-postgres.session_token",
          value: token,
          url: "http://localhost:3000",
        },
      ]);
    }

    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem("theme", "light");
      document.documentElement.classList.remove("dark");
    });

    console.log(`Navigasi ke ${BASE_URL}/app/traffic (Light Mode)...`);
    await page.goto(`${BASE_URL}/app/traffic`, { waitUntil: "networkidle", timeout: 20000 });

    if (page.url().includes("/sign-in")) {
      console.log("Redirected to sign-in. Melakukan sign-up akun baru...");
      await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
      const email = `operator-traffic-${Date.now()}@noc.local`;
      await page.getByLabel("Nama", { exact: true }).fill("Operator NOC Telemetri Light");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Kata sandi", { exact: true }).fill("DesignRefSecret123!");
      await page.getByRole("button", { name: "Buat akun", exact: true }).click();
      await page.waitForURL("**/app**", { timeout: 15000 });
      await page.goto(`${BASE_URL}/app/traffic`, { waitUntil: "networkidle", timeout: 20000 });
    }

    await page.waitForSelector('[data-testid="traffic-trend-board"]', { timeout: 15000 });
    await page.waitForTimeout(2500);

    const lightFileDedicated = path.join(SCREENSHOTS_DIR, "traffic-fullpage-light.png");
    const lightFileArtifact = path.join(ARTIFACT_DIR, "traffic-fullpage-light.png");

    await page.screenshot({ path: lightFileDedicated, fullPage: true });
    fs.copyFileSync(lightFileDedicated, lightFileArtifact);

    console.log(`✓ Light mode screenshot tersimpan di:`);
    console.log(`  - ${lightFileDedicated}`);
    console.log(`  - ${lightFileArtifact}`);
    await context.close();
  }

  await browser.close();
  console.log("\n=== Sukses mengambil tangkapan layar penuh halaman trafik! ===");
}

run().catch((err) => {
  console.error("Gagal mengambil screenshot:", err);
  process.exit(1);
});
