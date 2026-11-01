import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import { getDeployRuns, getDeployRunDetail } from "@/services/deploy-runner.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");

    if (runId) {
      const detail = await getDeployRunDetail(runId);
      if (!detail) {
        return Response.json({ error: "Deploy run tidak ditemukan" }, { status: 404 });
      }
      return Response.json({ data: detail });
    }

    const status = url.searchParams.get("status") || undefined;
    const jenis = url.searchParams.get("jenis") || undefined;

    let runs = await getDeployRuns({ limit: 50 });

    if (status && status !== "all") {
      runs = runs.filter((r) => r.status === status);
    }
    if (jenis && jenis !== "all") {
      runs = runs.filter((r) => r.jenis === jenis);
    }

    return Response.json({
      data: {
        runs,
        total: runs.length,
      },
    });
  });
}
