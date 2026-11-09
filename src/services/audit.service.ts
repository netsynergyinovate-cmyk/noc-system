import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, user } from "@/db/schema";
import { sanitizeAuditDetail } from "@/lib/audit-sanitize";
import {
  auditWhere,
  clampAuditLimit,
  type AuditQueryOptions,
} from "@/lib/audit-query";

export { sanitizeAuditDetail };

// Pencatat gagal-aman: kegagalan log tidak boleh merusak alur aplikasi.
export async function recordAudit({
  userId,
  action,
  target,
  detail,
}: {
  userId?: string | null;
  action: string;
  target: string;
  detail?: Record<string, unknown>;
}) {
  try {
    const [inserted] = await db
      .insert(auditLog)
      .values({
        userId: userId ?? null,
        action,
        target,
        detail: sanitizeAuditDetail(detail ?? {}),
      })
      .returning();
    return inserted;
  } catch (error) {
    console.error(
      "Audit log gagal ditulis:",
      error instanceof Error ? error.name : "UnknownError",
    );
    return null;
  }
}

/**
 * Helper terstruktur untuk mencatat aktivitas operator dengan ringkasan & perubahan.
 */
export async function logOperatorAction({
  userId,
  action,
  target,
  summary,
  changes,
  detail = {},
}: {
  userId?: string | null;
  action: string;
  target: string;
  summary?: string;
  changes?: unknown[];
  detail?: Record<string, unknown>;
}) {
  const mergedDetail: Record<string, unknown> = {
    ...detail,
    ...(summary ? { summary } : {}),
    ...(changes ? { changes } : {}),
  };
  return recordAudit({
    userId,
    action,
    target,
    detail: mergedDetail,
  });
}

export type SyncAuditOperation =
  "seed" | "transfer" | "alignment" | "schema_migration";

/**
 * Mencatat operasi sinkronisasi data (seed, transfer, alignment, migrasi) ke audit_log
 * dengan sanitasi otomatis sehingga kredensial atau connection string tidak pernah bocor.
 */
export async function logSyncOperationAudit({
  userId,
  operation,
  target,
  summary,
  success,
  recordsCount,
  durationMs,
  detail = {},
}: {
  userId?: string | null;
  operation: SyncAuditOperation;
  target: string;
  summary: string;
  success: boolean;
  recordsCount?: number;
  durationMs?: number;
  detail?: Record<string, unknown>;
}) {
  const action = `sync:${operation}`;
  const mergedDetail: Record<string, unknown> = {
    ...detail,
    summary,
    success,
    ...(recordsCount !== undefined ? { recordsCount } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };

  return recordAudit({
    userId,
    action,
    target,
    detail: mergedDetail,
  });
}

export type { AuditQueryOptions };

export function listAuditLogs(options: AuditQueryOptions = {}, maxLimit = 500) {
  return db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      action: auditLog.action,
      target: auditLog.target,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      actorName: user.name,
      actorEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.userId))
    .where(auditWhere(options))
    .orderBy(desc(auditLog.createdAt))
    .limit(clampAuditLimit(options.limit, maxLimit));
}

/**
 * Mengambil daftar jejak aktivitas terformat (terbaru di atas).
 */
export async function getAuditEntries(
  options: {
    limit?: number;
    before?: number;
    action?: string;
    userId?: string;
    q?: string;
    nowSec?: number;
  } = {},
) {
  try {
    const beforeSec = options.before ?? options.nowSec;
    const beforeDate = beforeSec ? new Date(beforeSec * 1000) : undefined;
    const rows = await listAuditLogs({
      limit: options.limit,
      before: beforeDate,
      action: options.action,
      userId: options.userId,
      q: options.q,
    });

    if (rows.length > 0) {
      return rows.map((r) => {
        const detail = (r.detail || {}) as Record<string, unknown>;
        const actorName =
          r.actorName || r.actorEmail || (r.userId ? "Operator" : "Sistem");
        const summary =
          typeof detail.summary === "string" && detail.summary.length > 0
            ? detail.summary
            : `${actorName} melakukan ${r.action} pada ${r.target}`;
        const changes = Array.isArray(detail.changes) ? detail.changes : [];

        return {
          id: r.id,
          at: Math.floor(r.createdAt.getTime() / 1000),
          actor: {
            id: r.userId || "system",
            name: actorName,
          },
          action: r.action,
          target: r.target,
          summary,
          changes,
        };
      });
    }
  } catch {
    // Abaikan jika DB offline
  }

  return [];
}
