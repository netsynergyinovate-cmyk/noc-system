import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { contextFor, signUp, type Cookies } from "./billing-ui";
import {
  cleanupDiagnosticTestData,
  createTestAlert,
  createTestCustomer,
  createTestDiagnosticRun,
  createTestRouter,
} from "./diagnostics-seed";

test.describe.configure({ mode: "serial" });

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});

let adminCookies: Cookies;
let viewerCookies: Cookies;

test.beforeAll(async ({ browser }) => {
  // Akun admin dengan peran penuh
  const adminContext = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  adminCookies = await signUp(adminContext, "Petugas Diagnosa Admin");
  const response = await adminContext.request.get("/api/auth/get-session");
  const { user } = (await response.json()) as { user: { id: string } };
  await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [
    "admin",
    user.id,
  ]);
  await adminContext.close();

  // Akun viewer biasa (peran 'user' bawaan tanpa izin alert:handle)
  const viewerContext = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  viewerCookies = await signUp(viewerContext, "Petugas Diagnosa Viewer");
  await viewerContext.close();

  await cleanupDiagnosticTestData(pool);
});

test.beforeEach(async () => {
  await cleanupDiagnosticTestData(pool);
});

test.afterAll(async () => {
  await cleanupDiagnosticTestData(pool);
  await pool.end();
});

test.describe("Diagnosa Pelanggan - Fase 9", () => {
  test("(1) EMPTY LAYER: lapisan dengan temuan unchecked menampilkan 'tidak dapat diperiksa' dan alasan, tanpa tanda OK/Normal", async ({
    browser,
  }) => {
    const router = await createTestRouter(pool, { name: "e2e-router-empty" });
    const customer = await createTestCustomer(pool, router.id, {
      pppoeUsername: "e2e_cust_empty",
      name: "Pelanggan Empty Layer",
    });

    const runId = await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_empty_layer",
      status: "done",
      verdictScope: "own",
      findings: [
        {
          layer: "mikrotik",
          metric: "reachability",
          label: "Status router",
          status: "ok",
          detail: "Router terhubung normal",
        },
        {
          layer: "trafik",
          metric: "traffic_trend",
          label: "Tren trafik pelanggan",
          status: "unchecked",
          detail: "Data sampel trafik tidak mencukupi untuk analisis tren",
        },
      ],
    });

    const { context, page, errors } = await contextFor(browser, adminCookies);
    await page.goto(`/app/pelanggan/${customer.id}`);

    // Buka detail run di dalam riwayat diagnosa pelanggan
    const runItem = page.locator(
      `[data-testid="history-run"][data-run-id="${runId}"]`,
    );
    await expect(runItem).toBeVisible({ timeout: 15_000 });
    await expect(runItem.getByTestId("history-copy")).toBeVisible();
    await expect(runItem.getByTestId("history-attach")).toBeVisible();
    const detailBtn = runItem.getByRole("button", { name: /detail|tutup/i });
    await detailBtn.click();

    // Lapisan trafik harus berstatus tidak dapat diperiksa beserta alasannya
    const trafikLayer = page.locator(
      '[data-testid="diagnostic-layer"][data-layer="trafik"]',
    );
    await expect(trafikLayer).toBeVisible({ timeout: 10_000 });
    await expect(trafikLayer).toContainText(/tidak dapat diperiksa/i);
    await expect(trafikLayer).toContainText(
      "Data sampel trafik tidak mencukupi untuk analisis tren",
    );

    // Buka rincian lapisan bila tertutup bawaan
    const layerToggle = trafikLayer.getByRole("button", { name: /trafik/i });
    if ((await layerToggle.getAttribute("aria-expanded")) === "false") {
      await layerToggle.click();
    }

    // Pill status harus unchecked dan tidak ada status Normal pada lapisan ini
    const pill = trafikLayer.locator(
      '[data-testid="diagnostic-finding"][data-status="unchecked"]',
    );
    await expect(pill).toBeVisible();
    const layerText = await trafikLayer.innerText();
    expect(layerText).not.toContain("Normal");

    expect(errors).toEqual([]);
    await context.close();
  });

  test("(2) DEVICE DOWN: router tidak terjangkau menghasilkan kesimpulan belum lengkap, bukan 'Semua lapisan normal'", async ({
    browser,
  }) => {
    const router = await createTestRouter(pool, { name: "e2e-router-down" });
    const customer = await createTestCustomer(pool, router.id, {
      pppoeUsername: "e2e_cust_down",
      name: "Pelanggan Device Down",
    });

    const runId = await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_device_down",
      status: "done",
      verdictScope: "unknown",
      verdictLayer: null,
      verdictDetail:
        "Tidak ada lapisan yang dapat diperiksa; belum ada kesimpulan.",
      findings: [
        {
          layer: "mikrotik",
          metric: "reachability",
          label: "Status router",
          status: "unchecked",
          detail: "router tidak terjangkau",
        },
        {
          layer: "trafik",
          metric: "traffic_trend",
          label: "Tren trafik pelanggan",
          status: "unchecked",
          detail: "pemeriksaan dilewati karena router tidak terjangkau",
        },
      ],
    });

    const { context, page, errors } = await contextFor(browser, adminCookies);
    await page.goto(`/app/pelanggan/${customer.id}`);

    const runItem = page.locator(
      `[data-testid="history-run"][data-run-id="${runId}"]`,
    );
    await expect(runItem).toBeVisible({ timeout: 15_000 });
    const detailBtn = runItem.getByRole("button", { name: /detail|tutup/i });
    await detailBtn.click();

    const runView = page.getByTestId("diagnostic-run");
    await expect(runView).toBeVisible({ timeout: 10_000 });

    // Kesimpulan menyatakan belum ada kesimpulan / belum lengkap
    const statusBox = runView.locator('[role="status"]');
    await expect(statusBox).toContainText(
      /belum ada kesimpulan|kesimpulan belum lengkap/i,
    );
    expect(await statusBox.innerText()).not.toContain("Semua lapisan normal");

    expect(errors).toEqual([]);
    await context.close();
  });

  test("(3) SHARED FAULT: gangguan bersama menampilkan badge 'Gangguan bersama', sumber, peringatan tidak kirim teknisi, dan temuan sekunder", async ({
    browser,
  }) => {
    const router = await createTestRouter(pool, { name: "e2e-router-shared" });
    const customer = await createTestCustomer(pool, router.id, {
      pppoeUsername: "e2e_cust_shared",
      name: "Pelanggan Shared Fault",
    });

    const runId = await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_shared_fault",
      status: "done",
      isSharedFault: true,
      verdictScope: "shared",
      verdictLayer: "optik",
      verdictDetail:
        "Gangguan optik bersama terdeteksi pada 6 pelanggan di PON X.",
      verdictRoot: { kind: "odp", name: "PON X", affected: 6, served: 17 },
      verdictHeld: true,
      verdictSecondary: [
        {
          layer: "optik",
          label: "Rx power OLT",
          status: "fail",
          value: "-31 dBm",
          threshold: "-27 dBm",
        },
        {
          layer: "ip",
          label: "Latency ping",
          status: "warn",
          value: "45 ms",
          threshold: "30 ms",
        },
      ],
      findings: [
        {
          layer: "optik",
          metric: "optical_power",
          label: "Rx power OLT",
          status: "fail",
          value: "-31 dBm",
          threshold: "-27 dBm",
          detail: "Redaman optik melebihi batas",
        },
      ],
    });

    const { context, page, errors } = await contextFor(browser, adminCookies);
    await page.goto(`/app/pelanggan/${customer.id}`);

    const runItem = page.locator(
      `[data-testid="history-run"][data-run-id="${runId}"]`,
    );
    await expect(runItem).toBeVisible({ timeout: 15_000 });
    const detailBtn = runItem.getByRole("button", { name: /detail|tutup/i });
    await detailBtn.click();

    // Periksa badge verdict-scope
    const scopeBadge = page.getByTestId("verdict-scope");
    await expect(scopeBadge).toBeVisible({ timeout: 10_000 });
    await expect(scopeBadge).toHaveText("Gangguan bersama");

    // Periksa sumber verdict-root
    const rootInfo = page.getByTestId("verdict-root");
    await expect(rootInfo).toBeVisible();
    await expect(rootInfo).toHaveText(
      "Sumber: PON X — 6 dari 17 pelanggan terganggu",
    );

    // Peringatan agar tidak mengirim teknisi ke rumah pelanggan
    const runView = page.getByTestId("diagnostic-run");
    await expect(runView).toContainText(
      "Jangan kirim teknisi ke rumah pelanggan sebelum sumber bersama diperiksa.",
    );

    // Temuan sekunder tampak
    const secondary = page.getByTestId("verdict-secondary");
    await expect(secondary).toBeVisible();

    // Anti-flapping verdict-held tampak
    const held = page.getByTestId("verdict-held");
    await expect(held).toBeVisible();
    await expect(held).toContainText("anti-flapping");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("(4) HISTORY COMPARE: pilih dua diagnosa lalu Bandingkan menampilkan history-compare dengan perubahan 'memburuk'", async ({
    browser,
  }) => {
    const router = await createTestRouter(pool, { name: "e2e-router-compare" });
    const customer = await createTestCustomer(pool, router.id, {
      pppoeUsername: "e2e_cust_compare",
      name: "Pelanggan History Compare",
    });

    // Run 1: Lebih lama, kondisi normal (ok)
    const run1Id = await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_compare_run1",
      status: "done",
      verdictScope: "own",
      createdAt: new Date(Date.now() - 600_000),
      findings: [
        {
          layer: "optik",
          metric: "optical_power",
          label: "Sinyal optik",
          value: "-22 dBm",
          threshold: "-27 dBm",
          comparator: ">",
          status: "ok",
          detail: "Sinyal optik dalam batas aman",
        },
      ],
    });

    // Run 2: Lebih baru, kondisi drop (fail -> memburuk)
    const run2Id = await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_compare_run2",
      status: "done",
      verdictScope: "own",
      verdictLayer: "optik",
      createdAt: new Date(Date.now() - 60_000),
      findings: [
        {
          layer: "optik",
          metric: "optical_power",
          label: "Sinyal optik",
          value: "-32 dBm",
          threshold: "-27 dBm",
          comparator: ">",
          status: "fail",
          detail: "Sinyal optik di bawah ambang batas",
        },
      ],
    });

    const { context, page, errors } = await contextFor(browser, adminCookies);
    await page.goto(`/app/pelanggan/${customer.id}`);

    const historySection = page.getByTestId("diagnostic-history");
    await expect(historySection).toBeVisible({ timeout: 15_000 });

    // Pilih kedua diagnosa lewat checkbox masing-masing
    const cb1 = page.locator(
      `[data-testid="history-run"][data-run-id="${run1Id}"] input[type="checkbox"]`,
    );
    const cb2 = page.locator(
      `[data-testid="history-run"][data-run-id="${run2Id}"] input[type="checkbox"]`,
    );
    await expect(cb1).toBeVisible();
    await expect(cb2).toBeVisible();

    await cb1.check();
    await cb2.check();

    // Tombol Bandingkan menjadi aktif
    const compareBtn = page
      .getByRole("button", { name: /bandingkan/i })
      .or(page.getByTestId("history-compare-button"));
    await expect(compareBtn).toBeEnabled();
    await compareBtn.click();

    // Kotak hasil perbandingan muncul
    const compareBox = page.getByTestId("history-compare");
    await expect(compareBox).toBeVisible({ timeout: 10_000 });

    // Baris perubahan menampilkan label 'memburuk'
    const changeRow = page.getByTestId("history-change");
    await expect(changeRow).toBeVisible();
    await expect(changeRow).toContainText("memburuk");

    expect(errors).toEqual([]);
    await context.close();
  });

  test("(5) API: unauthenticated 401, non-permission 403, admin attach berhasil dan idempoten", async ({
    browser,
  }) => {
    const router = await createTestRouter(pool, { name: "e2e-router-api" });
    const customer = await createTestCustomer(pool, router.id, {
      pppoeUsername: "e2e_cust_api",
      name: "Pelanggan API Spec",
    });

    const alert = await createTestAlert(pool, router.id, customer.id, {
      ticketNotes: "Catatan awal tiket sebelum diagnosa.",
    });

    const runId = await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_api_run",
      status: "done",
      verdictScope: "own",
      findings: [
        {
          layer: "mikrotik",
          metric: "reachability",
          label: "Status router",
          status: "ok",
          detail: "Router normal",
        },
      ],
    });

    // 1. Unauthenticated compare => 401
    const anonContext = await browser.newContext({
      baseURL: "http://localhost:3101",
    });
    const anonCompare = await anonContext.request.get(
      `/api/anomalies/diagnostics/compare?before=${runId}&after=${runId}`,
    );
    expect(anonCompare.status()).toBe(401);

    // 2. Unauthenticated attach => 401
    const anonAttach = await anonContext.request.post(
      `/api/anomalies/diagnostics/${runId}/attach`,
      {
        data: { alertId: alert.id },
        headers: { origin: "http://localhost:3101" },
      },
    );
    expect(anonAttach.status()).toBe(401);
    await anonContext.close();

    // 3. Plain signed-up user (viewer tanpa izin alert:handle) => 403
    const { context: viewerCtx } = await contextFor(browser, viewerCookies);
    const viewerAttach = await viewerCtx.request.post(
      `/api/anomalies/diagnostics/${runId}/attach`,
      {
        data: { alertId: alert.id },
        headers: { origin: "http://localhost:3101" },
      },
    );
    expect(viewerAttach.status()).toBe(403);
    // Kode galat harus izin, bukan Origin: kalau tidak, gerbang alert:handle belum teruji.
    const viewerBody = (await viewerAttach.json()) as {
      error: { code: string };
    };
    expect(viewerBody.error.code).toBe("FORBIDDEN");
    await viewerCtx.close();

    // 4. Admin dengan alert:handle => 200, melampirkan teks ke ticket_notes
    const { context: adminCtx } = await contextFor(browser, adminCookies);
    const adminAttach1 = await adminCtx.request.post(
      `/api/anomalies/diagnostics/${runId}/attach`,
      {
        data: { alertId: alert.id },
        headers: { origin: "http://localhost:3101" },
      },
    );
    expect(adminAttach1.status()).toBe(200);

    const {
      rows: [row1],
    } = await pool.query("SELECT ticket_notes FROM alerts WHERE id = $1", [
      alert.id,
    ]);
    const firstNotes = row1.ticket_notes as string;
    expect(firstNotes).toContain(runId);
    expect(firstNotes).toContain("Catatan awal tiket sebelum diagnosa.");

    // 5. Panggilan kedua yang identik => 200 dan tidak menduplikasi teks (idempoten)
    const adminAttach2 = await adminCtx.request.post(
      `/api/anomalies/diagnostics/${runId}/attach`,
      {
        data: { alertId: alert.id },
        headers: { origin: "http://localhost:3101" },
      },
    );
    expect(adminAttach2.status()).toBe(200);

    const {
      rows: [row2],
    } = await pool.query("SELECT ticket_notes FROM alerts WHERE id = $1", [
      alert.id,
    ]);
    const secondNotes = row2.ticket_notes as string;
    expect(secondNotes).toBe(firstNotes);

    await adminCtx.close();
  });

  test("(6) Tanpa galat konsol (console error) pada halaman /app/anomali dan /app/pelanggan/[id]", async ({
    browser,
  }) => {
    const router = await createTestRouter(pool, { name: "e2e-router-clean" });
    const customer = await createTestCustomer(pool, router.id, {
      pppoeUsername: "e2e_cust_clean",
      name: "Pelanggan Clean Console",
    });

    // Satu run supaya baris riwayat (dan tombol lampirkan, bila ada) benar-benar dirender.
    await createTestDiagnosticRun(pool, {
      customerId: customer.id,
      routerId: router.id,
      triggerReason: "e2e_clean",
      status: "done",
      verdictScope: "own",
      findings: [
        {
          layer: "billing",
          metric: "billing_status",
          label: "Status billing",
          status: "ok",
          detail: "Lunas",
        },
      ],
    });
    const { context, page, errors } = await contextFor(browser, adminCookies);

    // Panel /app/anomali: pilih pelanggan seperti operator, lalu riwayat tampil.
    // Daftar alert tidak dikirim ke panel, jadi tombol lampirkan harus tersembunyi.
    await page.goto("/app/anomali");
    await page.getByLabel(/Cari pelanggan/).fill("e2e_cust_clean");
    await page
      .getByRole("list", { name: "Hasil pencarian pelanggan" })
      .getByRole("button", { name: /Pelanggan Clean Console/ })
      .click();
    await expect(page.getByTestId("diagnostic-history")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("history-attach")).toHaveCount(0);
    expect(errors).toEqual([]);

    // Periksa halaman /app/pelanggan/[id]
    await page.goto(`/app/pelanggan/${customer.id}`);
    await expect(page.getByTestId("diagnostic-history")).toBeVisible({
      timeout: 15_000,
    });
    expect(errors).toEqual([]);

    await context.close();
  });
});
