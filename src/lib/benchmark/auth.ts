import { timingSafeEqual } from "node:crypto";

// Tanpa BENCHMARK_SECRET tidak ada kunci yang cocok: tidak ada kunci bawaan di kode.
function keyMatches(given: string | null) {
  const secret = process.env.BENCHMARK_SECRET;
  if (!given || !secret) return false;
  const want = Buffer.from(secret);
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want);
}

// Request lolos bila membawa x-benchmark-key yang sama dengan BENCHMARK_SECRET
// ATAU sesi Better Auth dengan izin system:manage (admin). Auth diimpor malas:
// jalur kunci tidak menyentuh database, dan modul ini tetap bisa diuji di luar Next.js.
export async function isBenchmarkAuthorized(request: Request) {
  if (keyMatches(request.headers.get("x-benchmark-key"))) return true;
  try {
    const { auth } = await import("@/lib/auth");
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    if (!session) return false;
    const { success } = await auth.api.userHasPermission({
      body: { userId: session.user.id, permissions: { system: ["manage"] } },
    });
    return success;
  } catch {
    return false; // gagal memeriksa sesi = tidak diizinkan
  }
}
