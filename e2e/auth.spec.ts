import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Auth server membatasi sign-up beruntun (per alamat, bukan per akun), dan
// batas itu juga terkena oleh spesifikasi lain yang baru saja mendaftar. Tunggu
// jendelanya sekali, seperti pembantu sign-up di spesifikasi lain.
async function postSignUp(
  request: APIRequestContext,
  options: Parameters<APIRequestContext["post"]>[1],
) {
  let response = await request.post("/api/auth/sign-up/email", options);
  if (response.status() === 429) {
    const seconds = Number(response.headers()["retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.1) * 1000);
    response = await request.post("/api/auth/sign-up/email", options);
  }
  return response;
}

// Sama untuk formulir: bila ditolak karena batas, tunggu jendelanya lalu kirim
// lagi.
async function submitSignUp(page: Page) {
  const submit = page.getByRole("button", {
    name: "Buat akun",
    exact: true,
  });
  await submit.click();
  const outcome = await Promise.race([
    page.waitForURL(/\/app$/, { timeout: 10_000 }).then(() => "ok"),
    page
      .getByText("Terlalu banyak percobaan. Tunggu beberapa detik")
      .waitFor({ timeout: 10_000 })
      .then(() => "limited"),
  ]).catch(() => "unknown");
  if (outcome === "limited") {
    await delay(10_500);
    await submit.click();
  }
}

test("anonymous visitors cannot access the protected app", async ({
  page,
  request,
}) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Masuk ke NOC ISP" }),
  ).toBeVisible();
  const session = await request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
});

test("signup, persisted session, signout, rejected password, and signin work", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `builder-${Date.now()}@example.com`;
  const password = "A-long-test-password-123!";
  await page.goto("/sign-up");
  await page.getByLabel("Nama", { exact: true }).fill("Ada Builder");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await submitSignUp(page);
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(`Masuk sebagai ${email}`)).toBeVisible();
  const cookies = await context.cookies();
  expect(
    cookies.some(
      (cookie) => cookie.name.includes("session_token") && cookie.httpOnly,
    ),
  ).toBe(true);
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  // Keluar memuat ulang halaman penuh ke halaman masuk dengan penegasan
  // (e2e/signed-out-ui.spec.ts memeriksanya lebih lengkap).
  await expect(page).toHaveURL(/\/sign-in\?keluar=1$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Anda sudah keluar." }),
  ).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Kata sandi", { exact: true })
    .fill("incorrect-password");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Email atau kata sandi salah" }),
  ).toContainText("Periksa lalu coba lagi");
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(errors).toEqual([]);
});

test("auth rejects cross-origin requests and invalid signup data", async ({
  request,
}) => {
  const crossOrigin = await postSignUp(request, {
    headers: { Origin: "https://untrusted.example" },
    data: {
      name: "Test",
      email: "cross-origin@example.com",
      password: "Test-password-123",
    },
  });
  expect(crossOrigin.status()).toBe(403);
  const invalid = await postSignUp(request, {
    headers: { Origin: "http://localhost:3101" },
    data: { name: "Test", email: "not-an-email", password: "short" },
  });
  expect(invalid.status()).toBeGreaterThanOrEqual(400);
  expect(invalid.status()).toBeLessThan(500);
});

test("halaman masuk dan daftar muat di layar sempit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // "/" hanya pengalih: pengunjung anonim berakhir di halaman masuk.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Masuk ke NOC ISP" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Buat akun", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
