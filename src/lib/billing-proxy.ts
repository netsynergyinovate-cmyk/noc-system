import "server-only";
import { withApiSession } from "@/lib/api";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";

const TIMEOUT_MS = 4_000;
// Sinkron penuh bisa berlangsung menit (batas backend 10 menit).
const MANUAL_SYNC_TIMEOUT_MS = 11 * 60_000;

// Meneruskan sinkron manual (POST) ke backend Go. Dipanggil HANYA dari handler
// yang sudah lolos withApiPermission({ billing: ["manage"] }); tiket yang
// diterbitkan di sini membawa izin "billing:manage" untuk backend. Mode demo atau
// tanpa backend menjawab simulasi sukses. Status 409 dan galat backend diteruskan
// apa adanya (bentuk galat Next.js), tanpa teks mentah.
export async function postBillingSync(userId: string) {
  if (
    env.DASHBOARD_DATA !== "live" ||
    !env.BACKEND_INTERNAL_URL ||
    !env.REALTIME_TOKEN_SECRET
  )
    return Response.json({
      ok: true,
      message: "Sinkronisasi billing (simulasi) berhasil.",
    });
  const { token } = issueRealtimeTicket({
    userId,
    secret: env.REALTIME_TOKEN_SECRET,
    perms: ["billing:manage"],
  });
  let res: Response;
  try {
    res = await fetch(`${env.BACKEND_INTERNAL_URL}/api/v1/billing/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(MANUAL_SYNC_TIMEOUT_MS),
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "BACKEND_UNREACHABLE",
          message: "Backend tidak dapat dihubungi.",
        },
      },
      { status: 502 },
    );
  }
  if (res.status === 200)
    return Response.json({
      ok: true,
      message: "sinkronisasi manual berhasil dijalankan",
    });
  if (res.status === 409)
    return Response.json(
      {
        error: {
          code: "SYNC_IN_PROGRESS",
          message: "sinkronisasi sedang berjalan",
        },
      },
      { status: 409 },
    );
  if (res.status === 503)
    return Response.json(
      {
        error: {
          code: "BILLING_DISABLED",
          message: "Sinkron billing tidak aktif.",
        },
      },
      { status: 503 },
    );
  return Response.json(
    { error: { code: "SYNC_FAILED", message: "Sinkronisasi billing gagal." } },
    { status: 502 },
  );
}

// Meneruskan GET ke backend Go bila mode live; jawaban selalu menyertakan
// `source` ("live" atau "mock"). 503 (billing_disabled), galat lain, atau
// gagal fetch jatuh ke `realFallback` (bila disediakan dan berhasil) atau `mock`.
// `mark` menaruh `source` pada bentuk data.
export function proxyBilling<T>(
  request: Request,
  path: string,
  mock: (nowSec: number) => T,
  mark: (data: T, source: "live" | "mock") => T,
  realFallback?: (nowSec: number) => Promise<T>,
) {
  return withApiSession(request, async (session) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const fallback = async () => {
      if (realFallback) {
        try {
          const realData = await realFallback(nowSec);
          return Response.json(mark(realData, "live"));
        } catch {
          // Abaikan kegagalan DB dan gunakan data tiruan
        }
      }
      return Response.json(mark(mock(nowSec), "mock"));
    };

    if (env.DASHBOARD_DATA !== "live" || !env.BACKEND_INTERNAL_URL)
      return fallback();
    if (!env.REALTIME_TOKEN_SECRET) return fallback();
    try {
      const { token } = issueRealtimeTicket({
        userId: session.user.id,
        secret: env.REALTIME_TOKEN_SECRET,
      });
      const res = await fetch(`${env.BACKEND_INTERNAL_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) return fallback();
      const body = (await res.json()) as { data?: T };
      if (!body || typeof body.data !== "object" || body.data === null)
        return fallback();
      return Response.json(mark(body.data, "live"));
    } catch {
      return fallback(); // backend mati atau timeout
    }
  });
}
