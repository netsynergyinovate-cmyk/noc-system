import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { geocodedCustomersQuerySchema } from "@/validators/customer-location";
import { getGeocodedCustomers } from "@/services/customer-location.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const rawParams = {
        status: url.searchParams.get("status") ?? undefined,
        odp: url.searchParams.get("odp") ?? undefined,
        region: url.searchParams.get("region") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        routerId: url.searchParams.get("routerId") ?? undefined,
        billingStatus: url.searchParams.get("billingStatus") ?? undefined,
        opticalStatus: url.searchParams.get("opticalStatus") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
        offset: url.searchParams.get("offset") ?? undefined,
      };

      const parsed = geocodedCustomersQuerySchema.safeParse(rawParams);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Parameter query daftar pelanggan berkoordinat tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const result = await getGeocodedCustomers(parsed.data);

      return NextResponse.json({
        ok: true,
        success: true,
        data: result.customers,
        summary: result.summary,
        dataSource: result.dataSource,
      });
    } catch (err) {
      console.error("[GET GEOCODED CUSTOMERS ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
    }
  });
}
