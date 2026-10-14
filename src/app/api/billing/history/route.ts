import { withApiSession } from "@/lib/api";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { mockBillingSync } from "@/lib/dashboard/billing";

export const runtime = "nodejs";

const TIMEOUT_MS = 4_000;

function intParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

// Riwayat sinkron billing berhalaman: { data, total, limit, offset, source }.
// Live: diteruskan ke Go /api/v1/billing/history; selain itu (demo/simulator,
// backend mati, atau galat) jatuh ke riwayat tiruan dari mockBillingSync.
export function GET(request: Request) {
  return withApiSession(request, async (session) => {
    const params = new URL(request.url).searchParams;
    const limit = intParam(params.get("limit"), 24, 1, 100);
    const offset = intParam(params.get("offset"), 0, 0, 1_000_000);
    if (limit === null || offset === null)
      return Response.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "limit harus 1-100 dan offset bilangan bulat >= 0.",
          },
        },
        { status: 400 },
      );

    const mock = () => {
      const runs = mockBillingSync(Math.floor(Date.now() / 1000)).runs;
      return Response.json({
        data: runs.slice(offset, offset + limit),
        total: runs.length,
        limit,
        offset,
        source: "mock",
      });
    };

    if (
      env.DASHBOARD_DATA !== "live" ||
      !env.BACKEND_INTERNAL_URL ||
      !env.REALTIME_TOKEN_SECRET
    )
      return mock();
    try {
      const { token } = issueRealtimeTicket({
        userId: session.user.id,
        secret: env.REALTIME_TOKEN_SECRET,
      });
      const res = await fetch(
        `${env.BACKEND_INTERNAL_URL}/api/v1/billing/history?limit=${limit}&offset=${offset}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (res.status !== 200) return mock();
      const body = (await res.json()) as {
        data?: unknown;
        total?: unknown;
      };
      if (!Array.isArray(body.data) || typeof body.total !== "number")
        return mock();
      return Response.json({
        data: body.data,
        total: body.total,
        limit,
        offset,
        source: "live",
      });
    } catch {
      return mock();
    }
  });
}
