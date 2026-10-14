import type { BetterAuthOptions } from "better-auth";
import { findInvalidTrustedProxies } from "@better-auth/core/utils/ip";
import { z } from "zod";

// Pengaturan keamanan login yang murni data (tanpa server-only, tanpa database),
// dipakai src/lib/auth.ts dan diuji langsung dari Node (e2e/auth-hardening-
// logic.spec.ts). Satu tempat supaya yang dites persis yang dipasang.

// --- Sesi ---------------------------------------------------------------
// Sesi berlaku 7 hari sejak dibuat atau terakhir diperpanjang, dan
// diperpanjang paling sering sekali sehari (updateAge): petugas NOC yang
// membuka dashboard tiap hari tidak perlu masuk lagi, sesi yang dibiarkan
// seminggu mati sendiri. Nilai ini sama dengan bawaan Better Auth 1.7; ditulis
// terang-terangan supaya naik versi tidak mengubah masa sesi tanpa terlihat.
// Cache sesi di cookie sengaja TIDAK dinyalakan: setiap permintaan memeriksa
// baris sesi di database, jadi sesi yang dicabut mati seketika.
export const SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_AGE = 60 * 60 * 24;

export const sessionOptions = {
  expiresIn: SESSION_EXPIRES_IN,
  updateAge: SESSION_UPDATE_AGE,
} satisfies NonNullable<BetterAuthOptions["session"]>;

// --- Proxy tepercaya ----------------------------------------------------
// TRUSTED_PROXIES: daftar alamat IP atau rentang CIDR dipisah koma. Kosong
// berarti "tidak ada proxy yang dipercaya".
export interface TrustedProxyList {
  // Entri yang sudah dirapikan (spasi dibuang, entri kosong dan kembar dibuang).
  entries: string[];
  // Entri yang bukan alamat IP atau rentang CIDR yang sah.
  invalid: string[];
}

export function parseTrustedProxies(
  raw: string | null | undefined,
): TrustedProxyList {
  const entries = [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  // Aturan sah-tidaknya dipinjam dari Better Auth sendiri, supaya "lolos
  // validasi di sini" selalu berarti "benar-benar dipakai di sana". Better Auth
  // sendiri hanya menulis peringatan lalu MEMBUANG entri yang tidak sah: tanpa
  // pemeriksaan ini salah ketik pada TRUSTED_PROXIES diam-diam menghilangkan
  // sebuah proxy dari daftar.
  return { entries, invalid: findInvalidTrustedProxies(entries) };
}

// Bidang skema untuk TRUSTED_PROXIES di lib/env.ts: hasilnya daftar entri yang
// sudah dirapikan (kosong bila tidak diisi). Entri yang tidak sah menggagalkan
// pembacaan env, jadi aplikasi (dan `npm run build`) berhenti dengan pesan yang
// menyebut entri itu.
export const trustedProxiesField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const { entries, invalid } = parseTrustedProxies(value);
    if (invalid.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `TRUSTED_PROXIES berisi entri yang bukan alamat IP atau rentang CIDR: ${invalid
          .map((entry) => JSON.stringify(entry))
          .join(", ")}. Pisahkan dengan koma, contoh: 127.0.0.1,10.0.0.0/8`,
      });
      return z.NEVER;
    }
    return entries;
  });

// Bagian `advanced.ipAddress` Better Auth: dari mana alamat klien diambil.
// Alamat itu menjadi KUNCI batas laju (3 percobaan masuk per 10 detik per
// alamat per jalur) dan dicatat di baris sesi.
//
// Hasil penyelidikan di build produksi (Next 16.3.4 `next start`, Better Auth
// 1.7.3, NODE_ENV=production; header yang dibaca bawaannya X-Forwarded-For):
//   - Next mengisi X-Forwarded-For dengan alamat soket HANYA bila klien tidak
//     mengirimnya (`x-forwarded-for ??= socket.remoteAddress` di
//     next/dist/server/base-server.js). Nilai kiriman klien dibiarkan, tidak
//     ditambah. Jadi di aplikasi, nilai asli dan nilai palsu tidak bisa
//     dibedakan, dan aplikasi tidak punya jalan lain ke alamat soket.
//   - Tanpa TRUSTED_PROXIES, bawaan Better Auth: satu nilai DIPERCAYA apa
//     adanya. Klien yang menjangkau aplikasi langsung cukup mengganti header
//     itu di tiap permintaan, dan tiap nilai mendapat keranjang batas laju
//     baru: sandi bisa ditebak tanpa batas, dan keranjang orang lain bisa
//     dihabiskan dengan memalsukan alamatnya. Beberapa nilai ("a, b") ditolak
//     (tanpa alamat, keranjang bersama "no-trusted-ip"); tanpa header klien
//     yang terpakai alamat soket.
//   - Dengan trustedProxies: rantai dibaca dari KANAN, hop tepercaya dilewati,
//     hop pertama yang tidak tepercaya adalah klien. Isi kiri rantai (yang
//     bisa dikarang klien) tidak pernah dipakai; rantai berisi sampah atau
//     seluruhnya tepercaya menghasilkan "tidak ada alamat" (keranjang
//     bersama). Satu nilai tidak tepercaya dipakai apa adanya, termasuk alamat
//     soket yang diisi Next untuk sambungan langsung tanpa header.
//
// Aplikasi tidak bisa tahu sendiri apakah ada proxy yang menimpa header itu,
// jadi bawaannya yang paling aman: tanpa TRUSTED_PROXIES SEMUA header terusan
// diabaikan (`ipAddressHeaders: []`; daftar kosong tetap dianggap diisi, jadi
// bawaan X-Forwarded-For tidak dipakai). Akibatnya satu keranjang bersama per
// jalur untuk semua klien: tidak bisa dilewati dengan header palsu, tetapi
// satu penyerang yang menghabiskan keranjang itu menahan petugas lain beberapa
// detik (429 sementara). Itu pilihan sengaja: pembatas yang bisa dilewati
// lebih buruk daripada yang kadang menahan. Jangan ganti ke
// `disableIpTracking`: itu mematikan batas laju seluruhnya.
//
// Di belakang proxy sendiri (nginx, Caddy, load balancer) isi TRUSTED_PROXIES
// dengan alamat proxy itu; tiap pengguna lalu mendapat keranjang sendiri.
// Syaratnya: aplikasi HANYA bisa dijangkau lewat proxy itu. Better Auth hanya
// menafsirkan rantai header, ia tidak bisa memeriksa siapa pengirim langsung;
// klien yang menembus proxy bisa tetap mengirim satu nilai palsu.
export function ipAddressOptions(
  trustedProxies: readonly string[],
): NonNullable<NonNullable<BetterAuthOptions["advanced"]>["ipAddress"]> {
  if (trustedProxies.length > 0) {
    return { trustedProxies: [...trustedProxies] };
  }
  return { ipAddressHeaders: [] };
}

// --- Cookie sesi --------------------------------------------------------
// Atribut cookie sesi ditulis terang-terangan (sama dengan bawaan Better Auth):
//   - httpOnly: skrip di halaman tidak bisa membaca token (XSS tidak mencuri
//     sesi).
//   - sameSite lax: cookie tidak ikut permintaan lintas situs selain navigasi
//     tingkat atas, jadi mengurangi CSRF; permintaan yang mengubah data masih
//     diperiksa Originnya oleh Better Auth.
//   - path "/": berlaku untuk seluruh situs, termasuk /api dan halaman.
// `secure` sengaja tidak ditulis di sini: Better Auth menurunkannya dari
// BETTER_AUTH_URL. Berawalan https:// berarti cookie berlabel Secure dan
// namanya berawalan "__Secure-"; http:// (pengembangan, uji) berarti tidak.
// Nama cookie: <cookiePrefix>.session_token.
export const sessionCookieAttributes = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;

export function authAdvancedOptions(config: {
  cookiePrefix: string;
  trustedProxies: readonly string[];
}): NonNullable<BetterAuthOptions["advanced"]> {
  return {
    cookiePrefix: config.cookiePrefix,
    defaultCookieAttributes: { ...sessionCookieAttributes },
    ipAddress: ipAddressOptions(config.trustedProxies),
  };
}
