import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { alertThresholds, auditLog } from "@/db/schema";
import {
  applyRows,
  mergeThresholds,
  toRows,
} from "@/lib/dashboard/threshold-rows";
import {
  changedThresholds,
  countThresholdErrors,
  defaultThresholds,
  validateThresholds,
  type ThresholdValues,
} from "@/lib/dashboard/thresholds";

export class ThresholdValidationError extends Error {
  constructor() {
    super("Nilai ambang di luar batas yang diizinkan.");
    this.name = "ThresholdValidationError";
  }
}

export async function getThresholds(): Promise<ThresholdValues> {
  return applyRows(await db.select().from(alertThresholds));
}

export async function updateThresholds(
  values: Partial<ThresholdValues>,
  userId?: string,
): Promise<ThresholdValues> {
  const current = await getThresholds();
  const merged = mergeThresholds(current, values);
  if (countThresholdErrors(validateThresholds(merged)) > 0) {
    throw new ThresholdValidationError();
  }
  const changes = changedThresholds(current, merged);
  if (changes.length === 0) return current;

  await db.transaction(async (tx) => {
    for (const row of toRows(merged)) {
      await tx
        .insert(alertThresholds)
        .values({ ...row, updatedBy: userId ?? null })
        .onConflictDoUpdate({
          target: alertThresholds.ruleKind,
          set: {
            threshold: row.threshold,
            forSeconds: row.forSeconds,
            updatedBy: userId ?? null,
            updatedAt: sql`now()`,
          },
        });
    }
    await tx.insert(auditLog).values({
      userId: userId ?? null,
      action: "update_thresholds",
      target: "alert_thresholds",
      detail: { changes },
    });
  });
  return merged;
}

export async function resetThresholds(
  userId?: string,
): Promise<ThresholdValues> {
  const current = await getThresholds();
  await db.transaction(async (tx) => {
    await tx.delete(alertThresholds);
    await tx.insert(auditLog).values({
      userId: userId ?? null,
      action: "reset_thresholds",
      target: "alert_thresholds",
      detail: { changes: changedThresholds(current, defaultThresholds()) },
    });
  });
  return defaultThresholds();
}
