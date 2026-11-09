import { formatDbm } from "./format.ts";
import {
  loneImpact,
  mockDirectory,
  type IncidentImpact,
} from "./incident-root.ts";
import { incidentLabels } from "./incidents.ts";
import type { DashboardCustomer } from "./types.ts";
import type { Incident, IncidentKind, IncidentSeverity } from "./types.ts";

// DATA TIRUAN untuk fase frontend. Anomali adalah gangguan yang sama dengan
// penanda di grafik traffic (mockIncidents), dilengkapi router, pelanggan, dan
// angka ukurnya. Saat backend siap, ganti isi loadAnomalies dengan
// GET /api/v1/anomalies (dari network_logs); bentuknya sudah mengikuti tabel itu:
// type, severity, started_at, ended_at, router_id, customer_id, dan detail.

export interface Anomaly extends Incident, IncidentImpact {
  routerId: string;
  // Hanya anomali milik satu pelanggan (offline, sinyal optik) yang punya id ini.
  customerId: string | null;
  // Nama interface untuk anomali traffic dan port; kosong untuk lainnya.
  interfaceName: string | null;
  // Nilai terburuk yang terukur saat melewati ambang; kosong untuk "offline"
  // yang ukurannya adalah lamanya sendiri.
  measured: number | null;
}

// Aturan deteksi, sama dengan yang dijalankan rule engine di backend. Satu
// sumber untuk kolom "ambang" di daftar dan untuk penjelasan aturan di halaman.
export interface AnomalyRule {
  kind: IncidentKind;
  title: string;
  description: string;
  threshold: number | null;
  unit: string;
  // Berapa lama kondisi harus terus benar sebelum menjadi alert (detik); selama
  // itu belum ada alert, jadi alert baru muncul sebesar ini setelah gangguan mulai.
  forSeconds: number;
  // Ambang dalam satu baris pendek, untuk kartu.
  limit: string;
}

export const anomalyRules: AnomalyRule[] = [
  {
    kind: "queue",
    title: incidentLabels.queue,
    description: "Pemakaian antrean di atas 95% selama 30 detik",
    threshold: 95,
    unit: "%",
    forSeconds: 30,
    limit: "> 95% selama 30 detik",
  },
  {
    kind: "cpu",
    title: incidentLabels.cpu,
    description: "CPU router di atas 85% selama 3 menit",
    threshold: 85,
    unit: "%",
    forSeconds: 180,
    limit: "> 85% selama 3 menit",
  },
  {
    kind: "port",
    title: incidentLabels.port,
    description: "Error interface naik lebih dari 20 per menit",
    threshold: 20,
    unit: "error/menit",
    forSeconds: 60,
    limit: "> 20 error per menit",
  },
  {
    kind: "optical",
    title: incidentLabels.optical,
    description: "Rx ONU di bawah -25 dBm (bukan CCQ)",
    threshold: -25,
    unit: "dBm",
    forSeconds: 0,
    limit: "Rx < -25 dBm",
  },
  {
    kind: "offline",
    title: incidentLabels.offline,
    description: "Pelanggan terputus lebih dari 30 detik",
    threshold: null,
    unit: "",
    forSeconds: 30,
    limit: "> 30 detik terputus",
  },
];

const INTERFACES = ["ether1-wan", "ether2-lan", "sfp1-olt", "sfp2-olt"];

const customers: DashboardCustomer[] = [];

// Satu anomali menghasilkan angka yang sama setiap dihitung, karena hanya
// bergantung pada id-nya.
// Anomali tanpa isian dampak; toAnomaly melengkapinya. Riwayat alert selesai
// memakainya apa adanya, karena sumber akar dan dampak baru dihitung untuk yang
// masih aktif.
export type RawAnomaly = Omit<Anomaly, keyof IncidentImpact>;

export function toRawAnomaly(incident: Incident): RawAnomaly {
  return buildAnomaly(incident);
}

export function toAnomaly(incident: Incident): Anomaly {
  const raw = buildAnomaly(incident);
  // Berdiri sendiri sampai korelasi (alerts.ts) menautkannya dengan yang lain.
  return { ...raw, ...loneImpact(raw, mockDirectory) };
}

function buildAnomaly(incident: Incident): RawAnomaly {
  return {
    ...incident,
    routerId: "",
    customerId: null,
    interfaceName: null,
    measured: null,
  };
}

// Keterangan satu baris: apa yang terukur dan batasnya. Lama berjalan tidak ikut
// di sini; ia bertambah tiap detik dan ditampilkan terpisah.
export function describeAnomaly(
  anomaly: Pick<Anomaly, "kind" | "interfaceName" | "measured">,
) {
  const where = anomaly.interfaceName ? ` ${anomaly.interfaceName}` : "";
  switch (anomaly.kind) {
    case "queue":
      return anomaly.measured === null
        ? `Antrean${where} — angka tidak tercatat (batas 95%)`
        : `Antrean${where} ${anomaly.measured}% (batas 95%)`;
    case "cpu":
      return anomaly.measured === null
        ? "CPU di atas batas — angka tidak tercatat (batas 85%)"
        : `CPU ${anomaly.measured}% (batas 85%)`;
    case "port": {
      const port = anomaly.interfaceName ?? "Interface";
      return anomaly.measured === null
        ? `${port}: error tinggi — angka tidak tercatat (batas 20/menit)`
        : `${port}: ${anomaly.measured} error/menit (batas 20)`;
    }
    case "optical":
      return anomaly.measured === null
        ? "Rx — angka tidak tercatat (batas -25,0 dBm)"
        : `Rx ${formatDbm(anomaly.measured)} (batas -25,0 dBm)`;
    case "offline":
      return "Tidak ada sesi PPPoE (batas 30 detik)";
  }
}

export function isActive(anomaly: Anomaly) {
  return anomaly.endedAt === null;
}

const severityRank = { critical: 0, warning: 1, info: 2 } as const;

// Yang masih aktif di atas (kritis lebih dulu), lalu yang selesai; dalam tiap
// kelompok yang terbaru di atas.
export function sortAnomalies(anomalies: Anomaly[]) {
  return [...anomalies].sort(
    (a, b) =>
      Number(isActive(b)) - Number(isActive(a)) ||
      (isActive(a) && isActive(b)
        ? severityRank[a.severity] - severityRank[b.severity]
        : 0) ||
      b.startedAt - a.startedAt ||
      a.id.localeCompare(b.id),
  );
}

export interface AnomalySummary {
  active: number;
  activeCritical: number;
  activeWarning: number;
  // Yang mulai dalam 24 jam terakhir, dan berapa di antaranya sudah selesai.
  last24h: number;
  last24hResolved: number;
  // Jenis tersering pada seluruh data; kosong bila tidak ada anomali.
  topKind: { kind: IncidentKind; count: number } | null;
  total: number;
}

export function summarizeAnomalies(
  anomalies: Anomaly[],
  now: number,
): AnomalySummary {
  const since = now - 24 * 3600;
  const counts = new Map<IncidentKind, number>();
  const summary: AnomalySummary = {
    active: 0,
    activeCritical: 0,
    activeWarning: 0,
    last24h: 0,
    last24hResolved: 0,
    topKind: null,
    total: anomalies.length,
  };
  for (const anomaly of anomalies) {
    counts.set(anomaly.kind, (counts.get(anomaly.kind) ?? 0) + 1);
    if (isActive(anomaly)) {
      summary.active += 1;
      if (anomaly.severity === "critical") summary.activeCritical += 1;
      if (anomaly.severity === "warning") summary.activeWarning += 1;
    }
    if (anomaly.startedAt >= since) {
      summary.last24h += 1;
      if (!isActive(anomaly)) summary.last24hResolved += 1;
    }
  }
  // Urutan aturan memutus seri, supaya hasilnya tetap sama.
  for (const rule of anomalyRules) {
    const count = counts.get(rule.kind) ?? 0;
    if (count > (summary.topKind?.count ?? 0)) {
      summary.topKind = { kind: rule.kind, count };
    }
  }
  return summary;
}

export interface KindSummary {
  kind: IncidentKind;
  active: number;
  // Tingkat terparah di antara yang aktif; kosong bila tidak ada yang aktif.
  worstActive: IncidentSeverity | null;
  last24h: number;
  total: number;
  // Yang paling baru mulai, aktif atau sudah selesai.
  latest: Anomaly | null;
}

// Satu ringkasan per jenis, urut sesuai aturan; jenis yang tidak pernah muncul
// tetap ada (dengan angka nol) supaya kartunya selalu lengkap.
export function summarizeByKind(
  anomalies: Anomaly[],
  now: number,
): KindSummary[] {
  const since = now - 24 * 3600;
  return anomalyRules.map((rule) => {
    const summary: KindSummary = {
      kind: rule.kind,
      active: 0,
      worstActive: null,
      last24h: 0,
      total: 0,
      latest: null,
    };
    for (const anomaly of anomalies) {
      if (anomaly.kind !== rule.kind) continue;
      summary.total += 1;
      if (anomaly.startedAt >= since) summary.last24h += 1;
      if (isActive(anomaly)) {
        summary.active += 1;
        if (
          summary.worstActive === null ||
          severityRank[anomaly.severity] < severityRank[summary.worstActive]
        ) {
          summary.worstActive = anomaly.severity;
        }
      }
      if (
        summary.latest === null ||
        anomaly.startedAt > summary.latest.startedAt
      ) {
        summary.latest = anomaly;
      }
    }
    return summary;
  });
}

export const ANOMALY_WINDOW_SECONDS = 7 * 24 * 3600;
