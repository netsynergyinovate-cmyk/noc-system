import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { deleteCable, updateCableColor } from "@/services/cable-map.service";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const color = body?.color;
      if (
        !color ||
        typeof color !== "string" ||
        !/^#[0-9a-fA-F]{3,8}$/.test(color)
      ) {
        return NextResponse.json(
          { ok: false, error: "Format warna tidak valid." },
          { status: 400 },
        );
      }
      const result = await updateCableColor(id, color);
      return NextResponse.json({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const result = await deleteCable(id);
      return NextResponse.json({
        ok: true,
        data: result,
        message: "Jalur kabel berhasil dihapus dari peta.",
      });
    } catch (err) {
      console.error("[DELETE CABLE ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
