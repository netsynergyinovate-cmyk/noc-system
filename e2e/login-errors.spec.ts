import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE_ERROR_CODES } from "better-auth";
import { expect, test } from "@playwright/test";
import {
  DEFAULT_RETRY_SECONDS,
  MAX_RETRY_SECONDS,
  authFailureFocus,
  authFailureMessage,
  authFailureWait,
  retryDelaySeconds,
  type AuthFailure,
  type AuthMode,
} from "../src/lib/auth-errors";
import { sessionRejectedUrl } from "../src/lib/session-redirect";
import {
  NEXT_PATH_HEADER,
  SESSION_EXPIRED_PARAM,
  SESSION_EXPIRED_VALUE,
  isSessionExpiredParam,
  safeNextPath,
  signInUrl,
  signUpUrl,
} from "../src/lib/route-guard";

// Pesan galat login dan aksinya, tanpa browser: lama tunggu sesudah batas laju
// (429) dibersihkan ke 1..60 detik, hanya 429 yang membuat tombol menunggu,
// penanda "sesi berakhir" di alamat masuk hanya dari teks persis, alamat masuk
// membawa tujuan dan penanda dalam urutan tetap, dan halaman tidak ada/galat
// berbahasa Indonesia dengan jalan kembali. Tampilannya di browser ada di
// e2e/login-errors-ui.spec.ts.

const modes: AuthMode[] = ["sign-in", "sign-up"];
const response = (
  status?: number,
  code?: string,
  retryAfter?: number,
): AuthFailure => ({ kind: "response", status, code, retryAfter });
const network: AuthFailure = { kind: "network" };

// Judul tes: karakter di luar ASCII tercetak ditulis sebagai kode \uXXXX, dan
// nilai yang bukan teks/angka ditulis jenisnya.
const show = (value: unknown) => {
  if (typeof value === "symbol") return "Symbol()";
  if (typeof value === "function") return "function";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.keys(value).length === 0
      ? "{}"
      : `objek ${Object.keys(value).join(",")}`;
  }
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
};

// ---------------------------------------------------------------------------
// retryDelaySeconds
// ---------------------------------------------------------------------------

test.describe("retryDelaySeconds: nilai header menjadi 1..60 detik", () => {
  // [masukan, keluaran]
  const table: [unknown, number][] = [
    // Dalam rentang: dipakai apa adanya.
    [1, 1],
    [7, 7],
    ["7", 7],
    [" 7 ", 7],
    [10, 10],
    [59, 59],
    [60, 60],
    ["60", 60],
    // Terlalu besar: dibatasi 60.
    [61, 60],
    ["61", 60],
    [999, 60],
    ["999", 60],
    [1e9, 60],
    ["1e9", 60],
    [Number.MAX_SAFE_INTEGER, 60],
    [Infinity, 60],
    ["Infinity", 60],
    // Pecahan dibulatkan ke atas (lebih aman menunggu sedikit lebih lama).
    [2.1, 3],
    ["2.1", 3],
    [0.2, 1],
    ["0.5", 1],
    [6.999, 7],
    [59.2, 60],
    [60.0001, 60],
    // Nol, negatif, bukan angka: lama bawaan.
    [0, DEFAULT_RETRY_SECONDS],
    ["0", DEFAULT_RETRY_SECONDS],
    [-3, DEFAULT_RETRY_SECONDS],
    ["-3", DEFAULT_RETRY_SECONDS],
    [-Infinity, DEFAULT_RETRY_SECONDS],
    [NaN, DEFAULT_RETRY_SECONDS],
    ["NaN", DEFAULT_RETRY_SECONDS],
    [null, DEFAULT_RETRY_SECONDS],
    [undefined, DEFAULT_RETRY_SECONDS],
    ["abc", DEFAULT_RETRY_SECONDS],
    ["7abc", DEFAULT_RETRY_SECONDS],
    ["7 detik", DEFAULT_RETRY_SECONDS],
    ["", DEFAULT_RETRY_SECONDS],
    ["   ", DEFAULT_RETRY_SECONDS],
    // Tanggal HTTP (bentuk lain Retry-After) tidak dikenali di sini.
    ["Wed, 21 Oct 2026 07:28:00 GMT", DEFAULT_RETRY_SECONDS],
    // Bukan angka dan bukan teks: tidak dipaksa menjadi angka.
    [[7], DEFAULT_RETRY_SECONDS],
    [["7"], DEFAULT_RETRY_SECONDS],
    [[], DEFAULT_RETRY_SECONDS],
    [{}, DEFAULT_RETRY_SECONDS],
    [{ toString: () => "7" }, DEFAULT_RETRY_SECONDS],
    [{ valueOf: () => 7 }, DEFAULT_RETRY_SECONDS],
    [true, DEFAULT_RETRY_SECONDS],
    [false, DEFAULT_RETRY_SECONDS],
    [BigInt(10), DEFAULT_RETRY_SECONDS],
    [Symbol("7"), DEFAULT_RETRY_SECONDS],
    [() => 7, DEFAULT_RETRY_SECONDS],
  ];
  for (const [input, expected] of table) {
    test(`${show(input)} -> ${expected}`, () => {
      expect(retryDelaySeconds(input)).toBe(expected);
    });
  }

  test("konstanta: bawaan 10 detik (jendela Better Auth), batas atas 60", () => {
    expect(DEFAULT_RETRY_SECONDS).toBe(10);
    expect(MAX_RETRY_SECONDS).toBe(60);
  });

  test("apa pun masukannya, hasilnya bilangan bulat 1..60; idempoten", () => {
    // Deret bilangan, teks bilangan, dan sampah, dengan pembangkit
    // pseudo-acak berbenih supaya tes bisa diulang.
    let seed = 20_260_509;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    const junk = ["", "x", "1x", "٣", "0x10", "1,5", "--1", "+7", "7.", ".5"];
    for (let i = 0; i < 2000; i += 1) {
      const n = (next() - 0.3) * 200;
      for (const value of [
        n,
        String(n),
        Math.trunc(n),
        junk[Math.floor(next() * junk.length)],
      ]) {
        const result = retryDelaySeconds(value);
        expect(Number.isInteger(result), show(value)).toBe(true);
        expect(result, show(value)).toBeGreaterThanOrEqual(1);
        expect(result, show(value)).toBeLessThanOrEqual(60);
        expect(retryDelaySeconds(result), show(value)).toBe(result);
      }
    }
  });

  test("monoton: angka positif yang lebih besar tidak pernah menunggu lebih sedikit", () => {
    let previous = 0;
    for (let tenths = 1; tenths <= 1500; tenths += 1) {
      const result = retryDelaySeconds(tenths / 10);
      expect(result).toBeGreaterThanOrEqual(previous);
      previous = result;
    }
  });
});

// ---------------------------------------------------------------------------
// authFailureWait: hanya batas laju yang menunggu
// ---------------------------------------------------------------------------

test.describe("authFailureWait", () => {
  for (const mode of modes) {
    test(`${mode}: 429 memakai retryAfter bila ada, selain itu 10`, () => {
      expect(authFailureWait(mode, response(429))).toBe(10);
      expect(authFailureWait(mode, response(429, undefined, 7))).toBe(7);
      expect(authFailureWait(mode, response(429, undefined, 1))).toBe(1);
      expect(authFailureWait(mode, response(429, undefined, 60))).toBe(60);
      // Nilai yang belum dibersihkan pun dibersihkan lagi di sini.
      expect(authFailureWait(mode, response(429, undefined, 61))).toBe(60);
      expect(authFailureWait(mode, response(429, undefined, 999))).toBe(60);
      expect(authFailureWait(mode, response(429, undefined, 0))).toBe(10);
      expect(authFailureWait(mode, response(429, undefined, -5))).toBe(10);
      expect(authFailureWait(mode, response(429, undefined, NaN))).toBe(10);
      expect(authFailureWait(mode, response(429, undefined, 2.1))).toBe(3);
    });

    test(`${mode}: 429 menunggu apa pun kodenya (429 menang atas kode lain)`, () => {
      for (const code of [
        "INVALID_EMAIL_OR_PASSWORD",
        "BANNED_USER",
        "INVALID_ORIGIN",
        "USER_ALREADY_EXISTS",
        "KODE_ASING",
      ]) {
        expect(authFailureWait(mode, response(429, code, 4)), code).toBe(4);
        expect(authFailureWait(mode, response(429, code)), code).toBe(10);
      }
    });

    test(`${mode}: semua kegagalan lain TIDAK menunggu (null), juga bila retryAfter terisi`, () => {
      const statuses = [
        undefined,
        200,
        400,
        401,
        403,
        404,
        408,
        409,
        422,
        428,
        430,
        499,
        500,
        502,
        503,
        504,
        599,
      ];
      const codes = [
        undefined,
        "INVALID_EMAIL_OR_PASSWORD",
        "BANNED_USER",
        "INVALID_ORIGIN",
        "MISSING_OR_NULL_ORIGIN",
        "USER_ALREADY_EXISTS",
        "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        ...Object.keys(BASE_ERROR_CODES),
      ];
      let checked = 0;
      for (const status of statuses) {
        for (const code of codes) {
          for (const retryAfter of [undefined, 7, 60]) {
            expect(
              authFailureWait(mode, response(status, code, retryAfter)),
              `${status} ${code} ${retryAfter}`,
            ).toBeNull();
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);
      expect(authFailureWait(mode, network)).toBeNull();
    });
  }

  test("tepat 429 yang menunggu: 428 dan 430 tidak", () => {
    expect(authFailureWait("sign-in", response(428))).toBeNull();
    expect(authFailureWait("sign-in", response(429))).toBe(10);
    expect(authFailureWait("sign-in", response(430))).toBeNull();
  });

  test("pesan dan fokus 429 tidak berubah, ada atau tidak ada retryAfter", () => {
    const limited =
      "Terlalu banyak percobaan. Tunggu beberapa detik lalu coba lagi.";
    for (const mode of modes) {
      for (const failure of [
        response(429),
        response(429, undefined, 7),
        response(429, undefined, 60),
        response(429, "INVALID_EMAIL_OR_PASSWORD", 3),
      ]) {
        expect(authFailureMessage(mode, failure)).toBe(limited);
        expect(authFailureFocus(mode, failure)).toBe("submit");
      }
    }
  });

  test("retryAfter tidak mengubah pesan atau fokus kegagalan lain", () => {
    const cases: [AuthMode, number, string | undefined][] = [
      ["sign-in", 401, "INVALID_EMAIL_OR_PASSWORD"],
      ["sign-in", 403, "BANNED_USER"],
      ["sign-in", 500, undefined],
      ["sign-up", 422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"],
      ["sign-up", 400, "PASSWORD_TOO_SHORT"],
    ];
    for (const [mode, status, code] of cases) {
      expect(authFailureMessage(mode, response(status, code, 7))).toBe(
        authFailureMessage(mode, response(status, code)),
      );
      expect(authFailureFocus(mode, response(status, code, 7))).toBe(
        authFailureFocus(mode, response(status, code)),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ?sesi=berakhir
// ---------------------------------------------------------------------------

test.describe("isSessionExpiredParam", () => {
  test("nama dan nilai parameter", () => {
    expect(SESSION_EXPIRED_PARAM).toBe("sesi");
    expect(SESSION_EXPIRED_VALUE).toBe("berakhir");
  });

  test("benar hanya untuk teks persis 'berakhir'", () => {
    expect(isSessionExpiredParam("berakhir")).toBe(true);
  });

  const falsy: unknown[] = [
    "Berakhir",
    "BERAKHIR",
    "berakhir ",
    " berakhir",
    "berakhir\n",
    "berakhirr",
    "berakhi",
    "ber akhir",
    "true",
    "1",
    "0",
    "ya",
    "expired",
    "",
    "sesi=berakhir",
    "<script>",
    ["berakhir"],
    ["berakhir", "x"],
    ["x", "berakhir"],
    ["berakhir", "berakhir"],
    [],
    undefined,
    null,
    true,
    false,
    1,
    0,
    NaN,
    {},
    { toString: () => "berakhir" },
    new String("berakhir"),
    () => "berakhir",
  ];
  for (const value of falsy) {
    test(`salah: ${show(value)}`, () => {
      expect(isSessionExpiredParam(value)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// signInUrl / signUpUrl
// ---------------------------------------------------------------------------

test.describe("signInUrl dengan expired", () => {
  // [tujuan, expired, alamat]
  const table: [string | null, boolean | undefined, string][] = [
    [null, false, "/sign-in"],
    [null, undefined, "/sign-in"],
    ["/app/alert", false, "/sign-in?next=%2Fapp%2Falert"],
    ["/app/alert", undefined, "/sign-in?next=%2Fapp%2Falert"],
    [null, true, "/sign-in?sesi=berakhir"],
    ["/app/alert", true, "/sign-in?next=%2Fapp%2Falert&sesi=berakhir"],
    // Tujuan bawaan (/app) tidak ditulis, juga bersama penanda.
    ["/app", false, "/sign-in"],
    ["/app", true, "/sign-in?sesi=berakhir"],
    // Tujuan tidak sah dibuang; penanda tetap.
    ["//evil.example", true, "/sign-in?sesi=berakhir"],
    ["https://evil.example/app", true, "/sign-in?sesi=berakhir"],
    ["/api/notes", true, "/sign-in?sesi=berakhir"],
    ["/sign-in", true, "/sign-in?sesi=berakhir"],
    ["/app/../x", true, "/sign-in?sesi=berakhir"],
    ["", true, "/sign-in?sesi=berakhir"],
    ["//evil.example", false, "/sign-in"],
    // Query di tujuan ikut terkode; & dan = di dalamnya bukan parameter sendiri.
    [
      "/app/alert?x=1",
      true,
      "/sign-in?next=%2Fapp%2Falert%3Fx%3D1&sesi=berakhir",
    ],
    [
      "/app/billing?x=1&y=2",
      true,
      "/sign-in?next=%2Fapp%2Fbilling%3Fx%3D1%26y%3D2&sesi=berakhir",
    ],
    ["/setup", true, "/sign-in?next=%2Fsetup&sesi=berakhir"],
    ["/admin", true, "/sign-in?next=%2Fadmin&sesi=berakhir"],
  ];
  for (const [next, expired, url] of table) {
    test(`next=${show(next)} expired=${show(expired)} -> ${url}`, () => {
      const options = expired === undefined ? undefined : { expired };
      expect(signInUrl(next, options)).toBe(url);
    });
  }

  test("opsi kosong sama dengan tanpa opsi; hanya true persis yang menambah penanda", () => {
    expect(signInUrl("/app/alert", {})).toBe("/sign-in?next=%2Fapp%2Falert");
    expect(signInUrl("/app/alert", { expired: undefined })).toBe(
      "/sign-in?next=%2Fapp%2Falert",
    );
    for (const value of ["true", 1, "ya", {}, []]) {
      expect(
        signInUrl("/app/alert", { expired: value as unknown as boolean }),
        show(value),
      ).toBe("/sign-in?next=%2Fapp%2Falert");
    }
  });

  test("urutan kunci tetap: next dulu, lalu sesi; round-trip lewat URLSearchParams", () => {
    const destinations = [
      "/app/alert",
      "/app/alert?x=1&y=a%20b",
      "/app?focus=abc-123",
      "/setup",
      "/admin",
      "/app/pelanggan?q=%C3%A9&r=1",
      "/app/router/new",
    ];
    for (const destination of destinations) {
      const url = new URL(
        signInUrl(destination, { expired: true }),
        "http://localhost",
      );
      expect(url.pathname).toBe("/sign-in");
      expect([...url.searchParams.keys()]).toEqual(["next", "sesi"]);
      expect(url.searchParams.get("next")).toBe(safeNextPath(destination));
      expect(url.searchParams.get("sesi")).toBe("berakhir");
      expect(isSessionExpiredParam(url.searchParams.get("sesi"))).toBe(true);

      // Tanpa penanda: hanya next.
      const plain = new URL(signInUrl(destination), "http://localhost");
      expect([...plain.searchParams.keys()]).toEqual(["next"]);
      expect(plain.searchParams.get("next")).toBe(safeNextPath(destination));
    }
  });

  test("tujuan yang memuat sesi=berakhir di query-nya tetap terkurung di dalam next", () => {
    const destination = "/app/alert?sesi=berakhir&next=/admin";
    const withFlag = new URL(
      signInUrl(destination, { expired: true }),
      "http://localhost",
    );
    expect([...withFlag.searchParams.keys()]).toEqual(["next", "sesi"]);
    expect(withFlag.searchParams.get("next")).toBe(destination);
    // Tanpa penanda yang sah, query di dalam next bukan penanda.
    const without = new URL(signInUrl(destination), "http://localhost");
    expect([...without.searchParams.keys()]).toEqual(["next"]);
    expect(without.searchParams.get("sesi")).toBeNull();
    // Bagi halaman masuk, penandanya hanya yang berada di tingkat atas.
    expect(isSessionExpiredParam(without.searchParams.get("sesi"))).toBe(false);
  });

  test("seperti safeNextPath: tujuan yang sama menghasilkan alamat yang sama dan tujuan acak tidak merusak penanda", () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    const pieces = [
      "/app",
      "/setup",
      "/admin",
      "/x",
      "/",
      "?",
      "&",
      "=",
      "%",
      "%2F",
      "#",
      "sesi=berakhir",
      " ",
      "é",
      "..",
      "//",
      "\\",
    ];
    for (let i = 0; i < 1500; i += 1) {
      let candidate = "";
      const length = 1 + Math.floor(next() * 6);
      for (let j = 0; j < length; j += 1) {
        candidate += pieces[Math.floor(next() * pieces.length)];
      }
      const url = new URL(
        signInUrl(candidate, { expired: true }),
        "http://localhost",
      );
      const safe = safeNextPath(candidate);
      const carried = safe !== null && safe !== "/app";
      expect(url.pathname, candidate).toBe("/sign-in");
      expect([...url.searchParams.keys()], candidate).toEqual(
        carried ? ["next", "sesi"] : ["sesi"],
      );
      expect(url.searchParams.get("sesi"), candidate).toBe("berakhir");
      if (carried) expect(url.searchParams.get("next"), candidate).toBe(safe);
    }
  });
});

test.describe("signUpUrl tidak pernah membawa sesi", () => {
  test("alamat daftar", () => {
    expect(signUpUrl(null)).toBe("/sign-up");
    expect(signUpUrl("/app")).toBe("/sign-up");
    expect(signUpUrl("/app/alert")).toBe("/sign-up?next=%2Fapp%2Falert");
    expect(signUpUrl("//evil.example")).toBe("/sign-up");
  });

  test("juga bila tujuannya sendiri memuat sesi=berakhir", () => {
    for (const destination of [
      "/app?sesi=berakhir",
      "/app/alert?sesi=berakhir",
      "/app/alert?x=1&sesi=berakhir",
    ]) {
      const url = new URL(signUpUrl(destination), "http://localhost");
      expect([...url.searchParams.keys()], destination).toEqual(["next"]);
      expect(url.searchParams.get("sesi"), destination).toBeNull();
      expect(url.searchParams.get("next"), destination).toBe(
        safeNextPath(destination),
      );
    }
  });

  test("tidak ada cara memintanya: argumen kedua diabaikan", () => {
    const call = signUpUrl as unknown as (
      next: string | null,
      options?: { expired?: boolean },
    ) => string;
    expect(call("/app/alert", { expired: true })).toBe(
      "/sign-up?next=%2Fapp%2Falert",
    );
  });
});

// ---------------------------------------------------------------------------
// sessionRejectedUrl: ke mana requireSession mengirim permintaan yang ditolak
// ---------------------------------------------------------------------------

test.describe("sessionRejectedUrl", () => {
  const prefix = "ngodingpakeai-uji";
  const request = (init: { cookie?: string; path?: string | null }) => {
    const headers = new Headers();
    if (init.cookie !== undefined) headers.set("cookie", init.cookie);
    if (init.path !== undefined && init.path !== null) {
      headers.set(NEXT_PATH_HEADER, init.path);
    }
    return headers;
  };
  const sessionCookies = [
    `${prefix}.session_token=nilai-apa-saja`,
    `__Secure-${prefix}.session_token=nilai-apa-saja`,
    `lain=1; ${prefix}.session_token=ngawur.ngawur; z=2`,
  ];
  const otherCookies = [
    undefined,
    "",
    "a=1",
    "session_token=abc",
    "better-auth.session_token=abc",
    "ngodingpakeai-lain.session_token=abc",
    `${prefix}.session_token=`,
    `${prefix}.session_data=abc`,
  ];

  test("cookie sesi ada tetapi sesinya tidak sah: tujuan semula dan ?sesi=berakhir", () => {
    for (const cookie of sessionCookies) {
      expect(
        sessionRejectedUrl(request({ cookie, path: "/app/alert?x=1" }), prefix),
        cookie,
      ).toBe("/sign-in?next=%2Fapp%2Falert%3Fx%3D1&sesi=berakhir");
      expect(
        sessionRejectedUrl(request({ cookie, path: "/setup" }), prefix),
        cookie,
      ).toBe("/sign-in?next=%2Fsetup&sesi=berakhir");
      expect(
        sessionRejectedUrl(request({ cookie, path: "/app" }), prefix),
        cookie,
      ).toBe("/sign-in?sesi=berakhir");
      expect(sessionRejectedUrl(request({ cookie }), prefix), cookie).toBe(
        "/sign-in?sesi=berakhir",
      );
    }
  });

  test("tanpa cookie sesi (anonim): tujuan ikut, TANPA penanda sesi", () => {
    for (const cookie of otherCookies) {
      expect(
        sessionRejectedUrl(request({ cookie, path: "/app/alert?x=1" }), prefix),
        String(cookie),
      ).toBe("/sign-in?next=%2Fapp%2Falert%3Fx%3D1");
      expect(
        sessionRejectedUrl(request({ cookie, path: "/admin" }), prefix),
        String(cookie),
      ).toBe("/sign-in?next=%2Fadmin");
      expect(
        sessionRejectedUrl(request({ cookie, path: "/app" }), prefix),
        String(cookie),
      ).toBe("/sign-in");
      expect(
        sessionRejectedUrl(request({ cookie }), prefix),
        String(cookie),
      ).toBe("/sign-in");
    }
  });

  test("awalan cookie yang salah dianggap tanpa cookie", () => {
    const headers = request({
      cookie: `${prefix}.session_token=abc`,
      path: "/app/alert",
    });
    expect(sessionRejectedUrl(headers, "ngodingpakeai-salah")).toBe(
      "/sign-in?next=%2Fapp%2Falert",
    );
    expect(sessionRejectedUrl(headers, prefix)).toBe(
      "/sign-in?next=%2Fapp%2Falert&sesi=berakhir",
    );
  });

  test("header tujuan palsu dibuang, juga bersama cookie; penanda tidak ikut terbuang", () => {
    for (const path of [
      "//evil.example",
      "https://evil.example/app",
      "/api/notes",
      "/sign-in",
      "/app/../x",
      "javascript:alert(1)",
      "",
    ]) {
      expect(
        sessionRejectedUrl(
          request({ cookie: sessionCookies[0], path }),
          prefix,
        ),
        path,
      ).toBe("/sign-in?sesi=berakhir");
      expect(
        sessionRejectedUrl(request({ cookie: undefined, path }), prefix),
        path,
      ).toBe("/sign-in");
    }
  });

  test("selalu /sign-in; sesi ada tepat bila cookie sesi ada; urutan kunci tetap", () => {
    const paths = [null, "/app", "/app/alert", "/app/alert?a=1&b=2", "/admin"];
    for (const path of paths) {
      for (const cookie of [...sessionCookies, ...otherCookies]) {
        const url = new URL(
          sessionRejectedUrl(request({ cookie, path }), prefix),
          "http://localhost",
        );
        const hasCookie =
          cookie !== undefined && sessionCookies.includes(cookie);
        expect(url.pathname).toBe("/sign-in");
        expect(url.searchParams.has("sesi")).toBe(hasCookie);
        const keys = [...url.searchParams.keys()];
        expect(keys).toEqual(
          [
            path !== null && path !== "/app" ? "next" : null,
            hasCookie ? "sesi" : null,
          ].filter((key) => key !== null),
        );
      }
    }
  });

  test("session.ts hanya memakai sessionRejectedUrl (tidak merakit alamat sendiri)", () => {
    const code = withoutComments(source("lib/session.ts"));
    expect(code).toContain(
      "sessionRejectedUrl(await headers(), authCookiePrefix)",
    );
    expect(code).not.toContain("signInUrl(");
    expect(code).not.toContain("expired");
    const helper = withoutComments(source("lib/session-redirect.ts"));
    expect(helper).toContain("hasSessionCookie(requestHeaders, cookiePrefix)");
    expect(helper).not.toContain("next/");
    expect(helper).not.toContain("server-only");
  });
});

// ---------------------------------------------------------------------------
// Isi halaman tidak ada dan halaman galat (dibaca dari sumber)
// ---------------------------------------------------------------------------
//
// Halaman galat (error.tsx) hanya tampil bila sebuah halaman melempar galat saat
// dirender, dan aplikasi ini tidak punya rute yang melempar dengan sengaja (dan
// tidak boleh menambah rute uji). Karena itu tulisannya diperiksa dari sumber,
// tanpa komentar; perilakunya di browser (tombol "Coba lagi") tidak diuji di
// sini. Halaman tidak ada diuji di browser di login-errors-ui.spec.ts.

function source(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../src/${relative}`, import.meta.url)),
    "utf8",
  );
}

// Sumber tanpa komentar baris dan blok, supaya yang diperiksa hanya yang
// ikut tampil atau dijalankan.
function withoutComments(code: string) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test.describe("teks halaman galat dan tidak ada", () => {
  test("error.tsx berbahasa Indonesia dengan dua jalan keluar", () => {
    const code = withoutComments(source("app/error.tsx"));
    for (const expected of [
      "Terjadi kesalahan",
      "Coba muat halaman ini lagi. Bila terus terjadi, hubungi admin NOC.",
      "Coba lagi",
      "Kembali ke beranda",
      'href="/"',
    ]) {
      expect(code, expected).toContain(expected);
    }
    for (const old of [
      "Something went wrong",
      "Try again",
      "Try loading",
      "terminal",
      "Go home",
    ]) {
      expect(code, old).not.toContain(old);
    }
    // Tombol memanggil retry (atau reset sebagai cadangan), bukan kosong.
    expect(code).toMatch(/onClick=\{\(\) => \(retry \?\? reset\)\(\)\}/);
    // Halaman tidak memakai role="alert" (halamannya sendiri baru).
    expect(code).not.toContain('role="alert"');
  });

  test("not-found.tsx berbahasa Indonesia, tanpa kata izin, akses, hak, atau dilarang", () => {
    const code = withoutComments(source("app/not-found.tsx"));
    for (const expected of [
      "404",
      "Halaman tidak ditemukan",
      "Alamat ini tidak ada. Kembali ke awal untuk melanjutkan.",
      "Kembali ke beranda",
      'href="/"',
    ]) {
      expect(code, expected).toContain(expected);
    }
    for (const old of ["This page", "isn’t here", "Go home", "Head back"]) {
      expect(code, old).not.toContain(old);
    }
    // Halaman yang sama dipakai untuk "tidak ada" dan "ada tetapi tidak boleh
    // dibuka", jadi tulisannya tidak boleh membedakan keduanya.
    expect(code).not.toMatch(
      /\b(izin|akses|hak|dilarang|terlarang|forbidden|permission|denied|unauthori[sz]ed)/i,
    );
  });
});
