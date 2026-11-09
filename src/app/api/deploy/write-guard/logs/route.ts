import { withApiPermission } from "@/lib/api";
import {
  evaluateDeployAccess,
  deployGuardResponse,
} from "@/lib/deploy/role-guard";
import { db } from "@/db";
import { deployWriteGuardLogs } from "@/db/schema/deploy-runs";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    try {
      const logs = await db
        .select()
        .from(deployWriteGuardLogs)
        .orderBy(desc(deployWriteGuardLogs.blockedAt))
        .limit(100);

      return Response.json({ success: true, data: logs });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Gagal memuat log penjaga tulis";
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  });
}

export function DELETE(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    try {
      await db.delete(deployWriteGuardLogs);
      return Response.json({
        success: true,
        message: "Log berhasil dibersihkan",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Gagal membersihkan log";
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  });
}
