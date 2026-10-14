import { NextResponse, type NextRequest } from "next/server";
import { authCookiePrefix } from "./config/site";
import { hasSessionCookie } from "./lib/auth-cookie";
import { forwardedHeaders, guardDecision } from "./lib/route-guard";

// Gerbang OPTIMIS untuk halaman terlindungi: tanpa cookie sesi, pengunjung
// langsung dialihkan ke /sign-in (membawa tujuannya) tanpa merender apa pun.
// Tidak ada akses database di sini. Cookie yang ada belum tentu sesi yang
// berlaku, jadi pemeriksaan nyata tetap requireSession() di layout dan
// withApiSession()/withApiPermission() di API. /api/* sengaja di luar proxy:
// API menjawab JSON 401 sendiri.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = guardDecision({
    pathname,
    search,
    hasSessionCookie: hasSessionCookie(request.headers, authCookiePrefix),
  });

  if (decision) {
    // Dibangun dari alamat yang diminta (bukan BETTER_AUTH_URL), supaya host
    // dan port tetap yang dipakai pengunjung.
    const target = new URL(decision.redirectTo, "http://placeholder.invalid");
    const url = request.nextUrl.clone();
    url.pathname = target.pathname;
    url.search = target.search;
    url.hash = "";
    return NextResponse.redirect(url, 307);
  }

  // Jalur yang diminta diteruskan ke render sebagai header PERMINTAAN (bukan
  // header jawaban), supaya requireSession bisa membawanya bila cookie basi.
  return NextResponse.next({
    request: { headers: forwardedHeaders(request.headers, pathname, search) },
  });
}

// Literal statis (Next membacanya saat build, variabel diabaikan). Harus sama
// dengan PROTECTED_PREFIXES di lib/route-guard.ts; e2e/route-guard.spec.ts
// memeriksanya.
export const config = {
  matcher: ["/app/:path*", "/setup/:path*", "/admin/:path*"],
};
