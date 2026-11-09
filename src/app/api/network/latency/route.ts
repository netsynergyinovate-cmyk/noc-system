import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getNetworkLatencyOverview } from "@/services/network-latency.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const summary = await getNetworkLatencyOverview();
    return NextResponse.json({ ok: true, data: summary });
  });
}
