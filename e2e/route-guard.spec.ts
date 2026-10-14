import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server.js";
import { hasSessionCookie } from "../src/lib/auth-cookie";
import {
  DEFAULT_DESTINATION,
  NEXT_PATH_HEADER,
  PROTECTED_PREFIXES,
  forwardedHeaders,
  guardDecision,
  isProtectedPath,
  safeNextPath,
  signInUrl,
  signUpUrl,
} from "../src/lib/route-guard";

// Gerbang jalur terlindungi, tanpa browser: tujuan setelah masuk (?next=) harus
// selalu jalur satu-origin di dalam /app, /setup, atau /admin (tidak boleh
// menjadi open redirect), alamat masuk/daftar membawanya pulang pergi tanpa
// berubah, keputusan proxy hanya satu (tanpa cookie ke /sign-in), dan matcher
// proxy sepakat dengan daftar awalan.

// Judul tes: karakter di luar ASCII tercetak ditulis sebagai kode \uXXXX.
const show = (value: string) =>
  JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

test.describe("safeNextPath: nilai keluaran persis", () => {
  // [masukan, keluaran]. Keluaran sudah ternormalkan: dot-segment selesai,
  // karakter di-escape, hash dibuang, query dipertahankan.
  const accepted: [string, string][] = [
    ["/app", "/app"],
    ["/app/", "/app/"],
    ["/app/alert", "/app/alert"],
    ["/app?focus=abc-123", "/app?focus=abc-123"],
    ["/app/pelanggan?q=a%20b&x=1", "/app/pelanggan?q=a%20b&x=1"],
    ["/setup", "/setup"],
    ["/admin", "/admin"],
    ["/admin/notes", "/admin/notes"],
    ["/app/router/new", "/app/router/new"],
    // Dinormalkan.
    ["/app/alert#bagian", "/app/alert"],
    ["/app?focus=abc#bagian", "/app?focus=abc"],
    ["/app/./alert", "/app/alert"],
    ["/app/router/../alert", "/app/alert"],
    ["/app/%2e%2e/app/alert", "/app/alert"],
    ["/app/%2E/alert", "/app/alert"],
    // URL tidak bisa naik di atas akar, jadi ini tetap di dalam /app.
    ["/app/%2e%2e/%2e%2e/app", "/app"],
    ["/app?q=é", "/app?q=%C3%A9"],
    ['/app?q="x"', "/app?q=%22x%22"],
    ["/app?", "/app"],
    // Escape yang sah dipertahankan apa adanya.
    ["/app?q=%26%3D%25", "/app?q=%26%3D%25"],
    ["/app/a%2Fb", "/app/a%2Fb"],
  ];
  for (const [input, output] of accepted) {
    test(`${show(input)} -> ${show(output)}`, () => {
      expect(safeNextPath(input)).toBe(output);
    });
  }

  const rejected: [string, string][] = [
    // Pindah host atau skema.
    ["//evil.com", "dua garis miring"],
    ["//evil.com/app", "dua garis miring"],
    ["/\\evil.com", "garis miring + backslash"],
    ["/\\/evil.com", "garis miring + backslash"],
    ["\\\\evil.com", "backslash"],
    ["https://evil.com/app", "skema"],
    ["http://localhost:3101/app", "alamat mutlak"],
    ["javascript:alert(1)", "javascript:"],
    ["data:text/html,x", "data:"],
    ["app", "tanpa garis miring awal"],
    ["", "kosong"],
    ["/", "akar bukan jalur terlindungi"],
    // Jalur yang bukan di dalam awalan terlindungi setelah diselesaikan.
    ["/app/../sign-in", "keluar dari /app"],
    ["/app/%2e%2e/%2e%2e/etc", "keluar dari /app"],
    ["/app/..//evil.com", "menjadi //evil.com"],
    ["/app/%2e%2e//evil.com", "menjadi //evil.com"],
    ["/app@evil.com", "bukan /app/..."],
    ["/app:80", "bukan /app/..."],
    ["/app%2Fx", "slash ter-escape bukan pemisah"],
    ["/application", "awalan teks, bukan jalur"],
    ["/apps", "awalan teks, bukan jalur"],
    ["/administrator", "awalan teks, bukan jalur"],
    ["/setupx", "awalan teks, bukan jalur"],
    ["/APP", "huruf besar bukan /app"],
    ["/api/notes", "API bukan halaman"],
    ["/api/auth/get-session", "API bukan halaman"],
    ["/sign-in", "putaran masuk"],
    ["/sign-in?next=/app", "putaran masuk"],
    ["/sign-up?next=/app", "putaran daftar"],
    ["/_next/static/x.js", "aset"],
    // Karakter berbahaya.
    ["/app%0d%0aSet-Cookie:x", "bukan /app/..."],
    ["/app\\evil", "backslash"],
    ["/app/a\\b", "backslash"],
    ["/app\u0000", "NUL"],
    ["/app/a\u0000b", "NUL"],
    ["/app\r\nSet-Cookie: x", "CRLF"],
    ["/app\n", "baris baru"],
    ["/app\t", "tab"],
    ["/app/a\tb", "tab di tengah"],
    ["/app/a b", "spasi di tengah"],
    ["/app ", "spasi di akhir"],
    [" /app", "spasi di awal"],
    ["\t/app", "tab di awal"],
    ["/ app", "spasi setelah garis miring"],
    ["/app\u007f", "DEL"],
    ["/app/a\u0085b", "kendali C1"],
    ["/app/a b", "spasi Unicode"],
    ["/app/a b", "pemisah baris Unicode"],
    ["/app　", "spasi lebar"],
  ];
  for (const [input, why] of rejected) {
    test(`ditolak: ${show(input)} (${why})`, () => {
      expect(safeNextPath(input)).toBeNull();
    });
  }

  test("bukan teks ditolak", () => {
    for (const value of [
      undefined,
      null,
      ["/app/alert"],
      ["/app/alert", "/admin"],
      [],
      { toString: () => "/app" },
      { next: "/app" },
      42,
      0,
      true,
      false,
      Symbol("x"),
      () => "/app",
      new String("/app"),
    ]) {
      expect(safeNextPath(value), String(typeof value)).toBeNull();
    }
  });

  test("panjang: 2048 karakter masih sah, 2049 tidak; yang membengkak oleh escape ditolak", () => {
    const fits = `/app/${"a".repeat(2043)}`;
    expect(fits).toHaveLength(2048);
    expect(safeNextPath(fits)).toBe(fits);
    expect(safeNextPath(`${fits}a`)).toBeNull();
    // 1007 karakter mentah, tetapi tiap "é" menjadi "%C3%A9" (6 karakter): hasil
    // normalnya melewati batas, dan hasil itu tidak boleh keluar karena
    // memanggil ulang pada hasilnya akan menolaknya.
    expect(safeNextPath(`/app?q=${"é".repeat(1000)}`)).toBeNull();
    expect(safeNextPath(`/app?q=${"é".repeat(300)}`)).toBe(
      `/app?q=${"%C3%A9".repeat(300)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Uji acak berbenih
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tokens = [
  "/",
  "/",
  "//",
  "\\",
  ".",
  "..",
  "/..",
  "/./",
  "%2e",
  "%2E%2e",
  "%2f",
  "%5c",
  "%0d%0a",
  "%00",
  "%",
  "%zz",
  "@",
  ":",
  "?",
  "?",
  "#",
  "&",
  "=",
  "a",
  "b",
  "app",
  "setup",
  "admin",
  "application",
  "sign-in",
  "evil.com",
  "http:",
  "https://",
  "javascript:",
  " ",
  "\t",
  "\n",
  "\r",
  "\u0000",
  "\u007f",
  "\u0085",
  " ",
  " ",
  "é",
  "日本",
  "‮",
  "\ud800",
  "x".repeat(300),
];
const prefixes = [
  "/app",
  "/setup",
  "/admin",
  "/app/",
  "/app?",
  "",
  // Pindah host tetapi berakhir di jalur terlindungi: harus tetap ditolak.
  "//evil.com/app",
  "//h/setup",
  "/\\evil.com/admin",
];

function randomInput(random: () => number) {
  const count = 1 + Math.floor(random() * 12);
  let value = prefixes[Math.floor(random() * prefixes.length)];
  for (let i = 0; i < count; i += 1) {
    value += tokens[Math.floor(random() * tokens.length)];
  }
  return value;
}

// Penolakan yang pasti, ditulis terpisah dari fungsinya: tanpa garis miring
// awal, awalan "//", backslash, atau karakter kendali.
function mustReject(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

test("acak: hasil non-null selalu satu-origin, di dalam awalan terlindungi, bersih, dan idempoten", () => {
  const random = mulberry32(20260509);
  const total = 30_000;
  let accepted = 0;
  // Pelanggaran dikumpulkan (bukan expect di tiap putaran, yang lambat) lalu
  // dibandingkan dengan daftar kosong di akhir.
  const violations: string[] = [];
  for (let n = 0; n < total; n += 1) {
    const input = randomInput(random);
    const result = safeNextPath(input);
    if (mustReject(input)) {
      if (result !== null) {
        violations.push(`harus ditolak: ${show(input)} -> ${show(result)}`);
      }
      continue;
    }
    if (result === null) continue;
    accepted += 1;
    const label = `${show(input)} -> ${show(result)}`;
    const problems: string[] = [];
    if (new URL(result, "http://x.invalid").origin !== "http://x.invalid") {
      problems.push("pindah origin");
    }
    if (!/^\/(?:app|setup|admin)(?:[/?]|$)/.test(result)) {
      problems.push("bukan awalan terlindungi");
    }
    if (result.startsWith("//")) problems.push("diawali //");
    if (result.length > 2048) problems.push("terlalu panjang");
    for (let i = 0; i < result.length; i += 1) {
      const code = result.charCodeAt(i);
      if (code <= 0x20 || code === 0x7f || code === 0x5c) {
        problems.push("karakter terlarang");
        break;
      }
    }
    if (safeNextPath(result) !== result) problems.push("tidak idempoten");
    if (problems.length) violations.push(`${label}: ${problems.join(", ")}`);
  }
  expect(violations.slice(0, 10)).toEqual([]);
  // Supaya ujinya tidak kosong: sebagian masukan memang sah.
  expect(accepted).toBeGreaterThan(1500);
});

// ---------------------------------------------------------------------------
// signInUrl / signUpUrl
// ---------------------------------------------------------------------------

function nextOf(url: string) {
  const parsed = new URL(url, "http://x.invalid");
  expect(parsed.origin).toBe("http://x.invalid");
  return {
    path: parsed.pathname,
    keys: [...parsed.searchParams.keys()],
    parsed,
  };
}

test.describe("signInUrl dan signUpUrl", () => {
  const builders = [
    ["signInUrl", signInUrl, "/sign-in"],
    ["signUpUrl", signUpUrl, "/sign-up"],
  ] as const;

  for (const [name, build, base] of builders) {
    test(`${name}: tanpa tujuan, tujuan bawaan, atau tujuan tidak sah tetap bersih`, () => {
      expect(build(null)).toBe(base);
      expect(build("/app")).toBe(base);
      for (const bad of [
        "//evil.example",
        "https://evil.example",
        "/\\evil.example",
        "/api/notes",
        "/sign-in",
        "/sign-up",
        "/application",
        "",
        "/app/../x",
        "x".repeat(3000),
      ]) {
        expect(build(bad), bad.slice(0, 40)).toBe(base);
      }
    });

    test(`${name}: tujuan lain dikodekan persis`, () => {
      expect(build("/app/alert")).toBe(`${base}?next=%2Fapp%2Falert`);
      expect(build("/app?focus=abc")).toBe(`${base}?next=%2Fapp%3Ffocus%3Dabc`);
      expect(build("/setup")).toBe(`${base}?next=%2Fsetup`);
      expect(build("/admin")).toBe(`${base}?next=%2Fadmin`);
      expect(build("/app/alert?x=1&y=a%20b")).toBe(
        `${base}?next=%2Fapp%2Falert%3Fx%3D1%26y%3Da%2520b`,
      );
      // Dibersihkan dulu: dot-segment dan hash tidak ikut.
      expect(build("/app/router/../alert#x")).toBe(
        `${base}?next=%2Fapp%2Falert`,
      );
    });

    test(`${name}: bisa dibaca balik oleh safeNextPath sebagai nilai semula`, () => {
      const queries = [
        "/app/alert?x=1&y=a%20b",
        "/app?q=%26%3D%25",
        "/app?q=a+b&r=c%2Bd",
        "/app?q=é&r=日本",
        "/app?focus=abc-123",
        "/app/pelanggan?q=%E2%9C%93#bagian",
        "/app?a=b&a=c&=&&",
        "/app?next=/app/alert&next=/admin",
        "/app?u=https://evil.example/%2F%2F",
        "/setup?x=%3Cscript%3E",
        "/admin/notes?id=1",
      ];
      for (const raw of queries) {
        const normal = safeNextPath(raw);
        expect(normal, raw).not.toBeNull();
        const url = build(normal);
        const { path, keys, parsed } = nextOf(url);
        expect(path, raw).toBe(base);
        expect(keys, raw).toEqual(normal === "/app" ? [] : ["next"]);
        const back = safeNextPath(parsed.searchParams.get("next"));
        expect(back, raw).toBe(normal === "/app" ? null : normal);
      }
    });
  }

  test("acak: pulang pergi untuk 2000 tujuan sah", () => {
    const random = mulberry32(7);
    let checked = 0;
    const violations: string[] = [];
    for (let n = 0; n < 80_000 && checked < 2000; n += 1) {
      const normal = safeNextPath(randomInput(random));
      if (normal === null || normal === "/app") continue;
      checked += 1;
      for (const build of [signInUrl, signUpUrl]) {
        const parsed: URL = new URL(build(normal), "http://x.invalid");
        const keys = [...parsed.searchParams.keys()];
        if (keys.length !== 1 || keys[0] !== "next") {
          violations.push(`${show(normal)}: parameter ${keys.join(",")}`);
        } else if (parsed.searchParams.get("next") !== normal) {
          violations.push(`${show(normal)}: nilai berubah`);
        }
      }
    }
    expect(violations.slice(0, 10)).toEqual([]);
    expect(checked).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// guardDecision
// ---------------------------------------------------------------------------

test.describe("guardDecision", () => {
  const protectedPaths = [
    "/app",
    "/app/alert",
    "/app/anomali",
    "/app/router/new",
    "/app/xyz-tidak-ada",
    "/setup",
    "/setup/x",
    "/admin",
    "/admin/notes",
  ];
  const searches = ["", "?focus=abc", "?x=1&y=a%20b"];

  test("jalur terlindungi tanpa cookie dialihkan ke /sign-in dengan tujuan yang benar", () => {
    for (const pathname of protectedPaths) {
      for (const search of searches) {
        const expected =
          pathname + search === "/app"
            ? "/sign-in"
            : `/sign-in?next=${encodeURIComponent(pathname + search)}`;
        expect(
          guardDecision({ pathname, search, hasSessionCookie: false }),
          pathname + search,
        ).toEqual({ redirectTo: expected });
      }
    }
  });

  test("setiap awalan terlindungi tercakup beserta turunannya", () => {
    for (const prefix of PROTECTED_PREFIXES) {
      for (const pathname of [prefix, `${prefix}/`, `${prefix}/a/b`]) {
        expect(isProtectedPath(pathname), pathname).toBe(true);
        expect(
          guardDecision({ pathname, search: "", hasSessionCookie: false }),
          pathname,
        ).not.toBeNull();
      }
      for (const pathname of [`${prefix}x`, `${prefix}-lain`, `${prefix}.js`]) {
        expect(isProtectedPath(pathname), pathname).toBe(false);
      }
    }
  });

  test("dengan cookie sesi (sah atau basi) tidak pernah dialihkan", () => {
    for (const pathname of protectedPaths) {
      for (const search of searches) {
        expect(
          guardDecision({ pathname, search, hasSessionCookie: true }),
          pathname + search,
        ).toBeNull();
      }
    }
  });

  test("jalur lain lolos, dengan atau tanpa cookie (termasuk /sign-in: tidak ada pengalihan ke dasbor)", () => {
    for (const pathname of [
      "/",
      "/sign-in",
      "/sign-up",
      "/api/x",
      "/api/notes",
      "/api/auth/get-session",
      "/application",
      "/apps",
      "/administrator",
      "/setupx",
      "/_next/x",
      "/icon.svg",
    ]) {
      for (const hasSessionCookie of [false, true]) {
        expect(
          guardDecision({ pathname, search: "?next=/app", hasSessionCookie }),
          `${pathname} ${hasSessionCookie}`,
        ).toBeNull();
      }
    }
  });

  test("tujuan terlalu panjang tidak ikut, tetapi pengalihan tetap ada", () => {
    expect(
      guardDecision({
        pathname: "/app/alert",
        search: `?q=${"a".repeat(3000)}`,
        hasSessionCookie: false,
      }),
    ).toEqual({ redirectTo: "/sign-in" });
  });
});

// ---------------------------------------------------------------------------
// Matcher proxy
// ---------------------------------------------------------------------------

// Matcher dibaca dari teks src/proxy.ts: berkas itu mengimpor next/server, yang
// tidak bisa dimuat langsung oleh pemuat ESM Node di sini, dan matcher memang
// harus literal statis (yang dibaca Next saat build adalah teks itu juga).
const proxySource = readFileSync(
  fileURLToPath(new URL("../src/proxy.ts", import.meta.url)),
  "utf8",
);
function readMatcher(): string[] {
  const found = /matcher:\s*(\[[^\]]*\])/.exec(proxySource);
  expect(
    found,
    "src/proxy.ts harus punya matcher: [...] literal",
  ).not.toBeNull();
  return JSON.parse(found![1].replace(/,\s*\]$/, "]"));
}

test.describe("matcher proxy", () => {
  test("matcher literal sama dengan daftar awalan terlindungi", () => {
    expect(readMatcher()).toEqual(
      PROTECTED_PREFIXES.map((prefix) => `${prefix}/:path*`),
    );
  });

  test("Next sendiri menjalankan proxy tepat pada jalur yang dianggap terlindungi", () => {
    const config = { matcher: readMatcher() };
    const paths = [
      "/app",
      "/app/",
      "/app/alert",
      "/app/alert?focus=abc",
      "/app/router/new",
      "/app/xyz-tidak-ada",
      "/setup",
      "/setup/x",
      "/admin",
      "/admin/notes",
      "/",
      "/sign-in",
      "/sign-up",
      "/api/notes",
      "/api/auth/get-session",
      "/application",
      "/apps",
      "/administrator",
      "/setupx",
      "/_next/static/chunks/x.js",
      "/icon.svg",
    ];
    for (const path of paths) {
      expect(unstable_doesMiddlewareMatch({ config, url: path }), path).toBe(
        isProtectedPath(path.split("?")[0]),
      );
    }
  });

  test("proxy.ts memakai guardDecision, forwardedHeaders, dan hasSessionCookie, tanpa database", () => {
    expect(proxySource).toContain("guardDecision(");
    expect(proxySource).toContain("forwardedHeaders(");
    expect(proxySource).toContain("hasSessionCookie(");
    expect(proxySource).not.toMatch(/auth\.api|@\/db|\.\/db|drizzle/);
  });
});

// ---------------------------------------------------------------------------
// Header yang diteruskan dan cookie sesi
// ---------------------------------------------------------------------------

test.describe("forwardedHeaders", () => {
  test("mengisi x-noc-path dengan jalur+query yang diminta dan menyimpan header lain", () => {
    const original = new Headers({ cookie: "a=1", "x-lain": "ya" });
    const headers = forwardedHeaders(original, "/app/alert", "?x=1&y=a%20b");
    expect(headers.get(NEXT_PATH_HEADER)).toBe("/app/alert?x=1&y=a%20b");
    expect(headers.get("cookie")).toBe("a=1");
    expect(headers.get("x-lain")).toBe("ya");
    // Salinan: aslinya tidak berubah.
    expect(original.has(NEXT_PATH_HEADER)).toBe(false);
  });

  test("nilai kiriman klien DITIMPA, bukan ditambahkan (huruf besar-kecil apa pun)", () => {
    for (const name of [NEXT_PATH_HEADER, "X-Noc-Path", "X-NOC-PATH"]) {
      for (const forged of [
        "//evil.example",
        "/app/lain",
        "https://x.example",
        "",
      ]) {
        const headers = forwardedHeaders(
          new Headers({ [name]: forged }),
          "/app/alert",
          "",
        );
        // Satu nilai persis; nilai tambahan akan tampil "forged, /app/alert".
        expect(headers.get(NEXT_PATH_HEADER), `${name}=${forged}`).toBe(
          "/app/alert",
        );
      }
    }
  });

  test("jalur yang tidak layak dibawa membuang header kiriman klien", () => {
    const headers = forwardedHeaders(
      new Headers({ [NEXT_PATH_HEADER]: "//evil.example" }),
      "/app/alert",
      `?q=${"a".repeat(3000)}`,
    );
    expect(headers.has(NEXT_PATH_HEADER)).toBe(false);
  });

  test("acak: yang diteruskan selalu sudah lolos safeNextPath", () => {
    const random = mulberry32(99);
    let forwarded = 0;
    for (let n = 0; n < 5000; n += 1) {
      const pathname = `/${["app", "setup", "admin", "x"][Math.floor(random() * 4)]}${
        random() < 0.5 ? "/" + tokens[Math.floor(random() * tokens.length)] : ""
      }`;
      const search =
        random() < 0.5 ? "" : `?${randomInput(random).slice(0, 40)}`;
      let value: string | null;
      try {
        value = forwardedHeaders(new Headers(), pathname, search).get(
          NEXT_PATH_HEADER,
        );
      } catch {
        // Nilai header yang tidak sah ditolak Headers sendiri; Next tidak
        // pernah memberi proxy alamat seperti itu.
        continue;
      }
      if (value === null) continue;
      forwarded += 1;
      expect(safeNextPath(value), pathname + search).toBe(value);
    }
    expect(forwarded).toBeGreaterThan(500);
  });
});

test.describe("hasSessionCookie", () => {
  const prefix = "ngodingpakeai-contoh";
  const withCookie = (cookie: string) => new Headers(cookie ? { cookie } : {});

  test("mengenali cookie sesi dengan awalan aplikasi (juga bentuk __Secure-), apa pun nilainya", () => {
    for (const cookie of [
      `${prefix}.session_token=nilai-apa-saja`,
      `__Secure-${prefix}.session_token=nilai-apa-saja`,
      `lain=1; ${prefix}.session_token=x.y; z=2`,
    ]) {
      expect(hasSessionCookie(withCookie(cookie), prefix), cookie).toBe(true);
    }
  });

  test("cookie dengan awalan atau nama lain, atau kosong, bukan sesi", () => {
    for (const cookie of [
      "",
      "session_token=abc",
      "better-auth.session_token=abc",
      "ngodingpakeai-lain.session_token=abc",
      `${prefix}.session_data=abc`,
      `${prefix}.session_token=`,
      `x${prefix}.session_token=abc`,
    ]) {
      expect(hasSessionCookie(withCookie(cookie), prefix), cookie).toBe(false);
    }
  });

  test("awalan yang salah (mis. kosong) tidak mengenali cookie aplikasi", () => {
    const headers = withCookie(`${prefix}.session_token=abc`);
    expect(hasSessionCookie(headers, "ngodingpakeai-salah")).toBe(false);
    expect(hasSessionCookie(headers, "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Konfigurasi yang dibagi dengan berkas lain
// ---------------------------------------------------------------------------

// config/site.ts mengimpor JSON tanpa atribut impor, jadi tidak bisa dimuat
// langsung oleh pemuat ESM Node di sini; teksnya dibaca.
const readSource = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const siteSource = readSource("../src/config/site.ts");
const authSource = readSource("../src/lib/auth.ts");

test.describe("konfigurasi bersama", () => {
  test("tujuan bawaan setelah masuk sama dengan siteConfig.homePath", () => {
    expect(siteSource).toContain(`homePath: "${DEFAULT_DESTINATION}"`);
  });

  test("satu konstanta awalan cookie: site.ts mendefinisikannya, auth.ts dan proxy.ts memakainya", () => {
    expect(siteSource).toContain(
      "export const authCookiePrefix = `ngodingpakeai-${starter.id}`;",
    );
    expect(authSource).toContain("cookiePrefix: authCookiePrefix");
    // Tidak ada awalan lain yang ditulis tangan di auth.ts maupun proxy.ts.
    expect(authSource).not.toMatch(/cookiePrefix:\s*[`"']/);
    expect(proxySource).toContain("authCookiePrefix");
    expect(proxySource).not.toContain("ngodingpakeai-");
  });
});
