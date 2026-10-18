import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { reorderDrawingLayersSchema } from "@/validators/map-drawing-layers";
import { reorderMapDrawingLayers } from "@/services/map-drawing-layers.service";

export const runtime = "nodejs";

/**
 * POST /api/map/drawing-layers/reorder
 * Memperbarui urutan tumpukan (z-index) banyak lapisan gambar sekaligus.
 */
export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = reorderDrawingLayersSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data urutan lapisan gambar tidak valid",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const updated = await reorderMapDrawingLayers(parsed.data.layers);

      return NextResponse.json({
        ok: true,
        success: true,
        data: updated,
        count: updated.length,
      });
    } catch (err) {
      console.error("[POST MAP DRAWING LAYERS REORDER ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

/**
 * PATCH /api/map/drawing-layers/reorder
 * Alias untuk memperbarui urutan z-index lapisan.
 */
export async function PATCH(request: Request) {
  return POST(request);
}
