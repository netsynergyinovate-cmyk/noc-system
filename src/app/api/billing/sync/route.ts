import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { postBillingSync, proxyBilling } from "@/lib/billing-proxy";
import { mockBillingSync, withBillingSource } from "@/lib/dashboard/billing";
import { getBillingSyncState } from "@/services/billing.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return proxyBilling(
    request,
    "/api/v1/billing/sync",
    mockBillingSync,
    (data, source) => withBillingSource(data, source),
    getBillingSyncState,
  );
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
