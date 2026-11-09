import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import {
  getRunsnetOverview,
  getRunsnetCustomers,
  getRunsnetInvoices,
  getRunsnetPayments,
  getDelinquentCustomers,
  getRunsnetCustomerDetail,
  getRunsnetCustomerLive,
} from "@/services/runsnet-billing.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const tab = url.searchParams.get("tab") || "overview";
      const periode = url.searchParams.get("periode") || undefined;
      const statusFilter =
        (url.searchParams.get("status") as
          "all" | "unpaid" | "paid" | undefined) || undefined;
      const custId = url.searchParams.get("custId") || undefined;
      const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
      const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

      if (tab === "customers") {
        const items = await getRunsnetCustomers(limit, offset, statusFilter);
        return NextResponse.json({ ok: true, data: items });
      }

      if (tab === "invoices") {
        const items = await getRunsnetInvoices(
          limit,
          offset,
          periode,
          statusFilter,
        );
        return NextResponse.json({ ok: true, data: items });
      }

      if (tab === "payments") {
        const items = await getRunsnetPayments(limit, offset, periode);
        return NextResponse.json({ ok: true, data: items });
      }

      if (tab === "delinquent") {
        const items = await getDelinquentCustomers(periode);
        return NextResponse.json({ ok: true, data: items });
      }

      if (tab === "customer-live") {
        if (!custId) {
          return NextResponse.json(
            { ok: false, error: "Parameter custId diperlukan" },
            { status: 400 },
          );
        }
        return NextResponse.json({
          ok: true,
          data: await getRunsnetCustomerLive(custId),
        });
      }

      if (tab === "customer-detail") {
        if (!custId) {
          return NextResponse.json(
            { ok: false, error: "Parameter custId diperlukan" },
            { status: 400 },
          );
        }
        const detail = await getRunsnetCustomerDetail(custId);
        return NextResponse.json({ ok: true, data: detail });
      }

      const overview = await getRunsnetOverview(periode);
      return NextResponse.json({ ok: true, data: overview });
    } catch (err) {
      console.error("[RUNSNET GET ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
