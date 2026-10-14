import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { getCookies } from "better-auth/cookies";
import {
  createRateLimitKey,
  getIP,
  getIPFromHeader,
} from "@better-auth/core/utils/ip";
import { hasSessionCookie } from "../src/lib/auth-cookie";
import {
  authAdvancedOptions,
  ipAddressOptions,
  parseTrustedProxies,
  SESSION_EXPIRES_IN,
  SESSION_UPDATE_AGE,
  sessionCookieAttributes,
  sessionOptions,
  trustedProxiesField,
} from "../src/lib/auth-security";

// Pengaturan login yang murni data, tanpa server dan tanpa browser: dari mana
// alamat klien untuk batas laju diambil (TRUSTED_PROXIES), masa sesi, dan
// atribut cookie sesi di http dan https. Perilaku di server sungguhan (build
// produksi) diperiksa e2e/auth-hardening.spec.ts.

const source = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    "utf8",
  );

const starterId = (JSON.parse(source("starter.config.json")) as { id: string })
  .id;
// Ditulis ulang di sini (bukan diimpor dari config/site.ts) supaya perubahan
// nama cookie tanpa sengaja ketahuan.
const sessionCookieName = `ngodingpakeai-${starterId}.session_token`;

// ---------------------------------------------------------------------------
// TRUSTED_PROXIES: pembacaan dan validasi
// ---------------------------------------------------------------------------

test.describe("parseTrustedProxies", () => {
  test("kosong atau hanya spasi dan koma berarti tidak ada proxy", () => {
    for (const raw of [undefined, null, "", "   ", ",", " , ,, "]) {
      expect(parseTrustedProxies(raw)).toEqual({ entries: [], invalid: [] });
    }
  });

  test("entri dirapikan: spasi dibuang, entri kosong dan kembar dibuang, urutan tetap", () => {
    expect(
      parseTrustedProxies(" 10.0.0.0/8 , ::1 ,, 2001:db8::/32,10.0.0.0/8 "),
    ).toEqual({
      entries: ["10.0.0.0/8", "::1", "2001:db8::/32"],
      invalid: [],
    });
  });

  test("alamat dan rentang yang sah diterima", () => {
    const valid = [
      "127.0.0.1",
      "10.0.0.0/8",
      "172.31.0.1/32",
      "192.168.1.0/24",
      "0.0.0.0/0",
      "::1",
      "fd00::/8",
      "2001:db8::/32",
      "2001:db8:ffff::/48",
      "2001:DB8::1",
    ];
    for (const entry of valid) {
      expect(parseTrustedProxies(entry), entry).toEqual({
        entries: [entry],
        invalid: [],
      });
    }
  });

  test("entri yang tidak sah dilaporkan apa adanya, tidak dibuang diam-diam", () => {
    const invalid = [
      "10.0.0.0/33",
      "10.0.0.0/",
      "10.0.0.0/-1",
      "10.0.0.0/8/8",
      "10.0.0.0/8x",
      "10.0.0.0/ 8",
      "256.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "0x7f.0.0.1",
      "localhost",
      "proxy.example.com",
      "abc",
      "2001:db8::/129",
      "2001:db8::g",
      "10.0.0.1;10.0.0.2",
      "10.0.0.1 10.0.0.2",
      "*",
    ];
    for (const entry of invalid) {
      expect(parseTrustedProxies(entry), entry).toEqual({
        entries: [entry],
        invalid: [entry],
      });
    }
  });

  test("dalam daftar campuran hanya entri yang salah yang dilaporkan, berurutan", () => {
    expect(
      parseTrustedProxies("10.0.0.0/8, nginx, 127.0.0.1, 10.0.0.0/40, ::1"),
    ).toEqual({
      entries: ["10.0.0.0/8", "nginx", "127.0.0.1", "10.0.0.0/40", "::1"],
      invalid: ["nginx", "10.0.0.0/40"],
    });
  });
});

test.describe("trustedProxiesField (bidang skema env)", () => {
  test("tanpa nilai: daftar kosong", () => {
    const parsed = trustedProxiesField.safeParse(undefined);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([]);
  });

  test("nilai sah menjadi daftar entri yang rapi", () => {
    const parsed = trustedProxiesField.safeParse(" 127.0.0.1 , 10.0.0.0/24 ");
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(["127.0.0.1", "10.0.0.0/24"]);
  });

  test("satu entri tidak sah menggagalkan pembacaan, dengan pesan yang menyebut entrinya", () => {
    for (const raw of ["10.0.0.0/33", "127.0.0.1, nginx", "1.2.3.4, 5.6.7"]) {
      const parsed = trustedProxiesField.safeParse(raw);
      expect(parsed.success, raw).toBe(false);
      const message = parsed.error?.issues.map((i) => i.message).join(" | ");
      expect(message, raw).toContain("TRUSTED_PROXIES");
      const bad = parseTrustedProxies(raw).invalid;
      expect(bad.length).toBeGreaterThan(0);
      for (const entry of bad) expect(message).toContain(JSON.stringify(entry));
    }
  });

  test("env.ts memakai bidang itu, dan auth.ts meneruskan hasilnya serta pengaturan sesi", () => {
    const env = source("src/lib/env.ts");
    expect(env).toMatch(/TRUSTED_PROXIES:\s*trustedProxiesField/);
    expect(env).toMatch(
      /TRUSTED_PROXIES:\s*blankToUndefined\(process\.env\.TRUSTED_PROXIES\)/,
    );
    const auth = source("src/lib/auth.ts");
    expect(auth).toMatch(/session:\s*sessionOptions/);
    expect(auth).toMatch(/authAdvancedOptions\(\{/);
    expect(auth).toMatch(/trustedProxies:\s*env\.TRUSTED_PROXIES/);
    expect(auth).toMatch(/cookiePrefix:\s*authCookiePrefix/);
    expect(source(".env.example")).toMatch(/^TRUSTED_PROXIES=$/m);
  });
});

// ---------------------------------------------------------------------------
// Alamat klien untuk batas laju
// ---------------------------------------------------------------------------

// Di NODE_ENV test dan development Better Auth memakai 127.0.0.1 bila tidak ada
// alamat terpercaya; di produksi hasilnya null (dan kuncinya "no-trusted-ip").
// Tes ini berjalan di proses Playwright, jadi kedua bentuk itu berarti sama:
// tidak ada alamat. Nilai uji di bawah memakai blok dokumentasi (TEST-NET),
// tidak pernah 127.0.0.1.
const noAddress = (value: string | null) =>
  value === null || value === "127.0.0.1";

function resolve(
  headers: Record<string, string>,
  trustedProxies: readonly string[],
) {
  return getIP(new Headers(headers), {
    advanced: authAdvancedOptions({ cookiePrefix: "x", trustedProxies }),
  });
}

// Daftar yang sama dengan TRUSTED_PROXIES server ketiga di playwright.config.ts.
const trusted = ["10.10.0.0/16", "172.31.0.1", "2001:db8:ffff::/48"];

test.describe("alamat klien tanpa TRUSTED_PROXIES", () => {
  test("bawaan Better Auth memercayai satu nilai X-Forwarded-For (pembanding)", () => {
    // Inilah lubangnya: tanpa pengaturan, klien memilih sendiri alamatnya.
    expect(getIP(new Headers({ "x-forwarded-for": "203.0.113.9" }), {})).toBe(
      "203.0.113.9",
    );
    // Rantai "klien, proxy" tanpa daftar tepercaya ditolak bawaannya.
    expect(
      noAddress(
        getIP(
          new Headers({ "x-forwarded-for": "203.0.113.9, 198.51.100.1" }),
          {},
        ),
      ),
    ).toBe(true);
  });

  test("semua header terusan diabaikan: tanpa header, satu nilai, beberapa nilai, header lain", () => {
    const cases: Record<string, string>[] = [
      {},
      { "x-forwarded-for": "203.0.113.9" },
      { "x-forwarded-for": "203.0.113.9, 198.51.100.1" },
      { "x-forwarded-for": "203.0.113.9, 198.51.100.1, 192.0.2.5" },
      { "x-forwarded-for": "2001:db8::1" },
      { "x-forwarded-for": "garbage" },
      { "x-real-ip": "203.0.113.9" },
      { "x-client-ip": "203.0.113.9" },
      { "cf-connecting-ip": "203.0.113.9" },
      { forwarded: "for=203.0.113.9" },
      {
        "x-forwarded-for": "203.0.113.9",
        "x-real-ip": "198.51.100.1",
        "cf-connecting-ip": "192.0.2.5",
      },
    ];
    for (const headers of cases) {
      expect(noAddress(resolve(headers, [])), JSON.stringify(headers)).toBe(
        true,
      );
    }
  });

  test("asumsi tentang Next: X-Forwarded-For diisi dari alamat soket hanya bila klien tidak mengirimnya", () => {
    // Inilah sebabnya header itu tidak bisa dipercaya tanpa daftar proxy:
    // kiriman klien dibiarkan (tidak ditambah alamat soket), jadi nilai asli
    // dan nilai palsu tidak bisa dibedakan di aplikasi. Bila Next mengubah
    // ini (mis. menambahkan alamat soket di kanan rantai), tinjau ulang
    // ipAddressOptions di src/lib/auth-security.ts.
    expect(source("node_modules/next/dist/server/base-server.js")).toMatch(
      /req\.headers\['x-forwarded-for'\]\s*\?\?=[^;]*remoteAddress/,
    );
  });

  test("tanpa proxy tepercaya, header palsu apa pun menghasilkan kunci batas laju yang sama", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const ip = resolve({ "x-forwarded-for": `203.0.113.${i + 1}` }, []);
      keys.add(createRateLimitKey(ip ?? "no-trusted-ip", "/sign-in/email"));
    }
    expect(keys.size).toBe(1);
  });

  test("pengaturannya persis: daftar header kosong, bukan mematikan pelacakan IP", () => {
    // disableIpTracking mematikan batas laju seluruhnya (Better Auth melewati
    // pemeriksaan bila tidak ada alamat DAN pelacakan dimatikan).
    expect(ipAddressOptions([])).toEqual({ ipAddressHeaders: [] });
    const advanced = authAdvancedOptions({
      cookiePrefix: "x",
      trustedProxies: [],
    });
    expect(advanced.ipAddress).toEqual({ ipAddressHeaders: [] });
    expect(JSON.stringify(advanced)).not.toContain("disableIpTracking");
  });
});

test.describe("alamat klien dengan TRUSTED_PROXIES", () => {
  const xff = (value: string) => ({ "x-forwarded-for": value });

  test("rantai dibaca dari kanan; hop tepercaya dilewati; hop pertama yang tidak tepercaya adalah klien", () => {
    const cases: [string, string | null][] = [
      ["203.0.113.9, 10.10.4.4", "203.0.113.9"],
      ["203.0.113.9, 10.10.4.4, 172.31.0.1", "203.0.113.9"],
      ["203.0.113.9, 172.31.0.1, 10.10.4.4", "203.0.113.9"],
      // Isi kiri rantai (dikirim klien) tidak pernah dipakai.
      ["9.9.9.9, 203.0.113.9, 10.10.4.4", "203.0.113.9"],
      ["9.9.9.9, 8.8.8.8, 203.0.113.9, 10.10.4.4, 172.31.0.1", "203.0.113.9"],
      // Hop tidak tepercaya di sebelah kanan menang atas yang di kirinya.
      ["203.0.113.9, 10.10.4.4, 198.51.100.8", "198.51.100.8"],
      // Satu nilai tidak tepercaya dipakai apa adanya (aplikasi harus hanya
      // bisa dijangkau lewat proxy; lihat auth-security.ts).
      ["203.0.113.9", "203.0.113.9"],
      // Spasi dan huruf besar.
      ["  203.0.113.9 ,10.10.4.4 ", "203.0.113.9"],
      // Semuanya tepercaya: tidak ada klien yang bisa diketahui.
      ["10.10.4.4", null],
      ["10.10.4.4, 172.31.0.1", null],
      ["10.10.255.255", null],
      // 10.11.x.x di luar /16 itu.
      ["10.11.0.1, 10.10.4.4", "10.11.0.1"],
      // Sampah di rantai: tidak ada alamat (gagal tertutup).
      ["garbage, 10.10.4.4", null],
      ["203.0.113.9, garbage", null],
      ["203.0.113.9, , 10.10.4.4", "203.0.113.9"],
      ["", null],
      ["   ", null],
    ];
    for (const [header, expected] of cases) {
      const got = resolve(xff(header), trusted);
      if (expected === null) {
        expect(noAddress(got), JSON.stringify(header)).toBe(true);
      } else {
        expect(got, JSON.stringify(header)).toBe(expected);
      }
    }
  });

  test("IPv6: dikecilkan ke subnet /64, bentuk IPv4-mapped menjadi IPv4", () => {
    expect(resolve(xff("2001:db8:1:2::1, 10.10.4.4"), trusted)).toBe(
      "2001:0db8:0001:0002:0000:0000:0000:0000",
    );
    // Dua alamat di /64 yang sama berbagi satu kunci.
    expect(resolve(xff("2001:db8:1:2:aaaa::7, 10.10.4.4"), trusted)).toBe(
      resolve(xff("2001:db8:1:2:bbbb::9, 10.10.4.4"), trusted),
    );
    expect(resolve(xff("::ffff:203.0.113.9, 10.10.4.4"), trusted)).toBe(
      "203.0.113.9",
    );
    // Proxy tepercaya yang ditulis sebagai IPv4-mapped tetap dikenali.
    expect(resolve(xff("203.0.113.9, ::ffff:10.10.4.4"), trusted)).toBe(
      "203.0.113.9",
    );
    // Rentang IPv6 tepercaya.
    expect(noAddress(resolve(xff("2001:db8:ffff:1::5"), trusted))).toBe(true);
    expect(resolve(xff("2001:db8:fffe::5"), trusted)).toBe(
      "2001:0db8:fffe:0000:0000:0000:0000:0000",
    );
  });

  test("di luar Next: tanpa X-Forwarded-For tidak ada alamat, dan header lain tidak dibaca", () => {
    expect(noAddress(resolve({}, trusted))).toBe(true);
    expect(noAddress(resolve({ "x-real-ip": "203.0.113.9" }, trusted))).toBe(
      true,
    );
    expect(
      noAddress(resolve({ "cf-connecting-ip": "203.0.113.9" }, trusted)),
    ).toBe(true);
  });

  test("klien tidak bisa berpindah keranjang dengan mengarang isi kiri rantai", () => {
    // Pembangkit acak berbenih: hasil sama di setiap jalan.
    let state = 20240607;
    const next = (max: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % max;
    };
    const fake = () =>
      `${1 + next(223)}.${next(256)}.${next(256)}.${1 + next(254)}`;
    const keys = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const hops = Array.from({ length: next(5) }, fake);
      // Rantai nyata: klien sebenarnya, lalu proxy tepercaya yang menambahkan.
      const chain = [...hops, "203.0.113.50", "10.10.7.7"].join(", ");
      const ip = resolve(xff(chain), trusted);
      keys.add(createRateLimitKey(ip ?? "no-trusted-ip", "/sign-in/email"));
    }
    expect([...keys]).toEqual(["203.0.113.50|/sign-in/email"]);
  });

  test("klien berbeda mendapat kunci berbeda", () => {
    const a = resolve(xff("203.0.113.50, 10.10.7.7"), trusted);
    const b = resolve(xff("203.0.113.51, 10.10.7.7"), trusted);
    expect(a).not.toBe(b);
  });

  test("getIPFromHeader (tanpa cadangan localhost) sepakat dengan getIP untuk rantai tepercaya", () => {
    // getIP menambah cadangan 127.0.0.1 di test/development; getIPFromHeader
    // tidak, sehingga "tidak ada alamat" terlihat sebagai null murni.
    const options = { trustedProxies: trusted };
    expect(getIPFromHeader("10.10.4.4", options)).toBeNull();
    expect(getIPFromHeader("garbage, 10.10.4.4", options)).toBeNull();
    expect(getIPFromHeader("203.0.113.9, 10.10.4.4", options)).toBe(
      "203.0.113.9",
    );
    expect(getIPFromHeader("203.0.113.9, 198.51.100.1")).toBeNull();
    expect(getIPFromHeader("203.0.113.9")).toBe("203.0.113.9");
  });

  test("pengaturannya memakai daftar yang diberikan dan header bawaan", () => {
    const options = ipAddressOptions(trusted);
    expect(options).toEqual({ trustedProxies: trusted });
    // Daftar disalin, bukan dipinjam.
    expect(options.trustedProxies).not.toBe(trusted);
    expect(JSON.stringify(options)).not.toContain("disableIpTracking");
    expect(options).not.toHaveProperty("ipAddressHeaders");
  });
});

// ---------------------------------------------------------------------------
// Masa sesi
// ---------------------------------------------------------------------------

test.describe("masa sesi", () => {
  test("7 hari, diperpanjang paling sering sekali sehari, tanpa cache sesi di cookie", () => {
    expect(SESSION_EXPIRES_IN).toBe(7 * 24 * 60 * 60);
    expect(SESSION_UPDATE_AGE).toBe(24 * 60 * 60);
    expect(sessionOptions).toEqual({ expiresIn: 604800, updateAge: 86400 });
    expect(sessionOptions).not.toHaveProperty("cookieCache");
  });
});

// ---------------------------------------------------------------------------
// Cookie sesi di http dan https
// ---------------------------------------------------------------------------

function cookiesFor(baseURL: string) {
  return getCookies({
    baseURL,
    secret: "x".repeat(32),
    advanced: authAdvancedOptions({
      cookiePrefix: `ngodingpakeai-${starterId}`,
      trustedProxies: [],
    }),
    session: sessionOptions,
  }).sessionToken;
}

test.describe("cookie sesi", () => {
  test("atribut yang ditulis terang-terangan", () => {
    expect(sessionCookieAttributes).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(
      authAdvancedOptions({ cookiePrefix: "p", trustedProxies: [] }),
    ).toMatchObject({
      cookiePrefix: "p",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    });
    // `secure` diturunkan Better Auth dari BETTER_AUTH_URL, tidak dipaksa di sini.
    const advanced = authAdvancedOptions({
      cookiePrefix: "p",
      trustedProxies: [],
    });
    expect(advanced).not.toHaveProperty("useSecureCookies");
    expect(advanced.defaultCookieAttributes).not.toHaveProperty("secure");
    expect(advanced.defaultCookieAttributes).not.toHaveProperty("domain");
    expect(advanced).not.toHaveProperty("crossSubDomainCookies");
  });

  for (const baseURL of [
    "http://localhost:3000",
    "http://localhost:3101",
    "http://noc.example.com",
    "http://192.0.2.10:8080",
  ]) {
    test(`di http (${baseURL}): httpOnly, SameSite=Lax, Path=/, tanpa Secure, tanpa awalan __Secure-`, () => {
      const cookie = cookiesFor(baseURL);
      expect(cookie.name).toBe(sessionCookieName);
      expect(cookie.attributes).toEqual({
        secure: false,
        sameSite: "lax",
        path: "/",
        httpOnly: true,
        maxAge: SESSION_EXPIRES_IN,
      });
    });
  }

  for (const baseURL of [
    "https://noc.example.com",
    "https://noc.example.com:8443",
    "https://192.0.2.10",
  ]) {
    test(`di https (${baseURL}): Secure dan awalan __Secure-, atribut lain tetap`, () => {
      const cookie = cookiesFor(baseURL);
      expect(cookie.name).toBe(`__Secure-${sessionCookieName}`);
      expect(cookie.attributes).toEqual({
        secure: true,
        sameSite: "lax",
        path: "/",
        httpOnly: true,
        maxAge: SESSION_EXPIRES_IN,
      });
    });
  }

  test("tidak ada atribut Domain: cookie hanya untuk host yang menerbitkannya", () => {
    for (const baseURL of [
      "http://localhost:3000",
      "https://noc.example.com",
    ]) {
      expect(cookiesFor(baseURL).attributes).not.toHaveProperty("domain");
    }
  });

  test("gerbang proxy mengenali cookie sesi di kedua bentuk, dan hanya yang bernama itu", () => {
    const prefix = `ngodingpakeai-${starterId}`;
    const has = (cookie: string) =>
      hasSessionCookie(new Headers({ cookie }), prefix);
    expect(has(`${sessionCookieName}=abc`)).toBe(true);
    expect(has(`__Secure-${sessionCookieName}=abc`)).toBe(true);
    expect(has(`a=1; ${sessionCookieName}=abc; b=2`)).toBe(true);
    // Cookie lain tidak dianggap sesi.
    expect(has(`ngodingpakeai-${starterId}.session_data=abc`)).toBe(false);
    expect(has(`ngodingpakeai-lain.session_token=abc`)).toBe(false);
    expect(has(`session_token=abc`)).toBe(false);
    expect(has(`better-auth.session_token=abc`)).toBe(false);
    expect(has("")).toBe(false);
  });
});
