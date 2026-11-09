import { withApiPermission } from "@/lib/api";
import {
  evaluateDeployAccess,
  deployGuardResponse,
} from "@/lib/deploy/role-guard";
import { db } from "@/db";
import { deployReleases } from "@/db/schema/deploy-runs";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const releases = await db
      .select()
      .from(deployReleases)
      .orderBy(desc(deployReleases.dipasangPada));

    return Response.json({
      data: {
        releases,
        total: releases.length,
      },
    });
  });
}
