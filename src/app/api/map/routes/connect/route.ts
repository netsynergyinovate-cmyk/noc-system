import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { connectOdpSchema } from "@/validators/route";
import { connectOdp } from "@/services/route.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = connectOdpSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data koneksi tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }
      await connectOdp(
        parsed.data.childId,
        parsed.data.parentId,
        parsed.data.routeId,
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLoop = msg.includes("loop");
      return NextResponse.json(
        { ok: false, error: msg },
        { status: isLoop ? 422 : 500 },
      );
    }
  });
}
