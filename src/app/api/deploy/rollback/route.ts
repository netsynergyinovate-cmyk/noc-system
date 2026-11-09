import { withApiPermission } from "@/lib/api";
import {
  evaluateDeployAccess,
  deployGuardResponse,
} from "@/lib/deploy/role-guard";
import {
  getDeployTarget,
  detectConnectionPath,
} from "@/services/deploy-targets.service";
import { getDecryptedSshCredential } from "@/services/ssh-credentials.service";
import { executeManualRollback } from "@/services/deploy-runner.service";
import { z } from "zod";

export const runtime = "nodejs";

const rollbackSchema = z.object({
  targetVersion: z.string().min(1, "Versi target rollback wajib diisi"),
  confirm: z.literal(true, {
    message: "Konfirmasi eksplisit wajib disetujui (confirm: true).",
  }),
});

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json(
        { error: "API Key tidak diizinkan untuk operasi rollback." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = rollbackSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: "Permintaan rollback tidak valid atau belum dikonfirmasi.",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

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
    const result = await executeManualRollback(
      target,
      credential,
      parsed.data.targetVersion,
      session.user?.email || "Operator",
      detection.resolvedHost,
    );

    return Response.json(
      {
        ok: result.success,
        message: result.message,
      },
      { status: result.success ? 200 : 500 },
    );
  });
}
