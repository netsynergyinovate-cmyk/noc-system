import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import { getDeployTarget, detectConnectionPath } from "@/services/deploy-targets.service";
import { getDecryptedSshCredential } from "@/services/ssh-credentials.service";
import { testSshConnection } from "@/services/ssh-client.service";
import { z } from "zod";

export const runtime = "nodejs";

const testSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().optional(),
  sshUser: z.string().optional(),
  mode: z.enum(["lan", "tailscale", "tunnel"]).optional(),
  tailscaleHost: z.string().optional().nullable(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  password: z.string().optional(),
});

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const body = await request.json().catch(() => ({}));
    const parsed = testSchema.safeParse(body);

    const savedTarget = await getDeployTarget();

    const host = parsed.data?.host || savedTarget?.host;
    const port = parsed.data?.port || savedTarget?.port || 22;
    const sshUser = parsed.data?.sshUser || savedTarget?.sshUser;
    const mode = parsed.data?.mode || savedTarget?.mode || "lan";
    const tailscaleHost = parsed.data?.tailscaleHost ?? savedTarget?.tailscaleHost;

    if (!host || !sshUser) {
      return Response.json(
        { error: "Host dan user SSH belum dikonfigurasi." },
        { status: 400 },
      );
    }

    let privateKey = parsed.data?.privateKey;
    let passphrase = parsed.data?.passphrase;
    let password = parsed.data?.password;

    if (!privateKey && !password && savedTarget) {
      const savedCred = await getDecryptedSshCredential(savedTarget.id);
      if (savedCred) {
        privateKey = savedCred.privateKey;
        passphrase = passphrase || savedCred.passphrase;
        password = password || savedCred.password;
      }
    }

    if (!privateKey && !password) {
      return Response.json(
        { error: "Kredensial SSH (Password atau Kunci Privat) belum disimpan atau dimasukkan." },
        { status: 400 },
      );
    }

    // Tentukan jalur koneksi aktif
    const targetObj = { host, port, mode, sshUser, tailscaleHost: tailscaleHost || null };
    const detection = await detectConnectionPath(targetObj);

    const testResult = await testSshConnection(
      targetObj,
      { privateKey, passphrase, password },
      detection.resolvedHost,
    );

    return Response.json({
      ok: testResult.success,
      data: {
        testResult,
        detection,
      },
    });
  });
}
