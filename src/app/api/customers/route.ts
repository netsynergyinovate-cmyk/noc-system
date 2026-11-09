import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { asc } from "drizzle-orm";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      if (url.searchParams.get("geocoded") === "true") {
        const { getGeocodedCustomers } =
          await import("@/services/customer-location.service");
        const { geocodedCustomersQuerySchema } =
          await import("@/validators/customer-location");
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
        const result = await getGeocodedCustomers(
          parsed.success ? parsed.data : undefined,
        );
        return NextResponse.json({
          ok: true,
          success: true,
          data: result.customers,
          summary: result.summary,
          dataSource: result.dataSource,
        });
      }

      const rows = await db
        .select({
          id: customers.id,
          name: customers.name,
          pppoeUsername: customers.pppoeUsername,
          routerId: customers.routerId,
          address: customers.address,
          billingStatus: customers.billingStatus,
          opticalPowerDbm: customers.opticalPower,
          isOnline: customers.isOnline,
          latitude: customers.latitude,
          longitude: customers.longitude,
          odpName: customers.odpName,
        })
        .from(customers)
        .orderBy(asc(customers.name));

      return NextResponse.json({
        ok: true,
        success: true,
        data: rows,
      });
    } catch (err) {
      console.error("[GET CUSTOMERS ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
