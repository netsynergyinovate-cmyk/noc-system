// Ke mana requireSession() mengirim permintaan yang ditolak. MURNI (tanpa next/*
// dan tanpa database), jadi bisa diuji langsung dari spesifikasi Node; yang
// server-only hanya requireSession() di session.ts yang memanggilnya.
import { hasSessionCookie } from "./auth-cookie";
import { NEXT_PATH_HEADER, safeNextPath, signInUrl } from "./route-guard";

// Alamat halaman masuk untuk permintaan yang TIDAK punya sesi sah.
//
// - Tujuan semula datang dari header NEXT_PATH_HEADER yang diisi proxy, dan
//   dibersihkan lagi di sini (safeNextPath): nilai apa pun yang bukan jalur
//   terlindungi satu-origin dibuang, dan tanpa header (rute di luar proxy)
//   hasilnya /sign-in biasa.
// - Cookie sesi ADA tetapi sesinya tidak sah berarti sesi petugas berakhir
//   (kedaluwarsa, dicabut, atau cookie ngawur): alamatnya membawa
//   ?sesi=berakhir supaya halaman masuk memberi tahu. Tanpa cookie sama sekali
//   (anonim, yang biasanya sudah dialihkan proxy lebih dulu) tidak ada yang
//   "berakhir", jadi tidak ada penanda.
export function sessionRejectedUrl(
  requestHeaders: Headers,
  cookiePrefix: string,
): string {
  return signInUrl(safeNextPath(requestHeaders.get(NEXT_PATH_HEADER)), {
    expired: hasSessionCookie(requestHeaders, cookiePrefix),
  });
}
