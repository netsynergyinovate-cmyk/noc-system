import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateInfrastructureParent } from "@/services/map-infrastructure.service";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parentId = body?.parentId ?? null;
      if (parentId !== null && typeof parentId !== "string") {
        return NextResponse.json({ ok: false, error: "parentId harus string atau null." }, { status: 400 });
      }
      const result = await updateInfrastructureParent(id, parentId);
      return NextResponse.json({ ok: true, data: result, message: "Parent perangkat berhasil diperbarui." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
