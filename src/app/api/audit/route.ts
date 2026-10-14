import { withApiSession } from "@/lib/api";
import { mockAuditLog } from "@/lib/dashboard/audit";
import { getAuditEntries } from "@/services/audit.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const beforeRaw = url.searchParams.get("before");
    const action = url.searchParams.get("action") || undefined;
    const userId = url.searchParams.get("userId") || undefined;
    const q = url.searchParams.get("q") || undefined;

    let limit = 50;
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 500) {
        limit = parsed;
      }
    }

    let before: number | undefined;
    if (beforeRaw) {
      const parsed = parseInt(beforeRaw, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        before = parsed;
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const realEntries = await getAuditEntries({
      limit,
      before,
      action,
      userId,
      q,
      nowSec,
    });

    const entries =
      realEntries.length > 0 ? realEntries : mockAuditLog(nowSec).slice(0, limit);

    return Response.json({
      ok: true,
      entries,
      data: entries,
      total: entries.length,
    });
  });
}
