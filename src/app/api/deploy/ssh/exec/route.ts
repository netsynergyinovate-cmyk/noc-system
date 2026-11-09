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
import { executeSshCommand } from "@/services/ssh-client.service";
import { z } from "zod";

export const runtime = "nodejs";

const execSchema = z.object({
  command: z.string().min(1, "Perintah tidak boleh kosong"),
  timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
});

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json(
        { error: "API Key tidak diizinkan untuk eksekusi perintah SSH." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = execSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Validasi gagal", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const target = await getDeployTarget();
    if (!target) {
      return Response.json(
        {
          error:
            "Target SERVER NATIVE belum dikonfigurasi. Simpan target terlebih dahulu.",
        },
        { status: 400 },
      );
    }

    const credential = await getDecryptedSshCredential(target.id);
    if (!credential) {
      return Response.json(
        { error: "Kredensial SSH belum disimpan untuk target ini." },
        { status: 400 },
      );
    }

    const detection = await detectConnectionPath(target);
    const host = detection.resolvedHost || target.host;

    try {
      const result = await executeSshCommand(
        target,
        credential,
        parsed.data.command,
        host,
        parsed.data.timeoutMs,
      );

      return Response.json({
        ok: result.code === 0,
        data: {
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          host,
          user: target.sshUser,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json(
        { ok: false, error: `Gagal mengeksekusi perintah di server: ${msg}` },
        { status: 500 },
      );
    }
  });
}
