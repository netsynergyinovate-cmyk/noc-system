import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { contrastOf } from "./contrast";

// Dijalankan pada server mode "live" (DASHBOARD_DATA=live, port 3102).
const origin = "http://localhost:3102";
const headers = { Origin: origin };

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});
test.afterAll(async () => {
  await pool.end();
});

// Mendaftar lewat API dan mengembalikan email akunnya.
async function signUp(page: Page): Promise<string> {
  const data = {
    name: "Gate Tester",
    email: `gate-${randomUUID()}@example.com`,
    password: "Gate-test-password-123!",
  };
  let response = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data,
  });
  if (response.status() === 429) {
    const seconds = Number(response.headers()["retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.1) * 1000);
    response = await page.request.post("/api/auth/sign-up/email", {
      headers,
      data,
    });
  }
  expect(response.status()).toBe(200);
  return data.email;
}

const clearDevices = async () => {
  await pool.query("DELETE FROM routers");
  await pool.query("DELETE FROM olts");
};

test.beforeEach(clearDevices);
test.afterEach(clearDevices);

const addRouter = (status: string, seen: boolean) =>
  pool.query(
    `INSERT INTO routers (name, host, username, password_enc, status, last_seen_at)
     VALUES ($1, $2, 'api', 'enc', $3, ${seen ? "now()" : "NULL"})`,
    [
      `RTR-${randomUUID().slice(0, 6)}`,
      // Unik pasti: host yang diacak dari 250 nilai bertabrakan sesekali.
      `rtr-${randomUUID()}.test`,
      status,
    ],
  );

const addOlt = (status: string, seen: boolean) =>
  pool.query(
    `INSERT INTO olts (name, host, brand, driver, username, password_enc, status, last_seen_at)
     VALUES ($1, $2, 'hsgq', 'hsgq', 'admin', 'enc', $3, ${seen ? "now()" : "NULL"})`,
    [`OLT-${randomUUID().slice(0, 6)}`, `olt-${randomUUID()}.test`, status],
  );

test("the setup page needs a signed-in user", async ({ page }) => {
  await page.goto("/setup");
  // Proxy mengalihkan ke login dan membawa tujuannya.
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsetup$/);
});

test("the dashboard stays locked until a device is installed and reachable", async ({
  page,
}) => {
  await signUp(page);

  await test.step("no devices: the dashboard redirects to Setup Perangkat", async () => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByRole("heading", { name: "Setup Perangkat" }),
    ).toBeVisible();
    await expect(page.getByTestId("connected-routers")).toHaveText("0");
    await expect(page.getByTestId("connected-olts")).toHaveText("0");
    // Live mode never offers the demo shortcut.
    await expect(page.getByText("Mode demo aktif")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Buka dashboard demo" }),
    ).toHaveCount(0);
  });

  await test.step("devices that are inactive or never reached do not count", async () => {
    await addRouter("aktif", false); // belum pernah menjawab
    await addRouter("nonaktif", true); // pernah menjawab tetapi dinonaktifkan
    await addOlt("aktif", false);
    await addOlt("nonaktif", true);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByTestId("connected-routers")).toHaveText("0");
    await expect(page.getByTestId("connected-olts")).toHaveText("0");
  });

  await test.step("one connected router opens the dashboard", async () => {
    await addRouter("aktif", true);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard NOC" }),
    ).toBeVisible();
  });

  await test.step("the setup page sends users with a device to the dashboard", async () => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/app$/);
  });

  await test.step("a connected OLT alone is enough", async () => {
    await pool.query("DELETE FROM routers");
    await page.goto("/app");
    await expect(page).toHaveURL(/\/setup$/); // tanpa perangkat lagi
    await addOlt("aktif", true);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
  });

  await test.step("the gate is checked on every visit, so removing the last device locks it again", async () => {
    await pool.query("DELETE FROM olts");
    await page.goto("/app");
    await expect(page).toHaveURL(/\/setup$/);
  });
});

test("signing in lands on the setup page when no device exists", async ({
  page,
}) => {
  const email = `login-${randomUUID()}@example.com`;
  const password = "Gate-test-password-123!";
  let response = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: "Login Gate", email, password },
  });
  if (response.status() === 429) {
    await delay(10_100);
    response = await page.request.post("/api/auth/sign-up/email", {
      headers,
      data: { name: "Login Gate", email, password },
    });
  }
  expect(response.status()).toBe(200);
  await page.context().clearCookies(); // keluar, lalu masuk lewat formulir

  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  // Formulir mengarah ke /app; gerbang meneruskannya ke /setup.
  await expect(page).toHaveURL(/\/setup$/);
});

test("in live mode the role badge shows the real role as a chip and offers no preview", async ({
  page,
}) => {
  await signUp(page);
  await addOlt("aktif", true);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);

  const badge = page.locator("aside").getByTestId("role-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("data-preview-enabled", "false");
  await expect(badge).toHaveAttribute("data-preview", "false");
  await expect(badge).toHaveAttribute("data-role", "user");
  await expect(badge.getByText("Peran:", { exact: true })).toBeVisible();
  const chip = badge.getByTestId("role-chip");
  await expect(chip).toHaveText("Petugas");

  // Mode live tidak menawarkan peran tiruan di mana pun: tanpa label, tanpa
  // pilihan, tanpa petunjuk, juga di salinan header yang tersembunyi.
  await expect(page.getByText("Lihat sebagai")).toHaveCount(0);
  await expect(
    page.getByText("Hanya tampilan; server tetap memakai peran asli."),
  ).toHaveCount(0);
  await expect(page.locator("aside select")).toHaveCount(0);
  await expect(page.locator("header select")).toHaveCount(0);

  // Di layar sempit chip ada di header, dengan isi yang sama.
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = page.locator("header").getByTestId("role-badge");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("data-preview-enabled", "false");
  await expect(bar.getByTestId("role-chip")).toHaveText("Petugas");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Chip dan tulisan "Peran:" terbaca di dua tema (4,5 : 1).
  for (const scheme of ["light", "dark"] as const) {
    await test.step(`kontras di tema ${scheme}`, async () => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      if (scheme === "dark")
        await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      for (const [name, locator] of [
        ["Peran:", badge.getByText("Peran:", { exact: true })],
        ["chip", badge.getByTestId("role-chip")],
      ] as const) {
        const { text, ratio } = await contrastOf(locator);
        expect(text, `${name}: elemen tanpa tulisan`).not.toBe("");
        expect(ratio, `${name} di tema ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test("in live mode the admin link follows the real role: absent for a regular account, present for the real admin", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const email = await signUp(page);
  await addOlt("aktif", true);
  const sidebarLink = page.locator("aside a[href='/admin']");
  const barLink = page.locator("header a[href='/admin']");
  const anchorsInHtml = async () =>
    [
      ...(await (await page.request.get("/app")).text()).matchAll(
        /<a\b[^>]*\bhref="\/admin"[^>]*>/g,
      ),
    ].length;

  await test.step("a regular account never sees the link, not even in the server HTML", async () => {
    await page.goto("/app");
    await expect(page.locator("aside").getByTestId("role-badge")).toBeVisible();
    await expect(page.locator("a[href='/admin']")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Buka admin" })).toHaveCount(0);
    expect(await anchorsInHtml()).toBe(0);
  });

  await test.step("the real admin sees it in the sidebar and in the narrow header, from the server HTML", async () => {
    await pool.query('UPDATE "user" SET role = $1 WHERE email = $2', [
      "admin",
      email,
    ]);
    try {
      await page.goto("/app");
      await expect(
        page.locator("aside").getByTestId("role-badge"),
      ).toHaveAttribute("data-role", "admin");
      await expect(sidebarLink).toHaveCount(1);
      await expect(barLink).toHaveCount(1);
      await expect(sidebarLink).toBeVisible();
      await expect(sidebarLink).toHaveText("Buka admin");
      await expect(barLink).toBeHidden();
      expect(await anchorsInHtml()).toBe(2);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(barLink).toBeVisible();
      await expect(sidebarLink).toBeHidden();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await page.setViewportSize({ width: 1280, height: 720 });

      await sidebarLink.click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(
        page.getByRole("heading", { name: "Every account’s notes" }),
      ).toBeVisible();
    } finally {
      await pool.query('UPDATE "user" SET role = $1 WHERE email = $2', [
        "user",
        email,
      ]);
    }
  });

  await test.step("the stored role is read again: after the role is taken away the link is gone", async () => {
    await page.goto("/app");
    await expect(page.locator("a[href='/admin']")).toHaveCount(0);
    expect(await anchorsInHtml()).toBe(0);
  });
  expect(errors).toEqual([]);
});
