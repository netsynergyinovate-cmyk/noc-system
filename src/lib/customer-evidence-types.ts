// Kontrak "bukti keluhan pelanggan": riwayat up/down dan analisis jam sibuk dari
// customer_traffic_samples + customer_connection_events. Dipakai bersama oleh
// logika murni (customer-evidence.ts), service, API, dan UI. Semua waktu detik
// epoch (UTC); pengelompokan hari/jam memakai WIB (UTC+7, tanpa DST).

export const evidenceRanges = [
  { id: "24h", label: "1 hari", seconds: 24 * 3600 },
  { id: "3d", label: "3 hari", seconds: 3 * 24 * 3600 },
  { id: "7d", label: "7 hari", seconds: 7 * 24 * 3600 },
  { id: "30d", label: "1 bulan", seconds: 30 * 24 * 3600 },
  { id: "90d", label: "3 bulan", seconds: 90 * 24 * 3600 },
] as const;
export type EvidenceRangeId = (typeof evidenceRanges)[number]["id"];

/** Selisih WIB terhadap UTC dalam detik. Indonesia Barat tidak memakai DST. */
export const WIB_OFFSET_SECONDS = 7 * 3600;

/**
 * Jam sibuk dalam menit sejak 00:00 WIB, [startMin, endMin). Berurutan tanpa
 * celah; jam di luar daftar masuk "luar" (di luar jam sibuk). Satu-satunya
 * tempat batas ini ditulis; ubah di sini bila kebiasaan pelanggan berbeda.
 */
export const peakWindows = [
  { id: "siang", label: "Siang", startMin: 11 * 60, endMin: 12 * 60 + 30 },
  { id: "pulang-sekolah", label: "Pulang sekolah", startMin: 12 * 60 + 30, endMin: 15 * 60 + 30 },
  { id: "pulang-kerja", label: "Sore pulang kerja", startMin: 15 * 60 + 30, endMin: 17 * 60 + 30 },
  { id: "magrib-malam", label: "Menjelang magrib – malam", startMin: 17 * 60 + 30, endMin: 23 * 60 },
] as const;
export const OFF_PEAK_ID = "luar" as const;
export const OFF_PEAK_LABEL = "Di luar jam sibuk";
export type PeakWindowId = (typeof peakWindows)[number]["id"] | typeof OFF_PEAK_ID;

export interface ConnectionEvent {
  at: number;
  kind: "up" | "down";
  /** "alert" = disusun dari alert offline lama, waktunya kurang tepat. */
  source: "live" | "alert";
}

export interface Outage {
  from: number;
  /** null = masih down sekarang. */
  to: number | null;
  /** Lama sampai `to` (atau sampai sekarang bila masih down), terpotong di awal rentang. */
  seconds: number;
  source: "live" | "alert";
  /** Jam sibuk yang tersentuh oleh gangguan ini. */
  windows: PeakWindowId[];
}

export interface WindowStat {
  id: PeakWindowId;
  label: string;
  /** Jumlah bucket 5 menit yang punya trafik di jam ini pada rentang. */
  bucketCount: number;
  /** Rata-rata berbobot jumlah sampel; null = tidak ada data. */
  avgDownMbps: number | null;
  avgUpMbps: number | null;
  /** p95 dari rata-rata bucket. */
  p95DownMbps: number | null;
  maxDownMbps: number | null;
  maxUpMbps: number | null;
  /** Detik down yang jatuh di jam ini (WIB) pada rentang. */
  downSeconds: number;
  /** Jumlah gangguan yang MULAI di jam ini. */
  outageStarts: number;
}

export interface DayStat {
  /** Tanggal WIB, "YYYY-MM-DD". */
  date: string;
  downSeconds: number;
  outageStarts: number;
  windows: Record<
    PeakWindowId,
    {
      avgDownMbps: number | null;
      avgUpMbps: number | null;
      maxDownMbps: number | null;
      downSeconds: number;
    }
  >;
}

export interface HourStat {
  /** 0-23 WIB. */
  hour: number;
  bucketCount: number;
  avgDownMbps: number | null;
  avgUpMbps: number | null;
  downSeconds: number;
}

export interface EvidenceFinding {
  /** "info" = fakta; "warn" = layak diperhatikan teknisi. */
  severity: "info" | "warn";
  /** Kalimat Indonesia deterministik (bukan tebakan/persentase keyakinan). */
  text: string;
}

export interface CustomerEvidence {
  range: EvidenceRangeId;
  from: number;
  to: number;
  coverage: {
    /** Bucket trafik tertua yang tersimpan; null = belum ada. */
    trafficSince: number | null;
    /** Kejadian up/down tertua yang tersimpan; null = belum ada. */
    eventsSince: number | null;
    /** Bucket 5 menit yang ada vs yang diharapkan pada rentang (terpotong sejak trafficSince). */
    trafficBuckets: number;
    expectedBuckets: number;
    /** Riwayat up/down sudah ada sejak awal rentang (jika false, bukti terpotong). */
    eventsCoverRange: boolean;
    /** Kalimat yang menjelaskan batas bukti ini (mis. "data trafik baru ada sejak ..."). */
    notes: string[];
  };
  connection: {
    state: "up" | "down" | "unknown";
    /** Kapan keadaan sekarang dimulai; null bila tidak diketahui. */
    since: number | null;
    /** Terbaru dulu, maksimal 200. */
    events: ConnectionEvent[];
    /** Terbaru dulu. */
    outages: Outage[];
    summary: {
      outageCount: number;
      downSeconds: number;
      /** Persen up pada bagian rentang yang tercakup riwayat; null = tidak diketahui. */
      uptimePct: number | null;
      longestOutageSeconds: number;
      /** Gangguan pendek (< 5 menit): tanda koneksi naik-turun. */
      flapCount: number;
    };
  };
  windows: WindowStat[];
  daily: DayStat[];
  hourly: HourStat[];
  findings: EvidenceFinding[];
  /** Gangguan yang sudah dikelompokkan dan diverifikasi; terbaru dulu. */
  incidents: CustomerIncident[];
  incidentSummary: IncidentSummary;
}

// ---------------------------------------------------------------------------
// Gangguan nyata. Satu-satunya aturan penghitungan angka "jumlah gangguan"
// (daftar per pelanggan di /app/anomali dan rincian pelanggan memakai fungsi
// murni yang sama, jadi angkanya tidak bisa berbeda).
//
// 1. Kejadian putus mentah (outage) yang jaraknya <= INCIDENT_MERGE_GAP_SECONDS
//    (dari akhir yang satu ke awal berikutnya) digabung jadi SATU insiden:
//    putus-nyambung berulang dihitung sekali, bukan puluhan kali.
// 2. Insiden dihitung bila total detik down >= INCIDENT_MIN_DOWN_SECONDS ATAU
//    jumlah putus mentah di dalamnya >= INCIDENT_MIN_FLAPS (tidak stabil).
//    Sisanya "kedipan": dicatat tapi tidak dihitung.
// 3. Diverifikasi dengan trafik pelanggan sendiri (customer_traffic_samples):
//    queue dinamis hanya ada saat sesi PPPoE hidup, jadi bucket 5 menit yang
//    tumpang tindih dengan detik-detik down tidak boleh berisi sampel lebih
//    dari (300 - detik down di bucket itu) + INCIDENT_BUCKET_TOLERANCE_SAMPLES.
//    Bila terlampaui = trafik tetap mengalir, catatan down TIDAK terbukti.
//    "Terbukti" juga mewajibkan ada sampel trafik tepat sebelum mulai dan
//    (bila sudah selesai) tepat sesudah akhir (dalam INCIDENT_EDGE_SECONDS);
//    tanpa itu = belum terverifikasi (mis. data trafik belum ada / backend mati).
// 4. Insiden yang masih berjalan, atau yang berakhir kurang dari
//    INCIDENT_SETTLE_SECONDS lalu (bucket trafik belum selesai ditulis),
//    berstatus final=false dan belum dihitung sebagai terbukti.
export const INCIDENT_MERGE_GAP_SECONDS = 15 * 60;
export const INCIDENT_MIN_DOWN_SECONDS = 5 * 60;
export const INCIDENT_MIN_FLAPS = 3;
export const INCIDENT_BUCKET_SECONDS = 300;
export const INCIDENT_BUCKET_TOLERANCE_SAMPLES = 60;
/** Toleransi lebih lebar bila putus berasal dari alert: akhir alert adalah deteksi poll, bisa tertinggal dari sambung ulang sebenarnya. */
export const INCIDENT_BUCKET_TOLERANCE_ALERT_SAMPLES = 180;
export const INCIDENT_EDGE_SECONDS = 10 * 60;
export const INCIDENT_SETTLE_SECONDS = 10 * 60;
/** Ikut dihitung "massal": >= 3 pelanggan lain di router yang sama down bersamaan dan >= 20% pelanggan router itu. */
export const MASS_MIN_CUSTOMERS = 3;
export const MASS_MIN_SHARE = 0.2;

export type IncidentVerdict =
  | "terbukti" // dihitung
  | "tidak-terbukti" // trafik tetap mengalir saat dicatat down
  | "belum-terverifikasi" // data trafik sekitar tidak ada / belum final
  | "kedipan"; // terlalu singkat dan tunggal, tidak dihitung

export interface CustomerIncident {
  /** `${startSec}`; unik per pelanggan. */
  id: string;
  /** Awal putus pertama dan akhir putus terakhir; to=null = masih down. */
  from: number;
  to: number | null;
  /** Gabungan detik down (tanpa dobel) di dalam insiden. */
  downSeconds: number;
  /** Jumlah putus mentah yang digabung. */
  outageCount: number;
  longestOutageSeconds: number;
  sources: ("live" | "alert")[];
  verdict: IncidentVerdict;
  /** Kalimat Indonesia deterministik yang menjelaskan keputusan (angka asli, bukan keyakinan). */
  verdictReason: string;
  final: boolean;
  /** Jam sibuk yang tersentuh (termasuk "luar") dan jam sibuk tempat insiden MULAI. */
  windows: PeakWindowId[];
  startWindow: PeakWindowId;
  /** Putus mentah di dalamnya, untuk menggambar blok down di grafik; maksimal 300 (terbaru). */
  outages: { from: number; to: number | null }[];
  /** Rata-rata unduh 30 menit sebelum mulai / sesudah akhir; null = tidak ada data. */
  beforeAvgDownMbps: number | null;
  afterAvgDownMbps: number | null;
  /** Jumlah sampel antrean (detik) di bucket 5 menit yang tumpang tindih, bucket utuh (termasuk bagian yang hidup, jadi bisa melebihi downSeconds); null = tidak ada bucket. */
  queueSecondsDuring: number | null;
  scope: {
    kind: "sendiri" | "massal" | "tidak-diketahui";
    /** Pelanggan lain di router yang sama yang down bersamaan (tumpang tindih waktu). */
    otherDown: number;
    routerCustomers: number;
  };
}

export interface IncidentSummary {
  /** Jumlah gangguan nyata = insiden berstatus "terbukti". Angka utama. */
  real: number;
  belumTerverifikasi: number;
  tidakTerbukti: number;
  kedipan: number;
  realDownSeconds: number;
  realByWindow: Record<PeakWindowId, number>;
  realMassal: number;
  lastRealAt: number | null;
}

/** Satu baris daftar "Gangguan per pelanggan" di /app/anomali. */
export interface CustomerIncidentRow {
  customerId: string;
  name: string;
  pppoeUsername: string;
  routerName: string | null;
  summary: IncidentSummary;
  isOnline: boolean;
  billingStatus?: string | null;
}

/** Titik grafik rincian gangguan: satu bucket 5 menit trafik pelanggan. */
export interface IncidentSeriesPoint {
  t: number;
  samples: number;
  downMbps: number;
  upMbps: number;
  downMaxMbps: number;
  upMaxMbps: number;
}
