import type { Anomaly } from "./anomalies.ts";

// Panduan penanganan per jenis anomali. Murni: tanpa React.
export interface TroubleshootingGuide {
  rootCauseHypothesis: string;
  steps: string[];
  cliHelp?: string;
}

export function getAnomalyTroubleshootingSteps(
  anomaly: Pick<Anomaly, "kind">,
): TroubleshootingGuide {
  switch (anomaly.kind) {
    case "queue":
      return {
        rootCauseHypothesis:
          "Antrean penuh: bandwidth plan pelanggan terlalu kecil atau ada bottleneck pada queue tree / simple queue.",
        steps: [
          "Periksa bandwidth plan pelanggan, cek bottleneck queue tree / simple queue",
          "Cari pelanggan dengan pemakaian tertinggi pada antrean itu",
          "Bandingkan max-limit antrean dengan paket langganan",
        ],
        cliHelp: "/queue simple print",
      };
    case "cpu":
      return {
        rootCauseHypothesis:
          "CPU router tinggi: kemungkinan loop aturan firewall atau serangan SYN flood.",
        steps: [
          "Periksa process list di MikroTik, firewall rules loop, attack SYN flood",
          "Lihat proses yang memakai CPU terbanyak",
          "Blokir sumber serangan bila terbukti",
        ],
        cliHelp: "/tool profile",
      };
    case "port":
      return {
        rootCauseHypothesis:
          "Error pada port: kabel/SFP bermasalah atau duplex tidak cocok.",
        steps: [
          "Cek fisik kabel UTP/SFP, duplex mismatch, penggantian patchcord optik",
          "Bersihkan konektor dan pasang ulang modul SFP",
          "Pantau counter error setelah perbaikan",
        ],
        cliHelp: "/interface ethernet monitor [find]",
      };
    case "optical":
      return {
        rootCauseHypothesis:
          "Redaman Rx ONU terlalu besar: kabel drop, splitter ODP, atau fiber tertekuk.",
        steps: [
          "Redaman RX drop, cek kabel drop, ODP splitter, atau bending fiber",
          "Ukur daya optik di ODP dan di ONU, bandingkan",
          "Bersihkan konektor atau ganti kabel drop bila perlu",
        ],
        cliHelp: "show pon power olt",
      };
    case "offline":
      return {
        rootCauseHypothesis:
          "Pelanggan offline: listrik padam, ONT mati, atau kabel putus.",
        steps: [
          "Pelanggan offline, konfirmasi listrik padam, cek ONT power atau kabel putus",
          "Hubungi pelanggan untuk memastikan lampu ONT",
          "Jadwalkan teknisi bila kabel putus",
        ],
      };
  }
}

// --- Penandaan "ditinjau" (mock lokal; backend menggantikannya) ---

export const REVIEWED_STORAGE_KEY = "handled_anomalies";

export interface ReviewedEntry {
  operator: string;
  reviewedAt: string;
}

// Cadangan bila localStorage tidak bisa dipakai.
let memory: Record<string, ReviewedEntry> = {};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getReviewedAnomalies(): Record<string, ReviewedEntry> {
  const store = storage();
  if (!store) return { ...memory };
  try {
    const parsed: unknown = JSON.parse(
      store.getItem(REVIEWED_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, ReviewedEntry> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const entry = value as Partial<ReviewedEntry> | null;
      if (
        entry &&
        typeof entry.operator === "string" &&
        typeof entry.reviewedAt === "string"
      ) {
        result[id] = { operator: entry.operator, reviewedAt: entry.reviewedAt };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function write(all: Record<string, ReviewedEntry>) {
  const store = storage();
  if (store) {
    try {
      store.setItem(REVIEWED_STORAGE_KEY, JSON.stringify(all));
      return;
    } catch {
      // jatuh ke memori
    }
  }
  memory = { ...all };
}

export function markAnomalyReviewed(anomalyId: string, operator: string) {
  const reviewedAt = new Date().toISOString();
  write({ ...getReviewedAnomalies(), [anomalyId]: { operator, reviewedAt } });
  return { anomalyId, operator, reviewedAt };
}

export function isAnomalyReviewed(anomalyId: string) {
  return Object.prototype.hasOwnProperty.call(
    getReviewedAnomalies(),
    anomalyId,
  );
}

export function clearReviewedAnomalies() {
  memory = {};
  const store = storage();
  try {
    store?.removeItem(REVIEWED_STORAGE_KEY);
  } catch {
    // abaikan
  }
}
