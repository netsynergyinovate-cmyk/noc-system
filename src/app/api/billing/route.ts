import { proxyBilling } from "@/lib/billing-proxy";
import { mockBillingOverview, overviewWithSource } from "@/lib/dashboard/billing";
import { getBillingOverview } from "@/services/billing.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return proxyBilling(
    request,
    "/api/v1/billing",
    mockBillingOverview,
    (data, source) => overviewWithSource(data, source),
    getBillingOverview,
  );
}
