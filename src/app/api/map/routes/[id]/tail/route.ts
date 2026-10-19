import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getLastOdpInRoute } from "@/services/route.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      if (!id) {
        return NextResponse.json(
          { ok: false, error: "Route ID wajib ditentukan." },
          { status: 400 },
        );
      }
      const tail = await getLastOdpInRoute(id);
      return NextResponse.json({ ok: true, data: tail });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
