import { withApiSession } from "@/lib/api";
import {
  getRollbackHistoryEvents,
  recordMigrationRollbackEvent,
} from "@/services/migration-rollback-runner.service";
import type { MigrationRollbackEvent } from "@/lib/dashboard/deploy-safety";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    const status = url.searchParams.get("status");

    let history = await getRollbackHistoryEvents();

    if (status && status !== "all") {
      history = history.filter((h) => h.status === status);
    }

    if (search) {
      history = history.filter(
        (h) =>
          h.migrationFile.toLowerCase().includes(search) ||
          h.reason.toLowerCase().includes(search) ||
          h.affectedTables.some((t) => t.toLowerCase().includes(search)),
      );
    }

    return Response.json({
      data: {
        history,
        total: history.length,
        retrievedAt: new Date().toISOString(),
      },
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: Partial<MigrationRollbackEvent> = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(
        { error: "Payload JSON tidak valid" },
        { status: 400 },
      );
    }

    if (!body.migrationFile || !body.reason) {
      return Response.json(
        { error: "migrationFile dan reason wajib diisi" },
        { status: 422 },
      );
    }

    const event = await recordMigrationRollbackEvent({
      migrationFile: body.migrationFile,
      targetVersion: body.targetVersion ?? "versi_stabil_sebelumnya",
      reason: body.reason,
      remediationHint:
        body.remediationHint ??
        "Periksa kembali berkas migrasi SQL dan integritas skema database.",
      status: body.status ?? "success",
      affectedTables: body.affectedTables ?? ["database_schema"],
      durationMs: body.durationMs ?? 150,
      actor: body.actor ?? "system_safeguard",
      executedAt: new Date().toISOString(),
      revertStatementsCount: body.revertStatementsCount ?? 1,
    });

    return Response.json(
      {
        data: event,
        message: `Kejadian rollback untuk ${event.migrationFile} berhasil dicatat.`,
      },
      { status: 201 },
    );
  });
}
