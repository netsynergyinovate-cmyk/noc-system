import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getDashboardKpiMetrics } from "@/services/dashboard-metrics.service";

export const runtime = "nodejs";

export const GET = (request: Request) =>
  withApiSession(request, async () => {
    const metrics = await getDashboardKpiMetrics();
    return NextResponse.json({ data: metrics });
  });
