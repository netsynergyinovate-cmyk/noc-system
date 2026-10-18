import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getCriticalOpticalOnus } from "@/services/critical-optics.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 6)));
    const items = await getCriticalOpticalOnus(limit);
    return NextResponse.json({ ok: true, data: items });
  });
}

