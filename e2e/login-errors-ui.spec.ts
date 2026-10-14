import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { contextFor, signUp, type Cookies } from "./billing-ui";
import { contrastOf } from "./contrast";

// Galat login dan aksinya di halaman sungguhan (mode demo, port 3101):
//  - batas laju (429): tombol kirim menunggu dengan hitung mundur (jam palsu),
//    tidak mengirim apa pun selama menunggu, mengumumkan selesai satu kali;
//  - sesi berakhir: cookie ada tetapi sesinya tidak sah, halaman masuk memberi
//    tahu dan petugas kembali ke tujuan semula sesudah masuk;
//  - halaman "tidak ditemukan" berbahasa Indonesia dengan jalan kembali.
// (Halaman galat error.tsx tidak bisa dipicu dengan sah di aplikasi; teksnya
// diperiksa dari sumber di login-errors.spec.ts.)
//
// Jawaban 429 ditiru lewat route supaya batas laju Better Auth yang asli (3
// permintaan per 10 detik per jalur) tidak dikuras dan tidak dimatikan. Masuk
// ke server sungguhan hanya dilakukan di tes sesi berakhir; bila kena batas
// laju, tombol menunggu hitung mundurnya (click menunggu sampai tombol aktif).

const origin = "http://localhost:3101";
const password = "A-long-test-password-123!";
const narrow = { width: 390, height: 844 };
const wide = { width: 1440, height: 900 };

const limitedText =
  "Terlalu banyak percobaan. Tunggu beberapa detik lalu coba lagi.";
const credentialsText = "Email atau kata sandi salah. Periksa lalu coba lagi.";
const signUpFailedText =
  "Akun belum bisa dibuat. Periksa isian lalu coba lagi.";
const expiredText = "Sesi Anda berakhir. Masuk lagi untuk melanjutkan.";
const signedOutText = "Anda sudah keluar.";
const readyText = "Anda bisa mencoba lagi sekarang.";
const waitNoteText = "Batas percobaan tercapai; tunggu beberapa detik.";
const countdownText = (seconds: number) =>
  `Bisa mencoba lagi dalam ${seconds} dtk`;

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});
test.afterAll(async () => {
  await pool.end();
});

interface Account {
  email: string;
  cookies: Cookies;
}

async function register(browser: Browser, name: string): Promise<Account> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const cookies = await signUp(context, name);
    const response = await context.request.get("/api/auth/get-session");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { user: { email: string } };
    return { email: body.user.email, cookies };
  } finally {
    await context.close();
  }
}

// Akun A: sesinya dihapus di database oleh tes sesi berakhir. Akun B: tetap
// masuk, untuk tes halaman tidak ditemukan.
let accountA: Account;
let accountB: Account;
test.beforeAll(async ({ browser }) => {
  accountA = await register(browser, "Petugas Sesi Habis");
  accountB = await register(browser, "Petugas Tetap Masuk");
});

// ---------------------------------------------------------------------------
// Pembantu
// ---------------------------------------------------------------------------

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
  toSignUp: page.getByRole("link", { name: "Buat akun", exact: true }),
  toSignIn: page.getByRole("link", { name: "Masuk", exact: true }),
  error: page.locator("#auth-error"),
  heading: page.getByRole("heading", { level: 1 }),
});

// Hitung mundur: baris terpisah DI BAWAH tombol (bukan di dalam tombol),
// tersembunyi dari pembaca layar, hanya ada selama menunggu.
const countdown = (page: Page) => page.getByTestId("retry-countdown");

// WCAG 2.5.3 (Label in Name): teks yang terlihat pada tombol sama dengan nama
// aksesibelnya, di setiap detik hitungan; tidak ada aria-label yang menimpa.
async function expectNameIsVisibleText(button: Locator, label: string) {
  const visible = (await button.innerText()).replace(/\s+/g, " ").trim();
  expect(visible).toBe(label);
  await expect(button).toHaveAccessibleName(visible);
  await expect(button).not.toHaveAttribute("aria-label", /.*/);
}

// Hitung mundur sedang tampil dengan angka `seconds`, di bawah tombol dan
// tersembunyi dari pembaca layar.
async function expectCountdown(page: Page, button: Locator, seconds: number) {
  const row = countdown(page);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveText(countdownText(seconds));
  await expect(row).toHaveAttribute("aria-hidden", "true");
  await expect(row.locator("svg")).toHaveCount(1);
  await expect(row.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(row.locator("span[aria-hidden='true']")).toHaveText(
    String(seconds),
  );
  // Bukan di dalam <button>, tetapi di pembungkus yang sama dan di bawahnya.
  await expect(button.getByTestId("retry-countdown")).toHaveCount(0);
  await expect(
    button.locator("xpath=..").getByTestId("retry-countdown"),
  ).toHaveCount(1);
  const buttonBox = (await button.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(rowBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
}

// Wilayah status tersembunyi untuk "bisa mencoba lagi" (kosong sampai selesai).
const readyRegion = (page: Page) => page.locator("p[role='status'].sr-only");
const readyAnnouncements = (page: Page) =>
  page.getByRole("status").filter({ hasText: readyText });
const expiredNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: expiredText });
const signedOutNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: signedOutText });

// Formulir sudah dihidrasi: sebelum itu pengiriman ditangani browser, bukan skrip.
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return (
      form !== null &&
      Object.keys(form).some((key) => key.startsWith("__reactProps$"))
    );
  });
}

// Galat konsol yang diharapkan: jawaban 429/401 yang sengaja ditiru atau
// ditunggu (Chrome mencatat "Failed to load resource ... status of 429").
const unexpected = (errors: string[]) =>
  errors.filter((message) => !/status of (401|403|404|429)/.test(message));

// Menjawab sign-in/sign-up dengan 429. `header` null: tanpa header sama sekali.
// Mengembalikan pencacah permintaan dan kendali jawaban berikutnya.
async function mockAuth(
  page: Page,
  path: "sign-in" | "sign-up",
  initial: { status: number; header: string | null },
) {
  const state = { requests: 0, ...initial };
  await page.route(`**/api/auth/${path}/email`, (route) => {
    state.requests += 1;
    return route.fulfill({
      status: state.status,
      contentType: "application/json",
      headers: state.header === null ? {} : { "X-Retry-After": state.header },
      body: JSON.stringify(
        state.status === 429
          ? { message: "Too many requests. Please try again later." }
          : { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid" },
      ),
    });
  });
  return state;
}

async function fillSignIn(page: Page) {
  const f = fields(page);
  await f.email.fill("petugas@example.com");
  await f.password.fill("kata-sandi-apa-saja");
}

async function fillSignUp(page: Page) {
  const f = fields(page);
  await f.name.fill("Petugas Tiruan");
  await fillSignIn(page);
}

// Jam palsu: dipasang sebelum halaman dibuka; waktu mengalir sampai dihentikan
// (pauseAt). Mulai dari saat tetap supaya angka tidak bergantung pada jam tes.
const T0 = Date.UTC(2026, 9, 9, 3, 0, 0);

// Menghentikan jam palsu di T0 + 60 detik (cukup jauh dari muat halaman).
async function freeze(page: Page) {
  await page.clock.pauseAt(T0 + 60_000);
}

// Pencatat interval aktif di halaman: dipasang SESUDAH jam palsu terpasang
// (membungkus setInterval/clearInterval palsu), jadi hanya interval yang dibuat
// sesudahnya yang tercatat.
async function trackIntervals(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __interval: Set<number>;
      setInterval: (...args: unknown[]) => number;
      clearInterval: (id: number) => void;
    };
    w.__interval = new Set();
    const set = w.setInterval.bind(w);
    const clear = w.clearInterval.bind(w);
    w.setInterval = (...args: unknown[]) => {
      const id = set(...args);
      w.__interval.add(id);
      return id;
    };
    w.clearInterval = (id: number) => {
      w.__interval.delete(id);
      clear(id);
    };
  });
}
const liveIntervals = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __interval: Set<number> }).__interval.size,
  );
// Efek React dibersihkan/dipasang sedikit sesudah render, jadi jumlahnya
// ditunggu, tidak dibaca sekali.
const expectIntervals = (page: Page, count: number) =>
  expect.poll(() => liveIntervals(page), { timeout: 5_000 }).toBe(count);

// Semua transisi dan animasi CSS selesai, supaya warna yang diukur sudah akhir.
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );

// ---------------------------------------------------------------------------
// a. Hitung mundur batas laju (jam palsu)
// ---------------------------------------------------------------------------

for (const mode of ["sign-in", "sign-up"] as const) {
  const label = mode === "sign-in" ? "Masuk" : "Buat akun";
  test(`${mode}: 429 dengan X-Retry-After 7 mengunci tombol, menghitung mundur 7..1, mengabaikan klik dan Enter, mengumumkan selesai satu kali`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const { context, page, errors } = await contextFor(browser, []);
    await page.clock.install({ time: T0 });
    const state = await mockAuth(page, mode, { status: 429, header: "7" });
    const f = fields(page);
    const button = mode === "sign-in" ? f.signIn : f.signUp;
    try {
      await page.goto(mode === "sign-in" ? "/sign-in" : "/sign-up");
      await hydrated(page);
      await (mode === "sign-in" ? fillSignIn(page) : fillSignUp(page));
      await trackIntervals(page);
      await freeze(page);

      // Sebelum apa pun: tombol normal, wilayah status ada tetapi kosong.
      await expect(button).not.toHaveAttribute("aria-disabled", /.*/);
      await expect(button).toHaveText(label);
      await expect(readyRegion(page)).toHaveCount(1);
      await expect(readyRegion(page)).toHaveText("");

      await button.click();
      expect(state.requests).toBe(1);
      await expect(f.error).toHaveText(limitedText);
      await expect(f.error).toHaveAttribute("role", "alert");

      // Keadaan menunggu: aria-disabled (BUKAN disabled), fokus tetap di tombol,
      // teks tombol TIDAK berubah (nama aksesibel = teks terlihat), hitung mundur
      // di baris terpisah di bawah tombol, dan penjelasan statis tanpa angka.
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).not.toHaveAttribute("disabled", /.*/);
      await expect(button).toHaveText(label);
      await expectNameIsVisibleText(button, label);
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute("type", "submit");
      // Tanpa panah selagi menunggu, dan tanpa ikon lain di dalam tombol.
      await expect(button.locator("svg")).toHaveCount(0);
      await expectCountdown(page, button, 7);
      await expect(button).toHaveAccessibleDescription(waitNoteText);
      expect(waitNoteText).not.toMatch(/\d/);
      // Angka yang berkurang tidak diumumkan: tidak ada wilayah langsung di dalam
      // tombol.
      await expect(
        button.locator(
          "[aria-live], [role=status], [role=alert], [role=timer]",
        ),
      ).toHaveCount(0);
      // Tepat satu interval hidup.
      await expectIntervals(page, 1);

      // Klik (dipaksa melewati pemeriksaan aktif), klik lewat DOM, Enter di
      // tombol, dan Enter di bidang: tidak satu pun mengirim.
      await button.click({ force: true });
      await button.dispatchEvent("click");
      await page.keyboard.press("Enter");
      await f.password.press("Enter");
      await page.evaluate(() => {
        const form = document.querySelector("form")!;
        form.requestSubmit();
        form.requestSubmit();
      });
      await delay(400);
      expect(state.requests).toBe(1);
      // Tombol masih menunggu, tidak berganti angka (jam berhenti), dan pesan galat
      // tetap.
      await expect(countdown(page)).toHaveText(countdownText(7));
      await expect(button).toHaveText(label);
      await expect(f.error).toHaveText(limitedText);
      // Enter di kata sandi memindahkan fokus ke sana; kembalikan ke tombol
      // untuk langkah berikut.
      await button.focus();
      await expect(button).toBeFocused();

      // Hitung mundur 7, 6, 5, ... 1 (satu detik jam palsu tiap langkah).
      for (let left = 6; left >= 1; left -= 1) {
        await page.clock.runFor(1000);
        await expectCountdown(page, button, left);
        await expect(button).toHaveText(label);
        await expect(button).toHaveAttribute("aria-disabled", "true");
        await expect(button).toBeFocused();
        // Di setiap detik: nama aksesibel sama dengan teks yang terlihat.
        await expectNameIsVisibleText(button, label);
        await expect(button).toHaveAccessibleDescription(waitNoteText);
        // Belum diumumkan selagi menunggu.
        await expect(readyAnnouncements(page)).toHaveCount(0);
        await expect(readyRegion(page)).toHaveText("");
        await expectIntervals(page, 1);
      }
      expect(state.requests).toBe(1);

      // Detik terakhir: selesai. Tombol normal, fokus tetap, pesan galat tetap,
      // pengumuman muncul tepat satu.
      await page.clock.runFor(1000);
      await expect(button).not.toHaveAttribute("aria-disabled", /.*/);
      await expect(button).toHaveText(label);
      await expect(button).toBeEnabled();
      await expect(button).toBeFocused();
      await expectNameIsVisibleText(button, label);
      await expect(button.locator("svg")).toHaveCount(1); // panah kembali
      // Hitung mundur dan penjelasannya hilang bersama keadaan menunggu.
      await expect(countdown(page)).toHaveCount(0);
      await expect(button).not.toHaveAttribute("aria-describedby", /.*/);
      await expect(button).toHaveAccessibleDescription("");
      await expect(f.error).toHaveText(limitedText);
      await expect(readyAnnouncements(page)).toHaveCount(1);
      await expect(readyAnnouncements(page)).toHaveText(readyText);
      await expectIntervals(page, 0);

      // Tidak diumumkan lagi / tidak berubah sesudahnya.
      await page.clock.runFor(30_000);
      await expect(readyAnnouncements(page)).toHaveCount(1);
      await expect(button).toHaveText(label);

      // Klik berikutnya mengirim. Jawaban kali ini 401: pesan galat berganti dan
      // pengumuman hilang.
      state.status = 401;
      state.header = null;
      await button.click();
      await expect.poll(() => state.requests).toBe(2);
      await expect(f.error).toHaveText(
        mode === "sign-in" ? credentialsText : signUpFailedText,
      );
      await expect(readyAnnouncements(page)).toHaveCount(0);
      await expect(button).not.toHaveAttribute("aria-disabled", /.*/);
      await expectIntervals(page, 0);
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("lama tunggu: tanpa header 10, '999' dibatasi 60, 'abc' 10, '0' 10, '2.1' dibulatkan ke atas 3, '1' satu detik", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, errors } = await contextFor(browser, []);
  await page.clock.install({ time: T0 });
  const state = await mockAuth(page, "sign-in", { status: 429, header: null });
  const f = fields(page);
  try {
    await page.goto("/sign-in");
    await hydrated(page);
    await fillSignIn(page);
    await freeze(page);

    const cases: [string | null, number][] = [
      [null, 10],
      ["999", 60],
      ["abc", 10],
      ["0", 10],
      ["-4", 10],
      ["", 10],
      ["2.1", 3],
      ["1", 1],
      ["61", 60],
      ["60", 60],
    ];
    let expectedRequests = 0;
    for (const [header, seconds] of cases) {
      state.header = header;
      await f.signIn.click();
      expectedRequests += 1;
      await expect(countdown(page), `${header}`).toHaveText(
        countdownText(seconds),
      );
      await expect(f.signIn).toHaveText("Masuk");
      expect(state.requests).toBe(expectedRequests);
      // Sedetik sebelum habis masih menunggu; tepat sesudahnya aktif.
      await page.clock.runFor((seconds - 1) * 1000);
      await expect(countdown(page)).toHaveText(countdownText(1));
      await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
      await page.clock.runFor(1000);
      await expect(countdown(page)).toHaveCount(0);
      await expect(f.signIn).toHaveText("Masuk");
      await expect(f.signIn).not.toHaveAttribute("aria-disabled", /.*/);
    }
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("berpindah dari masuk ke daftar lalu kembali tidak menyisakan hitungan lama, dan intervalnya dibersihkan", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page, errors } = await contextFor(browser, []);
  // Jam mengalir (tidak dihentikan): hitungan 60 detik tidak habis selama tes.
  await page.clock.install({ time: T0 });
  await mockAuth(page, "sign-in", { status: 429, header: "60" });
  const f = fields(page);
  try {
    await page.goto("/sign-in");
    await hydrated(page);
    await fillSignIn(page);
    await trackIntervals(page);

    await f.signIn.click();
    await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
    await expect(countdown(page)).toHaveText(
      /^Bisa mencoba lagi dalam \d+ dtk$/,
    );
    await expectIntervals(page, 1);

    // Ke halaman daftar lewat tautan (navigasi di dalam aplikasi).
    await f.toSignUp.click();
    await expect(page).toHaveURL(`${origin}/sign-up`);
    await expect(f.heading).toHaveText("Buat akun petugas");
    await hydrated(page);
    await expect(f.signUp).toHaveText("Buat akun");
    await expect(f.signUp).not.toHaveAttribute("aria-disabled", /.*/);
    await expect(f.signUp).toBeEnabled();
    await expect(f.error).toHaveCount(0);
    await expect(readyAnnouncements(page)).toHaveCount(0);
    await expect(countdown(page)).toHaveCount(0);
    await expect(page.getByText(/mencoba lagi dalam/)).toHaveCount(0);
    // Interval halaman masuk dibersihkan saat komponennya dilepas.
    await expectIntervals(page, 0);

    // Kembali ke masuk: formulir bersih, tanpa hitungan, tanpa galat.
    await f.toSignIn.click();
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(f.heading).toHaveText("Masuk ke NOC ISP");
    await hydrated(page);
    await expect(f.signIn).toHaveText("Masuk");
    await expect(f.signIn).not.toHaveAttribute("aria-disabled", /.*/);
    await expect(f.signIn).toBeEnabled();
    await expect(f.error).toHaveCount(0);
    await expect(countdown(page)).toHaveCount(0);
    await expect(page.getByText(/mencoba lagi dalam/)).toHaveCount(0);
    await expectIntervals(page, 0);
    // Dan tetap bisa mengirim.
    await fillSignIn(page);
    await f.signIn.click();
    await expect(f.error).toHaveText(limitedText);
    await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
    await expectIntervals(page, 1);
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// b. Jam dinding, bukan hitungan denyut
// ---------------------------------------------------------------------------

test("jam melompat 5 detik sekaligus: angka langsung turun 5 (bukan 1), lalu melompat melewati akhir langsung selesai", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page, errors } = await contextFor(browser, []);
  await page.clock.install({ time: T0 });
  const state = await mockAuth(page, "sign-in", { status: 429, header: "7" });
  const f = fields(page);
  try {
    await page.goto("/sign-in");
    await hydrated(page);
    await fillSignIn(page);
    await freeze(page);

    await f.signIn.click();
    await expect(countdown(page)).toHaveText(countdownText(7));

    // fastForward: jam melompat, timer yang jatuh tempo berjalan sekali (seperti
    // laptop yang tertutup lalu dibuka lagi). Dihitung per denyut akan menjadi 6.
    await page.clock.fastForward(5000);
    await expect(countdown(page)).toHaveText(countdownText(2));
    await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
    await expect(readyAnnouncements(page)).toHaveCount(0);

    // Melompat melewati akhir: selesai sekaligus.
    await page.clock.fastForward(60_000);
    await expect(f.signIn).toHaveText("Masuk");
    await expect(f.signIn).not.toHaveAttribute("aria-disabled", /.*/);
    await expect(readyAnnouncements(page)).toHaveCount(1);
    expect(state.requests).toBe(1);
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("jam dinding yang digeser (setFixedTime) langsung terbaca di denyut berikutnya, juga lewat tab yang terlihat lagi", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { context, page } = await contextFor(browser, []);
  await page.clock.install({ time: T0 });
  await mockAuth(page, "sign-in", { status: 429, header: "9" });
  const f = fields(page);
  try {
    await page.goto("/sign-in");
    await hydrated(page);
    await fillSignIn(page);
    await freeze(page);
    await f.signIn.click();
    await expect(countdown(page)).toHaveText(countdownText(9));
    const start = await page.evaluate(() => Date.now());

    // Tab "terlihat lagi" (visibilitychange) setelah jam dinding bergeser 6
    // detik, tanpa satu denyut interval pun: angka langsung 3.
    await page.clock.setFixedTime(start + 6000);
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(countdown(page)).toHaveText(countdownText(3));

    // Bergeser ke belakang melewati akhir: selesai.
    await page.clock.setFixedTime(start + 20_000);
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(f.signIn).toHaveText("Masuk");
    await expect(readyAnnouncements(page)).toHaveCount(1);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// g (sebagian). Papan ketik dan gerak berkurang
// ---------------------------------------------------------------------------

test("tombol yang menunggu tetap ada dalam urutan Tab dengan fokus terlihat, dan Spasi tidak mengirim", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { context, page, errors } = await contextFor(browser, []);
  const state = await mockAuth(page, "sign-in", { status: 429, header: "60" });
  const f = fields(page);
  try {
    await page.goto("/sign-in");
    await hydrated(page);
    await fillSignIn(page);
    await f.signIn.click();
    await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
    await expect(f.signIn).toBeFocused();
    expect(state.requests).toBe(1);

    const active = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return (
          el?.id ||
          el?.getAttribute("aria-label") ||
          el?.textContent?.trim() ||
          null
        );
      });
    // Urutan: email, kata sandi, tampil kata sandi, tombol (menunggu), tautan.
    await f.email.focus();
    const order = [await active()];
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      order.push(await active());
    }
    expect(order).toEqual([
      "email",
      "password",
      "Tampilkan kata sandi",
      "Masuk",
      "Buat akun",
    ]);
    await page.keyboard.press("Shift+Tab");
    await expect(f.signIn).toBeFocused();
    // Fokus papan ketik terlihat: cincin 3 px pada tombol yang menunggu. (Fokus
    // yang dikembalikan skrip sesudah klik mouse sengaja tidak memakai cincin:
    // :focus-visible mengikuti cara terakhir pengguna berinteraksi.)
    await expect
      .poll(() => f.signIn.evaluate((el) => getComputedStyle(el).boxShadow))
      .toContain("0px 0px 0px 3px");

    // Spasi dan Enter pada tombol yang menunggu tidak mengirim apa pun.
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    await delay(400);
    expect(state.requests).toBe(1);
    await expect(f.signIn).toBeFocused();
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("gerak berkurang: tombol yang menunggu tidak bertransisi dan tidak ada animasi", async ({
  browser,
}) => {
  const results: Record<string, { transition: string; animations: number }> =
    {};
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    const { context, page } = await contextFor(browser, [], { reducedMotion });
    await mockAuth(page, "sign-in", { status: 429, header: "60" });
    const f = fields(page);
    try {
      await page.goto("/sign-in");
      await hydrated(page);
      await fillSignIn(page);
      await f.signIn.click();
      await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
      results[reducedMotion] = await f.signIn.evaluate((el) => ({
        transition: getComputedStyle(el).transitionProperty,
        animations: el
          .getAnimations({ subtree: true })
          .filter((animation) => animation instanceof CSSAnimation).length,
      }));
    } finally {
      await context.close();
    }
  }
  expect(results.reduce.transition).toBe("none");
  expect(results.reduce.animations).toBe(0);
  // Pembanding: tanpa permintaan itu, tombol yang sama bertransisi. Tanpanya
  // tes ini tidak membuktikan apa-apa.
  expect(results["no-preference"].transition).not.toBe("none");
  expect(results["no-preference"].animations).toBe(0);
});

// ---------------------------------------------------------------------------
// Tata letak tetap dan WCAG 2.5.3 (Label in Name)
// ---------------------------------------------------------------------------

for (const viewport of [narrow, wide]) {
  test(`hitung mundur tidak menggeser tata letak (${viewport.width} px): tombol dan elemen sesudahnya sama persis sebelum, selama, dan sesudah menunggu`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { context, page, errors } = await contextFor(browser, [], {
      viewport,
    });
    await page.clock.install({ time: T0 });
    await mockAuth(page, "sign-in", { status: 429, header: "3" });
    const f = fields(page);
    // Kotak tombol, tautan Buat akun, kalimat di bawah formulir, pesan galat,
    // dan tinggi seluruh halaman.
    const boxes = async () => ({
      button: await f.signIn.boundingBox(),
      error: await f.error.boundingBox(),
      footer: await page.getByText("Belum punya akun?").boundingBox(),
      link: await f.toSignUp.boundingBox(),
      pageHeight: await page.evaluate(
        () => document.documentElement.scrollHeight,
      ),
    });
    try {
      await page.goto("/sign-in");
      await hydrated(page);
      await fillSignIn(page);
      await freeze(page);

      // Percobaan pertama memunculkan pesan galat (yang tinggal sampai kiriman
      // berikutnya); tunggu habis. Dari sini pesan galat tetap ada, jadi yang
      // dibandingkan hanya pengaruh hitung mundurnya.
      await f.signIn.click();
      await expect(countdown(page)).toHaveText(countdownText(3));
      await page.clock.runFor(3000);
      await expect(countdown(page)).toHaveCount(0);
      await expect(f.signIn).not.toHaveAttribute("aria-disabled", /.*/);
      await expect(f.error).toHaveText(limitedText);
      const before = await boxes();
      expect(before.button).not.toBeNull();
      expect(before.footer).not.toBeNull();

      // Menunggu lagi (kiriman kedua): pesan galat yang sama, hitung mundur tampil.
      await f.signIn.click();
      await expect(f.error).toHaveText(limitedText);
      await expect(countdown(page)).toHaveText(countdownText(3));
      expect(await boxes(), "selama menunggu").toEqual(before);
      await page.clock.runFor(1000);
      await expect(countdown(page)).toHaveText(countdownText(2));
      expect(await boxes(), "selama menunggu, detik berikutnya").toEqual(
        before,
      );

      // Selesai: hitung mundur hilang, tata letak tetap.
      await page.clock.runFor(2000);
      await expect(countdown(page)).toHaveCount(0);
      await expect(f.signIn).not.toHaveAttribute("aria-disabled", /.*/);
      expect(await boxes(), "sesudah menunggu").toEqual(before);
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Setiap tombol dan tautan yang terlihat dan punya teks: teks yang terlihat
// termuat dalam nama aksesibelnya (tanpa membedakan huruf besar-kecil). Tombol
// berisi ikon saja (tanpa teks) tidak punya yang dibandingkan. Mengembalikan
// teks yang diperiksa.
async function expectLabelsInNames(page: Page, state: string) {
  const items = page.locator("button, a[href]");
  const count = await items.count();
  const checked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    if (!(await item.isVisible())) continue;
    const text = (await item.innerText()).replace(/\s+/g, " ").trim();
    if (!text) continue;
    await expect(item, `${state}: "${text}"`).toHaveAccessibleName(
      new RegExp(escapeRegExp(text), "i"),
    );
    checked.push(text);
  }
  return checked;
}

for (const mode of ["sign-in", "sign-up"] as const) {
  const idle = mode === "sign-in" ? "Masuk" : "Buat akun";
  const sending = mode === "sign-in" ? "Memeriksa…" : "Membuat akun…";
  test(`WCAG 2.5.3: di halaman ${mode === "sign-in" ? "masuk" : "daftar"}, teks terlihat setiap tombol dan tautan termuat dalam nama aksesibelnya: biasa, mengirim, dan menunggu`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { context, page, errors } = await contextFor(browser, [], {
      viewport: wide,
    });
    // Jawaban ditahan supaya keadaan "mengirim" bisa diperiksa.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/auth/${mode}/email`, async (route) => {
      await gate;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "X-Retry-After": "60" },
        body: JSON.stringify({ message: "Too many requests" }),
      });
    });
    const f = fields(page);
    try {
      await page.goto(mode === "sign-in" ? "/sign-in" : "/sign-up");
      await hydrated(page);
      await (mode === "sign-in" ? fillSignIn(page) : fillSignUp(page));

      // Keadaan biasa.
      const normal = await expectLabelsInNames(page, "biasa");
      expect(normal).toContain(idle);
      // Tautan lain di halaman ikut diperiksa (merek, tautan ke halaman satunya).
      expect(normal.length).toBeGreaterThanOrEqual(3);

      // Mengirim: tombol bertuliskan "Memeriksa…"/"Membuat akun…".
      await (mode === "sign-in" ? f.signIn : f.signUp).click();
      await expect(
        page.getByRole("button", { name: sending, exact: true }),
      ).toBeVisible();
      const whileSending = await expectLabelsInNames(page, "mengirim");
      expect(whileSending).toContain(sending);

      // Menunggu (batas laju): teks tombol tidak berubah.
      release();
      // Dicari lewat jenisnya (bukan lewat nama), supaya tes ini tetap sampai
      // ke pemeriksaan Label in Name walau namanya sudah menyimpang.
      const button = page.locator("button[type=submit]");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(countdown(page)).toHaveText(countdownText(60));
      const whileWaiting = await expectLabelsInNames(page, "menunggu");
      expect(whileWaiting).toContain(idle);
      // Hitung mundur bukan tombol atau tautan, dan tersembunyi dari pembaca
      // layar, jadi tidak ada label terlihat yang namanya tidak memuatnya.
      expect(whileWaiting.join("|")).not.toContain("dtk");
      expect(unexpected(errors)).toEqual([]);
    } finally {
      release();
      await context.close();
    }
  });
}

// ---------------------------------------------------------------------------
// c. Sesi berakhir
// ---------------------------------------------------------------------------

// Mengisi formulir masuk dengan akun sungguhan dan mengirim. Bila kena batas laju
// (tiga per sepuluh detik), tombol menunggu hitung mundurnya: click menunggu
// sampai tombol aktif lagi lalu mengirim ulang.
async function signInThroughForm(
  page: Page,
  account: Account,
  landing: string,
) {
  const f = fields(page);
  await hydrated(page);
  await f.email.fill(account.email);
  await f.password.fill(password);
  await f.signIn.click();
  const outcome = await Promise.race([
    page.waitForURL(landing, { timeout: 15_000 }).then(() => "ok" as const),
    page
      .locator("#auth-error")
      .filter({ hasText: limitedText })
      .waitFor({ timeout: 15_000 })
      .then(() => "limited" as const),
  ]);
  if (outcome === "limited") {
    await f.signIn.click({ timeout: 25_000 });
  }
  await page.waitForURL(landing, { timeout: 20_000 });
}

test("sesi dihapus di database: halaman masuk memberi tahu 'Sesi Anda berakhir', masuk lagi mendarat di tujuan semula", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const removed = await pool.query(
    `DELETE FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = $1)`,
    [accountA.email],
  );
  expect(removed.rowCount).toBeGreaterThanOrEqual(1);

  const { context, page, errors } = await contextFor(browser, accountA.cookies);
  const f = fields(page);
  try {
    await page.goto("/app/alert?x=1");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fapp%2Falert%3Fx%3D1&sesi=berakhir`,
    );
    await expect(f.heading).toHaveText("Masuk ke NOC ISP");
    await expect(expiredNotice(page)).toHaveCount(1);
    await expect(expiredNotice(page)).toHaveText(expiredText);
    await expect(signedOutNotice(page)).toHaveCount(0);
    // Ikon dan satu-satunya judul.
    await expect(expiredNotice(page).locator("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(page.getByRole("heading")).toHaveCount(1);
    // Isi alamat tidak dipantulkan: penegasannya kalimat tetap.
    await expect(page.locator("body")).not.toContainText("sesi=berakhir");
    // Tautan ke halaman daftar membawa tujuan tetapi TIDAK penanda sesi.
    await expect(f.toSignUp).toHaveAttribute(
      "href",
      "/sign-up?next=%2Fapp%2Falert%3Fx%3D1",
    );

    await signInThroughForm(page, accountA, `${origin}/app/alert?x=1`);
    await expect(
      page.getByRole("heading", { name: "Alert", level: 1 }),
    ).toBeVisible();
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("cookie sesi bernama benar tetapi nilainya ngawur: sama, penegasan tampil dan masuk lagi mendarat di tujuan semula", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const real = accountB.cookies.find((cookie) =>
    cookie.name.endsWith(".session_token"),
  );
  expect(real, "cookie sesi akun B").toBeDefined();
  const garbage: Cookies = [{ ...real!, value: "ngawur.ngawur" }];

  const { context, page, errors } = await contextFor(browser, garbage);
  try {
    await page.goto("/app/alert?x=1");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fapp%2Falert%3Fx%3D1&sesi=berakhir`,
    );
    await expect(expiredNotice(page)).toHaveText(expiredText);
    await expect(signedOutNotice(page)).toHaveCount(0);

    // Tanpa tujuan (jalur dasbor): hanya penanda.
    await page.goto("/app");
    await expect(page).toHaveURL(`${origin}/sign-in?sesi=berakhir`);
    await expect(expiredNotice(page)).toHaveCount(1);

    // /setup dan /admin ditolak layout yang sama, dengan penanda yang sama.
    await page.goto("/setup");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fsetup&sesi=berakhir`,
    );
    await page.goto("/admin");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fadmin&sesi=berakhir`,
    );
    await expect(expiredNotice(page)).toHaveCount(1);

    await page.goto("/app/alert?x=1");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fapp%2Falert%3Fx%3D1&sesi=berakhir`,
    );
    await signInThroughForm(page, accountB, `${origin}/app/alert?x=1`);
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("anonim tanpa cookie ke jalur yang sama: tujuan ikut, TANPA penanda sesi dan tanpa penegasan", async ({
  browser,
  request,
}) => {
  for (const path of ["/app/alert?x=1", "/app", "/setup", "/admin"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    const location = new URL(response.headers()["location"], origin);
    expect(location.pathname, path).toBe("/sign-in");
    expect(location.searchParams.has("sesi"), path).toBe(false);
    expect(location.search, path).not.toContain("berakhir");
  }

  const { context, page, errors } = await contextFor(browser, []);
  try {
    await page.goto("/app/alert?x=1");
    await expect(page).toHaveURL(
      `${origin}/sign-in?next=%2Fapp%2Falert%3Fx%3D1`,
    );
    await expect(fields(page).heading).toHaveText("Masuk ke NOC ISP");
    await expect(expiredNotice(page)).toHaveCount(0);
    await expect(signedOutNotice(page)).toHaveCount(0);
    await expect(page.getByText("Sesi Anda berakhir")).toHaveCount(0);
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test.describe("hanya ?sesi=berakhir persis yang menampilkan penegasan sesi berakhir", () => {
  const shown = [
    "/sign-in?sesi=berakhir",
    "/sign-in?sesi=berakhir&next=%2Fapp%2Falert",
    "/sign-in?next=%2Fapp%2Falert&sesi=berakhir",
    "/sign-in?sesi=berakhir&lain=2",
  ];
  const hidden = [
    "/sign-in",
    "/sign-in?sesi",
    "/sign-in?sesi=",
    "/sign-in?sesi=true",
    "/sign-in?sesi=1",
    "/sign-in?sesi=Berakhir",
    "/sign-in?sesi=BERAKHIR",
    "/sign-in?sesi=berakhir%20",
    "/sign-in?sesi=%20berakhir",
    "/sign-in?sesi=berakhirr",
    "/sign-in?Sesi=berakhir",
    "/sign-in?sesi[]=berakhir",
    // Parameter berulang sampai ke halaman sebagai array.
    "/sign-in?sesi=berakhir&sesi=x",
    "/sign-in?sesi=x&sesi=berakhir",
    "/sign-in?sesi=berakhir&sesi=berakhir",
    "/sign-in?next=sesi=berakhir",
    "/sign-in?next=%2Fapp%3Fsesi%3Dberakhir",
    // Halaman daftar tidak pernah menampilkannya.
    "/sign-up?sesi=berakhir",
    "/sign-up",
  ];
  for (const path of shown) {
    test(`tampil: ${path}`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).toContain(expiredText);
      expect(html).not.toContain(signedOutText);
    });
  }
  for (const path of hidden) {
    test(`tidak tampil: ${path}`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(await response.text()).not.toContain(expiredText);
    });
  }

  test("?keluar=1&sesi=berakhir hanya menampilkan 'Anda sudah keluar.', dalam urutan parameter apa pun", async ({
    browser,
    request,
  }) => {
    for (const path of [
      "/sign-in?keluar=1&sesi=berakhir",
      "/sign-in?sesi=berakhir&keluar=1",
      "/sign-in?next=%2Fapp%2Falert&sesi=berakhir&keluar=1",
    ]) {
      const html = await (await request.get(path)).text();
      expect(html, path).toContain(signedOutText);
      expect(html, path).not.toContain(expiredText);
    }
    const { context, page, errors } = await contextFor(browser, []);
    try {
      await page.goto("/sign-in?sesi=berakhir&keluar=1");
      await expect(signedOutNotice(page)).toHaveCount(1);
      await expect(expiredNotice(page)).toHaveCount(0);
      expect(
        await page.getByRole("status").filter({ hasText: /\S/ }).count(),
      ).toBe(1);
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("di browser, halaman daftar dengan ?sesi=berakhir tidak punya penegasan sama sekali", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, []);
    try {
      await page.goto("/sign-up?sesi=berakhir&keluar=1");
      await expect(
        page.getByRole("heading", { name: "Buat akun petugas" }),
      ).toBeVisible();
      await expect(expiredNotice(page)).toHaveCount(0);
      await expect(signedOutNotice(page)).toHaveCount(0);
      await expect(page.getByText("Sesi Anda berakhir")).toHaveCount(0);
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("penegasan di antara paragraf pengantar dan formulir, sudah ada di HTML dari server", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, [], {
      viewport: wide,
    });
    try {
      await page.goto("/sign-in?sesi=berakhir");
      await expect(expiredNotice(page)).toHaveCount(1);
      expect(
        await expiredNotice(page).evaluate((el) => ({
          before: el.previousElementSibling?.textContent,
          after: el.nextElementSibling?.tagName,
        })),
      ).toEqual({
        before: "Gunakan akun petugas untuk membuka dasbor pemantauan.",
        after: "FORM",
      });
      // Tidak mencuri fokus.
      expect(
        await page.evaluate(() => document.activeElement === document.body),
      ).toBe(true);
      expect(unexpected(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test("isi parameter sesi tidak pernah dipantulkan ke halaman", async ({
  browser,
  request,
}) => {
  const token = "PANTUL_c41e9d";
  const attack = "<script>window.__pantul=1</script>";
  for (const value of [
    token,
    attack,
    `"><img src=x onerror="window.__pantul=1">`,
    `berakhir${token}`,
  ]) {
    const path = `/sign-in?sesi=${encodeURIComponent(value)}`;
    const html = await (await request.get(path)).text();
    // Next menyalin alamat ke data internalnya di dalam <script> sebagai JSON
    // dengan "<" ditulis <; itu bukan pemantulan oleh halaman. Yang
    // diperiksa: tanda mentah tidak ada di mana pun, dan di luar blok <script>
    // isi parameter sama sekali tidak ada.
    expect(html, value).not.toContain(attack);
    expect(html, value).not.toContain("<img src=x");
    expect(html, value).not.toContain(expiredText);
    const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
    expect(markup, value).not.toContain(token);
    expect(markup, value).not.toContain("onerror");
    expect(markup, value).not.toContain("__pantul");

    const { context, page, errors } = await contextFor(browser, []);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    try {
      await page.goto(path);
      await expect(fields(page).heading).toHaveText("Masuk ke NOC ISP");
      const rendered = await page.evaluate(() => {
        const copy = document.body.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("script, style").forEach((el) => el.remove());
        return copy.innerHTML;
      });
      expect(rendered, value).not.toContain(token);
      expect(rendered, value).not.toContain("__pantul");
      expect(
        await page.evaluate(
          () => (window as unknown as { __pantul?: number }).__pantul,
        ),
      ).toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }

  // Pada ?sesi=berakhir yang sah pun, isi parameter tidak ada di tampilan.
  const { context, page } = await contextFor(browser, []);
  try {
    await page.goto("/sign-in?sesi=berakhir");
    const rendered = await page.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("script, style").forEach((el) => el.remove());
      return copy.innerHTML;
    });
    expect(rendered).not.toContain("sesi=berakhir");
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// d. Kontras di dua tema
// ---------------------------------------------------------------------------

for (const scheme of ["light", "dark"] as const) {
  const name = scheme === "light" ? "terang" : "gelap";

  test(`kontras ≥ 4,5:1 di tema ${name}: penegasan sesi berakhir, tombol yang menunggu (daftar juga), dan pesan galat`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { context, page } = await contextFor(browser, [], {
      colorScheme: scheme,
      viewport: wide,
    });
    await mockAuth(page, "sign-in", { status: 429, header: "60" });
    await mockAuth(page, "sign-up", { status: 429, header: "60" });
    const f = fields(page);
    const expectTheme = async () => {
      // Tema benar-benar berganti: kelas "dark" di <html> dan latar halaman.
      const html = page.locator("html");
      if (scheme === "dark") await expect(html).toHaveClass(/dark/);
      else await expect(html).not.toHaveClass(/dark/);
      const background = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      const channels = (background.match(/\d+(\.\d+)?/g) ?? [])
        .slice(0, 3)
        .map(Number);
      const lightness = (channels[0] + channels[1] + channels[2]) / 3;
      if (scheme === "light") expect(lightness).toBeGreaterThan(200);
      else expect(lightness).toBeLessThan(60);
    };
    try {
      await page.goto("/sign-in?sesi=berakhir");
      await expect(expiredNotice(page)).toBeVisible();
      await expectTheme();
      await settled(page);
      const notice = await contrastOf(expiredNotice(page));
      // contrastOf memotong teks sampai 40 karakter.
      expect(notice.text).toBe(expiredText.slice(0, 40));
      expect(notice.ratio, `${scheme} penegasan`).toBeGreaterThanOrEqual(4.5);

      // Tombol aktif sebagai pembanding, lalu tombol yang menunggu.
      await page.goto("/sign-in");
      await hydrated(page);
      const styleOf = (el: Element) => {
        const style = getComputedStyle(el);
        return {
          background: style.backgroundColor,
          border: style.borderTopStyle,
          cursor: style.cursor,
        };
      };
      const idle = await f.signIn.evaluate(styleOf);
      await fillSignIn(page);
      await f.signIn.click();
      await expect(f.signIn).toHaveAttribute("aria-disabled", "true");
      await expect(f.error).toHaveText(limitedText);
      await settled(page);
      const waitingStyle = await f.signIn.evaluate(styleOf);
      // Teks terbaca DAN tanda "tidak aktif" tidak hilang: latar berbeda dari
      // tombol aktif, garis putus-putus, kursor terlarang.
      expect(waitingStyle.background).not.toBe(idle.background);
      expect(waitingStyle.border).toBe("dashed");
      expect(waitingStyle.cursor).toBe("not-allowed");
      const waiting = await contrastOf(f.signIn);
      expect(waiting.text).toBe("Masuk");
      expect(waiting.ratio, `${scheme} tombol menunggu`).toBeGreaterThanOrEqual(
        4.5,
      );
      // Hitung mundur di bawah tombol (teks muted di atas latar halaman).
      const row = await contrastOf(countdown(page));
      expect(row.text).toBe(countdownText(60));
      expect(row.ratio, `${scheme} hitung mundur`).toBeGreaterThanOrEqual(4.5);
      const message = await contrastOf(f.error);
      expect(message.text).toContain("Terlalu banyak percobaan");
      expect(message.ratio, `${scheme} pesan galat`).toBeGreaterThanOrEqual(
        4.5,
      );

      // Halaman daftar.
      await page.goto("/sign-up");
      await hydrated(page);
      await fillSignUp(page);
      await f.signUp.click();
      await expect(f.signUp).toHaveAttribute("aria-disabled", "true");
      await settled(page);
      const upWaiting = await contrastOf(f.signUp);
      expect(upWaiting.text).toBe("Buat akun");
      const upRow = await contrastOf(countdown(page));
      expect(upRow.text).toBe(countdownText(60));
      expect(
        upRow.ratio,
        `${scheme} daftar hitung mundur`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(upWaiting.ratio, `${scheme} daftar`).toBeGreaterThanOrEqual(4.5);
    } finally {
      await context.close();
    }
  });
}

test("penegasan dan tombol menunggu tanpa guliran mendatar di 390 dan 1440 px, tanpa galat halaman", async ({
  browser,
}) => {
  for (const viewport of [narrow, wide]) {
    const { context, page, errors } = await contextFor(browser, [], {
      viewport,
    });
    await mockAuth(page, "sign-in", { status: 429, header: "60" });
    const f = fields(page);
    try {
      await page.goto("/sign-in?sesi=berakhir&next=%2Fapp%2Falert");
      await expect(expiredNotice(page)).toBeVisible();
      const noticeBox = (await expiredNotice(page).boundingBox())!;
      expect(noticeBox.x).toBeGreaterThanOrEqual(0);
      expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(viewport.width);
      await hydrated(page);
      await fillSignIn(page);
      await f.signIn.click();
      await expect(countdown(page)).toHaveText(countdownText(60));
      await expect(f.signIn).toHaveText("Masuk");
      const rowBox = (await countdown(page).boundingBox())!;
      expect(rowBox.x).toBeGreaterThanOrEqual(0);
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(viewport.width);
      const metrics = await page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        button: (() => {
          const el = document.querySelector(
            "button[type=submit]",
          ) as HTMLElement;
          return el.scrollWidth - el.clientWidth;
        })(),
      }));
      expect(metrics.overflow, `${viewport.width} px`).toBeLessThanOrEqual(0);
      expect(metrics.button, `${viewport.width} px tombol`).toBeLessThanOrEqual(
        0,
      );
      await page.waitForTimeout(300);
      expect(unexpected(errors), `${viewport.width} px`).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

// ---------------------------------------------------------------------------
// e. Halaman tidak ditemukan
// ---------------------------------------------------------------------------

const forbiddenWords =
  /\b(izin|akses|hak|dilarang|terlarang|forbidden|permission|denied|unauthori[sz]ed|access)/i;

const notFoundHeading = (page: Page) =>
  page.getByRole("heading", { name: "Halaman tidak ditemukan", level: 1 });
const homeLink = (page: Page) =>
  page.getByRole("link", { name: "Kembali ke beranda", exact: true });

// Isi utama halaman tidak ditemukan. Di /admin halaman ini dirender di dalam
// layout admin, yang sudah punya <main> sendiri, jadi yang dipakai <main>
// terdalam (terakhir dalam urutan dokumen).
const mainOf = (page: Page) =>
  page
    .locator("main")
    .filter({ has: notFoundHeading(page) })
    .last();

async function expectNotFoundPage(page: Page, label: string) {
  await expect(notFoundHeading(page), label).toBeVisible();
  await expect(page.getByRole("heading"), label).toHaveCount(1);
  await expect(page.getByText("404", { exact: true }), label).toBeVisible();
  await expect(
    page.getByText("Alamat ini tidak ada. Kembali ke awal untuk melanjutkan."),
    label,
  ).toBeVisible();
  await expect(homeLink(page), label).toHaveCount(1);
  await expect(homeLink(page), label).toHaveAttribute("href", "/");
  // Tidak ada sisa teks Inggris bawaan, dan tidak ada kata izin/akses/hak.
  const text = await mainOf(page).innerText();
  expect(text, label).not.toMatch(forbiddenWords);
  for (const old of ["This page", "isn’t here", "Go home", "Head back"]) {
    expect(text, label).not.toContain(old);
  }
}

test("alamat yang tidak ada (anonim): halaman Indonesia berstatus 404; 'Kembali ke beranda' membawa ke halaman masuk", async ({
  browser,
  request,
}) => {
  for (const path of [
    "/halaman-yang-tidak-ada",
    "/application",
    "/sign-in/tidak-ada",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    const html = await response.text();
    expect(html, path).toContain("Halaman tidak ditemukan");
    expect(html, path).toContain("Kembali ke beranda");
    expect(html, path).not.toContain("isn’t here");
  }

  const { context, page, errors } = await contextFor(browser, []);
  try {
    const response = await page.goto("/halaman-yang-tidak-ada");
    expect(response?.status()).toBe(404);
    await expectNotFoundPage(page, "anonim");
    await homeLink(page).click();
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(fields(page).heading).toHaveText("Masuk ke NOC ISP");
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("alamat yang tidak ada di dalam /app (akun masuk): halaman yang sama; 'Kembali ke beranda' membawa ke dasbor", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { context, page, errors } = await contextFor(browser, accountB.cookies);
  try {
    const response = await page.goto("/app/tidak-ada");
    expect(response?.status()).toBe(404);
    await expectNotFoundPage(page, "akun masuk");
    await homeLink(page).click();
    await expect(page).toHaveURL(`${origin}/app`);
    await expect(
      page.getByRole("heading", { name: "Dashboard NOC" }),
    ).toBeVisible();
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("/admin untuk akun biasa memakai halaman yang sama, tanpa kata izin atau akses", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { context, page, errors } = await contextFor(browser, accountB.cookies);
  try {
    await page.goto("/admin");
    await expectNotFoundPage(page, "/admin akun biasa");
    // Isi halaman /admin untuk akun biasa dan alamat yang tidak ada identik:
    // yang satu tidak membocorkan bahwa rutenya ada.
    const adminText = await mainOf(page).innerText();
    await page.goto("/app/tidak-ada");
    expect(await mainOf(page).innerText()).toBe(adminText);
    const adminHtml = await (await context.request.get("/admin")).text();
    expect(adminHtml).not.toMatch(/Every account/);
    expect(unexpected(errors)).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`halaman tidak ditemukan: kontras ≥ 4,5:1 di tema ${scheme === "light" ? "terang" : "gelap"}, tanpa guliran mendatar di 390 dan 1440 px, dan tanpa galat konsol`, async ({
    browser,
  }) => {
    for (const viewport of [narrow, wide]) {
      const { context, page, errors } = await contextFor(browser, [], {
        colorScheme: scheme,
        viewport,
      });
      const notFound: string[] = [];
      page.on("response", (reply) => {
        if (reply.status() === 404) notFound.push(reply.url());
      });
      try {
        await page.goto("/halaman-yang-tidak-ada");
        await expectNotFoundPage(page, `${scheme} ${viewport.width}`);
        // Satu-satunya 404 adalah dokumennya sendiri (Chrome mencatatnya di
        // konsol); tidak ada aset atau permintaan lain yang hilang.
        expect(notFound, `${scheme} ${viewport.width} px 404`).toEqual([
          `${origin}/halaman-yang-tidak-ada`,
        ]);
        const html = page.locator("html");
        if (scheme === "dark") await expect(html).toHaveClass(/dark/);
        else await expect(html).not.toHaveClass(/dark/);
        for (const [label, target] of [
          ["kicker 404", page.getByText("404", { exact: true })],
          ["judul", notFoundHeading(page)],
          [
            "paragraf",
            page.getByText(
              "Alamat ini tidak ada. Kembali ke awal untuk melanjutkan.",
            ),
          ],
          ["tombol", homeLink(page)],
        ] as const) {
          const { ratio } = await contrastOf(target);
          expect(
            ratio,
            `${scheme} ${viewport.width} px ${label}: ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow, `${scheme} ${viewport.width} px`).toBeLessThanOrEqual(
          0,
        );
        const box = (await homeLink(page).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(unexpected(errors), `${scheme} ${viewport.width} px`).toEqual(
          [],
        );
      } finally {
        await context.close();
      }
    }
  });
}

test("tautan 'Kembali ke beranda' bisa dijangkau dengan papan ketik, fokusnya terlihat, dan Enter menjalankannya", async ({
  browser,
}) => {
  const { context, page } = await contextFor(browser, []);
  try {
    await page.goto("/halaman-yang-tidak-ada");
    await expect(notFoundHeading(page)).toBeVisible();
    // Tab pertama ke tautan lewati-konten, kedua ke tombol (atau sebaliknya);
    // pastikan tombol bisa dicapai dan fokusnya terlihat.
    let reached = false;
    for (let presses = 0; presses < 6 && !reached; presses += 1) {
      await page.keyboard.press("Tab");
      reached = await homeLink(page).evaluate(
        (el) => el === document.activeElement,
      );
    }
    expect(reached).toBe(true);
    await expect
      .poll(() =>
        homeLink(page).evaluate((el) => getComputedStyle(el).boxShadow),
      )
      .toContain("0px 0px 0px 3px");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/sign-in`);
  } finally {
    await context.close();
  }
});
