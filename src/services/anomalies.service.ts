import "server-only";
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  customers as customersTable,
  routers as routersTable,
  type AlertSeverity,
  type AlertStatus,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import {
  anomalyRules,
  type Anomaly,
  type AnomalyRule,
} from "@/lib/dashboard/anomalies";
import { loadAnomalies } from "@/lib/dashboard/anomaly-feed";
import { loneImpact, mockDirectory } from "@/lib/dashboard/incident-root";
import type { IncidentKind, IncidentSeverity } from "@/lib/dashboard/types";
import {
  getAnomalyTroubleshootingSteps,
  isAnomalyReviewed,
  markAnomalyReviewed,
  type TroubleshootingGuide,
} from "@/lib/dashboard/anomaly-detail-logic";
import type {
  AnomalyQuery,
  CreateAnomalyInput,
  UpdateAnomalyStatusInput,
} from "@/validators/anomalies";

export interface AnomalyItem extends Anomaly {
  routerName?: string;
  customerName?: string;
}

export interface AnomalyListResult {
  anomalies: AnomalyItem[];
  total: number;
  activeCount: number;
  resolvedCount: number;
  rules: AnomalyRule[];
  sourceStatus: "nyata" | "dummy";
}

export interface DetectAnomaliesResult {
  detected: number;
  activeAnomalies: Anomaly[];
  rulesEvaluated: number;
  sourceStatus: "nyata" | "dummy";
}

function mapLogToAnomaly(row: {
  id: string;
  routerId: string | null;
  customerId: string | null;
  type: string;
  severity: string;
  startedAt: Date;
  endedAt: Date | null;
  detail: Record<string, unknown>;
  routerName?: string | null;
  customerName?: string | null;
}): AnomalyItem {
  const detail = (row.detail ?? {}) as Record<string, unknown>;
  const kind = row.type as IncidentKind;
  const severity = row.severity as IncidentSeverity;
  const startedAt = Math.floor(row.startedAt.getTime() / 1000);
  const endedAt = row.endedAt ? Math.floor(row.endedAt.getTime() / 1000) : null;
  const interfaceName = (detail.interfaceName as string) ?? null;
  const measured = typeof detail.measured === "number" ? detail.measured : null;

  const defaultImpact = loneImpact(
    { routerId: row.routerId ?? "", customerId: row.customerId },
    {
      customerName: (id) =>
        row.customerName ??
        (env.DASHBOARD_DATA === "demo" ? mockDirectory.customerName(id) : id),
      routerName: (id) =>
        row.routerName ??
        (env.DASHBOARD_DATA === "demo" ? mockDirectory.routerName(id) : id),
      customersOnRouter: (id) =>
        env.DASHBOARD_DATA === "demo" ? mockDirectory.customersOnRouter(id) : 0,
      customersOnOdp: (r, o) =>
        env.DASHBOARD_DATA === "demo" ? mockDirectory.customersOnOdp(r, o) : 0,
    },
  );
  const rootSource =
    (detail.rootSource as typeof defaultImpact.rootSource) ??
    defaultImpact.rootSource;
  const affectedCustomers =
    typeof detail.affectedCustomers === "number"
      ? detail.affectedCustomers
      : defaultImpact.affectedCustomers;
  const servedCustomers =
    typeof detail.servedCustomers === "number"
      ? detail.servedCustomers
      : defaultImpact.servedCustomers;
  const correlationId =
    (detail.correlationId as string | null) ?? defaultImpact.correlationId;

  return {
    id: row.id,
    kind,
    severity,
    startedAt,
    endedAt,
    routerId: row.routerId ?? "",
    customerId: row.customerId,
    interfaceName,
    measured,
    rootSource,
    affectedCustomers,
    servedCustomers,
    correlationId,
    routerName: row.routerName ?? undefined,
    customerName: row.customerName ?? undefined,
  };
}

/**
 * Mengambil daftar anomali dari basis data network_logs, atau fallback ke mock bila di mode demo.
 */
export async function getAnomaliesList(
  query: AnomalyQuery,
): Promise<AnomalyListResult> {
  const kind = query.kind ?? query.type;

  if (env.DASHBOARD_DATA === "demo") {
    let mockList = await loadAnomalies();
    if (query.status === "active")
      mockList = mockList.filter((a) => a.endedAt === null);
    if (query.status === "resolved")
      mockList = mockList.filter((a) => a.endedAt !== null);
    if (kind) mockList = mockList.filter((a) => a.kind === kind);
    if (query.severity)
      mockList = mockList.filter((a) => a.severity === query.severity);
    if (query.routerId)
      mockList = mockList.filter((a) => a.routerId === query.routerId);
    if (query.customerId)
      mockList = mockList.filter((a) => a.customerId === query.customerId);
    if (query.from)
      mockList = mockList.filter((a) => a.startedAt >= query.from!);
    if (query.to) mockList = mockList.filter((a) => a.startedAt <= query.to!);

    const total = mockList.length;
    const paged = mockList.slice(query.offset, query.offset + query.limit);
    return {
      anomalies: paged,
      total,
      activeCount: mockList.filter((a) => a.endedAt === null).length,
      resolvedCount: mockList.filter((a) => a.endedAt !== null).length,
      rules: anomalyRules,
      sourceStatus: "dummy",
    };
  }

  const conditions: SQL[] = [];

  if (query.status === "active") {
    conditions.push(isNull(alerts.endedAt));
  } else if (query.status === "resolved") {
    conditions.push(isNotNull(alerts.endedAt));
  }

  if (kind) {
    conditions.push(eq(alerts.type, kind as never));
  }
  if (query.severity) {
    conditions.push(eq(alerts.severity, query.severity as never));
  }
  if (query.routerId) {
    conditions.push(eq(alerts.routerId, query.routerId));
  }
  if (query.customerId) {
    conditions.push(eq(alerts.customerId, query.customerId));
  }
  if (query.from) {
    conditions.push(gte(alerts.startedAt, new Date(query.from * 1000)));
  }
  if (query.to) {
    conditions.push(lte(alerts.startedAt, new Date(query.to * 1000)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totals] = await db
    .select({
      total: count(),
      activeCount: sql<number>`count(*) filter (where ${alerts.endedAt} is null)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${alerts.endedAt} is not null)::int`,
    })
    .from(alerts)
    .where(whereClause);

  const total = Number(totals?.total ?? 0);
  if (total === 0) {
    return {
      anomalies: [],
      total: 0,
      activeCount: 0,
      resolvedCount: 0,
      rules: anomalyRules,
      sourceStatus: "nyata",
    };
  }

  const rows = await db
    .select({
      id: alerts.id,
      routerId: alerts.routerId,
      customerId: alerts.customerId,
      type: alerts.type,
      severity: alerts.severity,
      startedAt: alerts.startedAt,
      endedAt: alerts.endedAt,
      detail: alerts.detail,
      routerName: routersTable.name,
      customerName: customersTable.name,
    })
    .from(alerts)
    .leftJoin(routersTable, eq(alerts.routerId, routersTable.id))
    .leftJoin(customersTable, eq(alerts.customerId, customersTable.id))
    .where(whereClause)
    .orderBy(desc(alerts.startedAt))
    .limit(query.limit)
    .offset(query.offset);

  const items = rows.map((r) =>
    mapLogToAnomaly({
      ...r,
      detail: (r.detail ?? {}) as Record<string, unknown>,
    }),
  );

  return {
    anomalies: items,
    total,
    activeCount: Number(totals?.activeCount ?? 0),
    resolvedCount: Number(totals?.resolvedCount ?? 0),
    rules: anomalyRules,
    sourceStatus: "nyata",
  };
}

/**
 * Membuat catatan anomali baru di tabel network_logs.
 */
export async function createAnomaly(
  input: CreateAnomalyInput,
): Promise<AnomalyItem> {
  const [created] = await db
    .insert(alerts)
    .values({
      routerId: input.routerId,
      customerId: input.customerId ?? null,
      type: input.type,
      severity: input.severity,
      status: input.endedAt ? "resolved" : "active",
      startedAt: input.startedAt ?? new Date(),
      endedAt: input.endedAt ?? null,
      detail: {
        interfaceName: input.interfaceName ?? null,
        measured: input.measured ?? null,
        ...(input.detail ?? {}),
      },
    })
    .returning();

  if (!created) {
    throw new ApiError(
      500,
      "CREATE_ANOMALY_FAILED",
      "Gagal menyimpan anomali.",
    );
  }

  return mapLogToAnomaly(created);
}

/**
 * Menyelesaikan catatan anomali dengan mengisi ended_at.
 */
export async function resolveAnomaly(
  id: string,
  endedAt = new Date(),
): Promise<AnomalyItem | null> {
  const [updated] = await db
    .update(alerts)
    .set({
      endedAt,
      status: "resolved",
      endTimeSource: "operator",
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning();

  if (!updated) return null;
  return mapLogToAnomaly(updated);
}

/**
 * Mengambil anomali aktif dari database tanpa evaluasi mandiri di Next.js.
 * Evaluasi anomali ditangani sepenuhnya oleh engine Go (backend/internal/engine).
 */
export async function getActiveAnomaliesFromDB(
  routerId?: string,
): Promise<AnomalyItem[]> {
  const result = await getAnomaliesList({
    status: "active",
    routerId,
    limit: 50,
    offset: 0,
  });
  return result.anomalies;
}

/**
 * Mengambil anomali aktif (read-only) tanpa evaluasi atau penulisan mandiri.
 * Evaluasi diserahkan sepenuhnya ke engine Go.
 */
export async function detectAnomalies(
  options: {
    routerId?: string;
    persist?: boolean;
  } = {},
): Promise<DetectAnomaliesResult> {
  if (env.DASHBOARD_DATA === "demo") {
    const list = await loadAnomalies();
    const active = list.filter((a) => a.endedAt === null);
    return {
      detected: active.length,
      activeAnomalies: active,
      rulesEvaluated: anomalyRules.length,
      sourceStatus: "dummy",
    };
  }

  // Nonaktifkan trigger evaluasi mandiri di Next.js:
  // Serahkan sepenuhnya ke engine Go (backend/internal/engine)
  // Next.js cukup mengambil anomali aktif dari DB:
  const activeAnomalies = await getActiveAnomaliesFromDB(options.routerId);

  return {
    detected: activeAnomalies.length,
    activeAnomalies,
    rulesEvaluated: anomalyRules.length,
    sourceStatus: "nyata",
  };
}

export interface AnomalyDetailResult {
  anomaly: AnomalyItem;
  troubleshooting: TroubleshootingGuide;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  sourceStatus: "nyata" | "dummy";
}

/**
 * Mengambil detail satu anomali lengkap dengan panduan troubleshooting dan status review.
 */
export async function getAnomalyById(id: string): Promise<AnomalyDetailResult> {
  if (env.DASHBOARD_DATA !== "demo") {
    const [row] = await db
      .select({
        id: alerts.id,
        routerId: alerts.routerId,
        customerId: alerts.customerId,
        type: alerts.type,
        severity: alerts.severity,
        startedAt: alerts.startedAt,
        endedAt: alerts.endedAt,
        detail: alerts.detail,
        routerName: routersTable.name,
        customerName: customersTable.name,
      })
      .from(alerts)
      .leftJoin(routersTable, eq(alerts.routerId, routersTable.id))
      .leftJoin(customersTable, eq(alerts.customerId, customersTable.id))
      .where(eq(alerts.id, id))
      .limit(1);

    if (!row) {
      throw new ApiError(404, "ANOMALY_NOT_FOUND", "Anomali tidak ditemukan.");
    }

    const item = mapLogToAnomaly({
      ...row,
      detail: (row.detail ?? {}) as Record<string, unknown>,
    });
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const reviewed = Boolean(detail.reviewed) || isAnomalyReviewed(id);
    const reviewedBy = (detail.reviewedBy as string | null) ?? null;
    const reviewedAt = (detail.reviewedAt as string | null) ?? null;
    const note = (detail.note as string | null) ?? null;

    return {
      anomaly: item,
      troubleshooting: getAnomalyTroubleshootingSteps(item),
      reviewed,
      reviewedBy,
      reviewedAt,
      note,
      sourceStatus: "nyata",
    };
  }
  // Fallback ke mock data
  const mockList = await loadAnomalies();
  const found = mockList.find((a) => a.id === id);
  if (!found) {
    throw new ApiError(404, "ANOMALY_NOT_FOUND", "Anomali tidak ditemukan.");
  }

  const reviewed = isAnomalyReviewed(id);
  return {
    anomaly: found,
    troubleshooting: getAnomalyTroubleshootingSteps(found),
    reviewed,
    reviewedBy: null,
    reviewedAt: null,
    note: null,
    sourceStatus: "dummy",
  };
}

/**
 * Memperbarui status, keparahan, tinjauan, atau catatan anomali.
 */
export async function updateAnomalyStatus(
  id: string,
  update: UpdateAnomalyStatusInput,
): Promise<AnomalyDetailResult> {
  if (env.DASHBOARD_DATA !== "demo") {
    const [existing] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.id, id))
      .limit(1);

    if (!existing) {
      throw new ApiError(404, "ANOMALY_NOT_FOUND", "Anomali tidak ditemukan.");
    }

    const currentDetail = (existing.detail ?? {}) as Record<string, unknown>;
    const newDetail = { ...currentDetail };

    if (update.note !== undefined) {
      newDetail.note = update.note;
    }

    if (update.reviewed === true || update.status === "reviewed") {
      newDetail.reviewed = true;
      newDetail.reviewedBy = update.operator ?? "Operator NOC";
      newDetail.reviewedAt = new Date().toISOString();
      markAnomalyReviewed(id, update.operator ?? "Operator NOC");
    } else if (update.reviewed === false) {
      newDetail.reviewed = false;
      newDetail.reviewedBy = null;
      newDetail.reviewedAt = null;
    }

    const setValues: {
      endedAt?: Date | null;
      status?: AlertStatus;
      severity?: AlertSeverity;
      detail?: Record<string, unknown>;
      updatedAt: Date;
    } = { detail: newDetail, updatedAt: new Date() };

    if (update.status === "resolved") {
      setValues.endedAt = update.endedAt ?? new Date();
      setValues.status = "resolved";
    } else if (update.status === "active") {
      setValues.endedAt = null;
      setValues.status = "active";
    } else if (update.endedAt !== undefined) {
      setValues.endedAt = update.endedAt;
      setValues.status = update.endedAt !== null ? "resolved" : "active";
    }

    if (update.severity) {
      setValues.severity = update.severity;
    }

    await db.update(alerts).set(setValues).where(eq(alerts.id, id));

    return getAnomalyById(id);
  }

  // Fallback mode mock
  const mockList = await loadAnomalies();
  const found = mockList.find((a) => a.id === id);
  if (!found) {
    throw new ApiError(404, "ANOMALY_NOT_FOUND", "Anomali tidak ditemukan.");
  }

  if (update.reviewed || update.status === "reviewed") {
    markAnomalyReviewed(id, update.operator ?? "Operator NOC");
  }

  const updatedMock: AnomalyItem = {
    ...found,
    severity: (update.severity as IncidentSeverity) ?? found.severity,
    endedAt:
      update.status === "resolved"
        ? Math.floor(Date.now() / 1000)
        : update.status === "active"
          ? null
          : found.endedAt,
  };

  return {
    anomaly: updatedMock,
    troubleshooting: getAnomalyTroubleshootingSteps(updatedMock),
    reviewed: Boolean(update.reviewed || isAnomalyReviewed(id)),
    reviewedBy: update.operator ?? null,
    reviewedAt: new Date().toISOString(),
    note: update.note ?? null,
    sourceStatus: "dummy",
  };
}
