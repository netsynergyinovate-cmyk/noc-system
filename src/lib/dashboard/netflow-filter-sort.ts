import type { FlowFilter, NetflowRecord } from "./netflow.ts";

export type FlowSortField =
  "bytes" | "packets" | "throughput" | "duration" | "startedAt";
export type SortDirection = "asc" | "desc";

export interface FlowSortOption {
  field: FlowSortField;
  direction: SortDirection;
}

export interface ExtendedFlowFilter extends FlowFilter {
  // Ukuran minimal bytes (mis. 1 MB = 1_048_576).
  minBytes?: number;
  // Durasi minimal (detik).
  minDurationSec?: number;
}

export const LARGE_FLOW_BYTES = 524_288_000; // 500 MB
export const MASSIVE_FLOW_BYTES = 104_857_600; // 100 MB
export const PERSISTENT_FLOW_SEC = 300;

// Saring tambahan di atas filterFlows: ambang bytes dan durasi minimal.
export function applyExtendedFilter(
  flows: NetflowRecord[],
  filter: Pick<ExtendedFlowFilter, "minBytes" | "minDurationSec">,
): NetflowRecord[] {
  const { minBytes, minDurationSec } = filter;
  if (!minBytes && !minDurationSec) return flows;
  return flows.filter(
    (f) =>
      (!minBytes || f.bytes >= minBytes) &&
      (!minDurationSec || f.durationSec >= minDurationSec),
  );
}

export function flowThroughputBps(f: NetflowRecord): number {
  return (f.bytes * 8) / Math.max(1, f.durationSec);
}

function sortKey(f: NetflowRecord, field: FlowSortField): number {
  switch (field) {
    case "bytes":
      return f.bytes;
    case "packets":
      return f.packets;
    case "throughput":
      return f.bytes / Math.max(1, f.durationSec);
    case "duration":
      return f.durationSec;
    case "startedAt":
      return f.startedAt;
  }
}

// Murni, stabil (tie-breaker id naik), tidak mengubah input.
export function sortFlows(
  flows: NetflowRecord[],
  sortBy: FlowSortField,
  direction: SortDirection,
): NetflowRecord[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...flows].sort((a, b) => {
    const d = sortKey(a, sortBy) - sortKey(b, sortBy);
    if (d !== 0) return sign * d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface FlowAnomaly {
  isAnomaly: boolean;
  reason?: string;
  severity: "info" | "warning" | "critical";
}

export function evaluateFlowAnomaly(flow: NetflowRecord): FlowAnomaly {
  if (flow.bytes > LARGE_FLOW_BYTES) {
    return {
      isAnomaly: true,
      reason: "Volume aliran sangat besar (> 500 MB)",
      severity: "warning",
    };
  }
  if (
    flow.durationSec > PERSISTENT_FLOW_SEC &&
    flow.bytes >= MASSIVE_FLOW_BYTES
  ) {
    return {
      isAnomaly: true,
      reason: "Koneksi persisten bandwidth tinggi",
      severity: "warning",
    };
  }
  return { isAnomaly: false, severity: "info" };
}
