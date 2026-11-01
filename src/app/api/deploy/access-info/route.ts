import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import { getDeployTarget, detectConnectionPath } from "@/services/deploy-targets.service";
import { getDecryptedSshCredential } from "@/services/ssh-credentials.service";
import { executeSshCommand } from "@/services/ssh-client.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json({ error: "API Key tidak diizinkan." }, { status: 403 });
    }
    const target = await getDeployTarget();
    if (!target) {
      return Response.json({ error: "Target belum dikonfigurasi." }, { status: 400 });
    }

    const credential = await getDecryptedSshCredential(target.id);
    if (!credential) {
      return Response.json({ error: "Kredensial SSH belum dikonfigurasi." }, { status: 400 });
    }

    const detection = await detectConnectionPath(target);
    const host = detection.resolvedHost || target.host;
    const url = `http://${host}:3000`;

    let token = "";
    try {
      const tokenRes = await executeSshCommand(
        target,
        credential,
        `grep -E "^MONITOR_TOKEN=" /srv/noc/shared/.env 2>/dev/null | cut -d= -f2- | tr -d '"\\r\\n' || echo ""`,
        host,
        5000,
      );
      token = tokenRes.stdout.trim();
    } catch {
      // non-fatal
    }

    return Response.json(
      {
        ok: true,
        data: {
          url,
          token,
          backendUrl: `http://${host}:8080`,
          host,
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  });
}
