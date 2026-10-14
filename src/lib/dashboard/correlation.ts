import { formatElapsed } from "./format.ts";
import type { ActiveAlert } from "./alerts.ts";
import { incidentLabels } from "./incidents.ts";
import type { IncidentKind, IncidentSeverity } from "./types.ts";

// ENGINE KORELASI ALERT: mengelompokkan alert aktif yang kemungkinan berasal
// dari satu penyebab, supaya petugas melihat "satu masalah di ODP X" dan bukan
// dua belas baris pelanggan offline. Murni (tanpa React dan tanpa jam), jadi
// hasilnya hanya bergantung pada alert yang diberikan.
//
// Aturan penautan (dua alert ditautkan bila salah satu terpenuhi):
//   ODP      dua alert pelanggan (offline atau sinyal optik) di ODP dan router
//            yang sama, mulai berdekatan (ODP_WINDOW detik).
//   Router   dua alert router (antrean, CPU, port) pada router yang sama, mulai
//            berdekatan (ROUTER_WINDOW detik).
//   Lonjakan sedikitnya BURST_MIN pelanggan offline di router yang sama yang
//            mulainya berurutan dengan jeda tak lebih dari BURST_WINDOW detik.
//   Dampak   alert router dan sedikitnya IMPACT_MIN pelanggan offline di router
//            yang sama yang mulai dari sedikit sebelum sampai beberapa menit
//            sesudah alert router itu.
// Penautan bersifat transitif: A~B dan B~C berarti A, B, C satu kelompok.
//
// Jarak waktu dihitung memakai ketidakpastian waktu tiap alert (timeSource):
// alert dari polling bisa mulai sampai N detik lebih awal dari startedAt, jadi
// jaraknya dikurangi N sebelum dibandingkan dengan jendela.

export const ODP_WINDOW = 600;
export const ROUTER_WINDOW = 900;
export const BURST_WINDOW = 120;
export const BURST_MIN = 3;
export const IMPACT_BEFORE = 60;
export const IMPACT_AFTER = 300;
export const IMPACT_MIN = 2;

export type CauseKind =
  // Beberapa pelanggan di satu ODP: kemungkinan kabel atau ODP-nya.
  | "odp"
  // Router bermasalah (dan mungkin menjatuhkan pelanggannya).
  | "router"
  // Banyak pelanggan sekaligus offline di satu router tanpa tanda lain:
  // kemungkinan jalur uplink atau listrik.
  | "uplink"
  // Tidak ada yang berkaitan.
  | "single";

export type Confidence = "high" | "medium";

export interface AlertGroup {
  // Tetap selama anggota tertuanya sama.
  id: string;
  cause: CauseKind;
  title: string;
  // Alasan dalam kalimat, untuk petugas yang ingin tahu mengapa dikelompokkan.
  reasons: string[];
  routerId: string;
  odpName: string | null;
  alerts: ActiveAlert[];
  // Pelanggan berbeda yang terdampak.
  customerCount: number;
  severity: IncidentSeverity;
  startedAt: number;
  // Kelompok sungguhan (lebih dari satu alert) punya keyakinan; tunggal tidak.
  confidence: Confidence | null;
}

const customerKinds: IncidentKind[] = ["offline", "optical"];
const routerKinds: IncidentKind[] = ["queue", "cpu", "port"];

const isCustomerAlert = (alert: ActiveAlert) =>
  customerKinds.includes(alert.kind);
const isRouterAlert = (alert: ActiveAlert) => routerKinds.includes(alert.kind);

// Jarak antara dua alert dalam detik, sesudah dikurangi ketidakpastian waktunya.
export function timeGap(a: ActiveAlert, b: ActiveAlert) {
  const raw = Math.abs(a.startedAt - b.startedAt);
  return Math.max(0, raw - a.timeUncertaintySeconds - b.timeUncertaintySeconds);
}

class DisjointSet {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }
  find(index: number): number {
    while (this.parent[index] !== index) {
      this.parent[index] = this.parent[this.parent[index]];
      index = this.parent[index];
    }
    return index;
  }
  union(a: number, b: number) {
    const [rootA, rootB] = [this.find(a), this.find(b)];
    // Akar yang lebih kecil (alert yang lebih tua) menjadi induk, supaya hasil
    // tidak bergantung pada urutan penggabungan.
    if (rootA !== rootB)
      this.parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  }
}

const severityRank = { critical: 0, warning: 1, info: 2 } as const;

function worstSeverity(alerts: ActiveAlert[]): IncidentSeverity {
  return alerts.reduce<IncidentSeverity>(
    (worst, alert) =>
      severityRank[alert.severity] < severityRank[worst]
        ? alert.severity
        : worst,
    "info",
  );
}

export interface CorrelationOptions {
  // Nama router untuk judul kelompok; alert pelanggan hanya membawa id routernya.
  routerName?: (routerId: string) => string;
}

export function correlateAlerts(
  input: ActiveAlert[],
  { routerName = (routerId) => routerId }: CorrelationOptions = {},
): AlertGroup[] {
  // Urutan masukan tidak boleh memengaruhi hasil.
  const alerts = [...input].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
  const sets = new DisjointSet(alerts.length);
  // Alasan penautan per alert, untuk kalimat penjelasan.
  const burstMembers = new Set<number>();

  for (let i = 0; i < alerts.length; i += 1) {
    for (let j = i + 1; j < alerts.length; j += 1) {
      const a = alerts[i];
      const b = alerts[j];
      if (a.routerId !== b.routerId) continue;
      if (
        isCustomerAlert(a) &&
        isCustomerAlert(b) &&
        a.location.odpName !== null &&
        a.location.odpName === b.location.odpName &&
        timeGap(a, b) <= ODP_WINDOW
      ) {
        sets.union(i, j);
      } else if (
        isRouterAlert(a) &&
        isRouterAlert(b) &&
        timeGap(a, b) <= ROUTER_WINDOW
      ) {
        sets.union(i, j);
      }
    }
  }

  // Lonjakan offline: pelanggan offline di satu router yang mulainya berurutan
  // dengan jeda kecil, sedikitnya BURST_MIN.
  const offlineByRouter = new Map<string, number[]>();
  alerts.forEach((alert, index) => {
    if (alert.kind !== "offline") return;
    offlineByRouter.set(alert.routerId, [
      ...(offlineByRouter.get(alert.routerId) ?? []),
      index,
    ]);
  });
  for (const indexes of offlineByRouter.values()) {
    let run: number[] = [];
    const flush = () => {
      if (run.length >= BURST_MIN) {
        run.forEach((member) => {
          burstMembers.add(member);
          sets.union(run[0], member);
        });
      }
      run = [];
    };
    for (const index of indexes) {
      const last = run[run.length - 1];
      if (
        last !== undefined &&
        timeGap(alerts[last], alerts[index]) > BURST_WINDOW
      ) {
        flush();
      }
      run.push(index);
    }
    flush();
  }

  // Dampak: alert router dengan sedikitnya IMPACT_MIN pelanggan offline di router
  // yang sama pada jendela waktunya.
  alerts.forEach((router, routerIndex) => {
    if (!isRouterAlert(router)) return;
    const hit = (offlineByRouter.get(router.routerId) ?? []).filter((index) => {
      const delta = alerts[index].startedAt - router.startedAt;
      const slack =
        router.timeUncertaintySeconds + alerts[index].timeUncertaintySeconds;
      return delta >= -IMPACT_BEFORE - slack && delta <= IMPACT_AFTER + slack;
    });
    if (hit.length >= IMPACT_MIN) {
      hit.forEach((index) => sets.union(routerIndex, index));
    }
  });

  const members = new Map<number, number[]>();
  alerts.forEach((_, index) => {
    const root = sets.find(index);
    members.set(root, [...(members.get(root) ?? []), index]);
  });

  const groups = [...members.values()].map((indexes) =>
    describeGroup(
      indexes.map((index) => alerts[index]),
      indexes.some((index) => burstMembers.has(index)),
      routerName,
    ),
  );
  return groups.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      b.alerts.length - a.alerts.length ||
      b.startedAt - a.startedAt ||
      a.id.localeCompare(b.id),
  );
}

function describeGroup(
  alerts: ActiveAlert[],
  hasBurst: boolean,
  routerName: (routerId: string) => string,
): AlertGroup {
  const first = alerts[0];
  const customerIds = new Set(
    alerts.flatMap((alert) => (alert.customerId ? [alert.customerId] : [])),
  );
  const hasRouterAlert = alerts.some(isRouterAlert);
  const odpNames = new Set(
    alerts.flatMap((alert) =>
      alert.location.odpName ? [alert.location.odpName] : [],
    ),
  );
  const name = routerName(first.routerId);
  const spread = Math.max(...alerts.map((a) => a.startedAt)) - first.startedAt;

  let cause: CauseKind;
  let title: string;
  const reasons: string[] = [];
  if (alerts.length === 1) {
    cause = "single";
    title = `${incidentLabels[first.kind]}: ${first.location.name}`;
  } else if (hasRouterAlert) {
    cause = "router";
    const kinds = [
      ...new Set(
        alerts.filter(isRouterAlert).map((a) => incidentLabels[a.kind]),
      ),
    ];
    title = `${name}: ${kinds.join(", ").toLowerCase()}`;
    reasons.push(
      `Alert router yang sama mulai berdekatan: ${kinds.join(", ")}.`,
    );
    if (customerIds.size > 0) {
      reasons.push(
        `${customerIds.size} pelanggan di router ini ikut bermasalah dalam ${formatElapsed(spread)} sejak yang pertama.`,
      );
    }
  } else if (hasBurst && odpNames.size !== 1) {
    cause = "uplink";
    title = `${customerIds.size} pelanggan offline bersamaan di ${name}`;
    reasons.push(
      `${customerIds.size} pelanggan di router yang sama putus berurutan dalam ${formatElapsed(spread)}, di ODP berbeda.`,
    );
  } else {
    cause = "odp";
    const odp = [...odpNames][0] ?? first.location.name;
    title = `${odp}: ${customerIds.size} pelanggan terdampak`;
    reasons.push(
      `${customerIds.size} pelanggan di ODP yang sama bermasalah dalam ${formatElapsed(spread)}.`,
    );
  }

  const confidence: Confidence | null =
    alerts.length === 1
      ? null
      : alerts.length >= 4 || (alerts.length >= 3 && spread <= 120)
        ? "high"
        : "medium";

  return {
    id: `grp-${first.id}`,
    cause,
    title,
    reasons,
    routerId: first.routerId,
    odpName: odpNames.size === 1 ? [...odpNames][0] : null,
    alerts,
    customerCount: customerIds.size,
    severity: worstSeverity(alerts),
    startedAt: first.startedAt,
    confidence,
  };
}

export interface CorrelationSummary {
  alerts: number;
  groups: number;
  // Kelompok yang berisi lebih dari satu alert.
  correlated: number;
  // Berapa baris yang tidak perlu dibaca lagi berkat pengelompokan.
  saved: number;
}

export function summarizeCorrelation(groups: AlertGroup[]): CorrelationSummary {
  const alerts = groups.reduce((sum, group) => sum + group.alerts.length, 0);
  return {
    alerts,
    groups: groups.length,
    correlated: groups.filter((group) => group.alerts.length > 1).length,
    saved: alerts - groups.length,
  };
}
