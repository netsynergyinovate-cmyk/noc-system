import {
  anomalyRules,
  describeAnomaly,
  isActive,
  type Anomaly,
} from "./anomalies.ts";
import { incidentLabels } from "./incidents.ts";
import type { IncidentKind, IncidentSeverity } from "./types.ts";

// "unreviewed" = masih aktif dan belum ditandai ditinjau operator ("Belum selesai").
export type AnomalyStatusFilter = "all" | "active" | "unreviewed" | "resolved";

// Id anomali yang sudah ditinjau (kunci peta; nilainya tidak dipakai).
type Reviewed = Readonly<Record<string, unknown>>;

export interface AnomalyFilters {
  kind: IncidentKind | "all";
  severity: IncidentSeverity | "all";
  status: AnomalyStatusFilter;
  // Pencarian bebas: nama pelanggan, router, ODP, keterangan, jenis.
  query?: string;
  // Router tertentu.
  routerId?: string | "all";
}

export const defaultAnomalyFilters: AnomalyFilters = {
  kind: "all",
  severity: "all",
  status: "all",
  query: "",
  routerId: "all",
};

// Peta id -> nama, bentuknya sama dengan useSubjectLookup().
export interface AnomalyNameLookup {
  routerNames: Map<string, string>;
  customerById: Map<
    string,
    { name: string; pppoeUsername?: string; odpName?: string }
  >;
}

export function hasActiveAnomalyFilters(filters: AnomalyFilters) {
  return (
    filters.kind !== "all" ||
    filters.severity !== "all" ||
    filters.status !== "all" ||
    (filters.query ?? "").trim() !== "" ||
    (filters.routerId ?? "all") !== "all"
  );
}

type Dimension = "kind" | "severity" | "status" | "routerId";

function haystack(anomaly: Anomaly, lookup?: AnomalyNameLookup) {
  const customer = anomaly.customerId
    ? lookup?.customerById.get(anomaly.customerId)
    : undefined;
  return [
    incidentLabels[anomaly.kind],
    anomaly.kind,
    anomaly.routerId,
    lookup?.routerNames.get(anomaly.routerId),
    anomaly.customerId,
    customer?.name,
    customer?.pppoeUsername,
    customer?.odpName,
    anomaly.interfaceName,
    describeAnomaly(anomaly),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// `skip` mengabaikan satu saringan, untuk menghitung angka di samping pilihan
// saringan itu sendiri.
function matches(
  anomaly: Anomaly,
  filters: AnomalyFilters,
  skip?: Dimension,
  lookup?: AnomalyNameLookup,
  reviewed?: Reviewed,
) {
  if (
    skip !== "kind" &&
    filters.kind !== "all" &&
    anomaly.kind !== filters.kind
  ) {
    return false;
  }
  if (
    skip !== "severity" &&
    filters.severity !== "all" &&
    anomaly.severity !== filters.severity
  ) {
    return false;
  }
  if (skip !== "status" && filters.status !== "all") {
    const active = isActive(anomaly);
    if (filters.status === "resolved") {
      if (active) return false;
    } else if (!active) {
      return false;
    } else if (filters.status === "unreviewed" && reviewed?.[anomaly.id]) {
      return false;
    }
  }
  const routerId = filters.routerId ?? "all";
  if (
    skip !== "routerId" &&
    routerId !== "all" &&
    anomaly.routerId !== routerId
  ) {
    return false;
  }
  const words = (filters.query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 0) {
    const text = haystack(anomaly, lookup);
    if (!words.every((word) => text.includes(word))) return false;
  }
  return true;
}

// Urutan daftar tidak berubah.
export function filterAnomalies(
  anomalies: Anomaly[],
  filters: AnomalyFilters,
  lookup?: AnomalyNameLookup,
  reviewed?: Reviewed,
) {
  return anomalies.filter((anomaly) =>
    matches(anomaly, filters, undefined, lookup, reviewed),
  );
}

export interface FacetCounts {
  kind: Record<IncidentKind, number>;
  severity: Record<IncidentSeverity, number>;
  status: { active: number; unreviewed: number; resolved: number };
  // Seluruh yang lolos semua saringan.
  total: number;
}

// Angka di samping tiap pilihan: berapa anomali yang akan tampil bila pilihan
// itu dipilih, dengan saringan lain tetap berlaku. Memilih sebuah pilihan lalu
// selalu menghasilkan persis sebanyak angkanya.
export function facetCounts(
  anomalies: Anomaly[],
  filters: AnomalyFilters,
  lookup?: AnomalyNameLookup,
  reviewed?: Reviewed,
): FacetCounts {
  const counts: FacetCounts = {
    kind: Object.fromEntries(
      anomalyRules.map((rule) => [rule.kind, 0]),
    ) as Record<IncidentKind, number>,
    severity: { critical: 0, warning: 0, info: 0 },
    status: { active: 0, unreviewed: 0, resolved: 0 },
    total: 0,
  };
  for (const anomaly of anomalies) {
    if (matches(anomaly, filters, undefined, lookup, reviewed))
      counts.total += 1;
    if (matches(anomaly, filters, "kind", lookup, reviewed))
      counts.kind[anomaly.kind] += 1;
    if (matches(anomaly, filters, "severity", lookup, reviewed)) {
      counts.severity[anomaly.severity] += 1;
    }
    if (matches(anomaly, filters, "status", lookup, reviewed)) {
      if (!isActive(anomaly)) counts.status.resolved += 1;
      else {
        counts.status.active += 1;
        if (!reviewed?.[anomaly.id]) counts.status.unreviewed += 1;
      }
    }
  }
  return counts;
}
