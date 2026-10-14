import { getSessionCookie } from "better-auth/cookies";

// Ada tidaknya cookie sesi Better Auth, TANPA memeriksa isinya atau database.
// Cookie yang ada bisa basi (sesi dihapus atau kedaluwarsa); itu hanya cukup
// untuk pemeriksaan optimis di proxy. Yang menentukan akses tetap
// requireSession(). Awalan nama cookie datang dari pemanggil (authCookiePrefix
// di config/site.ts) supaya modul ini tidak bergantung pada berkas konfigurasi
// dan bisa diuji langsung dari Node.
export function hasSessionCookie(headers: Headers, prefix: string): boolean {
  return getSessionCookie(headers, { cookiePrefix: prefix }) !== null;
}
