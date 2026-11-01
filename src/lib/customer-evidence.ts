import {
  evidenceRanges,
  peakWindows,
  OFF_PEAK_ID,
  OFF_PEAK_LABEL,
  WIB_OFFSET_SECONDS,
  type ConnectionEvent,
  type CustomerEvidence,
  type DayStat,
  type EvidenceFinding,
  type EvidenceRangeId,
  type HourStat,
  type Outage,
  type PeakWindowId,
  type WindowStat,
} from "./customer-evidence-types.ts";
import {
  buildIncidents,
  INCIDENT_LOOKBACK_SECONDS,
  type IncidentScopeInput,
} from "./customer-incidents.ts";
export { buildIncidents, INCIDENT_LOOKBACK_SECONDS, type IncidentScopeInput };
export type { ConnectionEvent };
export interface TrafficBucketInput {
  bucketStart: number;
  samples: number;
  downAvg: number;
  upAvg: number;
  downMax: number;
  upMax: number;
}

export interface BuildCustomerEvidenceInput {
  range: EvidenceRangeId;
  nowSec?: number;
  buckets: TrafficBucketInput[];
  incidentBuckets?: TrafficBucketInput[];
  events: ConnectionEvent[];
  priorEvent?: ConnectionEvent | null;
  lookbackEvents?: ConnectionEvent[];
  lookbackPriorEvent?: ConnectionEvent | null;
  trafficSince?: number | null;
  eventsSince?: number | null;
  scope?: IncidentScopeInput;
}

/** Format detik epoch UTC ke teks tanggal & jam WIB. */
export function formatWib(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d) + " WIB"
  );
}

/** Format durasi detik ke teks ringkas Indonesia. */
export function formatDuration(sec: number): string {
  if (sec <= 0) return "0 detik";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} hari`);
  if (h > 0) parts.push(`${h} jam`);
  if (m > 0) parts.push(`${m} menit`);
  if (s > 0 && d === 0 && h === 0) parts.push(`${s} detik`);
  return parts.length > 0 ? parts.join(" ") : `${sec} detik`;
}

/** Tanggal WIB dalam format "YYYY-MM-DD". */
export function getWibDateString(epochSecUtc: number): string {
  const wibSec = epochSecUtc + WIB_OFFSET_SECONDS;
  return new Date(wibSec * 1000).toISOString().slice(0, 10);
}

/** Menit sejak 00:00 WIB (0..1439). */
export function getMinuteOfDayWib(epochSecUtc: number): number {
  const wibSec = epochSecUtc + WIB_OFFSET_SECONDS;
  const secOfDay = ((wibSec % 86400) + 86400) % 86400;
  return Math.floor(secOfDay / 60);
}

/** Klasifikasi menit-ke-berapa WIB ke kategori jam sibuk. */
export function classifyWibMinute(minOfDay: number): PeakWindowId {
  for (const pw of peakWindows) {
    if (minOfDay >= pw.startMin && minOfDay < pw.endMin) {
      return pw.id;
    }
  }
  return OFF_PEAK_ID;
}

// Batas-batas menit pergantian jam dan jam sibuk dalam satu hari WIB.
const DAY_BOUNDARIES_MIN = [
  0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 750, 780, 840,
  900, 930, 960, 1020, 1050, 1080, 1140, 1200, 1260, 1320, 1380, 1440,
];

export interface RawOutage {
  realStart: number;
  realEnd: number | null;
  from: number;
  to: number | null;
  seconds: number;
  source: "live" | "alert";
  windows: PeakWindowId[];
}

export function buildOutages(
  events: ConnectionEvent[],
  priorEvent: ConnectionEvent | null | undefined,
  from: number,
  to: number,
  nowSec: number = to,
): RawOutage[] {
  let currentKind: "up" | "down" | null = priorEvent ? priorEvent.kind : null;
  let currentSource: "live" | "alert" | null = priorEvent
    ? priorEvent.source
    : null;
  let realDownStart: number | null =
    priorEvent?.kind === "down" ? priorEvent.at : null;

  const rawOutages: RawOutage[] = [];

  for (const ev of events) {
    if (currentKind !== null && ev.kind === currentKind) {
      continue;
    }

    if (ev.kind === "down") {
      realDownStart = ev.at;
      currentSource = ev.source;
    } else if (ev.kind === "up") {
      if (currentKind === "down" && realDownStart !== null) {
        const outageFrom = Math.max(from, realDownStart);
        const outageTo = ev.at;
        const outageSeconds = Math.max(0, outageTo - outageFrom);
        rawOutages.push({
          realStart: realDownStart,
          realEnd: ev.at,
          from: outageFrom,
          to: outageTo,
          seconds: outageSeconds,
          source: currentSource ?? ev.source,
          windows: [],
        });
        realDownStart = null;
      }
    }

    currentKind = ev.kind;
    currentSource = ev.source;
  }

  // Jika masih down di akhir rentang (outage terbuka)
  if (currentKind === "down" && realDownStart !== null) {
    const outageFrom = Math.max(from, realDownStart);
    const outageSeconds = Math.max(0, nowSec - outageFrom);
    rawOutages.push({
      realStart: realDownStart,
      realEnd: null,
      from: outageFrom,
      to: null,
      seconds: outageSeconds,
      source: currentSource ?? "live",
      windows: [],
    });
  }

  return rawOutages;
}

export function buildCustomerEvidence(
  input: BuildCustomerEvidenceInput,
): CustomerEvidence {
  const rangeConfig = evidenceRanges.find((r) => r.id === input.range);
  const rangeSeconds = rangeConfig ? rangeConfig.seconds : 24 * 3600;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const to = nowSec;
  const from = nowSec - rangeSeconds;

  const buckets = input.buckets ?? [];
  const rawEvents = input.events ?? [];
  const priorEvent = input.priorEvent ?? null;

  // 1. Rekonstruksi kejadian & outage dengan deduplikasi kejadian sejenis berturut-turut.
  let currentKind: "up" | "down" | null = priorEvent ? priorEvent.kind : null;
  let currentStateStart: number | null = priorEvent ? priorEvent.at : null;

  const dedupedEvents: ConnectionEvent[] = [];
  for (const ev of rawEvents) {
    if (currentKind !== null && ev.kind === currentKind) {
      continue;
    }
    dedupedEvents.push(ev);
    currentKind = ev.kind;
    currentStateStart = ev.at;
  }

  const rawOutages = buildOutages(rawEvents, priorEvent, from, to, nowSec);

  // 2. Siapkan wadah harian (DayStat) untuk seluruh hari WIB pada rentang [from, to]
  const startDayWibSec =
    Math.floor((from + WIB_OFFSET_SECONDS) / 86400) * 86400;
  const endDayWibSec = Math.floor((to + WIB_OFFSET_SECONDS) / 86400) * 86400;

  const dayMap = new Map<string, DayStat>();
  for (let sec = startDayWibSec; sec <= endDayWibSec; sec += 86400) {
    const dateStr = new Date(sec * 1000).toISOString().slice(0, 10);
    dayMap.set(dateStr, {
      date: dateStr,
      downSeconds: 0,
      outageStarts: 0,
      windows: {
        siang: {
          avgDownMbps: null,
          avgUpMbps: null,
          maxDownMbps: null,
          downSeconds: 0,
        },
        "pulang-sekolah": {
          avgDownMbps: null,
          avgUpMbps: null,
          maxDownMbps: null,
          downSeconds: 0,
        },
        "pulang-kerja": {
          avgDownMbps: null,
          avgUpMbps: null,
          maxDownMbps: null,
          downSeconds: 0,
        },
        "magrib-malam": {
          avgDownMbps: null,
          avgUpMbps: null,
          maxDownMbps: null,
          downSeconds: 0,
        },
        luar: {
          avgDownMbps: null,
          avgUpMbps: null,
          maxDownMbps: null,
          downSeconds: 0,
        },
      },
    });
  }

  // Wadah akumulasi downSeconds per window & hour
  const windowDownSec: Record<PeakWindowId, number> = {
    siang: 0,
    "pulang-sekolah": 0,
    "pulang-kerja": 0,
    "magrib-malam": 0,
    luar: 0,
  };
  const hourDownSec: number[] = Array.from({ length: 24 }, () => 0);

  // 3. Telusuri interval tiap gangguan langkah-demi-batas (boundary walking)
  for (const outage of rawOutages) {
    const outageStart = Math.max(from, outage.from);
    const outageEnd = Math.min(to, outage.to ?? to);
    const touchedSet = new Set<PeakWindowId>();

    let t = outageStart;
    while (t < outageEnd) {
      const wibSec = t + WIB_OFFSET_SECONDS;
      const secOfDay = ((wibSec % 86400) + 86400) % 86400;
      const minOfDay = Math.floor(secOfDay / 60);
      const hour = Math.floor(minOfDay / 60);
      const windowId = classifyWibMinute(minOfDay);
      const dateStr = new Date((wibSec - secOfDay) * 1000)
        .toISOString()
        .slice(0, 10);

      let nextBoundarySecOfDay = 86400;
      for (const b of DAY_BOUNDARIES_MIN) {
        const bSec = b * 60;
        if (bSec > secOfDay) {
          nextBoundarySecOfDay = bSec;
          break;
        }
      }

      const deltaSec = nextBoundarySecOfDay - secOfDay;
      const sliceSec = Math.min(outageEnd - t, deltaSec);

      windowDownSec[windowId] += sliceSec;
      hourDownSec[hour] += sliceSec;
      touchedSet.add(windowId);

      const day = dayMap.get(dateStr);
      if (day) {
        day.downSeconds += sliceSec;
        day.windows[windowId].downSeconds += sliceSec;
      }

      t += sliceSec;
    }

    // Windows yang tersentuh oleh gangguan ini
    const touchedWindows: PeakWindowId[] = [];
    for (const pw of peakWindows) {
      if (touchedSet.has(pw.id)) touchedWindows.push(pw.id);
    }
    if (touchedSet.has(OFF_PEAK_ID)) {
      touchedWindows.push(OFF_PEAK_ID);
    }
    outage.windows = touchedWindows;
  }

  // Hitung outageStarts (hanya gangguan yang mulai dalam rentang waktu [from, to])
  const windowOutageStarts: Record<PeakWindowId, number> = {
    siang: 0,
    "pulang-sekolah": 0,
    "pulang-kerja": 0,
    "magrib-malam": 0,
    luar: 0,
  };

  for (const outage of rawOutages) {
    if (outage.realStart >= from && outage.realStart <= to) {
      const minOfDay = getMinuteOfDayWib(outage.realStart);
      const windowId = classifyWibMinute(minOfDay);
      windowOutageStarts[windowId]++;

      const dateStr = getWibDateString(outage.realStart);
      const day = dayMap.get(dateStr);
      if (day) {
        day.outageStarts++;
      }
    }
  }

  // 4. Akumulasi data sampel trafik untuk WindowStat, DayStat, dan HourStat
  interface BucketAgg {
    count: number;
    totalSamples: number;
    downWeightedSum: number;
    upWeightedSum: number;
    maxDown: number;
    maxUp: number;
    downAvgs: number[];
  }

  const newAgg = (): BucketAgg => ({
    count: 0,
    totalSamples: 0,
    downWeightedSum: 0,
    upWeightedSum: 0,
    maxDown: 0,
    maxUp: 0,
    downAvgs: [],
  });

  const windowAggs: Record<PeakWindowId, BucketAgg> = {
    siang: newAgg(),
    "pulang-sekolah": newAgg(),
    "pulang-kerja": newAgg(),
    "magrib-malam": newAgg(),
    luar: newAgg(),
  };

  const hourAggs: BucketAgg[] = Array.from({ length: 24 }, () => newAgg());

  const dayWindowAggs = new Map<string, Record<PeakWindowId, BucketAgg>>();
  for (const dateStr of dayMap.keys()) {
    dayWindowAggs.set(dateStr, {
      siang: newAgg(),
      "pulang-sekolah": newAgg(),
      "pulang-kerja": newAgg(),
      "magrib-malam": newAgg(),
      luar: newAgg(),
    });
  }

  for (const b of buckets) {
    if (b.bucketStart < from || b.bucketStart >= to) continue;

    const minOfDay = getMinuteOfDayWib(b.bucketStart);
    const windowId = classifyWibMinute(minOfDay);
    const hour = Math.floor(minOfDay / 60);
    const dateStr = getWibDateString(b.bucketStart);

    // Akumulasi Window
    const wAgg = windowAggs[windowId];
    wAgg.count++;
    wAgg.totalSamples += b.samples;
    wAgg.downWeightedSum += b.downAvg * b.samples;
    wAgg.upWeightedSum += b.upAvg * b.samples;
    wAgg.maxDown = Math.max(wAgg.maxDown, b.downMax);
    wAgg.maxUp = Math.max(wAgg.maxUp, b.upMax);
    wAgg.downAvgs.push(b.downAvg);

    // Akumulasi Hour
    const hAgg = hourAggs[hour];
    hAgg.count++;
    hAgg.totalSamples += b.samples;
    hAgg.downWeightedSum += b.downAvg * b.samples;
    hAgg.upWeightedSum += b.upAvg * b.samples;
    hAgg.maxDown = Math.max(hAgg.maxDown, b.downMax);
    hAgg.maxUp = Math.max(hAgg.maxUp, b.upMax);
    hAgg.downAvgs.push(b.downAvg);

    // Akumulasi Day Window
    const dwMap = dayWindowAggs.get(dateStr);
    if (dwMap) {
      const dwAgg = dwMap[windowId];
      dwAgg.count++;
      dwAgg.totalSamples += b.samples;
      dwAgg.downWeightedSum += b.downAvg * b.samples;
      dwAgg.upWeightedSum += b.upAvg * b.samples;
      dwAgg.maxDown = Math.max(dwAgg.maxDown, b.downMax);
      dwAgg.maxUp = Math.max(dwAgg.maxUp, b.upMax);
    }
  }

  // Bangun DayStat.windows metrics
  for (const [dateStr, day] of dayMap.entries()) {
    const dwMap = dayWindowAggs.get(dateStr);
    if (!dwMap) continue;
    for (const pwId of [
      ...peakWindows.map((p) => p.id),
      OFF_PEAK_ID,
    ] as PeakWindowId[]) {
      const agg = dwMap[pwId];
      if (agg.count > 0 && agg.totalSamples > 0) {
        day.windows[pwId].avgDownMbps = Number(
          (agg.downWeightedSum / agg.totalSamples).toFixed(2),
        );
        day.windows[pwId].avgUpMbps = Number(
          (agg.upWeightedSum / agg.totalSamples).toFixed(2),
        );
        day.windows[pwId].maxDownMbps = Number(agg.maxDown.toFixed(2));
      }
    }
  }

  // 5. Bentuk WindowStat list
  const windowDefs: Array<{ id: PeakWindowId; label: string }> = [
    ...peakWindows.map((pw) => ({ id: pw.id, label: pw.label })),
    { id: OFF_PEAK_ID, label: OFF_PEAK_LABEL },
  ];

  const windows: WindowStat[] = windowDefs.map(({ id, label }) => {
    const agg = windowAggs[id];
    let p95DownMbps: number | null = null;
    if (agg.downAvgs.length > 0) {
      agg.downAvgs.sort((a, b) => a - b);
      const k = Math.ceil(0.95 * agg.downAvgs.length);
      const idx = Math.min(agg.downAvgs.length - 1, Math.max(0, k - 1));
      p95DownMbps = Number(agg.downAvgs[idx].toFixed(2));
    }

    return {
      id,
      label,
      bucketCount: agg.count,
      avgDownMbps:
        agg.count > 0 && agg.totalSamples > 0
          ? Number((agg.downWeightedSum / agg.totalSamples).toFixed(2))
          : null,
      avgUpMbps:
        agg.count > 0 && agg.totalSamples > 0
          ? Number((agg.upWeightedSum / agg.totalSamples).toFixed(2))
          : null,
      p95DownMbps,
      maxDownMbps: agg.count > 0 ? Number(agg.maxDown.toFixed(2)) : null,
      maxUpMbps: agg.count > 0 ? Number(agg.maxUp.toFixed(2)) : null,
      downSeconds: windowDownSec[id],
      outageStarts: windowOutageStarts[id],
    };
  });

  // 6. Bentuk HourStat list (0..23)
  const hourly: HourStat[] = Array.from({ length: 24 }, (_, h) => {
    const agg = hourAggs[h];
    return {
      hour: h,
      bucketCount: agg.count,
      avgDownMbps:
        agg.count > 0 && agg.totalSamples > 0
          ? Number((agg.downWeightedSum / agg.totalSamples).toFixed(2))
          : null,
      avgUpMbps:
        agg.count > 0 && agg.totalSamples > 0
          ? Number((agg.upWeightedSum / agg.totalSamples).toFixed(2))
          : null,
      downSeconds: hourDownSec[h],
    };
  });

  const daily: DayStat[] = Array.from(dayMap.values());

  // 7. Hitung ringkasan koneksi & uptime%
  const totalDownSeconds = rawOutages.reduce((sum, o) => sum + o.seconds, 0);
  const longestOutageSeconds = rawOutages.reduce(
    (max, o) => Math.max(max, o.seconds),
    0,
  );
  const flapCount = rawOutages.filter((o) => o.seconds < 300).length;

  let uptimePct: number | null = null;
  if (priorEvent === null && rawEvents.length === 0) {
    uptimePct = null;
  } else {
    const evalStart = priorEvent !== null ? from : rawEvents[0].at;
    const evalDuration = to - evalStart;
    if (evalDuration <= 0) {
      uptimePct = 100;
    } else {
      const uptimeSec = Math.max(0, evalDuration - totalDownSeconds);
      uptimePct = Math.min(
        100,
        Math.max(0, Number(((uptimeSec / evalDuration) * 100).toFixed(2))),
      );
    }
  }

  // 8. Coverage calculation
  const trafficSince =
    input.trafficSince !== undefined
      ? input.trafficSince
      : buckets.length > 0
        ? buckets[0].bucketStart
        : null;

  const eventsSince =
    input.eventsSince !== undefined
      ? input.eventsSince
      : priorEvent !== null
        ? priorEvent.at
        : rawEvents.length > 0
          ? rawEvents[0].at
          : null;

  const effTrafficStart =
    trafficSince !== null ? Math.max(from, trafficSince) : from;
  const expectedBuckets = Math.max(0, Math.floor((to - effTrafficStart) / 300));

  const eventsCoverRange =
    priorEvent !== null ||
    (rawEvents.length > 0 && rawEvents[0].at <= from + 300);

  const notes: string[] = [];
  if (trafficSince !== null && trafficSince > from) {
    notes.push(
      `Data trafik baru tersimpan sejak ${formatWib(trafficSince)}; sebelum itu tidak ada bukti.`,
    );
  } else if (trafficSince === null) {
    notes.push(
      "Belum ada data sampel trafik yang tersimpan untuk pelanggan ini.",
    );
  }

  if (eventsSince !== null && eventsSince > from) {
    notes.push(
      `Catatan kejadian koneksi baru tersimpan sejak ${formatWib(eventsSince)}; status sebelum itu tidak tercatat.`,
    );
  } else if (
    eventsSince === null &&
    priorEvent === null &&
    rawEvents.length === 0
  ) {
    notes.push(
      "Belum ada riwayat kejadian koneksi yang tercatat untuk pelanggan ini.",
    );
  }

  if (rawOutages.some((o) => o.source === "alert")) {
    notes.push(
      "Sebagian gangguan disusun dari alert lama; waktunya mengikuti deteksi alert.",
    );
  }

  notes.push(
    "Latensi dan packet loss pelanggan tidak direkam terus-menerus; bukti ini hanya putus-nyambung dan trafik. Penurunan trafik bisa berarti jaringan lambat atau pelanggan memang kurang memakai.",
  );
  notes.push(
    "Catatan kejadian koneksi dapat berlubang jika backend pemantau sempat berhenti berjalan.",
  );

  const incidentOutages = input.lookbackEvents
    ? buildOutages(
        input.lookbackEvents,
        input.lookbackPriorEvent,
        nowSec - INCIDENT_LOOKBACK_SECONDS,
        to,
        nowSec,
      )
    : rawOutages;

  const { incidents, summary: incidentSummary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: incidentOutages,
    buckets: input.incidentBuckets ?? buckets,
    scope: input.scope,
  });

  // 9. Temuan bukti (Findings)
  const findings: EvidenceFinding[] = [];
  const hasAnyData =
    buckets.length > 0 || rawEvents.length > 0 || priorEvent !== null;

  if (!hasAnyData) {
    findings.push({
      severity: "info",
      text: "Tidak ada data sampel trafik maupun riwayat koneksi pada rentang waktu ini.",
    });
  } else {
    // Sedang down
    if (currentKind === "down") {
      const sinceText =
        currentStateStart !== null ? ` sejak ${formatWib(currentStateStart)}` : "";
      findings.push({
        severity: "warn",
        text: `Koneksi pelanggan saat ini sedang terputus (down${sinceText}).`,
      });
    }

    // Ringkasan gangguan nyata
    if (incidentSummary.real > 0) {
      findings.push({
        severity: "warn",
        text: `${incidentSummary.real} gangguan nyata terverifikasi (total durasi ${formatDuration(incidentSummary.realDownSeconds)})${incidentSummary.realMassal > 0 ? `, ${incidentSummary.realMassal} di antaranya gangguan massal` : ""}.`,
      });
    }

    // Kejadian putus mentah tercatat
    if (rawOutages.length > 0) {
      findings.push({
        severity: "info",
        text: `Kejadian putus mentah (belum digabung): ${rawOutages.length} kali, total down ${formatDuration(totalDownSeconds)}, terlama ${formatDuration(longestOutageSeconds)}. Angka gangguan nyata ada di ringkasan.`,
      });
    }
    if (rawOutages.length === 0 && currentKind === "up") {
      findings.push({
        severity: "info",
        text: `Koneksi stabil tanpa gangguan yang tercatat selama rentang ini (uptime ${uptimePct ?? 100}%).`,
      });
    }

    // Flapping
    if (flapCount >= 3) {
      findings.push({
        severity: "warn",
        text: `Terdeteksi flapping: ada ${flapCount} kali gangguan singkat (< 5 menit), menandakan koneksi tidak stabil.`,
      });
    }

    // Gangguan di jam sibuk
    const peakOutages = rawOutages.filter((o) =>
      o.windows.some((w) => w !== OFF_PEAK_ID),
    );
    if (peakOutages.length > 0) {
      const touchedPeakIds = Array.from(
        new Set(
          peakOutages.flatMap((o) => o.windows).filter((w) => w !== OFF_PEAK_ID),
        ),
      );
      const labels = touchedPeakIds
        .map((id) => peakWindows.find((pw) => pw.id === id)?.label ?? id)
        .join(", ");
      findings.push({
        severity: "warn",
        text: `${peakOutages.length} dari ${rawOutages.length} kejadian putus mentah menyentuh jam sibuk (${labels}); kolom "mulai gangguan" di tabel hanya menghitung yang dimulai di jam itu.`,
      });
    }

    // Perbandingan per window dengan off-peak
    const luarStat = windows.find((w) => w.id === OFF_PEAK_ID);
    if (luarStat && luarStat.avgDownMbps !== null && luarStat.avgDownMbps > 0) {
      for (const pw of peakWindows) {
        const stat = windows.find((w) => w.id === pw.id);
        if (
          stat &&
          stat.bucketCount >= 12 &&
          stat.avgDownMbps !== null &&
          stat.avgDownMbps < 0.5 * luarStat.avgDownMbps
        ) {
          findings.push({
            severity: "warn",
            text: `Trafik turun di jam sibuk (${stat.label}): rata-rata unduh hanya ${stat.avgDownMbps} Mbps (< 50% dari rata-rata luar jam sibuk ${luarStat.avgDownMbps} Mbps).`,
          });
        }
      }
    }
  }

  // Format final outages (terbaru dulu)
  const outages: Outage[] = rawOutages
    .map((o) => ({
      from: o.from,
      to: o.to,
      seconds: o.seconds,
      source: o.source,
      windows: o.windows,
    }))
    .reverse();

  // Events (terbaru dulu, maksimal 200)
  const events: ConnectionEvent[] = dedupedEvents.slice().reverse().slice(0, 200);

  return {
    range: input.range,
    from,
    to,
    coverage: {
      trafficSince,
      eventsSince,
      trafficBuckets: buckets.length,
      expectedBuckets,
      eventsCoverRange,
      notes,
    },
    connection: {
      state: currentKind ?? "unknown",
      since: currentStateStart,
      events,
      outages,
      summary: {
        outageCount: rawOutages.length,
        downSeconds: totalDownSeconds,
        uptimePct,
        longestOutageSeconds,
        flapCount,
      },
    },
    windows,
    daily,
    hourly,
    findings,
    incidents,
    incidentSummary,
  };
}
