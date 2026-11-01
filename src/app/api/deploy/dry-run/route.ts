import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import { getDeployTarget, detectConnectionPath } from "@/services/deploy-targets.service";
import { getDecryptedSshCredential } from "@/services/ssh-credentials.service";
import { runDryRun } from "@/services/deploy-runner.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const target = await getDeployTarget();
    if (!target) {
      return Response.json(
        { error: "Target SERVER NATIVE belum dikonfigurasi." },
        { status: 400 },
      );
    }

    const credential = await getDecryptedSshCredential(target.id);
    if (!credential) {
      return Response.json(
        { error: "Kunci privat SSH belum dikonfigurasi untuk target ini." },
        { status: 400 },
      );
    }

    const detection = await detectConnectionPath(target);
    const result = await runDryRun(target, credential, detection.resolvedHost);

    return Response.json({
      data: {
        ...result,
        detection,
      },
    });
  });
}
