import { timingSafeEqual } from "node:crypto";

export const DEFAULT_BENCHMARK_KEY = "lab-benchmark-key";

function keyMatches(given: string | null) {
  if (!given) return false;
  const want = Buffer.from(process.env.BENCHMARK_SECRET || DEFAULT_BENCHMARK_KEY);
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Request lolos bila membawa x-benchmark-key yang benar ATAU sesi Better Auth
// aktif. Auth diimpor malas: jalur kunci tidak menyentuh database, dan modul
// ini tetap bisa diuji di luar Next.js.
// ponytail: kunci bawaan hanya untuk lab lokal; set BENCHMARK_SECRET di luar lab.
export async function isBenchmarkAuthorized(request: Request) {
  if (keyMatches(request.headers.get("x-benchmark-key"))) return true;
  try {
    const { auth } = await import("@/lib/auth");
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    return Boolean(session);
  } catch {
    return false; // gagal memeriksa sesi = tidak diizinkan
  }
}
