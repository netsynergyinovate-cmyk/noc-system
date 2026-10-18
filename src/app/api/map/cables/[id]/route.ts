import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { deleteCable } from "@/services/cable-map.service";

export const runtime = "nodejs";

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
