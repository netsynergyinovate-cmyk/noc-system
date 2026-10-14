import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getRouterResourcesSummary } from "@/services/router-resources.service";

export const runtime = "nodejs";

export const GET = (request: Request) =>
  withApiSession(request, async () => {
    const result = await getRouterResourcesSummary();
    return NextResponse.json({ data: result });
  });
