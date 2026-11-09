import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getMapLegendMetadata } from "@/services/map-legend.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/map/legend
 * Menyediakan metadata resmi legenda peta: simbol status pelanggan, ikon infrastruktur,
 * kapasitas kabel serat optik (6 tingkatan), Level-of-Detail (LOD), dan panduan gestur interaksi.
 */
export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const legend = getMapLegendMetadata();

      return NextResponse.json(
        {
          ok: true,
          success: true,
          data: legend,
        },
        {
          headers: {
            "Cache-Control": "private, max-age=300, must-revalidate",
          },
        },
      );
    } catch (err) {
      console.error("[GET MAP LEGEND METADATA ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
