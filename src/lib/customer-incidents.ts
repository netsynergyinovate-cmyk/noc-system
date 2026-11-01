import {
  INCIDENT_MERGE_GAP_SECONDS,
  INCIDENT_MIN_DOWN_SECONDS,
  INCIDENT_MIN_FLAPS,
  INCIDENT_BUCKET_SECONDS,
  INCIDENT_BUCKET_TOLERANCE_SAMPLES,
  INCIDENT_BUCKET_TOLERANCE_ALERT_SAMPLES,
  INCIDENT_EDGE_SECONDS,
  INCIDENT_SETTLE_SECONDS,
  MASS_MIN_CUSTOMERS,
  MASS_MIN_SHARE,
  peakWindows,
  OFF_PEAK_ID,
  type CustomerIncident,
  type IncidentSummary,
  type CustomerIncidentRow,
  type IncidentSeriesPoint,
  type IncidentVerdict,
  type PeakWindowId,
} from "./customer-evidence-types.ts";
import {
  formatDuration,
  formatWib,
  getMinuteOfDayWib,
  classifyWibMinute,
  type TrafficBucketInput,
  type RawOutage,
} from "./customer-evidence.ts";

export {
  INCIDENT_MERGE_GAP_SECONDS,
  INCIDENT_MIN_DOWN_SECONDS,
  INCIDENT_MIN_FLAPS,
  INCIDENT_BUCKET_SECONDS,
  INCIDENT_BUCKET_TOLERANCE_SAMPLES,
  INCIDENT_EDGE_SECONDS,
  INCIDENT_SETTLE_SECONDS,
  MASS_MIN_CUSTOMERS,
  MASS_MIN_SHARE,
  type CustomerIncident,
  type IncidentSummary,
  type CustomerIncidentRow,
  type IncidentSeriesPoint,
  type IncidentVerdict,
};
/**
 * Jeda waktu riwayat tetap untuk pengelompokan insiden (400 hari, sama dengan retensi tabel customer_connection_events).
 * Menjamin kluster insiden stabil dan tidak berubah-ubah saat rentang waktu filter diganti.
 */
export const INCIDENT_LOOKBACK_SECONDS = 400 * 24 * 3600;

export interface IncidentScopeInput {
  routerCustomers: number | null;
  others: { from: number; to: number | null }[][];
}

export interface BuildIncidentsInput {
  nowSec: number;
  from: number;
  to: number;
  outages: RawOutage[];
  buckets: TrafficBucketInput[];
  scope?: IncidentScopeInput;
}

export interface BuildIncidentsResult {
  incidents: CustomerIncident[];
  summary: IncidentSummary;
}

/** Gabungkan interval waktu yang tumpang tindih / bersentuhan menjadi interval terpisah. */
export function unionIntervals(
  intervals: { from: number; to: number }[],
): { from: number; to: number }[] {
  if (intervals.length === 0) return [];
  const sorted = intervals
    .slice()
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const result: { from: number; to: number }[] = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.from <= current.to) {
      current.to = Math.max(current.to, next.to);
    } else {
      result.push(current);
      current = { ...next };
    }
  }
  result.push(current);
  return result;
}

const DAY_BOUNDARIES_MIN = [
  0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 750, 780, 840,
  900, 930, 960, 1020, 1050, 1080, 1140, 1200, 1260, 1320, 1380, 1440,
];

/** Ambil seluruh jam sibuk (termasuk "luar") yang tersentuh oleh rentang waktu detik epoch. */
export function getTouchedWindows(
  fromSec: number,
  toSec: number,
): PeakWindowId[] {
  if (toSec <= fromSec) {
    const minOfDay = getMinuteOfDayWib(fromSec);
    return [classifyWibMinute(minOfDay)];
  }
  const touchedSet = new Set<PeakWindowId>();
  let t = fromSec;
  while (t < toSec) {
    const minOfDay = getMinuteOfDayWib(t);
    const windowId = classifyWibMinute(minOfDay);
    touchedSet.add(windowId);
    let nextBoundaryMin = 1440;
    for (const b of DAY_BOUNDARIES_MIN) {
      if (b > minOfDay) {
        nextBoundaryMin = b;
        break;
      }
    }
    const secUntilBoundary = (nextBoundaryMin - minOfDay) * 60;
    t += Math.max(60, Math.min(secUntilBoundary, toSec - t));
  }
  const result: PeakWindowId[] = [];
  for (const pw of peakWindows) {
    if (touchedSet.has(pw.id)) result.push(pw.id);
  }
  if (touchedSet.has(OFF_PEAK_ID)) result.push(OFF_PEAK_ID);
  return result;
}

function computeAvgDown(
  buckets: TrafficBucketInput[],
  startSec: number,
  endSec: number,
): number | null {
  let totalWeighted = 0;
  let totalSamples = 0;
  for (const b of buckets) {
    if (b.bucketStart >= startSec && b.bucketStart < endSec && b.samples > 0) {
      totalWeighted += b.downAvg * b.samples;
      totalSamples += b.samples;
    }
  }
  if (totalSamples === 0) return null;
  return Math.round((totalWeighted / totalSamples) * 100) / 100;
}

/**
 * Bangun daftar gangguan nyata (CustomerIncident) dan ringkasannya (IncidentSummary)
 * berdasarkan aturan kontrak:
 * 1. Gabung pemadaman mentah dengan jeda <= 15 menit.
 * 2. Hitung bila total down >= 5 menit atau putus mentah >= 3 (sisanya 'kedipan').
 * 3. Verifikasi dengan sampel trafik (maks toleransi 60 sampel di atas detik up).
 * 4. Wajib sampel sebelum dan sesudah (dalam 10 menit); gangguan belum selesai / baru selesai < 10 menit => belum final.
 */
export function buildIncidents(input: BuildIncidentsInput): BuildIncidentsResult {
  const { nowSec, from, to, outages, buckets, scope } = input;

  // 1. Kluster seluruh outage berdasarkan INCIDENT_MERGE_GAP_SECONDS
  const sortedOutages = (outages ?? [])
    .slice()
    .sort((a, b) => a.realStart - b.realStart || a.from - b.from);

  const clusters: RawOutage[][] = [];
  let currentCluster: RawOutage[] = [];

  for (const o of sortedOutages) {
    if (currentCluster.length === 0) {
      currentCluster.push(o);
    } else {
      const prev = currentCluster[currentCluster.length - 1];
      if (prev.to !== null && o.from - prev.to <= INCIDENT_MERGE_GAP_SECONDS) {
        currentCluster.push(o);
      } else {
        clusters.push(currentCluster);
        currentCluster = [o];
      }
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // 2. Pilih hanya insiden yang mulai dalam rentang [from, to].
  // Insiden yang mulai sebelum 'from' (termasuk yang masih terbuka) tidak dihitung di rentang ini;
  // insiden tersebut dihitung pada rentang lebih panjang yang memuat titik mulainya.
  // Aturan ini menjamin penghitungan angka selalu stabil dan bersarang (real(24h) <= real(3d) <= ...).
  const inRangeClusters = clusters.filter((cluster) => {
    const incStart = cluster[0].realStart;
    return incStart >= from && incStart <= to;
  });

  const bucketMap = new Map<number, TrafficBucketInput>();
  for (const b of buckets ?? []) {
    bucketMap.set(b.bucketStart, b);
  }

  const incidents: CustomerIncident[] = [];

  for (const cluster of inRangeClusters) {
    const firstOutage = cluster[0];
    const lastOutage = cluster[cluster.length - 1];
    const incFrom = firstOutage.realStart;
    const incTo = lastOutage.to;
    const incEnd = incTo ?? nowSec;
    const outageCount = cluster.length;

    const longestOutageSeconds = Math.max(
      ...cluster.map((o) => (o.realEnd ?? o.to ?? nowSec) - o.realStart),
    );
    const sources = Array.from(
      new Set(cluster.map((o) => o.source)),
    ) as ("live" | "alert")[];

    // Gabungkan interval outage untuk menghitung downSeconds tanpa tumpang tindih ganda
    const rawIntervals = cluster.map((o) => ({
      from: o.from,
      to: o.to ?? nowSec,
    }));
    const mergedIntervals = unionIntervals(rawIntervals);
    const downSeconds = mergedIntervals.reduce(
      (sum, int) => sum + (int.to - int.from),
      0,
    );

    const startMin = getMinuteOfDayWib(incFrom);
    const startWindow = classifyWibMinute(startMin);
    const windows = getTouchedWindows(incFrom, incEnd);

    const isOngoing = incTo === null;
    const isSettled = !isOngoing && nowSec - incTo >= INCIDENT_SETTLE_SECONDS;
    const final = !isOngoing && isSettled;

    // Hitung queueSecondsDuring
    const overlappingBuckets = (buckets ?? []).filter(
      (b) =>
        Math.max(b.bucketStart, incFrom) < Math.min(b.bucketStart + 300, incEnd),
    );
    const queueSecondsDuring =
      overlappingBuckets.length > 0
        ? overlappingBuckets.reduce(
            (sum, b) => sum + Math.min(b.samples, 300),
            0,
          )
        : null;

    const beforeAvgDownMbps = computeAvgDown(buckets ?? [], incFrom - 1800, incFrom);
    const afterAvgDownMbps =
      incTo !== null ? computeAvgDown(buckets ?? [], incTo, incTo + 1800) : null;

    // Hitung cakupan scope (sendiri vs massal vs tidak-diketahui)
    let scopeKind: "sendiri" | "massal" | "tidak-diketahui";
    let otherDown = 0;
    const routerCustomers = scope?.routerCustomers ?? 0;
    if (scope?.routerCustomers === null || scope?.routerCustomers === undefined) {
      scopeKind = "tidak-diketahui";
    } else {
      for (const otherIntervals of scope.others ?? []) {
        const hasOverlap = otherIntervals.some((int) => {
          const oStart = int.from;
          const oEnd = int.to ?? nowSec;
          return Math.max(incFrom, oStart) < Math.min(incEnd, oEnd);
        });
        if (hasOverlap) otherDown++;
      }
      const share = routerCustomers > 0 ? otherDown / routerCustomers : 0;
      if (otherDown >= MASS_MIN_CUSTOMERS && share >= MASS_MIN_SHARE) {
        scopeKind = "massal";
      } else {
        scopeKind = "sendiri";
      }
    }

    // Evaluasi keputusan (verdict)
    let verdict: IncidentVerdict;
    let verdictReason: string;

    if (!final) {
      verdict = "belum-terverifikasi";
      if (incTo === null) {
        verdictReason = "Belum final: gangguan masih berlangsung.";
      } else {
        const settleMin = Math.round(INCIDENT_SETTLE_SECONDS / 60);
        verdictReason = `Belum final: gangguan baru selesai kurang dari ${settleMin} menit lalu (data trafik sedang ditulis).`;
      }
    } else if (
      downSeconds < INCIDENT_MIN_DOWN_SECONDS &&
      outageCount < INCIDENT_MIN_FLAPS
    ) {
      verdict = "kedipan";
      verdictReason = `Terlalu singkat (${outageCount} kali putus, ${formatDuration(downSeconds)}): kedipan.`;
    } else {
      // 1. Verifikasi kontradiksi per bucket 5 menit
      let contradiction: { samples: number; maxAllowed: number } | null = null;
      let maxBucketSamples = 0;
      let maxBucketLimit = 60;
      const minBucket = Math.floor(incFrom / 300) * 300;
      const maxBucket = Math.floor(incEnd / 300) * 300;

      for (let bStart = minBucket; bStart <= maxBucket; bStart += 300) {
        const bEnd = bStart + 300;
        let downInBucket = 0;
        for (const int of mergedIntervals) {
          const oStart = Math.max(bStart, int.from);
          const oEnd = Math.min(bEnd, int.to);
          if (oEnd > oStart) {
            downInBucket += oEnd - oStart;
          }
        }
        if (downInBucket > 0) {
          const maxAllowed =
            300 - downInBucket +
            (sources.includes("alert")
              ? INCIDENT_BUCKET_TOLERANCE_ALERT_SAMPLES
              : INCIDENT_BUCKET_TOLERANCE_SAMPLES);
          const b = bucketMap.get(bStart);
          const s = b?.samples ?? 0;
          if (s >= maxBucketSamples) {
            maxBucketSamples = s;
            maxBucketLimit = maxAllowed;
          }
          if (b && b.samples > maxAllowed) {
            if (
              !contradiction ||
              b.samples - maxAllowed >
                contradiction.samples - contradiction.maxAllowed
            ) {
              contradiction = { samples: b.samples, maxAllowed };
            }
          }
        }
      }

      if (contradiction) {
        verdict = "tidak-terbukti";
        verdictReason = `Trafik tetap mengalir: ${contradiction.samples} sampel di bucket yang seharusnya down (batas ${contradiction.maxAllowed}).`;
      } else {
        // 2. Wajib sampel sebelum dan sesudah
        const hasBefore = (buckets ?? []).some(
          (b) =>
            b.samples > 0 &&
            b.bucketStart < incFrom &&
            b.bucketStart >= incFrom - INCIDENT_EDGE_SECONDS,
        );
        const hasAfter =
          incTo !== null &&
          (buckets ?? []).some(
            (b) =>
              b.samples > 0 &&
              b.bucketStart + 300 > incTo &&
              b.bucketStart <= incTo + INCIDENT_EDGE_SECONDS,
          );

        if (!hasBefore) {
          verdict = "belum-terverifikasi";
          const earliest = (buckets ?? [])
            .filter((b) => b.samples > 0)
            .sort((a, b) => a.bucketStart - b.bucketStart)[0];
          verdictReason = earliest
            ? `Belum ada data trafik tepat sebelum gangguan (data trafik baru ada sejak ${formatWib(earliest.bucketStart)}), tidak bisa diverifikasi.`
            : "Belum ada data trafik tepat sebelum gangguan, tidak bisa diverifikasi.";
        } else if (incTo !== null && !hasAfter) {
          verdict = "belum-terverifikasi";
          verdictReason =
            "Belum ada data trafik setelah gangguan selesai, tidak bisa diverifikasi.";
        } else {
          verdict = "terbukti";
          verdictReason = `Trafik berhenti selama gangguan: sampel antrean di bucket yang tumpang tindih tidak melebihi batas (terbesar ${maxBucketSamples}, batas ${maxBucketLimit}); ada sampel sebelum dan sesudahnya.`;
        }
      }
    }

    incidents.push({
      id: String(incFrom),
      from: incFrom,
      to: incTo,
      downSeconds,
      outageCount,
      longestOutageSeconds,
      sources,
      verdict,
      verdictReason,
      final,
      windows,
      startWindow,
      outages: cluster.slice(-300).map((o) => ({ from: o.from, to: o.to })),
      beforeAvgDownMbps,
      afterAvgDownMbps,
      queueSecondsDuring,
      scope: {
        kind: scopeKind,
        otherDown,
        routerCustomers,
      },
    });
  }

  // Hitung ringkasan
  const realIncidents = incidents.filter(
    (i) => i.verdict === "terbukti" && i.final,
  );
  const realByWindow: Record<PeakWindowId, number> = {
    siang: 0,
    "pulang-sekolah": 0,
    "pulang-kerja": 0,
    "magrib-malam": 0,
    luar: 0,
  };
  for (const i of realIncidents) {
    realByWindow[i.startWindow]++;
  }

  const summary: IncidentSummary = {
    real: realIncidents.length,
    belumTerverifikasi: incidents.filter(
      (i) => i.verdict === "belum-terverifikasi",
    ).length,
    tidakTerbukti: incidents.filter((i) => i.verdict === "tidak-terbukti").length,
    kedipan: incidents.filter((i) => i.verdict === "kedipan").length,
    realDownSeconds: realIncidents.reduce((sum, i) => sum + i.downSeconds, 0),
    realByWindow,
    realMassal: realIncidents.filter((i) => i.scope.kind === "massal").length,
    lastRealAt:
      realIncidents.length > 0
        ? Math.max(...realIncidents.map((i) => i.to ?? i.from))
        : null,
  };

  // Terbaru dulu, maksimal 500
  incidents.sort((a, b) => b.from - a.from);
  const cappedIncidents = incidents.slice(0, 500);

  return {
    incidents: cappedIncidents,
    summary,
  };
}
