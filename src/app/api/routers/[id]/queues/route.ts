import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import type { QueueStatusFilter } from "@/lib/dashboard/routers";
import { getRouterQueues } from "@/services/router-queues.service";

export const runtime = "nodejs";

const STATUSES: readonly QueueStatusFilter[] = ["all", "active", "disabled"];

export const GET = (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
  withApiSession(request, async () => {
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const q = (sp.get("q") ?? "").slice(0, 100);
    const s = sp.get("status") as QueueStatusFilter | null;
    const queues = await getRouterQueues(
      id,
      q,
      s && STATUSES.includes(s) ? s : "all",
    );
    return NextResponse.json({ data: queues });
  });
