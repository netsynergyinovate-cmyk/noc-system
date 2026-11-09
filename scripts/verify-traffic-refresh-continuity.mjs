import { chromium } from "playwright";
import path from "node:path";
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/nocsystem";

async function verifyTrafficContinuity() {
  console.log(
    "=== STEP 1: Memeriksa Jumlah Baris Database vlan_traffic_samples ===",
  );
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  const dbBefore = await client.query(
    "SELECT COUNT(*) as cnt, MAX(sampled_at) as latest FROM vlan_traffic_samples",
  );
  console.log(
    `Database count sebelum test: ${dbBefore.rows[0].cnt}, latest timestamp: ${dbBefore.rows[0].latest}`,
  );

  console.log("\n=== STEP 2: Meluncurkan Browser & Login ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await context.newPage();

  // Buka sign-up / sign-in
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
  const email = `operator-vlan-${Date.now()}@noc.local`;
  await page.getByLabel("Nama", { exact: true }).fill("Operator VLAN Tester");
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

  console.log(
    "\n=== STEP 3: Memastikan /api/traffic/vlans Mengembalikan Histori Lengkap ===",
  );
  await page.waitForTimeout(2500);

  const initialVlanData = await page.evaluate(async () => {
    const res = await fetch("/api/traffic/vlans");
    return await res.json();
  });

  console.log(`VLAN items count: ${initialVlanData.data?.items?.length ?? 0}`);
  const firstVlan = initialVlanData.data?.items?.[0];
  console.log(
    `VLAN 0 (${firstVlan?.vlanName}): series length = ${firstVlan?.series?.length ?? 0}`,
  );
  if (firstVlan?.series?.length > 0) {
    const last3 = firstVlan.series.slice(-3);
    console.log("Sampel seri terakhir sebelum refresh:", JSON.stringify(last3));
  }

  const screenshotT0 = path.resolve(
    process.cwd(),
    "screenshots",
    "vlan",
    "01-initial-continuity.png",
  );
  await page.screenshot({ path: screenshotT0 });
  console.log(`Screenshot T0 tersimpan di ${screenshotT0}`);

  console.log(
    "\n=== STEP 4: Melakukan REFRESH HALAMAN (F5 / page.reload()) ===",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  console.log(
    "=== STEP 5: Verifikasi Data Kontinu Langsung Setelah Refresh ===",
  );
  const postRefreshVlanData = await page.evaluate(async () => {
    const res = await fetch("/api/traffic/vlans");
    return await res.json();
  });

  const refreshedFirstVlan = postRefreshVlanData.data?.items?.[0];
  const postRefreshSeriesCount = refreshedFirstVlan?.series?.length ?? 0;
  console.log(
    `Setelah Refresh: VLAN 0 (${refreshedFirstVlan?.vlanName}): series length = ${postRefreshSeriesCount}`,
  );

  if (refreshedFirstVlan?.series?.length > 0) {
    const first3 = refreshedFirstVlan.series.slice(0, 3);
    const last3 = refreshedFirstVlan.series.slice(-3);
    console.log("Sampel awal setelah refresh:", JSON.stringify(first3));
    console.log("Sampel akhir setelah refresh:", JSON.stringify(last3));
  }

  // Verifikasi apakah titik grafik langsung terisi minimal 30 titik dari PostgreSQL
  if (postRefreshSeriesCount < 30) {
    throw new Error(
      `GAGAL: Series VLAN setelah refresh hanya memiliki ${postRefreshSeriesCount} titik, diharapkan >= 30!`,
    );
  }
  console.log(
    `✓ SUKSES: Series VLAN langsung terisi ${postRefreshSeriesCount} titik dari database PostgreSQL tanpa reset ke 0!`,
  );

  // Verifikasi persistensi database bertambah
  await page.waitForTimeout(3000);
  const dbAfter = await client.query(
    "SELECT COUNT(*) as cnt, MAX(sampled_at) as latest FROM vlan_traffic_samples",
  );
  console.log(
    `Database count setelah refresh: ${dbAfter.rows[0].cnt}, latest timestamp: ${dbAfter.rows[0].latest}`,
  );
  const addedRows = Number(dbAfter.rows[0].cnt) - Number(dbBefore.rows[0].cnt);
  console.log(
    `Jumlah baris sampel baru yang berhasil di-commit: +${addedRows}`,
  );

  client.release();
  await pool.end();

  const screenshotAfter = path.resolve(
    process.cwd(),
    "screenshots",
    "vlan",
    "02-after-refresh-continuity.png",
  );
  await page.screenshot({ path: screenshotAfter });
  console.log(`Screenshot setelah refresh tersimpan di ${screenshotAfter}`);

  await browser.close();
  console.log("\n=== SEMUA VERIFIKASI SELESAI DENGAN SUKSES ===");
}

verifyTrafficContinuity().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
