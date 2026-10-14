import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { BASE_ERROR_CODES } from "better-auth";
import { admin } from "better-auth/plugins";
import { Pool } from "pg";
import {
  authFailureFocus,
  authFailureMessage,
  type AuthFailure,
  type AuthFocusTarget,
  type AuthMode,
} from "../src/lib/auth-errors";
import { contrastOf } from "./contrast";

// Halaman masuk dan daftar: pemetaan galat (logika murni), struktur, pengalih
// "/", tata letak dua kolom, kontras di dua tema, pesan galat dan fokus (jawaban
// server ditiru lewat route, juga lewat server sungguhan), keadaan menunggu,
// tombol tampil/sembunyi kata sandi, dan gerak berkurang.
//
// Yang memanggil server sungguhan sengaja sedikit. Batas laju Better Auth (3
// permintaan per 10 detik per jalur) tidak dimatikan: bila terkena (HTTP 429
// sungguhan, mis. dari spesifikasi lain yang baru saja masuk), tes menunggu
// jendelanya habis lalu mengirim lagi.

const origin = "http://localhost:3101";
const headers = { Origin: origin };
const password = "A-long-test-password-123!";
type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

// Tulisan yang dipegang tes secara harfiah (tidak diimpor dari kode), supaya
// salah ketik di kode tertangkap.
const text = {
  credentials: "Email atau kata sandi salah. Periksa lalu coba lagi.",
  limited: "Terlalu banyak percobaan. Tunggu beberapa detik lalu coba lagi.",
  network: "Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.",
  server:
    "Server sedang bermasalah. Coba lagi sebentar; bila berulang, hubungi admin NOC.",
  banned: "Akun ini dinonaktifkan. Hubungi admin NOC.",
  taken: "Email ini sudah terdaftar. Masuk, atau pakai email lain.",
  signUpFailed: "Akun belum bisa dibuat. Periksa isian lalu coba lagi.",
};

// ---------------------------------------------------------------------------
// Pemetaan galat (logika murni, tanpa browser)
// ---------------------------------------------------------------------------

// Kode pemeriksaan Origin Better Auth: salah pasang alamat, bukan salah petugas.
const originCodes: string[] = ["INVALID_ORIGIN", "MISSING_OR_NULL_ORIGIN"];
const response = (status?: number, code?: string): AuthFailure => ({
  kind: "response",
  status,
  code,
});
const network: AuthFailure = { kind: "network" };

interface Case {
  name: string;
  mode: AuthMode;
  failure: AuthFailure;
  message: string;
  focus: AuthFocusTarget;
}

const cases: Case[] = [
  {
    name: "masuk, 401 INVALID_EMAIL_OR_PASSWORD",
    mode: "sign-in",
    failure: response(401, "INVALID_EMAIL_OR_PASSWORD"),
    message: text.credentials,
    focus: "password",
  },
  {
    name: "masuk, 401 tanpa kode",
    mode: "sign-in",
    failure: response(401),
    message: text.credentials,
    focus: "password",
  },
  {
    name: "masuk, 429",
    mode: "sign-in",
    failure: response(429),
    message: text.limited,
    focus: "submit",
  },
  {
    name: "masuk, 429 walau kodenya kode kredensial",
    mode: "sign-in",
    failure: response(429, "INVALID_EMAIL_OR_PASSWORD"),
    message: text.limited,
    focus: "submit",
  },
  {
    name: "masuk, jaringan putus",
    mode: "sign-in",
    failure: network,
    message: text.network,
    focus: "submit",
  },
  {
    name: "masuk, galat server 500 (bukan salah kata sandi)",
    mode: "sign-in",
    failure: response(500),
    message: text.server,
    focus: "submit",
  },
  {
    name: "masuk, 503 dari proksi tanpa kode",
    mode: "sign-in",
    failure: response(503),
    message: text.server,
    focus: "submit",
  },
  {
    name: "masuk, 403 INVALID_ORIGIN (alamat tidak cocok dengan server)",
    mode: "sign-in",
    failure: response(403, "INVALID_ORIGIN"),
    message: text.server,
    focus: "submit",
  },
  {
    name: "masuk, 403 MISSING_OR_NULL_ORIGIN",
    mode: "sign-in",
    failure: response(403, "MISSING_OR_NULL_ORIGIN"),
    message: text.server,
    focus: "submit",
  },
  {
    name: "masuk, 499 masih kegagalan kredensial (batas 5xx tepat di 500)",
    mode: "sign-in",
    failure: response(499),
    message: text.credentials,
    focus: "password",
  },
  {
    name: "masuk, akun diblokir (403 BANNED_USER)",
    mode: "sign-in",
    failure: response(403, "BANNED_USER"),
    message: text.banned,
    focus: "submit",
  },
  {
    name: "masuk, kode email terdaftar tidak berarti apa-apa di sini",
    mode: "sign-in",
    failure: response(422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"),
    message: text.credentials,
    focus: "password",
  },
  {
    name: "daftar, email sudah terdaftar (422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL)",
    mode: "sign-up",
    failure: response(422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"),
    message: text.taken,
    focus: "email",
  },
  {
    name: "daftar, email sudah terdaftar (USER_ALREADY_EXISTS)",
    mode: "sign-up",
    failure: response(400, "USER_ALREADY_EXISTS"),
    message: text.taken,
    focus: "email",
  },
  {
    name: "daftar, kata sandi terlalu pendek (400 PASSWORD_TOO_SHORT)",
    mode: "sign-up",
    failure: response(400, "PASSWORD_TOO_SHORT"),
    message: text.signUpFailed,
    focus: "submit",
  },
  {
    name: "daftar, galat server (500)",
    mode: "sign-up",
    failure: response(500),
    message: text.server,
    focus: "submit",
  },
  {
    name: "daftar, 403 INVALID_ORIGIN",
    mode: "sign-up",
    failure: response(403, "INVALID_ORIGIN"),
    message: text.server,
    focus: "submit",
  },
  {
    name: "daftar, kode akun diblokir tidak berarti apa-apa di sini",
    mode: "sign-up",
    failure: response(403, "BANNED_USER"),
    message: text.signUpFailed,
    focus: "submit",
  },
  {
    name: "daftar, 429",
    mode: "sign-up",
    failure: response(429),
    message: text.limited,
    focus: "submit",
  },
  {
    name: "daftar, jaringan putus",
    mode: "sign-up",
    failure: network,
    message: text.network,
    focus: "submit",
  },
];

test.describe("pemetaan galat masuk dan daftar", () => {
  for (const item of cases) {
    test(item.name, () => {
      expect(authFailureMessage(item.mode, item.failure)).toBe(item.message);
      expect(authFailureFocus(item.mode, item.failure)).toBe(item.focus);
    });
  }

  test("masuk: satu pesan untuk semua kegagalan kredensial, apa pun kode dan statusnya", () => {
    // Email tak dikenal (USER_NOT_FOUND), kata sandi salah (INVALID_PASSWORD),
    // akun tanpa kata sandi, email tak sah, dan seterusnya: semuanya sama,
    // supaya halaman tidak bisa dipakai menebak email yang terdaftar. Galat
    // server (5xx dan salah pasang alamat) tidak termasuk: itu bukan kegagalan
    // kredensial dan punya pesannya sendiri (lihat tes berikutnya).
    const codes = [undefined, ...Object.keys(BASE_ERROR_CODES)].filter(
      (code) => !originCodes.includes(code ?? ""),
    );
    const statuses = [undefined, 400, 401, 403, 404, 422];
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      for (const status of statuses) {
        const label = `${status ?? "tanpa status"} ${code ?? "tanpa kode"}`;
        const failure = response(status, code);
        expect(authFailureMessage("sign-in", failure), label).toBe(
          text.credentials,
        );
        expect(authFailureFocus("sign-in", failure), label).toBe("password");
      }
    }
  });

  test("daftar: semua kegagalan selain email terdaftar dan 429 satu pesan", () => {
    const codes = [undefined, ...Object.keys(BASE_ERROR_CODES)].filter(
      (code) =>
        code !== "USER_ALREADY_EXISTS" &&
        code !== "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" &&
        !originCodes.includes(code ?? ""),
    );
    for (const code of codes) {
      for (const status of [undefined, 400, 403, 422]) {
        expect(
          authFailureMessage("sign-up", response(status, code)),
          `${status} ${code}`,
        ).toBe(text.signUpFailed);
      }
    }
  });

  test("galat server dikatakan apa adanya, bukan sebagai kata sandi atau isian yang salah", () => {
    // Semua 5xx, apa pun kodenya (termasuk kode kredensial yang salah tempat),
    // dan dua kode pemeriksaan Origin pada status berapa pun, di kedua halaman.
    const codes = [undefined, "INVALID_EMAIL_OR_PASSWORD", "BANNED_USER"];
    for (const mode of ["sign-in", "sign-up"] as const) {
      for (const status of [500, 501, 502, 503, 504, 599]) {
        for (const code of codes) {
          const failure = response(status, code);
          const label = `${mode} ${status} ${code ?? "tanpa kode"}`;
          expect(authFailureMessage(mode, failure), label).toBe(text.server);
          expect(authFailureFocus(mode, failure), label).toBe("submit");
        }
      }
      for (const code of originCodes) {
        for (const status of [undefined, 400, 403]) {
          expect(
            authFailureMessage(mode, response(status, code)),
            `${mode} ${status} ${code}`,
          ).toBe(text.server);
        }
      }
    }
    // 429 menang atas semuanya: batas laju punya pesan tunggu sendiri.
    expect(authFailureMessage("sign-in", response(429, "INVALID_ORIGIN"))).toBe(
      text.limited,
    );
  });

  test("semua pesan berbahasa Indonesia, utuh, dan tidak memakai teks server", () => {
    const english =
      /\b(the|please|try|again|your|invalid|error|failed|wrong|incorrect|many|sign|account|already|exists|banned|user|password|check|connection)\b/i;
    const messages = new Set(cases.map((item) => item.message));
    expect(messages.size).toBe(Object.keys(text).length);
    for (const message of messages) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toMatch(english);
    }
  });

  test("kode yang dikenali memang ada di Better Auth yang terpasang", () => {
    // Bila Better Auth mengganti nama kode ini, tes ini gagal lebih dulu
    // daripada pesan yang diam-diam jatuh ke pesan umum.
    const adminCodes = admin().$ERROR_CODES;
    expect(adminCodes.BANNED_USER.code).toBe("BANNED_USER");
    expect(BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD.code).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );
    for (const code of originCodes) {
      expect(Object.keys(BASE_ERROR_CODES), code).toContain(code);
    }
    const taken = [
      BASE_ERROR_CODES.USER_ALREADY_EXISTS.code,
      BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL.code,
      adminCodes.USER_ALREADY_EXISTS.code,
      adminCodes.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL.code,
    ];
    expect(new Set(taken)).toEqual(
      new Set(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]),
    );
    expect(
      authFailureMessage("sign-in", response(403, adminCodes.BANNED_USER.code)),
    ).toBe(text.banned);
    for (const code of taken) {
      expect(authFailureMessage("sign-up", response(422, code))).toBe(
        text.taken,
      );
      expect(authFailureFocus("sign-up", response(422, code))).toBe("email");
    }
  });
});

// ---------------------------------------------------------------------------
// Pembantu halaman
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});
test.afterAll(async () => {
  await pool.end();
});

// Satu akun untuk berkas ini. Pendaftaran dibatasi sekitar tiga per sepuluh
// detik, jadi bila kena batas, tunggu jendelanya lalu coba sekali lagi.
let account: { email: string; cookies: Cookies };

async function registerAccount(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin });
  const email = `login-${randomUUID()}@example.com`;
  const data = { name: "Petugas Login", email, password };
  let result = await context.request.post("/api/auth/sign-up/email", {
    headers,
    data,
  });
  if (result.status() === 429) {
    const seconds = Number(
      result.headers()["x-retry-after"] ??
        result.headers()["retry-after"] ??
        10,
    );
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.1) * 1000);
    result = await context.request.post("/api/auth/sign-up/email", {
      headers,
      data,
    });
  }
  expect(result.status()).toBe(200);
  const cookies = await context.cookies();
  await context.close();
  return { email, cookies };
}

test.beforeAll(async ({ browser }) => {
  account = await registerAccount(browser);
});

const fields = (page: Page) => ({
  name: page.getByLabel("Nama", { exact: true }),
  email: page.getByLabel("Email", { exact: true }),
  password: page.getByLabel("Kata sandi", { exact: true }),
  toggle: page.getByRole("button", {
    name: "Tampilkan kata sandi",
    exact: true,
  }),
  signIn: page.getByRole("button", { name: "Masuk", exact: true }),
  signUp: page.getByRole("button", { name: "Buat akun", exact: true }),
  error: page.locator("#auth-error"),
});

// Halaman sudah dihidrasi: formulir punya props React. Sebelum itu pengiriman
// ditangani browser (GET bawaan, kata sandi masuk ke alamat), bukan skrip.
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return (
      form !== null &&
      Object.keys(form).some((key) => key.startsWith("__reactProps$"))
    );
  });
}

async function open(page: Page, path: "/sign-in" | "/sign-up") {
  await page.goto(path);
  await hydrated(page);
}

// Tema yang tampil: kelas "dark" di <html> (lihat src/lib/theme.ts).
async function expectTheme(page: Page, scheme: "light" | "dark") {
  const html = page.locator("html");
  if (scheme === "dark") await expect(html).toHaveClass(/dark/);
  else await expect(html).not.toHaveClass(/dark/);
}

const jsonBody = (body: unknown) => ({
  contentType: "application/json",
  body: JSON.stringify(body),
});
const wrongCredentials = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
};

const hasHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

// Elemen yang sedang berfokus, ditulis dengan nama yang bisa dibaca orang.
const activeName = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return (
      el?.id ||
      el?.getAttribute("aria-label") ||
      el?.textContent?.trim() ||
      el?.tagName ||
      null
    );
  });

// Kesalahan yang tidak boleh ada di halaman yang sehat.
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  return problems;
}

// Menjalankan `act` (klik atau Enter) lalu menunggu `done`. Bila server
// sungguhan menolak karena batas laju, tunggu jendelanya habis lalu ulangi
// sekali; batas itu sendiri tidak dimatikan.
async function actPastLimit(
  page: Page,
  act: () => Promise<unknown>,
  done: () => Promise<unknown>,
) {
  await act();
  const limited = page.locator("#auth-error").filter({ hasText: text.limited });
  const outcome = await Promise.race([
    done().then(() => "done" as const),
    limited.waitFor({ timeout: 15_000 }).then(() => "limited" as const),
  ]);
  if (outcome === "done") return;
  await delay(10_500);
  await act();
  await done();
}

// Fokus ada di kata sandi dan seluruh isinya terpilih (mudah diketik ulang).
async function expectPasswordSelected(page: Page) {
  const { password: field } = fields(page);
  await expect(field).toBeFocused();
  const [start, end, length] = await field.evaluate((el) => {
    const input = el as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd, input.value.length];
  });
  expect(length).toBeGreaterThan(0);
  expect([start, end]).toEqual([0, length]);
}

// ---------------------------------------------------------------------------
// Struktur
// ---------------------------------------------------------------------------

test("halaman masuk: judul, bidang, tombol, tautan, bahasa, dan tanpa galat konsol", async ({
  page,
}) => {
  const problems = collectProblems(page);
  const f = fields(page);
  await open(page, "/sign-in");

  await expect(page).toHaveTitle("Masuk | NOC ISP Dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Masuk ke NOC ISP" }),
  ).toBeVisible();
  await expect(
    page.getByText("Akses petugas NOC", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Gunakan akun petugas untuk membuka dasbor pemantauan."),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Data masuk" })).toBeVisible();

  await expect(f.email).toBeVisible();
  await expect(f.email).toHaveAttribute("placeholder", "nama@contoh.com");
  for (const [name, value] of Object.entries({
    type: "email",
    autocomplete: "email",
    autocapitalize: "none",
    spellcheck: "false",
    maxlength: "254",
  })) {
    await expect(f.email, name).toHaveAttribute(name, value);
  }
  await expect(f.email).toHaveJSProperty("required", true);

  await expect(f.password).toBeVisible();
  for (const [name, value] of Object.entries({
    type: "password",
    autocomplete: "current-password",
    minlength: "8",
    maxlength: "128",
  })) {
    await expect(f.password, name).toHaveAttribute(name, value);
  }
  await expect(f.password).toHaveJSProperty("required", true);

  await expect(f.signIn).toBeVisible();
  await expect(f.signIn).toBeEnabled();
  await expect(f.signIn).toHaveAttribute("type", "submit");
  await expect(f.toggle).toBeVisible();
  await expect(f.toggle).toHaveAttribute("aria-pressed", "false");
  await expect(f.error).toHaveCount(0);

  await expect(page.getByText("Belum punya akun?")).toBeVisible();
  const toSignUp = page.getByRole("link", { name: "Buat akun", exact: true });
  await expect(toSignUp).toHaveAttribute("href", "/sign-up");

  // Merek NOC tepat satu (di panel kiri), dan tautannya ke "/".
  const brand = page.getByRole("link", { name: "NOC ISP", exact: true });
  await expect(brand).toHaveCount(1);
  await expect(brand).toHaveAttribute("href", "/");
  // Tautan "Lewati ke konten" menunjuk ke isi utama yang memuat formulirnya.
  await expect(
    page.getByRole("link", { name: "Lewati ke konten" }),
  ).toHaveAttribute("href", "#main-content");
  await expect(page.locator("main#main-content form")).toHaveCount(1);

  // Tidak ada sisa teks Inggris bawaan starter.
  for (const old of ["Welcome back", "Sign in", "Password", "New here?"]) {
    await expect(page.getByText(old), old).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test("halaman daftar: teks Indonesia, petunjuk kata sandi, tautan ke masuk", async ({
  page,
}) => {
  const problems = collectProblems(page);
  const f = fields(page);
  await open(page, "/sign-up");

  await expect(page).toHaveTitle("Buat akun | NOC ISP Dashboard");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(
    page.getByRole("heading", { level: 1, name: "Buat akun petugas" }),
  ).toBeVisible();
  await expect(page.getByText("Akun baru", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Isi data singkat, lalu langsung masuk ke dasbor."),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Data akun" })).toBeVisible();

  await expect(f.name).toBeVisible();
  await expect(f.name).toHaveAttribute("placeholder", "Nama lengkap");
  await expect(f.name).toHaveAttribute("autocomplete", "name");
  await expect(f.name).toHaveJSProperty("required", true);
  await expect(f.email).toBeVisible();
  await expect(f.password).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByText("Minimal 8 karakter.")).toBeVisible();
  await expect(f.password).toHaveAccessibleDescription("Minimal 8 karakter.");
  await expect(f.toggle).toBeVisible();
  await expect(f.signUp).toBeVisible();
  await expect(f.signUp).toHaveAttribute("type", "submit");

  await expect(page.getByText("Sudah punya akun?")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Masuk", exact: true }),
  ).toHaveAttribute("href", "/sign-in");
  for (const old of ["Create", "Name", "Password", "Already have"]) {
    await expect(page.getByText(old), old).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test("tautan antara masuk dan daftar saling berpindah halaman", async ({
  page,
}) => {
  await open(page, "/sign-in");
  await page.getByRole("link", { name: "Buat akun", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(
    page.getByRole("heading", { name: "Buat akun petugas" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Masuk ke NOC ISP" }),
  ).toBeVisible();
});

test("tautan lewati-ke-konten membawa ke formulir lewat papan ketik", async ({
  page,
}) => {
  await open(page, "/sign-in");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Lewati ke konten" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  // Tab berikutnya mulai dari isi utama, bukan dari panel kiri.
  await page.keyboard.press("Tab");
  expect(await activeName(page)).toBe("email");
});

test("formulir yang terkirim sebelum skripnya siap tidak menaruh kata sandi di alamat", async ({
  page,
}) => {
  // Skrip diblokir, jadi halaman tidak pernah dihidrasi dan pengiriman
  // ditangani browser sendiri.
  await page.route("**/_next/static/**", (route) =>
    route.request().resourceType() === "script"
      ? route.abort()
      : route.continue(),
  );
  const secret = `rahasia-${randomUUID()}`;
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  const f = fields(page);
  await page.goto("/sign-in");
  await f.email.fill("petugas@example.com");
  await f.password.fill(secret);
  const [request] = await Promise.all([
    page.waitForRequest(
      (candidate) =>
        candidate.isNavigationRequest() && candidate.url().includes("/sign-in"),
      { timeout: 5_000 },
    ),
    f.signIn.click(),
  ]);
  expect(request.method()).toBe("POST");
  const answer = await request.response();
  expect(answer?.status()).toBe(200);
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(urls.filter((url) => url.includes(secret))).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
});

test("merek di layout admin tetap tampil dan membawa ke /app", async ({
  browser,
}) => {
  await pool.query(`UPDATE "user" SET role = 'admin' WHERE email = $1`, [
    account.email,
  ]);
  const context = await browser.newContext({ baseURL: origin });
  try {
    await context.addCookies(account.cookies);
    const page = await context.newPage();
    await page.goto("/admin");
    const brand = page.getByRole("link", { name: "NOC ISP", exact: true });
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute("href", "/");
    await expect(brand.locator("svg[aria-hidden='true']")).toHaveCount(1);
    await brand.click();
    await expect(page).toHaveURL(/\/app$/);
  } finally {
    await context.close();
    await pool.query(`UPDATE "user" SET role = 'user' WHERE email = $1`, [
      account.email,
    ]);
  }
});

// ---------------------------------------------------------------------------
// Pengalih "/"
// ---------------------------------------------------------------------------

test("/ mengalihkan pengunjung anonim ke /sign-in dalam satu lompatan", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Masuk ke NOC ISP" }),
  ).toBeVisible();
  // Tidak singgah di dasbor dulu, dan intro starter lama sudah tidak ada.
  expect(
    paths.filter((path) => path === "/app" || path.startsWith("/app/")),
  ).toEqual([]);
  await expect(page.getByText("A small base")).toHaveCount(0);
});

test("/ mengalihkan petugas yang sudah masuk ke /app, begitu juga /sign-in dan /sign-up", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: origin });
  await context.addCookies(account.cookies);
  const page = await context.newPage();
  const paths: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
  expect(paths).not.toContain("/sign-in");
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/app$/);
  }
  await context.close();
});

// ---------------------------------------------------------------------------
// Tata letak
// ---------------------------------------------------------------------------

const highlights = [
  "Status online/offline tampil kurang dari 1 detik",
  "Alert otomatis saat gangguan muncul",
  "Peta sebaran pelanggan merah, kuning, hijau",
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`tata letak di tema ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("390 px: tanpa guliran mendatar, panel tersembunyi, formulir di layar pertama", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const f = fields(page);
      const panel = page.locator("aside[aria-label='Tentang NOC ISP']");
      for (const path of ["/sign-in", "/sign-up"] as const) {
        await open(page, path);
        await expectTheme(page, scheme);
        expect(await hasHorizontalScroll(page), `${path} melebar`).toBe(false);
        await expect(panel).toBeHidden();
        // Satu-satunya judul adalah h1 formulir; panel tersembunyi.
        await expect(page.getByRole("heading")).toHaveCount(1);
        // Merek dan tombol tema ada di bagian atas, dan formulir langsung
        // terlihat tanpa menggulir.
        await expect(
          page.getByRole("link", { name: "NOC ISP", exact: true }),
        ).toHaveCount(1);
        await expect(
          page.getByRole("group", { name: "Tema tampilan" }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeInViewport({
          ratio: 1,
        });
        await expect(f.email).toBeInViewport({ ratio: 1 });
        await expect(f.password).toBeInViewport({ ratio: 1 });
        await expect(path === "/sign-in" ? f.signIn : f.signUp).toBeInViewport({
          ratio: 1,
        });
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      }
    });

    test("1440 px: panel dengan tiga butir di kiri, formulir di kanan, tanpa guliran mendatar", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const f = fields(page);
      const panel = page.getByRole("complementary", {
        name: "Tentang NOC ISP",
      });
      for (const path of ["/sign-in", "/sign-up"] as const) {
        await open(page, path);
        expect(await hasHorizontalScroll(page), `${path} melebar`).toBe(false);
        await expect(panel).toBeVisible();
        await expect(
          panel.getByText("Seluruh jaringan, satu layar.", { exact: true }),
        ).toBeVisible();
        // Kalimat penarik di panel bukan judul: urutan judul halaman tetap
        // h1 saja, bukan h2 yang terbaca sebelum h1.
        await expect(page.getByRole("heading")).toHaveCount(1);
        await expect(panel.getByRole("heading")).toHaveCount(0);
        await expect(
          panel.getByText(
            "Pantau pelanggan PPPoE, router, dan sinyal optik secara real-time.",
          ),
        ).toBeVisible();
        const items = panel.getByRole("listitem");
        await expect(items).toHaveText(highlights);
        for (let index = 0; index < highlights.length; index += 1) {
          await expect(items.nth(index)).toBeVisible();
        }
        // Merek di panel kiri saja (yang di header disembunyikan di lg).
        const brand = page.getByRole("link", { name: "NOC ISP", exact: true });
        await expect(brand).toHaveCount(1);
        await expect(panel.getByRole("link", { name: "NOC ISP" })).toHaveCount(
          1,
        );
        // Hiasan: satu gambar yang disembunyikan dari pembaca layar, tanpa teks
        // dan tanpa animasi.
        const art = panel.locator("svg[aria-hidden='true'][focusable='false']");
        await expect(art).toHaveCount(1);
        expect(await art.evaluate((el) => (el.textContent ?? "").trim())).toBe(
          "",
        );
        expect(
          await panel.evaluate(
            (el) => el.getAnimations({ subtree: true }).length,
          ),
        ).toBe(0);
        // Dua kolom: formulir di kanan panel, tombol tema di pojok kanan atas.
        const panelBox = (await panel.boundingBox())!;
        const formBox = (await f.email.boundingBox())!;
        expect(formBox.x).toBeGreaterThan(panelBox.x + panelBox.width);
        await expect(f.email).toBeInViewport({ ratio: 1 });
        await expect(path === "/sign-in" ? f.signIn : f.signUp).toBeInViewport({
          ratio: 1,
        });
        const themeBox = (await page
          .getByRole("group", { name: "Tema tampilan" })
          .boundingBox())!;
        expect(themeBox.x + themeBox.width).toBeGreaterThan(1440 - 80);
        expect(themeBox.y).toBeLessThan(60);
      }
    });
  });
}

test("panel kiri muncul tepat mulai lebar 1024 px (lg)", async ({ page }) => {
  const panel = page.locator("aside[aria-label='Tentang NOC ISP']");
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, "/sign-in");
  await expect(panel).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
  await page.setViewportSize({ width: 1023, height: 768 });
  await expect(panel).toBeHidden();
  expect(await hasHorizontalScroll(page)).toBe(false);
  await expect(
    page.getByRole("link", { name: "NOC ISP", exact: true }),
  ).toHaveCount(1);
});

test("tombol tema di halaman masuk mengganti dan mengingat tema", async ({
  page,
}) => {
  await open(page, "/sign-in");
  const group = page.getByRole("group", { name: "Tema tampilan" });
  const html = page.locator("html");
  await group.getByRole("button", { name: "Tema gelap" }).click();
  await expect(html).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await group.getByRole("button", { name: "Tema terang" }).click();
  await expect(html).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
    "light",
  );
});

// ---------------------------------------------------------------------------
// Kontras
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  test.describe(`kontras di tema ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });

    test("tulisan di halaman masuk dan daftar terbaca (4,5 : 1)", async ({
      page,
    }) => {
      const f = fields(page);
      const panel = page.locator("aside[aria-label='Tentang NOC ISP']");
      const measured: Array<[string, Locator]> = [];
      const check = async () => {
        for (const [label, locator] of measured) {
          const { text: sample, ratio } = await contrastOf(locator);
          expect(sample, `${label}: elemen tanpa tulisan`).not.toBe("");
          expect(
            ratio,
            `${label} ("${sample}") di tema ${scheme}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        measured.length = 0;
      };

      await page.route("**/api/auth/sign-in/email", (route) =>
        route.fulfill({ status: 401, ...jsonBody(wrongCredentials) }),
      );
      await open(page, "/sign-in");
      await expectTheme(page, scheme);
      // Galat tampil di atas latarnya sendiri (bg-destructive/5).
      await f.email.fill("petugas@example.com");
      await f.password.fill("kata-sandi-apa-saja");
      await f.signIn.click();
      await expect(f.error).toHaveText(text.credentials);
      measured.push(
        ["kicker", page.getByText("Akses petugas NOC", { exact: true })],
        ["judul", page.getByRole("heading", { level: 1 })],
        [
          "paragraf",
          page.getByText("Gunakan akun petugas untuk membuka dasbor"),
        ],
        ["label email", page.locator("label[for=email]")],
        ["label kata sandi", page.locator("label[for=password]")],
        ["galat", f.error],
        ["tombol kirim", f.signIn],
        ["kalimat bawah", page.getByText("Belum punya akun?")],
        ["tautan bawah", page.getByRole("link", { name: "Buat akun" })],
        [
          "kalimat penarik panel",
          panel.getByText("Seluruh jaringan, satu layar.", { exact: true }),
        ],
        [
          "kalimat panel",
          panel.getByText("Pantau pelanggan PPPoE, router, dan sinyal optik"),
        ],
      );
      for (const item of highlights) {
        measured.push([`butir panel "${item}"`, panel.getByText(item)]);
      }
      await check();

      await open(page, "/sign-up");
      measured.push(
        ["kicker daftar", page.getByText("Akun baru", { exact: true })],
        [
          "paragraf daftar",
          page.getByText("Isi data singkat, lalu langsung masuk ke dasbor."),
        ],
        ["label nama", page.locator("label[for=name]")],
        ["petunjuk kata sandi", page.locator("#password-hint")],
        ["tombol daftar", f.signUp],
        ["kalimat bawah daftar", page.getByText("Sudah punya akun?")],
        ["tautan bawah daftar", page.getByRole("link", { name: "Masuk" })],
      );
      await check();
    });
  });
}

// ---------------------------------------------------------------------------
// Pesan galat dan fokus: jawaban server ditiru lewat route
// ---------------------------------------------------------------------------

interface Mocked {
  name: string;
  // null: permintaan digagalkan seperti jaringan putus.
  status: number | null;
  body?: unknown;
  // Header jawaban. Batas laju membawa X-Retry-After: tombol kirim menunggu
  // sebanyak itu detik (aria-disabled) sebelum aktif lagi; 1 detik di sini
  // supaya tes tidak menunggu bawaan 10 detik. Hitung mundurnya sendiri diuji
  // dengan jam palsu di login-errors-ui.spec.ts.
  headers?: Record<string, string>;
  message: string;
  focus: AuthFocusTarget;
}

const shortWait = { "X-Retry-After": "1" };

const mockedSignIn: Mocked[] = [
  {
    name: "401 kredensial salah",
    status: 401,
    body: wrongCredentials,
    message: text.credentials,
    focus: "password",
  },
  {
    // Server yang membedakan email tak dikenal tidak boleh membuat halaman
    // ikut membedakan.
    name: "404 email tak dikenal (USER_NOT_FOUND)",
    status: 404,
    body: { code: "USER_NOT_FOUND", message: "User not found" },
    message: text.credentials,
    focus: "password",
  },
  {
    name: "batas laju 429 (teks server berbahasa Inggris)",
    status: 429,
    body: { message: "Too many requests. Please try again later." },
    headers: shortWait,
    message: text.limited,
    focus: "submit",
  },
  {
    name: "akun diblokir 403 BANNED_USER",
    status: 403,
    body: {
      code: "BANNED_USER",
      message: "You have been banned from this application",
    },
    message: text.banned,
    focus: "submit",
  },
  {
    name: "galat server 500 (bukan salah kata sandi)",
    status: 500,
    body: { message: "Internal Server Error" },
    message: text.server,
    focus: "submit",
  },
  {
    name: "403 INVALID_ORIGIN (alamat tidak cocok dengan server)",
    status: 403,
    body: { code: "INVALID_ORIGIN", message: "Invalid origin" },
    message: text.server,
    focus: "submit",
  },
  {
    name: "jaringan putus",
    status: null,
    message: text.network,
    focus: "submit",
  },
];

const mockedSignUp: Mocked[] = [
  {
    name: "email sudah terdaftar 422",
    status: 422,
    body: {
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      message: "User already exists. Use another email.",
    },
    message: text.taken,
    focus: "email",
  },
  {
    name: "batas laju 429",
    status: 429,
    body: { message: "Too many requests. Please try again later." },
    headers: shortWait,
    message: text.limited,
    focus: "submit",
  },
  {
    name: "kata sandi ditolak server 400",
    status: 400,
    body: { code: "PASSWORD_TOO_SHORT", message: "Password too short" },
    message: text.signUpFailed,
    focus: "submit",
  },
  {
    name: "galat server 500",
    status: 500,
    body: { message: "Internal Server Error" },
    message: text.server,
    focus: "submit",
  },
  {
    name: "jaringan putus",
    status: null,
    message: text.network,
    focus: "submit",
  },
];

for (const mode of ["sign-in", "sign-up"] as const) {
  test(`${mode === "sign-in" ? "masuk" : "daftar"}: setiap jawaban galat server tampil sebagai pesan Indonesia dengan fokus yang tepat`, async ({
    page,
  }) => {
    const f = fields(page);
    const route = `**/api/auth/${mode}/email`;
    const submit = mode === "sign-in" ? f.signIn : f.signUp;
    const target = (focus: AuthFocusTarget) =>
      focus === "submit" ? submit : f[focus];
    let current: Mocked = mockedSignIn[0];
    let requests = 0;
    await page.route(route, (request) => {
      requests += 1;
      return current.status === null
        ? request.abort("failed")
        : request.fulfill({
            status: current.status,
            headers: current.headers,
            ...jsonBody(current.body),
          });
    });
    await open(page, mode === "sign-in" ? "/sign-in" : "/sign-up");
    if (mode === "sign-up") await f.name.fill("Petugas Tiruan");
    await f.email.fill("petugas@example.com");
    await f.password.fill("kata-sandi-apa-saja");

    for (const item of mode === "sign-in" ? mockedSignIn : mockedSignUp) {
      await test.step(item.name, async () => {
        current = item;
        const before = requests;
        await submit.click();
        await expect(f.error).toHaveText(item.message);
        await expect(f.error).toHaveAttribute("role", "alert");
        expect(requests).toBe(before + 1);
        // Tombol aktif lagi dan tidak lagi bertuliskan menunggu. (Sesudah batas
        // laju: setelah hitung mundur 1 detik; toBeEnabled menunggu sampai
        // aria-disabled hilang.)
        await expect(submit).toBeEnabled();
        await expect(page.locator("form")).toHaveAttribute(
          "aria-busy",
          "false",
        );
        // Fokus pindah ke isian yang jadi sebab, atau tombol kirim.
        await expect(target(item.focus)).toBeFocused();
        if (item.focus === "password") await expectPasswordSelected(page);
        // Isian yang diberi fokus ditandai dan terhubung ke pesannya.
        if (item.focus !== "submit") {
          await expect(f[item.focus]).toHaveAttribute("aria-invalid", "true");
          await expect(f[item.focus]).toHaveAccessibleDescription(
            new RegExp(item.message.slice(0, 20)),
          );
        } else {
          await expect(f.email).not.toHaveAttribute("aria-invalid", "true");
          await expect(f.password).not.toHaveAttribute("aria-invalid", "true");
        }
        // Teks Inggris dari server tidak pernah sampai ke layar.
        await expect(
          page.getByText(
            /Invalid email|Too many requests|Internal Server|already exists|banned from|too short/i,
          ),
        ).toHaveCount(0);
        // Kata sandi yang diketik tidak hilang.
        await expect(f.password).toHaveValue("kata-sandi-apa-saja");
      });
    }
  });
}

test("pesan galat hilang begitu formulir dikirim ulang", async ({ page }) => {
  const f = fields(page);
  let fail = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    if (fail)
      return route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
    await gate;
    return route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
  });
  try {
    await open(page, "/sign-in");
    await f.email.fill("petugas@example.com");
    await f.password.fill("kata-sandi-apa-saja");
    await f.signIn.click();
    await expect(f.error).toHaveText(text.credentials);
    fail = false;
    await f.signIn.click();
    await expect(
      page.getByRole("button", { name: "Memeriksa…", exact: true }),
    ).toBeVisible();
    await expect(f.error).toHaveCount(0);
    await expect(f.password).not.toHaveAttribute("aria-invalid", "true");
  } finally {
    release();
  }
});

// ---------------------------------------------------------------------------
// Menunggu: satu permintaan pada satu waktu
// ---------------------------------------------------------------------------

test("selagi menunggu: tombol memeriksa, formulir sibuk, bidang terkunci, hanya satu permintaan", async ({
  page,
}) => {
  const f = fields(page);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Jawaban ditahan sampai tes melepasnya, jadi keadaan menunggu bisa diperiksa
  // tanpa berpacu dengan waktu.
  await page.route("**/api/auth/sign-in/email", async (route) => {
    requests += 1;
    await gate;
    await route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
  });
  try {
    await open(page, "/sign-in");
    await f.email.fill("petugas@example.com");
    await f.password.fill("kata-sandi-apa-saja");
    // Dua klik cepat: yang kedua jatuh pada tombol yang sudah terkunci.
    await f.signIn.dblclick();
    await expect.poll(() => requests).toBe(1);

    const waiting = page.getByRole("button", {
      name: "Memeriksa…",
      exact: true,
    });
    await expect(waiting).toBeVisible();
    await expect(waiting).toBeDisabled();
    await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
    await expect(f.email).toBeDisabled();
    await expect(f.email).not.toBeEditable();
    await expect(f.password).toBeDisabled();
    await expect(f.toggle).toBeDisabled();
    await expect(f.signIn).toHaveCount(0);
    await expect(f.error).toHaveCount(0);
    // Pemutar menandai menunggu dan tidak terbaca pembaca layar.
    await expect(waiting.locator("svg[aria-hidden='true']")).toHaveCount(1);

    // Pengiriman tambahan selagi menunggu: Enter berulang dan dua pengiriman
    // formulir sekaligus dalam satu tugas.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      const form = document.querySelector("form")!;
      form.requestSubmit();
      form.requestSubmit();
    });
    // Beri waktu pada permintaan tambahan (bila ada) untuk sampai ke route.
    await delay(300);
    expect(requests).toBe(1);

    release();
    await expect(f.error).toHaveText(text.credentials);
    expect(requests).toBe(1);
    await expect(f.signIn).toBeEnabled();
    await expect(page.locator("form")).toHaveAttribute("aria-busy", "false");
    await expect(f.email).toBeEnabled();
    await expect(f.password).toBeFocused();
  } finally {
    release();
  }
});

test("Enter di bidang kata sandi mengirim formulir satu kali", async ({
  page,
}) => {
  const f = fields(page);
  let requests = 0;
  await page.route("**/api/auth/sign-in/email", (route) => {
    requests += 1;
    return route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
  });
  await open(page, "/sign-in");
  await f.email.fill("petugas@example.com");
  await f.password.fill("kata-sandi-apa-saja");
  await f.password.press("Enter");
  await expect(f.error).toHaveText(text.credentials);
  expect(requests).toBe(1);
});

test("isian kosong atau terlalu pendek dicegah browser sebelum ada permintaan", async ({
  page,
}) => {
  const f = fields(page);
  let requests = 0;
  await page.route("**/api/auth/sign-in/email", (route) => {
    requests += 1;
    return route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
  });
  await open(page, "/sign-in");
  await f.signIn.click();
  await expect(f.email).toBeFocused();
  await f.email.fill("bukan-email");
  await f.password.fill("kata-sandi-apa-saja");
  await f.signIn.click();
  await expect(f.email).toBeFocused();
  await f.email.fill("petugas@example.com");
  await f.password.fill("pendek");
  await f.signIn.click();
  await expect(f.password).toBeFocused();
  expect(requests).toBe(0);
  await expect(f.error).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Tombol tampil/sembunyi kata sandi dan urutan Tab
// ---------------------------------------------------------------------------

test("tombol tampil/sembunyi: tipe bidang berganti, nilai dan fokus bertahan, nama tetap", async ({
  page,
}) => {
  const f = fields(page);
  let requests = 0;
  await page.route("**/api/auth/sign-in/email", (route) => {
    requests += 1;
    return route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
  });
  await open(page, "/sign-in");
  await f.password.fill("rahasia-12345");
  await expect(f.password).toHaveAttribute("type", "password");
  await expect(f.toggle).toHaveAttribute("aria-pressed", "false");
  await expect(f.toggle).toHaveAttribute("type", "button");

  // Ukuran dan tempat: cukup besar untuk disentuh, di dalam bidangnya, dan
  // tulisan tidak berjalan di bawahnya.
  const toggleBox = (await f.toggle.boundingBox())!;
  const fieldBox = (await f.password.boundingBox())!;
  expect(toggleBox.width).toBeGreaterThanOrEqual(24);
  expect(toggleBox.height).toBeGreaterThanOrEqual(24);
  expect(toggleBox.x).toBeGreaterThanOrEqual(fieldBox.x);
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(
    fieldBox.x + fieldBox.width,
  );
  const padding = await f.password.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).paddingRight),
  );
  expect(padding).toBeGreaterThanOrEqual(toggleBox.width);

  await f.toggle.click();
  await expect(f.password).toHaveAttribute("type", "text");
  await expect(f.toggle).toHaveAttribute("aria-pressed", "true");
  await expect(f.password).toHaveValue("rahasia-12345");
  await expect(f.toggle).toBeFocused();
  // Nama aksesibel tidak ikut berganti bersama status.
  await expect(f.toggle).toHaveAccessibleName("Tampilkan kata sandi");
  await expect(
    page.getByRole("button", { name: "Sembunyikan kata sandi" }),
  ).toHaveCount(0);

  await f.toggle.click();
  await expect(f.password).toHaveAttribute("type", "password");
  await expect(f.toggle).toHaveAttribute("aria-pressed", "false");
  await expect(f.password).toHaveValue("rahasia-12345");
  await expect(f.toggle).toBeFocused();

  // Lewat papan ketik: Spasi dan Enter pada tombol, dan tidak mengirim formulir.
  await page.keyboard.press("Space");
  await expect(f.password).toHaveAttribute("type", "text");
  await page.keyboard.press("Enter");
  await expect(f.password).toHaveAttribute("type", "password");
  await expect(f.toggle).toBeFocused();
  expect(requests).toBe(0);
});

test("urutan Tab: email, kata sandi, tombol tampil, Masuk, lalu tautan Buat akun; fokusnya terlihat", async ({
  page,
}) => {
  const f = fields(page);
  await open(page, "/sign-in");
  await f.email.focus();
  const order: Array<string | null> = [await activeName(page)];
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Tab");
    order.push(await activeName(page));
    if (step === 1) {
      // Tombol tampil memperlihatkan fokusnya (bayangan cincin), bukan
      // dihilangkan.
      const ring = await f.toggle.evaluate(
        (el) => getComputedStyle(el).boxShadow,
      );
      expect(ring).not.toBe("none");
    }
  }
  expect(order).toEqual([
    "email",
    "password",
    "Tampilkan kata sandi",
    "Masuk",
    "Buat akun",
  ]);
  // Mundur dengan Shift+Tab melewati urutan yang sama.
  await page.keyboard.press("Shift+Tab");
  expect(await activeName(page)).toBe("Masuk");
});

// ---------------------------------------------------------------------------
// Gerak berkurang
// ---------------------------------------------------------------------------

test("pemutar menunggu tidak berputar bila pengguna meminta gerak dikurangi", async ({
  page,
}) => {
  const f = fields(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await gate;
    await route.fulfill({ status: 401, ...jsonBody(wrongCredentials) });
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/sign-in");
    await f.email.fill("petugas@example.com");
    await f.password.fill("kata-sandi-apa-saja");
    await f.signIn.click();
    const spinner = page
      .getByRole("button", { name: "Memeriksa…", exact: true })
      .locator("svg");
    await expect(spinner).toHaveCount(1);
    const animationName = () =>
      spinner.evaluate((el) => getComputedStyle(el).animationName);
    expect(await animationName()).toBe("none");
    // Pembanding: tanpa permintaan itu, pemutar yang sama berputar. Tanpanya
    // tes ini tidak membuktikan apa-apa.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(animationName).toBe("spin");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(animationName).toBe("none");
  } finally {
    release();
  }
});

// ---------------------------------------------------------------------------
// Server sungguhan (autentikasi asli, tanpa jalan pintas)
// ---------------------------------------------------------------------------

test("server sungguhan: email tak dikenal dan kata sandi salah dijawab sama persis; yang benar masuk ke /app", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const f = fields(page);
  await open(page, "/sign-in");

  // 1. Email yang tidak terdaftar.
  await f.email.fill(`tidak-ada-${randomUUID()}@example.com`);
  await f.password.fill("kata-sandi-yang-salah");
  await actPastLimit(
    page,
    () => f.signIn.click(),
    () => expect(f.error).toContainText("Email atau kata sandi salah"),
  );
  const unknownEmail = (await f.error.innerText()).trim();
  expect(unknownEmail).toBe(text.credentials);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(f.signIn).toBeEnabled();
  await expectPasswordSelected(page);

  // 2. Email yang terdaftar, kata sandi salah: pesan yang sama persis.
  await f.email.fill(account.email);
  await actPastLimit(
    page,
    () => f.signIn.click(),
    () => expect(f.error).toContainText("Email atau kata sandi salah"),
  );
  expect((await f.error.innerText()).trim()).toBe(unknownEmail);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(f.signIn).toBeEnabled();
  await expect(f.password).toHaveAttribute("aria-invalid", "true");
  await expectPasswordSelected(page);

  // 3. Kata sandi benar: ketikan menggantikan isi yang terpilih, Enter
  // mengirim, dan petugas masuk ke dasbor.
  await page.keyboard.type(password);
  await expect(f.password).toHaveValue(password);
  await actPastLimit(
    page,
    () => page.keyboard.press("Enter"),
    () => expect(page).toHaveURL(/\/app$/),
  );
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
});

test("server sungguhan: akun yang diblokir mendapat pesan khusus dari kode BANNED_USER", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const f = fields(page);
  await pool.query(`UPDATE "user" SET banned = true WHERE email = $1`, [
    account.email,
  ]);
  try {
    await open(page, "/sign-in");
    await f.email.fill(account.email);
    await f.password.fill(password);
    await actPastLimit(
      page,
      () => f.signIn.click(),
      () => expect(f.error).toHaveText(text.banned),
    );
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(f.signIn).toBeEnabled();
    await expect(f.signIn).toBeFocused();
    await expect(f.password).toHaveValue(password);
  } finally {
    await pool.query(`UPDATE "user" SET banned = false WHERE email = $1`, [
      account.email,
    ]);
  }
});

test("server sungguhan: mendaftar dengan email yang sudah terdaftar memberi pesan dan fokus ke email", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const f = fields(page);
  await open(page, "/sign-up");
  await f.name.fill("Petugas Kembar");
  await f.email.fill(account.email);
  await f.password.fill(password);
  await actPastLimit(
    page,
    () => f.signUp.click(),
    () => expect(f.error).toHaveText(text.taken),
  );
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(f.signUp).toBeEnabled();
  await expect(f.email).toBeFocused();
  await expect(f.email).toHaveAttribute("aria-invalid", "true");
  await expect(f.email).toHaveValue(account.email);
  await expect(f.name).toHaveValue("Petugas Kembar");
  // Tidak ada sesi baru: tetap di halaman daftar, dan /api/auth tidak
  // mengenal pengunjung ini.
  const session = await page.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
});
