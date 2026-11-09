import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import {
  createDrawingLayerSchema,
  batchSaveDrawingLayersSchema,
} from "@/validators/map-drawing-layers";
import {
  getMapDrawingLayers,
  createMapDrawingLayer,
  batchSaveMapDrawingLayers,
} from "@/services/map-drawing-layers.service";

export const runtime = "nodejs";

/**
 * GET /api/map/drawing-layers
 * Mengambil daftar lapisan gambar anotasi peta operasional riil dari PostgreSQL.
 */
export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const visibleOnly = url.searchParams.get("visible") === "true";
      const search = url.searchParams.get("search")?.trim() || undefined;

      const data = await getMapDrawingLayers({ visibleOnly, search });
      return NextResponse.json({
        ok: true,
        success: true,
        data: data.layers,
        summary: data.summary,
        dataSource: data.dataSource,
      });
    } catch (err) {
      console.error("[GET MAP DRAWING LAYERS ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

/**
 * POST /api/map/drawing-layers
 * Menyimpan lapisan gambar / anotasi baru ke PostgreSQL nyata.
 */
export async function POST(request: Request) {
  return withApiSession(request, async (session) => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = createDrawingLayerSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data masukan lapisan gambar tidak valid",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const created = await createMapDrawingLayer({
        ...parsed.data,
        createdBy: session.user.id,
      });

      return NextResponse.json(
        {
          ok: true,
          success: true,
          data: created,
        },
        { status: 201 },
      );
    } catch (err) {
      console.error("[POST MAP DRAWING LAYER ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

/**
 * PUT /api/map/drawing-layers
 * Menyimpan seluruh lapisan gambar sekaligus (batch update) ke PostgreSQL dalam satu operasi.
 */
export async function PUT(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = batchSaveDrawingLayersSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data batch simpan lapisan tidak valid",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const updated = await batchSaveMapDrawingLayers(parsed.data.layers);

      return NextResponse.json({
        ok: true,
        success: true,
        message: `${updated.length} lapisan berhasil disimpan ke PostgreSQL operasional`,
        data: updated,
      });
    } catch (err) {
      console.error("[PUT BATCH MAP DRAWING LAYERS ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
