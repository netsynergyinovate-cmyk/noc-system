import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";
import { getDeployTarget, detectConnectionPath } from "@/services/deploy-targets.service";
import { getDecryptedSshCredential } from "@/services/ssh-credentials.service";
import { executeDeployRun } from "@/services/deploy-runner.service";
import { getAppVersion } from "@/services/deploy-version.service";
import { db } from "@/db";
import { deployRuns } from "@/db/schema/deploy-runs";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    // Larang mutasi deploy oleh API Key eksternal
    if ("apiKeyId" in session && session.apiKeyId) {
      return Response.json(
        { error: "API Key tidak diizinkan untuk operasi deploy." },
        { status: 403 },
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

    // Periksa apakah ada deploy yang sedang berjalan (advisory DB lock)
    const activeRuns = await db
      .select()
      .from(deployRuns)
      .where(eq(deployRuns.status, "berjalan"))
      .limit(1);

    if (activeRuns.length > 0) {
      return Response.json(
        {
          error: "Ada proses deploy lain yang sedang berjalan. Tunggu hingga selesai.",
          runId: activeRuns[0].id,
        },
        { status: 409 },
      );
    }

    const detection = await detectConnectionPath(target);
    const versionInfo = await getAppVersion();

    // Buat entri deploy_runs lebih dulu agar runId segera tersedia
    const [run] = await db
      .insert(deployRuns)
      .values({
        targetId: target.id,
        versi: versionInfo.fullVersion,
        jenis: "deploy",
        status: "berjalan",
        dijalankanOleh: session.user?.email || "Operator",
      })
      .returning();

    // Jalankan deploy di background tanpa memblokir response HTTP (PRD Goal #1)
    void executeDeployRun(
      target,
      credential,
      session.user?.email || "Operator",
      detection.resolvedHost,
      run.id,
    ).catch(async (err) => {
      console.error("Background deploy error:", err);
      await db
        .update(deployRuns)
        .set({ status: "gagal", selesai: new Date() })
        .where(eq(deployRuns.id, run.id));
    });

    return Response.json(
      {
        ok: true,
        data: {
          runId: run.id,
          version: versionInfo.fullVersion,
          message: "Proses deploy dimulai. Progres tiap langkah dapat dipantau langsung.",
        },
      },
      { status: 202 },
    );
  });
}
