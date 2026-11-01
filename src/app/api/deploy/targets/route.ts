import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import {
  getDeployTarget,
  saveDeployTarget,
  detectConnectionPath,
} from "@/services/deploy-targets.service";
import { z } from "zod";

export const runtime = "nodejs";

const saveTargetSchema = z.object({
  nama: z.string().optional(),
  host: z.string().min(1, "Host wajib diisi"),
  port: z.number().int().min(1).max(65535).default(22),
  sshUser: z.string().min(1, "User SSH wajib diisi"),
  mode: z.enum(["lan", "tailscale", "tunnel"]).default("lan"),
  tailscaleHost: z.string().optional().nullable(),
  connectionReason: z.string().optional().nullable(),
  deviceAccessLevel: z.enum(["simulator", "baca-saja", "penuh"]).default("simulator"),
});

export async function GET(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const target = await getDeployTarget();
    let detection = null;

    if (target) {
      detection = await detectConnectionPath(target);
    }

    return Response.json({
      data: {
        target,
        detection,
      },
    });
  });
}

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json(
        { error: "API Key tidak diizinkan untuk mengubah target deploy." },
        { status: 403 },
      );
    }
    const body = await request.json().catch(() => ({}));
    const parsed = saveTargetSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: "Validasi gagal",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

    const saved = await saveDeployTarget(parsed.data);
    const detection = await detectConnectionPath(saved);

    return Response.json({
      ok: true,
      data: {
        target: saved,
        detection,
      },
    });
  });
}
