import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { viewportCustomersQuerySchema } from "@/validators/customer-location";
import { getCustomersByViewport } from "@/services/customer-location.service";

export const runtime = "nodejs";

/**
 * GET /api/map/customers/viewport
 * Mengambil daftar titik pelanggan tergeocoded yang berada di dalam area pandang (viewport) peta Leaflet.
 * Mendukung bounding box koordinat (minLat, maxLat, minLng, maxLng / south, north, west, east / bbox).
 */
export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const rawParams = {
        minLat: url.searchParams.get("minLat") ?? undefined,
        maxLat: url.searchParams.get("maxLat") ?? undefined,
        minLng: url.searchParams.get("minLng") ?? undefined,
        maxLng: url.searchParams.get("maxLng") ?? undefined,
        south: url.searchParams.get("south") ?? undefined,
        north: url.searchParams.get("north") ?? undefined,
        west: url.searchParams.get("west") ?? undefined,
        east: url.searchParams.get("east") ?? undefined,
        bbox: url.searchParams.get("bbox") ?? undefined,
        buffer: url.searchParams.get("buffer") ?? undefined,
        zoom: url.searchParams.get("zoom") ?? undefined,
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
        forceMock: url.searchParams.get("forceMock") ?? undefined,
      };

      const parsed = viewportCustomersQuerySchema.safeParse(rawParams);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Parameter query viewport pelanggan peta tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const result = await getCustomersByViewport(parsed.data);

      return NextResponse.json({
        ok: true,
        success: true,
        data: result.customers,
        summary: result.summary,
        dataSource: result.dataSource,
      });
    } catch (err) {
      console.error("[GET MAP CUSTOMERS VIEWPORT ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
    }
  });
}
