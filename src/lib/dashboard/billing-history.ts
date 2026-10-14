import type { BillingSyncRun } from "./billing";

export type SyncRunStatusFilter = "all" | "success" | "failed";

export function filterSyncRuns(
  runs: readonly BillingSyncRun[],
  filter: SyncRunStatusFilter,
): BillingSyncRun[] {
  return filter === "all"
    ? [...runs]
    : runs.filter((run) => run.status === filter);
}

export interface SyncHistorySummary {
  total: number;
  success: number;
  failed: number;
  successRatePercent: number;
  averageDurationSeconds: number;
}

export function summarizeSyncHistory(
  runs: readonly BillingSyncRun[],
): SyncHistorySummary {
  const total = runs.length;
  const success = runs.filter((run) => run.status === "success").length;
  const duration = runs.reduce(
    (sum, run) => sum + Math.max(0, run.finishedAt - run.startedAt),
    0,
  );
  return {
    total,
    success,
    failed: total - success,
    successRatePercent: total === 0 ? 0 : Math.round((success / total) * 100),
    averageDurationSeconds: total === 0 ? 0 : Math.round(duration / total),
  };
}
