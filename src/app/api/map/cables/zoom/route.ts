import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { cableZoomQuerySchema } from "@/validators/cable-query";
import { getCablesByZoom } from "@/services/cable-map.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/cables/zoom
 * Mengambil jalur kabel optik jaringan yang dioptimasi sesuai level zoom peta (Level-of-Detail / LOD)
 * serta mendukung pembatasan batas koordinat viewport (Spatial Culling).
 */
export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const rawParams = {
        zoom: url.searchParams.get("zoom") ?? undefined,
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
        type: url.searchParams.get("type") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        includeDrop: url.searchParams.get("includeDrop") ?? undefined,
        forceMock: url.searchParams.get("forceMock") ?? undefined,
      };

      const parsed = cableZoomQuerySchema.safeParse(rawParams);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Parameter query jalur kabel per zoom tidak valid",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const result = await getCablesByZoom(parsed.data);

      return NextResponse.json(result, {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    } catch (err) {
      console.error("[GET MAP CABLES ZOOM ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
