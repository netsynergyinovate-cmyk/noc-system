import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { pingFromRouter } from "@/services/router-ping.service";

export const runtime = "nodejs";

export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  withApiSession(request, async () => {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { target?: string; count?: number };
    const target = body.target || "8.8.8.8";
    const count = Number(body.count) || 4;

    try {
      const result = await pingFromRouter(id, target, count);
      return NextResponse.json({ data: result });
    } catch (e) {
      return NextResponse.json(
        { error: { message: e instanceof Error ? e.message : "Gagal mengeksekusi ping dari router." } },
        { status: 400 },
      );
    }
  });

