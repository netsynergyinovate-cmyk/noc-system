// Aturan jalur terlindungi dan tujuan setelah masuk (?next=). MURNI: tanpa React,
// tanpa kode server, tanpa import dari next/*, jadi aman dipakai di proxy,
// server, browser, dan tes Node.
//
// Semua yang ada di sini hanya urusan arah pengunjung. Pemeriksaan sesi yang
// sebenarnya tetap requireSession() dan withApiSession(); proxy hanya melihat
// ada tidaknya cookie, tanpa database, jadi cookie basi tetap lolos ke sana.

// Awalan jalur yang butuh login. Daftar ini satu-satunya sumber; `matcher` di
// src/proxy.ts harus literal statis (Next membacanya saat build), jadi
// e2e/route-guard.spec.ts membuktikan keduanya sepakat.
export const PROTECTED_PREFIXES = ["/app", "/setup", "/admin"] as const;

// Tujuan bawaan setelah masuk. Harus sama dengan siteConfig.homePath
// (config/site.ts); tidak diimpor dari sana supaya modul ini tetap bisa dimuat
// langsung dari Node (berkas konfigurasi itu mengimpor JSON). Sebuah tes
// memeriksa keduanya sama.
export const DEFAULT_DESTINATION = "/app";

// Header yang diisi proxy dengan jalur+query yang diminta, supaya requireSession
// bisa membawa tujuan semula saat menolak cookie yang basi.
export const NEXT_PATH_HEADER = "x-noc-path";

const MAX_LENGTH = 2048;
// Alamat pura-pura untuk menguraikan jalur relatif; .invalid tidak pernah ada.
const PLACEHOLDER = "http://placeholder.invalid";

// Jalur persis awalan atau turunannya: "/app" dan "/app/x" ya, "/application"
// dan "/apps" tidak.
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Karakter yang tidak pernah sah di tujuan: kendali (U+0000-U+0020 termasuk
// spasi, U+007F-U+009F), backslash (beberapa browser menganggapnya "/"), dan
// spasi Unicode. Alamat yang sah dari browser sudah memakai %20 untuk spasi.
function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x5c) {
      return true;
    }
  }
  return /\s/u.test(value);
}

// Tujuan setelah masuk yang aman: jalur satu-origin yang diawali /app, /setup,
// atau /admin (hasil penguraian, bukan teks mentah), beserta query-nya; hash
// dibuang. Selain itu null. Hasilnya sudah ternormalkan (dot-segment selesai,
// karakter di-escape), jadi memanggilnya lagi pada hasilnya tidak mengubah apa-apa.
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  // Harus jalur dari akar: bukan "http:...", "javascript:...", dan bukan
  // "//host" (jalur tanpa skema yang berpindah host).
  if (value[0] !== "/" || value[1] === "/") return null;
  if (hasUnsafeCharacter(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER) return null;
  // Diperiksa setelah penguraian: "/app/../x" dan "/app/%2e%2e/x" sudah
  // diselesaikan URL menjadi "/x", yang bukan jalur terlindungi.
  if (!isProtectedPath(url.pathname)) return null;
  const result = url.pathname + url.search;
  // Escape bisa memperpanjang; batas dicek lagi supaya hasilnya tetap sah.
  return result.length > MAX_LENGTH ? null : result;
}

// Header permintaan yang diteruskan proxy ke render: salinan header asli dengan
// NEXT_PATH_HEADER berisi jalur+query yang diminta. DITIMPA (set/delete, tidak
// pernah append): nilai kiriman klien dengan nama itu (huruf besar-kecil
// apa pun) tidak boleh selamat sampai requireSession. Bila jalurnya tidak
// layak dibawa (mis. terlalu panjang), header dibuang sama sekali.
export function forwardedHeaders(
  original: Headers,
  pathname: string,
  search: string,
): Headers {
  const headers = new Headers(original);
  const requested = safeNextPath(pathname + search);
  if (requested) headers.set(NEXT_PATH_HEADER, requested);
  else headers.delete(NEXT_PATH_HEADER);
  return headers;
}

// Penanda "sesi berakhir" di alamat halaman masuk: ?sesi=berakhir. Hanya
// BENDERA untuk menampilkan satu kalimat; isinya tidak pernah ditampilkan, dan
// alamat buatan sendiri paling jauh memunculkan kalimat itu (tidak memberi
// akses apa pun). Nilainya persis "berakhir".
export const SESSION_EXPIRED_PARAM = "sesi";
export const SESSION_EXPIRED_VALUE = "berakhir";

// Benar hanya untuk teks persis "berakhir". Array (?sesi=berakhir&sesi=x),
// "Berakhir", "true", angka, null, dan undefined semuanya salah.
export function isSessionExpiredParam(value: unknown): boolean {
  return value === SESSION_EXPIRED_VALUE;
}

// Alamat halaman masuk/daftar dengan tujuan setelah masuk. Tujuan yang tidak
// sah, atau sama dengan tujuan bawaan, tidak ditulis supaya alamatnya bersih.
// Urutan kunci tetap: `next` dulu, lalu `sesi`.
function authUrl(
  base: string,
  next: string | null,
  expired: boolean = false,
): string {
  const params: string[] = [];
  const safe = safeNextPath(next);
  if (safe !== null && safe !== DEFAULT_DESTINATION) {
    params.push(`next=${encodeURIComponent(safe)}`);
  }
  if (expired) params.push(`${SESSION_EXPIRED_PARAM}=${SESSION_EXPIRED_VALUE}`);
  return params.length === 0 ? base : `${base}?${params.join("&")}`;
}

// `expired` menambah ?sesi=berakhir: dipakai requireSession bila cookie sesi ada
// tetapi sesinya tidak sah (kedaluwarsa, dicabut, atau cookie ngawur). Halaman
// daftar sengaja tidak punya padanannya.
export const signInUrl = (
  next: string | null,
  options?: { expired?: boolean },
) => authUrl("/sign-in", next, options?.expired === true);
export const signUpUrl = (next: string | null) => authUrl("/sign-up", next);

// Keputusan proxy untuk satu permintaan: null berarti biarkan lewat. Hanya
// satu pengalihan yang ada: jalur terlindungi tanpa cookie sesi menuju masuk.
// Pengunjung yang punya cookie TIDAK PERNAH dialihkan menjauh dari /sign-in ke
// dasbor di sini: cookie bisa basi, dan layout yang memeriksa database akan
// menolaknya lagi sehingga pengalihan berputar tanpa ujung.
export function guardDecision(input: {
  pathname: string;
  search: string;
  hasSessionCookie: boolean;
}): { redirectTo: string } | null {
  if (input.hasSessionCookie || !isProtectedPath(input.pathname)) return null;
  return {
    redirectTo: signInUrl(safeNextPath(input.pathname + input.search)),
  };
}
