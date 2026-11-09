import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateLayerOpacitySchema } from "@/validators/map-drawing-layers";
import {
  updateMapDrawingLayerOpacity,
  getMapDrawingLayerById,
} from "@/services/map-drawing-layers.service";

export const runtime = "nodejs";

/**
 * PATCH /api/map/drawing-layers/[id]/opacity
 * Memperbarui tingkat transparansi (opacity, 0.0 - 1.0) satu lapisan gambar secara cepat.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const existing = await getMapDrawingLayerById(id);

      if (!existing) {
        return NextResponse.json(
          { ok: false, error: "Lapisan gambar tidak ditemukan" },
          { status: 404 },
        );
      }

      const body = await request.json().catch(() => null);
      const parsed = updateLayerOpacitySchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Nilai transparansi tidak valid (harus berada di rentang 0.0 hingga 1.0)",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const updated = await updateMapDrawingLayerOpacity(
        id,
        parsed.data.opacity,
      );

      return NextResponse.json({
        ok: true,
        success: true,
        data: updated,
      });
    } catch (err) {
      console.error("[PATCH MAP DRAWING LAYER OPACITY ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
