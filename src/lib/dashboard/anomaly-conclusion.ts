import {
  diagnosticLayers,
  layerLabel,
  type DiagnosticLayer,
  type DiagnosticRunDto,
  type VerdictScope,
} from "../diagnostics.ts";
import {
  layerInfo,
  formatSource,
  type SourceInfo,
} from "../diagnostic-sources.ts";

export { layerInfo, formatSource, type SourceInfo };

export const scopeBadgeLabels: Record<VerdictScope, string> = {
  own: "Gangguan pelanggan ini",
  shared: "Gangguan bersama",
  unknown: "Cakupan belum dapat dipastikan",
};

/**
 * Aturan tetap tindak lanjut per lapisan diagnosa (deterministik, bukan probabilitas).
 * Diselaraskan untuk 9 lapisan PRD Fase 1-9.
 */
export const RECOMMENDED_ACTIONS: Record<DiagnosticLayer, string> = {
  hulu: "Periksa uplink/BGP router, jangan kirim teknisi ke rumah pelanggan.",
  mikrotik: "Periksa sesi PPPoE/queue pelanggan di router.",
  log: "Tinjau riwayat flapping/auth fail pada log router.",
  firewall: "Periksa aturan firewall/NAT yang memblokir trafik pelanggan.",
  optik: "Periksa redaman ODP/konektor, jadwalkan teknisi.",
  ont: "Cek daya & kabel modem pelanggan.",
  trafik: "Periksa saturasi bandwidth dan host lawan dominan.",
  aktif: "Periksa latensi ping & packet loss ke pelanggan.",
  billing: "Periksa status pembayaran dan isolir di sistem billing.",
};

export function getRecommendation(layer: string | null | undefined): string {
  if (layer && layer in RECOMMENDED_ACTIONS) {
    return RECOMMENDED_ACTIONS[layer as DiagnosticLayer];
  }
  return "Tinjau temuan diagnosa dan konfigurasi jaringan.";
}

export function clipDetail(text: string | null | undefined, maxLen = 160): string {
  if (!text) return "—";
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1).trimEnd() + "…";
}

export function formatAge(
  dateStr: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "baru saja";
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "baru saja";
  if (diffMinutes < 60) return `${diffMinutes} menit lalu`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} hari lalu`;
}

export interface ConclusionCard {
  runId: string;
  title: string;
  customerName: string | null;
  rootName: string | null;
  affectedCount: number | null;
  layer: DiagnosticLayer | null;
  layerLabel: string;
  scope: VerdictScope;
  scopeLabel: string;
  detail: string;
  rawDetail: string | null;
  finishedAt: string | null;
  age: string;
  recommendation: string;
  sources: SourceInfo[];
  explain: string;
}

export interface LayerDistributionItem {
  layer: string;
  label: string;
  count: number;
}

export interface AnomalyConclusionSummary {
  totalDiagnosed: number;
  sharedCount: number;
  ownCount: number;
  unknownCount: number;
  failedCount: number;
  headline: string;
  layerDistribution: LayerDistributionItem[];
  topCards: ConclusionCard[];
}

/**
 * Agregasi seluruh hasil diagnosa pelanggan dan gangguan bersama.
 * - Mengabaikan queued/running/failed untuk inferensi (failed dihitung terpisah)
 * - Mempertahankan HANYA run selesai terbaru per pelanggan (atau per root untuk shared-fault tanpa pelanggan)
 * - Menghasilkan headline deterministik, distribusi per lapisan, dan maks 3 kartu teratas
 */
export function aggregateConclusions(
  runs: DiagnosticRunDto[],
  now: Date = new Date(),
): AnomalyConclusionSummary {
  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      totalDiagnosed: 0,
      sharedCount: 0,
      ownCount: 0,
      unknownCount: 0,
      failedCount: 0,
      headline:
        "0 pelanggan didiagnosa: 0 gangguan bersama, 0 gangguan pelanggan sendiri, 0 belum dapat dipastikan",
      layerDistribution: [],
      topCards: [],
    };
  }

  let failedCount = 0;
  const finishedRuns: DiagnosticRunDto[] = [];

  for (const r of runs) {
    if (r.status === "failed") {
      failedCount++;
    } else if (r.status === "done") {
      finishedRuns.push(r);
    }
  }

  // Deduplikasi run selesai terbaru per pelanggan (atau per root untuk gangguan bersama tanpa pelanggan)
  const grouped = new Map<string, DiagnosticRunDto>();

  for (const r of finishedRuns) {
    const key = r.customerId
      ? `customer:${r.customerId}`
      : `root:${r.verdictRoot?.name ?? r.id}`;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, r);
    } else {
      const existingTime = new Date(
        existing.finishedAt || existing.createdAt,
      ).getTime();
      const newTime = new Date(r.finishedAt || r.createdAt).getTime();
      if (newTime > existingTime) {
        grouped.set(key, r);
      } else if (
        newTime === existingTime &&
        r.id.localeCompare(existing.id) > 0
      ) {
        grouped.set(key, r);
      }
    }
  }

  const latestRuns = Array.from(grouped.values());

  let sharedCount = 0;
  let ownCount = 0;
  let unknownCount = 0;

  const layerCounts: Record<string, number> = {};

  for (const r of latestRuns) {
    const isShared = isSharedRun(r);
    if (isShared) {
      sharedCount++;
    } else if (r.verdictScope === "own") {
      ownCount++;
    } else {
      unknownCount++;
    }

    if (r.verdictLayer) {
      layerCounts[r.verdictLayer] = (layerCounts[r.verdictLayer] ?? 0) + 1;
    }
  }

  const totalDiagnosed = latestRuns.length;
  const headline = `${totalDiagnosed} pelanggan didiagnosa: ${sharedCount} gangguan bersama, ${ownCount} gangguan pelanggan sendiri, ${unknownCount} belum dapat dipastikan`;

  // Urutkan distribusi lapisan berdasarkan jumlah terbanyak, lalu nama label
  const layerDistribution: LayerDistributionItem[] = Object.entries(layerCounts)
    .filter(([_, count]) => count > 0)
    .map(([layer, count]) => ({
      layer,
      label: layerLabel(layer),
      count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });

  // Urutkan kartu teratas: gangguan bersama dulu (paling banyak terdampak), lalu gangguan sendiri terbaru
  const sortedForCards = [...latestRuns].sort((a, b) => {
    const aShared = isSharedRun(a);
    const bShared = isSharedRun(b);

    if (aShared && !bShared) return -1;
    if (!aShared && bShared) return 1;

    if (aShared && bShared) {
      const aAff = a.verdictRoot?.affected ?? 0;
      const bAff = b.verdictRoot?.affected ?? 0;
      if (bAff !== aAff) return bAff - aAff; // Most affected first
      const aTime = new Date(a.finishedAt || a.createdAt).getTime();
      const bTime = new Date(b.finishedAt || b.createdAt).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return a.id.localeCompare(b.id);
    }

    // Keduanya bukan gangguan bersama
    const aScope = a.verdictScope === "own" ? 1 : 2;
    const bScope = b.verdictScope === "own" ? 1 : 2;
    if (aScope !== bScope) return aScope - bScope;

    const aTime = new Date(a.finishedAt || a.createdAt).getTime();
    const bTime = new Date(b.finishedAt || b.createdAt).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });

  // Satu gangguan bersama didiagnosa dari banyak pelanggan: tampilkan sekali per
  // akar (yang paling banyak terdampak sudah di depan). Hitungan judul tetap utuh.
  const seenSharedRoots = new Set<string>();
  const uniqueForCards = sortedForCards.filter((r) => {
    if (!isSharedRun(r)) return true;
    const key = r.verdictRoot
      ? `${r.verdictRoot.kind}:${r.verdictRoot.name}`
      : "tanpa-akar";
    if (seenSharedRoots.has(key)) return false;
    seenSharedRoots.add(key);
    return true;
  });

  const topCards: ConclusionCard[] = uniqueForCards.slice(0, 3).map((r) => {
    const isShared = isSharedRun(r);
    const title =
      isShared && !r.customerName && r.verdictRoot?.name
        ? r.verdictRoot.name
        : r.customerName ||
          r.verdictRoot?.name ||
          r.pppoeUsername ||
          r.customerId ||
          (isShared ? "Gangguan bersama" : "Pelanggan tanpa nama");

    const layer = (r.verdictLayer as DiagnosticLayer) ?? null;
    const scope: VerdictScope = isShared
      ? "shared"
      : r.verdictScope === "own"
        ? "own"
        : "unknown";

    return {
      runId: r.id,
      title,
      customerName: r.customerName ?? null,
      rootName: r.verdictRoot?.name ?? null,
      affectedCount: r.verdictRoot?.affected ?? null,
      layer,
      layerLabel: r.verdictLayer ? layerLabel(r.verdictLayer) : "—",
      scope,
      scopeLabel: scopeBadgeLabels[scope],
      detail: clipDetail(r.verdictDetail, 160),
      rawDetail: r.verdictDetail ?? null,
      finishedAt: r.finishedAt ?? null,
      age: formatAge(r.finishedAt, now),
      recommendation: getRecommendation(layer),
      sources: (r.verdictLayer ? layerInfo(r.verdictLayer) : { explain: "Belum ada informasi sumber.", sources: [] }).sources,
      explain: (r.verdictLayer ? layerInfo(r.verdictLayer) : { explain: "Belum ada informasi sumber.", sources: [] }).explain,
    };
  });

  return {
    totalDiagnosed,
    sharedCount,
    ownCount,
    unknownCount,
    failedCount,
    headline,
    layerDistribution,
    topCards,
  };
}

// Satu aturan "gangguan bersama" untuk hitungan judul, urutan, dan kartu.
function isSharedRun(r: {
  verdictScope?: string | null;
  isSharedFault?: boolean | null;
}) {
  return (
    r.verdictScope === "shared" ||
    (r.verdictScope == null && Boolean(r.isSharedFault))
  );
}
