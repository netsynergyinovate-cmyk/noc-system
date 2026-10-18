import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateDrawingLayerSchema } from "@/validators/map-drawing-layers";
import {
  updateMapDrawingLayer,
  deleteMapDrawingLayer,
  getMapDrawingLayerById,
} from "@/services/map-drawing-layers.service";

export const runtime = "nodejs";

/**
 * GET /api/map/drawing-layers/[id]
 * Mengambil detail satu lapisan gambar anotasi berdasarkan ID.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const layer = await getMapDrawingLayerById(id);

      if (!layer) {
        return NextResponse.json(
          { ok: false, error: "Lapisan gambar tidak ditemukan" },
          { status: 404 },
        );
      }

      return NextResponse.json({
        ok: true,
        success: true,
        data: layer,
      });
    } catch (err) {
      console.error("[GET MAP DRAWING LAYER BY ID ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

/**
 * PATCH /api/map/drawing-layers/[id]
 * Memperbarui properti, transparansi, urutan, atau bentuk gambar lapisan anotasi.
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
      const parsed = updateDrawingLayerSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data pembaruan lapisan gambar tidak valid",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const updated = await updateMapDrawingLayer(id, parsed.data);

      return NextResponse.json({
        ok: true,
        success: true,
        data: updated,
      });
    } catch (err) {
      console.error("[PATCH MAP DRAWING LAYER ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

/**
 * DELETE /api/map/drawing-layers/[id]
 * Menghapus lapisan gambar anotasi dari database PostgreSQL.
 */
export async function DELETE(
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

      const success = await deleteMapDrawingLayer(id);

      return NextResponse.json({
        ok: success,
        success,
        message: "Lapisan gambar berhasil dihapus",
      });
    } catch (err) {
      console.error("[DELETE MAP DRAWING LAYER ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
