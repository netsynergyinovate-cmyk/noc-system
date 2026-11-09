import { withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { postBillingSync } from "@/lib/billing-proxy";
import { withBillingSource } from "@/lib/dashboard/billing";
import { getBillingSyncState } from "@/services/billing.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const sync = await getBillingSyncState();
    return Response.json(withBillingSource(sync, "live"));
  });
}

// Sinkron manual. Hanya peran dengan billing:manage (admin); anonim 401.
export function POST(request: Request) {
  const audit = withAudit({
    action: "billing-sync",
    getTarget: () => "/api/billing/sync",
  });
  return withApiPermission(
    request,
    { billing: ["manage"] },
    audit(request, async (session) => postBillingSync(session.user.id)),
  );
}
