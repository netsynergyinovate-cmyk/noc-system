import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import { getDeployTarget } from "@/services/deploy-targets.service";
import {
  getSshCredentialMeta,
  saveSshCredential,
  deleteSshCredential,
} from "@/services/ssh-credentials.service";
import { z } from "zod";

export const runtime = "nodejs";

const saveKeySchema = z
  .object({
    targetId: z.string().optional(),
    authType: z.enum(["key", "password"]).optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional().nullable(),
    password: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.authType === "password" || (data.password && !data.privateKey)) {
        return Boolean(data.password && data.password.trim().length > 0);
      }
      return Boolean(data.privateKey && data.privateKey.trim().length >= 20);
    },
    {
      message: "Wajib mengisi Password SSH atau Kunci Privat SSH (minimal 20 karakter).",
    },
  );

export async function GET(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const target = await getDeployTarget();
    if (!target) {
      return Response.json({ data: null });
    }

    const meta = await getSshCredentialMeta(target.id);
    return Response.json({ data: meta });
  });
}

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json({ error: "API Key tidak diizinkan untuk menyimpan kunci SSH." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const parsed = saveKeySchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: "Validasi gagal", details: parsed.error.format() },
        { status: 400 },
      );
    }

    let targetId = parsed.data.targetId;
    if (!targetId) {
      const target = await getDeployTarget();
      if (!target) {
        return Response.json(
          { error: "Target SERVER NATIVE belum dikonfigurasi. Simpan target terlebih dahulu." },
          { status: 400 },
        );
      }
      targetId = target.id;
    }

    try {
      const meta = await saveSshCredential(targetId, {
        authType: parsed.data.authType || (parsed.data.password ? "password" : "key"),
        privateKey: parsed.data.privateKey,
        passphrase: parsed.data.passphrase,
        password: parsed.data.password,
      });
      return Response.json({
        ok: true,
        data: meta,
        message: "Kunci privat SSH berhasil disimpan dalam bentuk terenkripsi AES-256-GCM.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 422 });
    }
  });
}

export async function DELETE(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json({ error: "API Key tidak diizinkan untuk menghapus kunci SSH." }, { status: 403 });
    }
    const target = await getDeployTarget();
    if (!target) {
      return Response.json({ error: "Target tidak ditemukan" }, { status: 404 });
    }

    const deleted = await deleteSshCredential(target.id);
    return Response.json({ ok: true, deleted });
  });
}
