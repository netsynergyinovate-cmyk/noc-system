import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import {
  getCableMapData,
  getCablesByZoom,
  createCable,
} from "@/services/cable-map.service";
import { cableZoomQuerySchema } from "@/validators/cable-query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      if (
        !body?.name ||
        !body?.sourceId ||
        !Array.isArray(body?.polyline) ||
        body.polyline.length < 2
      ) {
        return NextResponse.json(
          { ok: false, error: "Data tidak lengkap." },
          { status: 400 },
        );
      }
      const result = await createCable({
        name: String(body.name),
        sourceId: String(body.sourceId),
        targetId: body.targetId ? String(body.targetId) : null,
        cableType: body.cableType || "distribution",
        coreCapacity: Number(body.coreCapacity) || 12,
        color: body.color || "#3b82f6",
        polyline: body.polyline,
      });
      return NextResponse.json({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const hasZoom = url.searchParams.has("zoom");

      if (hasZoom) {
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
        if (parsed.success) {
          const zoomResult = await getCablesByZoom(parsed.data);
          return NextResponse.json(zoomResult, {
            headers: {
              "Cache-Control": "private, no-cache, no-store, must-revalidate",
            },
          });
        }
      }

      const data = await getCableMapData();
      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    } catch (error) {
      console.error("[GET_CABLE_MAP_API_ERROR]", error);
      const msg =
        error instanceof Error
          ? error.message
          : "Gagal mengambil data jalur kabel jaringan";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
