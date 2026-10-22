import { correlateAlerts } from "./correlation.ts";
import {
  groupImpact,
  loneImpact,
  type ServiceDirectory,
} from "./incident-root.ts";
import type { AlertEndSource, AlertLocation, ActiveAlert, ResolvedAlert } from "./alerts.ts";
import type { Anomaly, RawAnomaly } from "./anomalies.ts";
import type { DashboardCustomer, DashboardRouter, IncidentKind, IncidentSeverity } from "./types.ts";

// ALERT NYATA dari tabel `alerts` (diisi rule engine Go; dibaca lewat
// GET /api/alerts). File ini hanya memetakan bentuk baris database ke bentuk
// yang dipakai halaman Alert dan Deteksi Anomali. Tidak ada angka karangan:
// yang tidak diketahui dibiarkan null.

// Bentuk satu alert dari GET /api/alerts (services/alerts.service.ts AlertItem).
export interface LiveAlertItem {
  id: string;
  type: string;
  severity: string;
  status: string;
  routerId: string | null;
  customerId: string | null;
  startedAt: number;
  detectedAt: number;
  endedAt: number | null;
  timeSource: string;
  timeUncertaintySeconds: number;
  endTimeSource: string | null;
  endTimeUncertaintySeconds: number | null;
  handledBy: string | null;
  location: AlertLocation;
}

const KINDS: readonly IncidentKind[] = ["offline", "optical", "queue", "cpu", "port"];
const SEVERITIES: readonly IncidentSeverity[] = ["info", "warning", "critical"];

const isKind = (v: string): v is IncidentKind => (KINDS as readonly string[]).includes(v);
const isSeverity = (v: string): v is IncidentSeverity =>
  (SEVERITIES as readonly string[]).includes(v);
const source = (v: string | null | undefined, fallback: "event" | "poll") =>
  v === "event" || v === "poll" ? v : fallback;

// Direktori nama dan hitungan dari data yang sudah ada di store dashboard
// (router dan pelanggan dari backend Go). Bila store belum memuat pelanggan atau
// router itu, nama diambil dari lokasi yang ditulis rule engine di baris alert
// (nama pelanggan, atau nama router untuk alert tingkat router), bukan UUID.
export function buildLiveDirectory(
  routers: readonly DashboardRouter[],
  customers: readonly DashboardCustomer[],
  items: readonly Pick<LiveAlertItem, "routerId" | "customerId" | "location">[] = [],
): ServiceDirectory {
  const routerNames = new Map<string, string>();
  const customerNames = new Map<string, string>();
  for (const item of items) {
    if (item.customerId) customerNames.set(item.customerId, item.location.name);
    else if (item.routerId) routerNames.set(item.routerId, item.location.name);
  }
  for (const r of routers) routerNames.set(r.id, r.name);
  for (const c of customers) customerNames.set(c.id, c.name);
  return {
    routerName: (id) => routerNames.get(id) ?? id,
    customerName: (id) => customerNames.get(id) ?? id,
    customersOnRouter: (id) => customers.filter((c) => c.routerId === id).length,
    customersOnOdp: (routerId, odpName) =>
      customers.filter((c) => c.routerId === routerId && c.odpName === odpName).length,
  };
}

// Baris dengan jenis atau tingkat yang tidak dikenal dilewati, bukan ditebak.
function toRaw(item: LiveAlertItem): RawAnomaly | null {
  if (!isKind(item.type) || !isSeverity(item.severity)) return null;
  return {
    id: item.id,
    kind: item.type,
    severity: item.severity,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    routerId: item.routerId ?? "",
    customerId: item.customerId,
    interfaceName: null,
    measured: null,
  };
}

export function toLiveActiveAlerts(
  items: readonly LiveAlertItem[],
  directory: ServiceDirectory,
): ActiveAlert[] {
  const base: ActiveAlert[] = [];
  for (const item of items) {
    if (item.endedAt !== null) continue;
    const raw = toRaw(item);
    if (!raw) continue;
    base.push({
      ...raw,
      ...loneImpact(raw, directory),
      endedAt: null,
      location: item.location,
      detectedAt: item.detectedAt,
      timeSource: source(item.timeSource, "poll"),
      timeUncertaintySeconds: item.timeUncertaintySeconds,
    });
  }
  // Alert yang diduga satu sebab dikelompokkan (ODP, router, dst).
  const impactById = new Map<string, ReturnType<typeof groupImpact>>();
  for (const group of correlateAlerts(base, { routerName: directory.routerName })) {
    const impact = groupImpact(group, directory);
    for (const alert of group.alerts) impactById.set(alert.id, impact);
  }
  return base.map((alert) => ({ ...alert, ...impactById.get(alert.id)! }));
}

export function toLiveResolvedAlerts(items: readonly LiveAlertItem[]): ResolvedAlert[] {
  const out: ResolvedAlert[] = [];
  for (const item of items) {
    if (item.endedAt === null) continue;
    const raw = toRaw(item);
    if (!raw) continue;
    const handled = item.handledBy ?? null;
    const endSource: AlertEndSource =
      handled !== null || item.endTimeSource === "operator"
        ? "operator"
        : source(item.endTimeSource, "poll");
    out.push({
      ...raw,
      endedAt: item.endedAt,
      location: item.location,
      detectedAt: item.detectedAt,
      timeSource: source(item.timeSource, "poll"),
      timeUncertaintySeconds: item.timeUncertaintySeconds,
      endTimeSource: endSource,
      endTimeUncertaintySeconds: endSource === "operator" ? 0 : (item.endTimeUncertaintySeconds ?? 0),
      handledBy: endSource === "operator" ? (handled ?? "Petugas") : null,
    });
  }
  return out;
}

// Halaman Deteksi Anomali: aktif dan riwayat dalam satu daftar, dengan
// dampak per alert. `active` memakai korelasi yang sama dengan halaman Alert.
export function toLiveAnomalies(
  items: readonly LiveAlertItem[],
  directory: ServiceDirectory,
): Anomaly[] {
  const active = toLiveActiveAlerts(items, directory);
  const history: Anomaly[] = [];
  for (const item of items) {
    if (item.endedAt === null) continue;
    const raw = toRaw(item);
    if (raw) history.push({ ...raw, ...loneImpact(raw, directory) });
  }
  return [...active, ...history];
}
