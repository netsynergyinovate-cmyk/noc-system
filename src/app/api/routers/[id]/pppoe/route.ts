import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getRouterPppoeSessions } from "@/services/router-pppoe.service";

export const runtime = "nodejs";

export const GET = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  withApiSession(request, async () => {
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const q = (sp.get("q") ?? "").slice(0, 100);
    const sessions = await getRouterPppoeSessions(id, q);
    return NextResponse.json({ data: sessions });
  });

