import { describeAnomaly } from "./anomalies";
import { describeHandled, type ResolvedAlert } from "./alerts";
import { incidentLabels, incidentSeverityLabels } from "./incidents";
import type { IncidentKind, IncidentSeverity } from "./types";
import {
  ALERT_CATEGORY_MAP,
  classifyAlertCategory,
  type AlertCategoryKey,
} from "./alert-categories";

// Pencarian dan saringan riwayat alert selesai. Murni, supaya bisa diuji tanpa
// layar: komponen hanya menyimpan pilihan saringannya.

// "Selesai dalam": semua yang ada di riwayat, atau hanya yang baru selesai.
export type ResolvedWindow = "all" | "1h" | "6h" | "24h";

export const resolvedWindowSeconds: Record<
  Exclude<ResolvedWindow, "all">,
  number
> = {
  "1h": 3_600,
  "6h": 6 * 3_600,
  "24h": 24 * 3_600,
};

export interface ResolvedFilters {
  // Kata kunci bebas; spasi memisahkan beberapa kata yang semuanya harus ada.
  query: string;
  category?: AlertCategoryKey;
  kind: IncidentKind | "all";
  severity: IncidentSeverity | "all";
  // "all" atau id router.
  routerId: string;
  window: ResolvedWindow;
}

export const defaultResolvedFilters: ResolvedFilters = {
  query: "",
  category: "all",
  kind: "all",
  severity: "all",
  routerId: "all",
  window: "all",
};

export function hasActiveResolvedFilters(filters: ResolvedFilters) {
  return (
    filters.query.trim() !== "" ||
    filters.kind !== "all" ||
    (Boolean(filters.category) && filters.category !== "all") ||
    filters.severity !== "all" ||
    filters.routerId !== "all" ||
    filters.window !== "all"
  );
}

// Nama yang tidak ada di alert itu sendiri (alert hanya membawa id): yang dicari
// petugas biasanya nama pelanggan, username PPPoE, atau nama router.
export interface SubjectDirectory {
  routerName(routerId: string): string | undefined;
  customer(
    customerId: string,
  ): { name: string; pppoeUsername: string } | undefined;
}

// Semua teks yang tampil di barisnya, jadi apa yang terbaca di layar bisa dicari.
export function searchableText(
  alert: ResolvedAlert,
  directory: SubjectDirectory,
) {
  const customer =
    alert.customerId === null
      ? undefined
      : directory.customer(alert.customerId);
  return [
    ALERT_CATEGORY_MAP[classifyAlertCategory(alert)].label,
    ALERT_CATEGORY_MAP[classifyAlertCategory(alert)].shortLabel,
    incidentLabels[alert.kind],
    incidentSeverityLabels[alert.severity],
    customer?.name,
    customer?.pppoeUsername,
    directory.routerName(alert.routerId),
    alert.location.name,
    alert.location.address,
    alert.location.odpName,
    describeAnomaly(alert),
    // "ditangani oleh Budi", seperti yang tertulis di bawah waktu selesai.
    alert.handledBy ? describeHandled(alert.handledBy) : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

// Kata kunci menjadi kata-kata kecil; kosong bila tidak ada yang dicari.
export function searchTerms(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

type Dimension =
  "query" | "category" | "kind" | "severity" | "routerId" | "window";

// `skip` mengabaikan satu saringan, untuk menghitung angka di samping pilihan
// saringan itu sendiri. `text` adalah teks pencarian alert itu (hanya dipakai
// bila ada kata kunci).
function matches(
  alert: ResolvedAlert,
  filters: ResolvedFilters,
  terms: string[],
  text: string,
  nowSec: number,
  skip?: Dimension,
) {
  if (
    skip !== "category" &&
    filters.category &&
    filters.category !== "all" &&
    classifyAlertCategory(alert) !== filters.category
  )
    return false;
  if (skip !== "kind" && filters.kind !== "all" && alert.kind !== filters.kind)
    return false;
  if (
    skip !== "severity" &&
    filters.severity !== "all" &&
    alert.severity !== filters.severity
  )
    return false;
  if (
    skip !== "routerId" &&
    filters.routerId !== "all" &&
    alert.routerId !== filters.routerId
  )
    return false;
  if (skip !== "window" && filters.window !== "all") {
    // Tegas: yang selesai tepat di batas sudah di luar.
    if (alert.endedAt <= nowSec - resolvedWindowSeconds[filters.window])
      return false;
  }
  if (skip !== "query" && terms.length > 0) {
    if (!terms.every((term) => text.includes(term))) return false;
  }
  return true;
}

// Urutan daftar tidak berubah.
export function filterResolvedAlerts(
  alerts: ResolvedAlert[],
  filters: ResolvedFilters,
  nowSec: number,
  directory: SubjectDirectory,
) {
  const terms = searchTerms(filters.query);
  return alerts.filter((alert) =>
    matches(
      alert,
      filters,
      terms,
      terms.length > 0 ? searchableText(alert, directory) : "",
      nowSec,
    ),
  );
}

export interface ResolvedFacetCounts {
  kind: Record<IncidentKind, number>;
  category: Record<Exclude<AlertCategoryKey, "all">, number>;
  severity: Record<IncidentSeverity, number>;
  router: Record<string, number>;
  window: Record<ResolvedWindow, number>;
  // Seluruh yang lolos semua saringan.
  total: number;
}

// Angka di samping tiap pilihan: berapa alert yang akan tampil bila pilihan itu
// dipilih, dengan saringan lain tetap berlaku. Memilih sebuah pilihan lalu selalu
// menghasilkan persis sebanyak angkanya.
export function resolvedFacetCounts(
  alerts: ResolvedAlert[],
  filters: ResolvedFilters,
  nowSec: number,
  directory: SubjectDirectory,
  routerIds: string[],
): ResolvedFacetCounts {
  const terms = searchTerms(filters.query);
  const counts: ResolvedFacetCounts = {
    kind: { offline: 0, optical: 0, queue: 0, cpu: 0, port: 0 },
    category: { core: 0, optical: 0, customer: 0, other: 0 },
    severity: { critical: 0, warning: 0, info: 0 },
    router: Object.fromEntries(routerIds.map((id) => [id, 0])),
    window: { all: 0, "1h": 0, "6h": 0, "24h": 0 },
    total: 0,
  };
  for (const alert of alerts) {
    const text = terms.length > 0 ? searchableText(alert, directory) : "";
    const check = (skip?: Dimension) =>
      matches(alert, filters, terms, text, nowSec, skip);
    if (check()) counts.total += 1;
    if (check("kind")) counts.kind[alert.kind] += 1;
    if (check("category")) {
      const cat = classifyAlertCategory(alert);
      counts.category[cat] = (counts.category[cat] ?? 0) + 1;
    }
    if (check("severity")) counts.severity[alert.severity] += 1;
    if (check("routerId") && alert.routerId in counts.router)
      counts.router[alert.routerId] += 1;
    if (check("window")) {
      counts.window.all += 1;
      for (const option of ["1h", "6h", "24h"] as const) {
        if (alert.endedAt > nowSec - resolvedWindowSeconds[option])
          counts.window[option] += 1;
      }
    }
  }
  return counts;
}
