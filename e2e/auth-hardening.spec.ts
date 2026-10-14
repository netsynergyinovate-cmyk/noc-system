import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { contextFor, type Cookies } from "./billing-ui";

// Login lewat API dan cookie sesi di server sungguhan (build produksi):
//   - 3101: tanpa TRUSTED_PROXIES, dipakai semua spesifikasi lain.
//   - 3103: TRUSTED_PROXIES="10.10.0.0/16, 172.31.0.1,2001:db8:ffff::/48"
//     (playwright.config.ts), untuk penentuan alamat klien di belakang proxy.
// Batas laju Better Auth (3 permintaan per 10 detik per jalur) TIDAK dimatikan.
// Tanpa alamat klien yang bisa dipercaya semua klien berbagi satu keranjang per
// jalur, jadi permintaan yang kena batas menunggu jendelanya lalu mengulang.
// Logika murni (penguraian TRUSTED_PROXIES, rantai X-Forwarded-For, atribut
// cookie di https) ada di e2e/auth-hardening-logic.spec.ts.

const MAIN = "http://localhost:3101";
const PROXIED = "http://localhost:3103";
const PASSWORD = "Hardening-test-password-123!";
const EMAIL_PATTERN = "hardening-%@example.com";
const DAY_MS = 24 * 60 * 60 * 1000;

const starterId = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../starter.config.json", import.meta.url)),
      "utf8",
    ),
  ) as { id: string }
).id;
// Ditulis ulang di sini (bukan diimpor dari config/site.ts).
const SESSION_COOKIE = `ngodingpakeai-${starterId}.session_token`;

test.describe.configure({ timeout: 120_000 });

// ---------------------------------------------------------------------------
// Pembantu
// ---------------------------------------------------------------------------

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 2,
});
const clients: APIRequestContext[] = [];

test.afterAll(async () => {
  await Promise.all(clients.map((client) => client.dispose()));
  await pool.query(`DELETE FROM "user" WHERE email LIKE $1`, [EMAIL_PATTERN]);
  await pool.end();
});

// Satu klien API dengan wadah cookie sendiri. Origin ikut di semua permintaan:
// Better Auth menolak POST tanpa Origin yang cocok.
async function newClient(
  origin: string,
  extraHeaders: Record<string, string> = {},
) {
  const client = await apiRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin, ...extraHeaders },
  });
  clients.push(client);
  return client;
}

interface PostOptions {
  headers?: Record<string, string>;
  // false: jawaban 429 dikembalikan apa adanya (untuk menguji batasnya).
  wait?: boolean;
}

async function post(
  client: APIRequestContext,
  path: string,
  data: unknown,
  options: PostOptions = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await client.post(path, {
      data,
      headers: options.headers,
    });
    if (response.status() !== 429 || options.wait === false || attempt >= 3) {
      return response;
    }
    const seconds = Number(response.headers()["x-retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.2) * 1000);
  }
}

async function register(client: APIRequestContext, options?: PostOptions) {
  const email = `hardening-${randomUUID()}@example.com`;
  const response = await post(
    client,
    "/api/auth/sign-up/email",
    { name: "Uji Pengerasan", email, password: PASSWORD },
    options,
  );
  return { email, password: PASSWORD, response };
}

const signIn = (
  client: APIRequestContext,
  credentials: { email: string; password: string },
  options?: PostOptions,
) => post(client, "/api/auth/sign-in/email", credentials, options);

interface SetCookie {
  name: string;
  value: string;
  attrs: Map<string, string>;
}

// Setiap header Set-Cookie jawaban, terurai.
function setCookies(response: APIResponse): SetCookie[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => {
      const [pair, ...rest] = header.value.split(";").map((p) => p.trim());
      const eq = pair.indexOf("=");
      const attrs = new Map<string, string>();
      for (const part of rest) {
        const at = part.indexOf("=");
        attrs.set(
          (at < 0 ? part : part.slice(0, at)).toLowerCase(),
          at < 0 ? "" : part.slice(at + 1),
        );
      }
      return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
    });
}

// Header jawaban tanpa yang berubah tiap permintaan.
function stableHeaders(response: APIResponse) {
  return response
    .headersArray()
    .filter(
      ({ name }) => !["date", "x-request-id"].includes(name.toLowerCase()),
    )
    .map(({ name, value }) => `${name.toLowerCase()}: ${value}`)
    .sort();
}

async function sessionRows(email: string) {
  const { rows } = await pool.query<{
    token: string;
    expires_at: Date;
    ip_address: string | null;
  }>(
    `SELECT s.token, s.expires_at, s.ip_address
       FROM session s JOIN "user" u ON u.id = s.user_id
      WHERE u.email = $1 ORDER BY s.created_at`,
    [email],
  );
  return rows;
}

// Kunci dan nilai yang tidak boleh muncul di jawaban mana pun: sandi, hash
// sandi, atau kolom bernama password/hash.
async function passwordHash(email: string) {
  const { rows } = await pool.query<{ password: string }>(
    `SELECT a.password FROM account a JOIN "user" u ON u.id = a.user_id
      WHERE u.email = $1 AND a.provider_id = 'credential'`,
    [email],
  );
  expect(rows).toHaveLength(1);
  return rows[0].password;
}

function expectNoSecrets(body: string, plain: string, hash: string) {
  expect(hash.length).toBeGreaterThan(20);
  expect(body).not.toContain(plain);
  expect(body).not.toContain(hash);
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        keys.push(key);
        walk(inner);
      }
    }
  };
  try {
    walk(JSON.parse(body));
  } catch {
    // Bukan JSON: pemeriksaan teks di atas sudah cukup.
  }
  expect(keys.filter((key) => /pass|hash|secret/i.test(key))).toEqual([]);
}

// ---------------------------------------------------------------------------
// API login di server utama (tanpa TRUSTED_PROXIES)
// ---------------------------------------------------------------------------

test.describe("API login", () => {
  test.describe.configure({ mode: "serial" });

  let email: string;
  let hash: string;
  let signUpBody: string;

  test.beforeAll(async () => {
    const account = await register(await newClient(MAIN));
    expect(account.response.status()).toBe(200);
    email = account.email;
    signUpBody = await account.response.text();
    hash = await passwordHash(email);
  });

  test("email tak dikenal dan sandi salah menjawab sama persis", async () => {
    const client = await newClient(MAIN);
    const unknown = `hardening-nobody-${randomUUID()}@example.com`;
    const noSuchUser = await signIn(client, {
      email: unknown,
      password: PASSWORD,
    });
    const wrongPassword = await signIn(client, {
      email,
      password: "Wrong-password-456!",
    });
    expect(noSuchUser.status()).toBe(401);
    expect(wrongPassword.status()).toBe(401);
    const expected = {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    };
    expect(await noSuchUser.json()).toEqual(expected);
    expect(await wrongPassword.json()).toEqual(expected);
    // Teks, status, dan semua header yang stabil identik: tidak ada cara
    // membedakan "tidak ada akun itu" dari "sandi salah".
    expect(await wrongPassword.text()).toBe(await noSuchUser.text());
    expect(wrongPassword.statusText()).toBe(noSuchUser.statusText());
    expect(stableHeaders(wrongPassword)).toEqual(stableHeaders(noSuchUser));
    // Tidak ada cookie yang terbit, dan alamat yang dicoba tidak digaungkan.
    expect(setCookies(noSuchUser)).toEqual([]);
    expect(setCookies(wrongPassword)).toEqual([]);
    expect(await noSuchUser.text()).not.toContain(unknown);
    // Tidak ada sesi baru untuk akun itu.
    expect(await sessionRows(email)).toHaveLength(1);
  });

  test("akun yang diblokir mendapat 403 hanya bila sandinya benar", async () => {
    const client = await newClient(MAIN);
    await pool.query(`UPDATE "user" SET banned = true WHERE email = $1`, [
      email,
    ]);
    try {
      const before = (await sessionRows(email)).length;
      const banned = await signIn(client, { email, password: PASSWORD });
      expect(banned.status()).toBe(403);
      expect(await banned.json()).toMatchObject({ code: "BANNED_USER" });
      expect(setCookies(banned)).toEqual([]);
      expectNoSecrets(await banned.text(), PASSWORD, hash);
      expect(await sessionRows(email)).toHaveLength(before);

      // Sandi salah pada akun yang diblokir tidak membocorkan status blokir:
      // jawabannya sama dengan akun yang tidak ada.
      const wrong = await signIn(client, {
        email,
        password: "Wrong-pass-789!",
      });
      expect(wrong.status()).toBe(401);
      expect(await wrong.json()).toEqual({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      });
      expect(setCookies(wrong)).toEqual([]);
    } finally {
      await pool.query(`UPDATE "user" SET banned = false WHERE email = $1`, [
        email,
      ]);
    }
  });

  // Hasil masuk yang berhasil dipakai tes-tes berikutnya (berurutan).
  let signedIn: {
    client: APIRequestContext;
    response: APIResponse;
    cookies: Cookies;
  };

  test("masuk berhasil: cookie terbit, get-session sah, jawaban tanpa sandi dan hash", async () => {
    const client = await newClient(MAIN);
    const response = await signIn(client, { email, password: PASSWORD });
    expect(response.status()).toBe(200);
    const body = await response.text();
    const json = JSON.parse(body);
    expect(json).toMatchObject({
      redirect: false,
      user: { email, role: "user", banned: false },
    });
    expect(typeof json.token).toBe("string");
    expectNoSecrets(body, PASSWORD, hash);
    expectNoSecrets(signUpBody, PASSWORD, hash);

    // Satu cookie sesi terbit, dan dengan cookie itu get-session sah.
    const issued = setCookies(response).filter(
      (cookie) => cookie.name === SESSION_COOKIE,
    );
    expect(issued).toHaveLength(1);
    expect(issued[0].value.length).toBeGreaterThan(20);
    const current = await client.get("/api/auth/get-session");
    expect(current.status()).toBe(200);
    const session = await current.json();
    expect(session.user.email).toBe(email);
    expect(session.session.userId).toBe(session.user.id);
    expect(new Date(session.session.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expectNoSecrets(JSON.stringify(session), PASSWORD, hash);

    // Daftar sesi pun tidak memuat sandi atau hash.
    const list = await client.get("/api/auth/list-sessions");
    expect(list.status()).toBe(200);
    expectNoSecrets(await list.text(), PASSWORD, hash);

    // API aplikasi menerima cookie itu, dan menolak permintaan tanpa cookie.
    expect((await client.get("/api/notes")).status()).toBe(200);
    const anonymous = await newClient(MAIN);
    expect((await anonymous.get("/api/notes")).status()).toBe(401);
    const none = await anonymous.get("/api/auth/get-session");
    expect(await none.json()).toBeNull();

    signedIn = {
      client,
      response,
      cookies: (await client.storageState()).cookies as Cookies,
    };
  });

  test("cookie sesi: httpOnly, SameSite=Lax, Path=/, tanpa Secure di http, nama berawalan ngodingpakeai-<id>", async ({
    browser,
  }) => {
    const cookies = setCookies(signedIn.response);
    expect(cookies.length).toBeGreaterThan(0);
    // Semua cookie yang diterbitkan masuk berlabel sama kerasnya.
    for (const cookie of cookies) {
      expect(cookie.attrs.has("httponly"), cookie.name).toBe(true);
      expect(cookie.attrs.get("samesite")?.toLowerCase(), cookie.name).toBe(
        "lax",
      );
      expect(cookie.attrs.get("path"), cookie.name).toBe("/");
      expect(cookie.attrs.has("domain"), cookie.name).toBe(false);
    }
    const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE)!;
    expect(session).toBeDefined();
    // Di http: tanpa Secure dan tanpa awalan __Secure-.
    expect(session.attrs.has("secure")).toBe(false);
    expect(cookies.some((cookie) => cookie.name.startsWith("__Secure-"))).toBe(
      false,
    );
    // Berlaku 7 hari.
    expect(session.attrs.get("max-age")).toBe(String(7 * 24 * 60 * 60));

    // Dalam browser: cookie tersimpan dengan atribut yang sama dan tidak
    // terbaca skrip halaman.
    const { context, page } = await contextFor(browser, signedIn.cookies);
    try {
      const stored = (await context.cookies()).find(
        (cookie) => cookie.name === SESSION_COOKIE,
      )!;
      expect(stored).toMatchObject({
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        secure: false,
      });
      await page.goto("/app");
      await expect(page).toHaveURL(/\/app$/);
      expect(await page.evaluate(() => document.cookie)).not.toContain(
        "session_token",
      );
    } finally {
      await context.close();
    }
  });

  test("sesi berlaku 7 hari dan diperpanjang paling sering sekali sehari", async () => {
    const { client } = signedIn;
    const expiresAt = async () => (await sessionRows(email)).at(-1)!.expires_at;
    const rows = await sessionRows(email);
    const row = rows.at(-1)!;
    const remaining = row.expires_at.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(7 * DAY_MS - 120_000);
    expect(remaining).toBeLessThanOrEqual(7 * DAY_MS + 5_000);

    // Sesi berumur 2 jam: belum waktunya diperpanjang.
    await pool.query(
      `UPDATE session SET expires_at = now() + interval '7 days' - interval '2 hours' WHERE token = $1`,
      [row.token],
    );
    const young = await expiresAt();
    expect((await client.get("/api/auth/get-session")).status()).toBe(200);
    expect((await expiresAt()).getTime()).toBe(young.getTime());

    // Sesi berumur 25 jam: diperpanjang kembali ke 7 hari dari sekarang.
    await pool.query(
      `UPDATE session SET expires_at = now() + interval '7 days' - interval '25 hours' WHERE token = $1`,
      [row.token],
    );
    const old = await expiresAt();
    const refreshed = await client.get("/api/auth/get-session");
    expect((await refreshed.json()).user.email).toBe(email);
    const after = (await expiresAt()).getTime();
    expect(after).toBeGreaterThan(old.getTime() + 20 * 60 * 60 * 1000);
    expect(Math.abs(after - (Date.now() + 7 * DAY_MS))).toBeLessThan(120_000);
    // Perpanjangan juga memperbarui cookie.
    const renewed = setCookies(refreshed).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    );
    expect(renewed?.attrs.get("max-age")).toBe(String(7 * 24 * 60 * 60));

    // Sesi yang lewat masa berlaku ditolak server walau cookie masih dibawa.
    await pool.query(
      `UPDATE session SET expires_at = now() - interval '1 minute' WHERE token = $1`,
      [row.token],
    );
    expect(await (await client.get("/api/auth/get-session")).json()).toBeNull();
    expect((await client.get("/api/notes")).status()).toBe(401);
  });

  test("keluar: cookie dihapus, sesi dicabut di server, cookie lama tidak berlaku lagi", async () => {
    // Akun baru lewat pendaftaran (jalur batas laju yang lain dari masuk).
    const fresh = await newClient(MAIN);
    const account = await register(fresh);
    expect(account.response.status()).toBe(200);
    expect(await sessionRows(account.email)).toHaveLength(1);
    const before = (await fresh.storageState()).cookies.find(
      (cookie) => cookie.name === SESSION_COOKIE,
    )!;
    expect(before.httpOnly).toBe(true);
    expect((await fresh.get("/api/notes")).status()).toBe(200);

    const out = await fresh.post("/api/auth/sign-out", { data: {} });
    expect(out.status()).toBe(200);
    expect(await out.json()).toEqual({ success: true });
    const cleared = setCookies(out).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    )!;
    expect(cleared).toBeDefined();
    expect(cleared.value).toBe("");
    expect(cleared.attrs.get("max-age")).toBe("0");
    expect(cleared.attrs.has("httponly")).toBe(true);
    expect(cleared.attrs.get("path")).toBe("/");

    // Wadah cookie klien tidak lagi memuatnya, dan baris sesinya hilang.
    const left = (await fresh.storageState()).cookies.map((c) => c.name);
    expect(left).not.toContain(SESSION_COOKIE);
    expect(await sessionRows(account.email)).toHaveLength(0);
    expect(await (await fresh.get("/api/auth/get-session")).json()).toBeNull();
    expect((await fresh.get("/api/notes")).status()).toBe(401);

    // Memutar ulang cookie lama (yang dicuri, misalnya) tidak menghidupkannya.
    const replay = await newClient(MAIN, {
      Cookie: `${before.name}=${before.value}`,
    });
    expect(await (await replay.get("/api/auth/get-session")).json()).toBeNull();
    expect((await replay.get("/api/notes")).status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Alamat klien dan batas laju
// ---------------------------------------------------------------------------

test.describe("tanpa TRUSTED_PROXIES (server utama)", () => {
  test("header X-Forwarded-For tidak dipakai: alamat yang dicatat di sesi kosong", async () => {
    // Di build produksi Next mengisi X-Forwarded-For dengan alamat soket bila
    // klien tidak mengirimnya, dan membiarkannya bila ada, jadi isinya tidak
    // bisa dibedakan dari kiriman klien. Tanpa daftar proxy tepercaya semuanya
    // diabaikan. Tabel ini dibandingkan utuh supaya, bila pengaturan salah,
    // semua bentuk yang bocor terlihat sekaligus.
    const chains: [string, string | undefined][] = [
      ["tanpa header", undefined],
      ["satu nilai IPv4", "203.0.113.99"],
      ["satu nilai IPv6", "2001:db8::99"],
      ["dua nilai", "203.0.113.98, 198.51.100.1"],
      ["tiga nilai", "9.9.9.9, 203.0.113.97, 198.51.100.2"],
    ];
    const recorded: Record<string, string> = {};
    for (const [label, chain] of chains) {
      const client = await newClient(MAIN);
      const account = await register(client, {
        headers: chain === undefined ? {} : { "X-Forwarded-For": chain },
      });
      expect(account.response.status(), label).toBe(200);
      const rows = await sessionRows(account.email);
      expect(rows, label).toHaveLength(1);
      recorded[label] = rows[0].ip_address ?? "";
    }
    expect(recorded).toEqual(
      Object.fromEntries(chains.map(([label]) => [label, ""])),
    );
  });

  test("memalsukan header tidak membuka keranjang batas laju baru", async () => {
    // Pembanding: dengan bawaan Better Auth tiap nilai X-Forwarded-For baru
    // adalah keranjang baru, jadi enam percobaan ini semuanya lolos ke
    // pemeriksaan sandi (401). Di sini semua berbagi satu keranjang (3 per 10
    // detik), jadi sedikitnya tiga percobaan ditolak 429.
    const client = await newClient(MAIN);
    const shapes: Record<string, string>[] = [
      {},
      { "X-Forwarded-For": "203.0.113.1" },
      { "X-Forwarded-For": "203.0.113.2" },
      { "X-Forwarded-For": "203.0.113.3, 198.51.100.7" },
      { "X-Forwarded-For": "2001:db8::4" },
      { "X-Real-IP": "203.0.113.5", "X-Forwarded-For": "203.0.113.6" },
    ];
    const statuses: number[] = [];
    let limited: APIResponse | undefined;
    for (const headers of shapes) {
      const response = await signIn(
        client,
        {
          email: `hardening-nobody-${randomUUID()}@example.com`,
          password: PASSWORD,
        },
        { headers, wait: false },
      );
      statuses.push(response.status());
      if (response.status() === 429) limited ??= response;
    }
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(
      true,
    );
    expect(
      statuses.filter((status) => status === 429).length,
      `status berurutan: ${statuses.join(" ")}`,
    ).toBeGreaterThan(2);
    expect(await limited!.json()).toEqual({
      message: "Too many requests. Please try again later.",
    });
    const seconds = Number(limited!.headers()["x-retry-after"]);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(10);
    // Jendela dibiarkan habis supaya spesifikasi berikutnya mulai bersih.
    await delay(10_500);
  });
});

test.describe("dengan TRUSTED_PROXIES (server ketiga)", () => {
  // Rantai X-Forwarded-For -> alamat yang tercatat di baris sesi. Hop
  // tepercaya: 10.10.0.0/16, 172.31.0.1, 2001:db8:ffff::/48.
  const SOCKET = "alamat soket";
  const cases: [string, string | undefined, string][] = [
    ["klien lalu proxy", "203.0.113.60, 10.10.7.7", "203.0.113.60"],
    [
      "isi kiri rantai (palsu) diabaikan",
      "9.9.9.9, 203.0.113.61, 10.10.7.7, 172.31.0.1",
      "203.0.113.61",
    ],
    ["satu nilai tidak tepercaya", "203.0.113.62", "203.0.113.62"],
    [
      "IPv6 dikecilkan ke /64",
      "2001:db8:1:2::1, 10.10.7.7",
      "2001:0db8:0001:0002:0000:0000:0000:0000",
    ],
    ["IPv4-mapped", "::ffff:203.0.113.63, 10.10.7.7", "203.0.113.63"],
    [
      "hop tidak tepercaya di kanan menang",
      "10.10.7.7, 198.51.100.4",
      "198.51.100.4",
    ],
    ["hanya hop tepercaya", "10.10.7.7", ""],
    ["rantai berisi sampah", "garbage, 10.10.7.7", ""],
    // Tanpa header dari klien Next mengisinya dengan alamat soket (lihat
    // base-server.js: `x-forwarded-for ??= socket.remoteAddress`), jadi
    // sambungan langsung ke aplikasi dikenali dari alamat sebenarnya.
    ["tanpa header", undefined, SOCKET],
  ];

  test("alamat klien yang tercatat mengikuti rantai dari kanan", async () => {
    const recorded: Record<string, string> = {};
    for (const [label, chain] of cases) {
      const client = await newClient(PROXIED);
      const account = await register(client, {
        headers: chain === undefined ? {} : { "X-Forwarded-For": chain },
      });
      expect(account.response.status(), label).toBe(200);
      const rows = await sessionRows(account.email);
      expect(rows, label).toHaveLength(1);
      recorded[label] = rows[0].ip_address ?? "";
    }
    // Klien tes tersambung lewat loopback: IPv4 atau IPv6 (::1 dikecilkan ke
    // /64 menjadi semua nol), tergantung bagaimana localhost diselesaikan.
    expect(recorded["tanpa header"]).toMatch(
      /^(127\.0\.0\.1|0000:0000:0000:0000:0000:0000:0000:0000)$/,
    );
    recorded["tanpa header"] = SOCKET;
    expect(recorded).toEqual(
      Object.fromEntries(cases.map(([label, , expected]) => [label, expected])),
    );
  });

  test("tiap klien punya keranjang batas laju sendiri dan tidak bisa berpindah dengan header palsu", async () => {
    const client = await newClient(PROXIED);
    const statuses: number[] = [];
    // Klien A mengarang isi kiri rantai di tiap percobaan.
    for (let i = 1; i <= 6; i += 1) {
      const response = await register(client, {
        headers: { "X-Forwarded-For": `9.9.9.${i}, 203.0.113.70, 10.10.7.7` },
        wait: false,
      });
      statuses.push(response.response.status());
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);

    // Klien B (alamat lain) tidak ikut terkena.
    const other = await register(client, {
      headers: { "X-Forwarded-For": "203.0.113.71, 10.10.7.7" },
      wait: false,
    });
    expect(other.response.status()).toBe(200);
    // Klien A, kini tanpa isian palsu, masih di keranjang yang sama.
    const again = await register(client, {
      headers: { "X-Forwarded-For": "203.0.113.70, 172.31.0.1" },
      wait: false,
    });
    expect(again.response.status()).toBe(429);
  });
});
