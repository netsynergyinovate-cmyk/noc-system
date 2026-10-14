import { withApiSession } from "@/lib/api";
import {
  getRealSystemHealthChecks,
  getRealDeploySafetyOverview,
} from "@/services/deploy-safety.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const [overview, healthChecks] = await Promise.all([
      getRealDeploySafetyOverview(),
      getRealSystemHealthChecks(),
    ]);

    return Response.json({
      data: {
        overview,
        healthChecks,
        checkedAt: new Date().toISOString(),
      },
    });
  });
}
