/**
 * Penjaga peran runtime dan loopback untuk Halaman Deploy & Rilis.
 *
 * PRINSIP KEAMANAN:
 * 1. FAIL CLOSED: Halaman dan rute deploy HANYA aktif bila variabel server-only
 *    process.env.DEPLOY_PAGE_ROLE bernilai persis "local".
 *    Bila tidak disetel, kosong, "server", atau nilai lain -> kembalikan 404.
 * 2. TANPA NEXT_PUBLIC_*: Jangan pernah membaca NEXT_PUBLIC_* agar nilai tidak
 *    terkompilasi ke dalam client bundle saat build di localhost.
 * 3. PEMERIKSAAN LOOPBACK WAJIB:
 *    Header Host harus ada dan wajib mengarah ke loopback (localhost, 127.0.0.1, ::1).
 *    0.0.0.0 bukan alamat loopback host dan ditolak.
 *    Bila header Host tidak ada -> tolak 403.
 */
import { isDeveloper } from "@/lib/roles";

export function isDeployRole(): boolean {
  return process.env.DEPLOY_PAGE_ROLE === "local";
}

export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const clean = hostHeader.trim().toLowerCase();

  // Bersihkan format IPv6 [::1]:port atau host:port
  let hostname = clean;
  if (clean.startsWith("[")) {
    const closingIndex = clean.indexOf("]");
    if (closingIndex !== -1) {
      hostname = clean.substring(1, closingIndex);
    }
  } else if (clean === "::1") {
    hostname = "::1";
  } else {
    hostname = clean.split(":")[0];
  }

  // 0.0.0.0 ditolak karena bind-all bukan loopback
  if (hostname === "0.0.0.0") {
    return false;
  }

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
}

export interface DeployGuardResult {
  allowed: boolean;
  status: 200 | 404 | 403;
  error?: string;
}

export function evaluateDeployAccess(
  request?: Request,
  userRole?: string | null,
): DeployGuardResult {
  // Halaman dan rute deploy diizinkan khusus untuk Developer (termasuk di server native untuk telemetri).
  if (isDeveloper(userRole)) {
    return { allowed: true, status: 200 };
  }

  // 1. Lapisan utama: Peran runtime (Fail-Closed)
  // Bila peran bukan 'local' (termasuk unset/undefined), kembalikan 404.
  if (!isDeployRole()) {
    return {
      allowed: false,
      status: 404,
      error: "Halaman dan rute deploy tidak tersedia di SERVER NATIVE.",
    };
  }

  // 2. Lapisan pelengkap: Pemeriksaan Host jika request diberikan
  if (request) {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    if (!host || !isLoopbackHost(host)) {
      return {
        allowed: false,
        status: 403,
        error: "Akses deploy ditolak: hanya boleh diakses melalui loopback localhost (127.0.0.1 / ::1).",
      };
    }
  }

  return { allowed: true, status: 200 };
}

export function deployGuardResponse(guard: DeployGuardResult): Response | null {
  if (guard.allowed) return null;
  if (guard.status === 404) {
    return new Response(JSON.stringify({ error: "Not Found", status: 404 }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: guard.error, status: 403 }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
