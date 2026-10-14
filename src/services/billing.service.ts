import "server-only";

import { db } from "@/db";
import {
  auditLog,
  billingMismatches,
  billingStatus,
  billingSyncRuns,
  customers,
  routers,
} from "@/db/schema";
import {
  type BillingMatch,
  type BillingOverview,
  type BillingRow,
  type BillingSyncRun,
  type BillingSyncState,
  type BillingUnmatched,
  type UnmatchedReason,
} from "@/lib/dashboard/billing";
import type { BillingStatus } from "@/db/schema/customers";
import type { MismatchResolutionAction, UpdateMismatchInput } from "@/validators/billing";
import { desc, eq, isNotNull, sql } from "drizzle-orm";

const SYNC_INTERVAL_SECONDS = 3_600;
const HISTORY_LIMIT = 24;

export interface MismatchResolutionRecord {
  mismatchKey: string;
  action: MismatchResolutionAction;
  notes?: string;
  resolvedBy: string;
  resolvedAt: string;
}

// Penyimpanan in-memory penandaan selisih billing antar-request
const mismatchResolutions = new Map<string, MismatchResolutionRecord>();

/**
 * Memperbarui penandaan ketidaksesuaian billing oleh operator.
 */
export async function updateMismatchResolution(
  input: UpdateMismatchInput,
  resolvedBy: string,
  userId?: string,
): Promise<MismatchResolutionRecord> {
  const now = new Date().toISOString();
  const record: MismatchResolutionRecord = {
    mismatchKey: input.mismatchKey,
    action: input.action,
    notes: input.notes?.trim() || undefined,
    resolvedBy,
    resolvedAt: now,
  };

  mismatchResolutions.set(input.mismatchKey, record);

  try {
    await db.insert(auditLog).values({
      userId: userId || null,
      action: "billing_mismatch_resolve",
      target: input.mismatchKey,
      detail: record as unknown as Record<string, unknown>,
    });
  } catch {
    // Abaikan jika database offline
  }

  return record;
}

/**
 * Mengambil semua penandaan ketidaksesuaian billing.
 */
export async function getMismatchResolutions(): Promise<MismatchResolutionRecord[]> {
  return Array.from(mismatchResolutions.values());
}

/**
 * Mengambil satu penandaan ketidaksesuaian billing berdasarkan kunci.
 */
export async function getMismatchResolution(
  key: string,
): Promise<MismatchResolutionRecord | null> {
  return mismatchResolutions.get(key) || null;
}

/**
 * Menghapus penandaan ketidaksesuaian billing.
 */
export async function deleteMismatchResolution(
  key: string,
  userId?: string,
): Promise<boolean> {
  const existed = mismatchResolutions.delete(key);
  if (existed) {
    try {
      await db.insert(auditLog).values({
        userId: userId || null,
        action: "billing_mismatch_clear",
        target: key,
        detail: { mismatchKey: key },
      });
    } catch {
      // Abaikan jika database offline
    }
  }
  return existed;
}

/**
 * Membaca keadaan sinkron billing dari database (billing_sync_runs).
 */
export async function getBillingSyncState(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<BillingSyncState> {
  const [runningRun] = await db
    .select()
    .from(billingSyncRuns)
    .where(eq(billingSyncRuns.status, "running"))
    .limit(1);

  const finishedRows = await db
    .select()
    .from(billingSyncRuns)
    .where(isNotNull(billingSyncRuns.finishedAt))
    .orderBy(desc(billingSyncRuns.finishedAt), desc(billingSyncRuns.id))
    .limit(HISTORY_LIMIT);

  const nextRunAt = (Math.floor(nowSec / SYNC_INTERVAL_SECONDS) + 1) * SYNC_INTERVAL_SECONDS + 300;

  const runs: BillingSyncRun[] = finishedRows.map((r) => {
    const startedAt = Math.floor(r.startedAt.getTime() / 1000);
    const finishedAt = r.finishedAt ? Math.floor(r.finishedAt.getTime() / 1000) : startedAt;
    const status = r.status as "success" | "failed";

    return {
      id: r.id,
      startedAt,
      finishedAt,
      status,
      result:
        status === "success"
          ? {
              invoices: r.invoicesTotal ?? 0,
              matched: (r.matchedExact ?? 0) + (r.matchedNormalized ?? 0),
              unmatched:
                (r.unmatchedUnknown ?? 0) +
                (r.unmatchedDuplicate ?? 0) +
                (r.unmatchedAmbiguous ?? 0),
              withoutInvoice: r.customersWithoutInvoice ?? 0,
            }
          : null,
      error: status === "failed" ? r.errorMessage : null,
    };
  });

  return {
    intervalSeconds: SYNC_INTERVAL_SECONDS,
    running: runningRun ? { startedAt: Math.floor(runningRun.startedAt.getTime() / 1000) } : null,
    nextRunAt,
    runs,
  };
}

/**
 * Membaca ringkasan status billing nyata beserta penanda selisih (mismatch/unmatched).
 */
export async function getBillingOverview(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<BillingOverview> {
  const sync = await getBillingSyncState(nowSec);

  // Ambil data pelanggan dengan status billing dan router
  const rawRows = await db
    .select({
      customerId: customers.id,
      name: customers.name,
      pppoeUsername: customers.pppoeUsername,
      routerId: customers.routerId,
      routerName: sql<string>`coalesce(${routers.name}, 'Router tidak dikenal')`,
      custStatus: customers.billingStatus,
      bsStatus: billingStatus.status,
      matchKind: billingStatus.matchKind,
      invoiceRef: billingStatus.invoiceRef,
      billingName: billingStatus.billingName,
    })
    .from(customers)
    .leftJoin(billingStatus, eq(billingStatus.customerId, customers.id))
    .leftJoin(routers, eq(routers.id, customers.routerId))
    .orderBy(customers.name, customers.pppoeUsername, customers.id);

  const rows: BillingRow[] = rawRows.map((c) => {
    const isMatched = c.matchKind === "exact" || c.matchKind === "normalized";
    const match: BillingMatch = isMatched ? (c.matchKind as BillingMatch) : "none";
    const status: BillingStatus = (c.bsStatus ?? c.custStatus ?? "lunas") as BillingStatus;

    return {
      customerId: c.customerId,
      name: c.name,
      pppoeUsername: c.pppoeUsername,
      routerId: c.routerId,
      routerName: c.routerName,
      status,
      match,
      invoiceRef: isMatched ? c.invoiceRef : null,
      billingName: isMatched ? c.billingName : null,
    };
  });

  // Ambil selisih / tagihan tak bertuan dari sinkron sukses terbaru
  const [latestSuccess] = await db
    .select({ id: billingSyncRuns.id })
    .from(billingSyncRuns)
    .where(eq(billingSyncRuns.status, "success"))
    .orderBy(desc(billingSyncRuns.finishedAt), desc(billingSyncRuns.id))
    .limit(1);

  let unmatched: BillingUnmatched[] = [];
  if (latestSuccess) {
    const rawMismatches = await db
      .select()
      .from(billingMismatches)
      .where(eq(billingMismatches.runId, latestSuccess.id))
      .orderBy(billingMismatches.id);

    unmatched = rawMismatches.map((m) => ({
      invoiceRef: m.invoiceRef ?? "",
      pppoeUsername: m.invoiceName,
      status: m.invoiceStatus as BillingStatus,
      reason: m.reason as UnmatchedReason,
    }));
  }

  return {
    sync,
    rows,
    unmatched,
  };
}
