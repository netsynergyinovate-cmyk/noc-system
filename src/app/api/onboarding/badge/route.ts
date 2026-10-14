import { withApiSession } from "@/lib/api";
import { getConfigurationBadgeSummary } from "@/services/configuration-badge.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const summary = await getConfigurationBadgeSummary();

    return Response.json({
      data: summary,
    });
  });
}
