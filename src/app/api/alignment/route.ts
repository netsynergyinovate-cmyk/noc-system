import { withApiSession } from "@/lib/api";
import {
  getAlignmentStatusAndHistory,
  runDataAlignmentIdempotent,
} from "@/services/data-alignment.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const status = await getAlignmentStatusAndHistory();
    return Response.json({ data: status });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    let body: {
      steps?: Array<"billing_status" | "thresholds" | "customers" | "routers">;
    } = {};
    try {
      body = await request.json();
    } catch {
      // Body opsional
    }

    const actor = session.user.name || session.user.email || "operator";
    const report = await runDataAlignmentIdempotent({
      actor,
      steps: body.steps,
    });

    const status = report.success ? 200 : 500;
    return Response.json({ data: report }, { status });
  });
}
