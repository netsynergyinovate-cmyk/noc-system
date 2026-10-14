import { loadActiveAlerts, type ActiveAlert } from "./alerts";
import {
  correlateAlerts,
  type AlertGroup,
  type CauseKind,
  type Confidence,
} from "./correlation";
import {
  groupImpact,
  mockDirectory,
  type RootSource,
  type ServiceDirectory,
} from "./incident-root";
import type { IncidentKind, IncidentSeverity } from "./types";

// KONTRAK API KARTU INSIDEN TERKELOMPOK (yang diasumsikan frontend; backend
// belum mengimplementasikannya). Satu kartu adalah satu masalah yang kemungkinan
// punya satu penyebab, berisi alert-alert aktif yang tergabung di dalamnya,
// supaya petugas membaca "satu masalah di ODP X" dan bukan dua belas baris.
//
// Titik ganti ke backend: loadIncidentCards di bawah ->
// GET /api/v1/incidents/cards?status=active
// Sebelum rule engine Go ikut mengelompokkan, frontend membuat kartu dari alert
// aktif lewat buildIncidentCards (engine korelasi di correlation.ts).
//
// Aturan yang harus dipenuhi isi kartu (diuji di e2e/incident-cards.spec.ts):
//
//   id                id kartu, tetap selama alert tertuanya sama.
//   correlationId     sama dengan id bila kartu berisi sedikitnya dua alert, selain
//                     itu null (kartu tunggal: gangguan yang berdiri sendiri).
//   rootSource        apa yang diduga menjadi akar: customer, odp, router, uplink.
//   affectedCustomers pelanggan yang TERBUKTI terdampak (punya alert sendiri).
//   servedCustomers   seluruh pelanggan yang dilayani akar itu: batas atas, selalu
//                     >= affectedCustomers.
//   startedAt dst.    waktu mulai alert tertua, dengan detectedAt, timeSource, dan
//                     timeUncertaintySeconds milik alert itu juga, supaya waktunya
//                     bisa ditampilkan dengan AlertTime seperti satu alert.
//   alerts            alert anggota, tertua lebih dulu; tidak pernah kosong.
//   focusCustomerId   pelanggan pertama yang punya titik di peta (untuk "Sorot di
//                     peta" lewat map-focus.ts), atau null bila tidak ada titik.
//                     Kartu tingkat router tidak mengarang titik.
//
// Urutan kartu: tingkat terparah dulu, lalu yang beranggota lebih banyak, lalu
// yang lebih baru mulai.

// Teks untuk kartu: penyebab yang diduga, jenis akarnya, dan keyakinannya.
export const causeLabels: Record<CauseKind, string> = {
  odp: "Satu ODP",
  router: "Router",
  uplink: "Jalur uplink",
  single: "Berdiri sendiri",
};

export const rootSourceLabels: Record<RootSource["kind"], string> = {
  customer: "Pelanggan",
  odp: "ODP",
  router: "Router",
  uplink: "Uplink",
};

export const confidenceLabels: Record<Confidence, string> = {
  high: "Keyakinan tinggi",
  medium: "Keyakinan sedang",
};

export interface IncidentCardKind {
  kind: IncidentKind;
  count: number;
}

export interface IncidentCard {
  id: string;
  correlationId: string | null;
  cause: CauseKind;
  title: string;
  // Alasan pengelompokan dalam kalimat; kosong untuk kartu tunggal.
  reasons: string[];
  // Keyakinan pengelompokan; kosong untuk kartu tunggal.
  confidence: Confidence | null;
  severity: IncidentSeverity;
  rootSource: RootSource;
  affectedCustomers: number;
  servedCustomers: number;
  routerId: string;
  routerName: string;
  odpName: string | null;
  startedAt: number;
  detectedAt: number;
  timeSource: ActiveAlert["timeSource"];
  timeUncertaintySeconds: number;
  alertCount: number;
  // Jumlah alert per jenis, urut menurut jumlah lalu urutan jenis tetap.
  kinds: IncidentCardKind[];
  alerts: ActiveAlert[];
  focusCustomerId: string | null;
}

const KIND_ORDER: IncidentKind[] = [
  "offline",
  "optical",
  "queue",
  "cpu",
  "port",
];

function countKinds(alerts: ActiveAlert[]): IncidentCardKind[] {
  const counts = new Map<IncidentKind, number>();
  for (const alert of alerts) {
    counts.set(alert.kind, (counts.get(alert.kind) ?? 0) + 1);
  }
  return [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
}

function focusCustomer(alerts: ActiveAlert[]): string | null {
  const withPoint = alerts.find(
    (alert) =>
      alert.customerId !== null &&
      alert.location.latitude !== null &&
      alert.location.longitude !== null,
  );
  return withPoint?.customerId ?? null;
}

function toCard(group: AlertGroup, directory: ServiceDirectory): IncidentCard {
  const impact = groupImpact(group, directory);
  // Anggota sudah tertua lebih dulu (correlateAlerts mengurutkannya).
  const first = group.alerts[0];
  return {
    id: group.id,
    correlationId: impact.correlationId,
    cause: group.cause,
    title: group.title,
    reasons: group.reasons,
    confidence: group.confidence,
    severity: group.severity,
    rootSource: impact.rootSource,
    affectedCustomers: impact.affectedCustomers,
    servedCustomers: impact.servedCustomers,
    routerId: group.routerId,
    routerName: directory.routerName(group.routerId),
    odpName: group.odpName,
    startedAt: first.startedAt,
    detectedAt: first.detectedAt,
    timeSource: first.timeSource,
    timeUncertaintySeconds: first.timeUncertaintySeconds,
    alertCount: group.alerts.length,
    kinds: countKinds(group.alerts),
    alerts: group.alerts,
    focusCustomerId: focusCustomer(group.alerts),
  };
}

// Murni: hasilnya hanya bergantung pada alert dan direktori yang diberikan,
// bukan pada urutan alert.
export function buildIncidentCards(
  alerts: ActiveAlert[],
  directory: ServiceDirectory = mockDirectory,
): IncidentCard[] {
  return correlateAlerts(alerts, { routerName: directory.routerName }).map(
    (group) => toCard(group, directory),
  );
}

export interface IncidentCardSummary {
  cards: number;
  alerts: number;
  // Kartu yang berisi lebih dari satu alert.
  grouped: number;
  // Berapa baris yang tidak perlu dibaca lagi berkat pengelompokan.
  saved: number;
  // Pelanggan berbeda yang terbukti terdampak di seluruh kartu.
  affectedCustomers: number;
  critical: number;
}

export function summarizeIncidentCards(
  cards: IncidentCard[],
): IncidentCardSummary {
  const alerts = cards.reduce((sum, card) => sum + card.alertCount, 0);
  const customers = new Set(
    cards.flatMap((card) =>
      card.alerts.flatMap((alert) =>
        alert.customerId ? [alert.customerId] : [],
      ),
    ),
  );
  return {
    cards: cards.length,
    alerts,
    grouped: cards.filter((card) => card.alertCount > 1).length,
    saved: alerts - cards.length,
    affectedCustomers: customers.size,
    critical: cards.filter((card) => card.severity === "critical").length,
  };
}

// Titik ganti ke backend: GET /api/v1/incidents/cards?status=active
export async function loadIncidentCards(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<IncidentCard[]> {
  return buildIncidentCards(await loadActiveAlerts(nowSec));
}
