// Klasifikasi masalah ONU. Murni: tanpa I/O, aman dipakai di server maupun browser.

export type OnuTroubleSeverity = "critical" | "warning" | "normal";
export type OnuTroubleCategory =
  | "optical_los" // Kabel fiber putus / LOS
  | "optical_critical" // RX < -27 dBm (sangat redam)
  | "optical_warning" // -27 dBm <= RX < -25 dBm (sinyal pas-pasan)
  | "power_off" // Status offline / mati listrik
  | "distance_anomaly" // Jarak > 15 km
  | "healthy";

export interface OnuTroubleEvaluation {
  severity: OnuTroubleSeverity;
  category: OnuTroubleCategory;
  isTroubled: boolean;
  badgeLabel: string;
  troubleDescription: string;
  recommendation: string;
  rowClassName?: string;
}

export const ONU_OPTICAL_CRITICAL_DBM = -27;
export const ONU_OPTICAL_WARNING_DBM = -25;
export const ONU_MAX_SAFE_DISTANCE_METERS = 15000;

export interface OnuTroubleInput {
  status: "online" | "offline" | "los";
  rxPowerDbm: number | null;
  distanceMeters?: number | null;
}

const CRITICAL_ROW = "bg-destructive/5 border-l-4 border-l-destructive";
const WARNING_ROW = "bg-warning/5 border-l-4 border-l-warning";

export function classifyOnuTrouble(onu: OnuTroubleInput): OnuTroubleEvaluation {
  const { status, rxPowerDbm: rx, distanceMeters: dist } = onu;

  if (status === "los") {
    return {
      severity: "critical",
      category: "optical_los",
      isTroubled: true,
      badgeLabel: "Kabel Putus (LOS)",
      troubleDescription: "ONU kehilangan sinyal optik (LOS).",
      recommendation: "Periksa sambungan kabel drop/pigtail atau ODP",
      rowClassName: CRITICAL_ROW,
    };
  }
  if (status === "offline") {
    return {
      severity: "warning",
      category: "power_off",
      isTroubled: true,
      badgeLabel: "Modem Mati",
      troubleDescription: "ONU offline, kemungkinan tanpa daya.",
      recommendation: "Konfirmasi listrik pelanggan atau adaptor ONT",
      rowClassName: WARNING_ROW,
    };
  }
  if (rx !== null && rx < ONU_OPTICAL_CRITICAL_DBM) {
    return {
      severity: "critical",
      category: "optical_critical",
      isTroubled: true,
      badgeLabel: "Redaman Kritis (< -27 dBm)",
      troubleDescription: `RX ${rx} dBm, di bawah batas kritis ${ONU_OPTICAL_CRITICAL_DBM} dBm.`,
      recommendation: "Cleaning patchcord atau fusion ulang splicing optik",
      rowClassName: CRITICAL_ROW,
    };
  }
  if (rx !== null && rx < ONU_OPTICAL_WARNING_DBM) {
    return {
      severity: "warning",
      category: "optical_warning",
      isTroubled: true,
      badgeLabel: "Sinyal Lemah (< -25 dBm)",
      troubleDescription: `RX ${rx} dBm, di bawah batas ${ONU_OPTICAL_WARNING_DBM} dBm.`,
      recommendation: "Optimasi redaman sebelum pelanggan komplain",
      rowClassName: WARNING_ROW,
    };
  }
  if (dist != null && dist > ONU_MAX_SAFE_DISTANCE_METERS) {
    return {
      severity: "warning",
      category: "distance_anomaly",
      isTroubled: true,
      badgeLabel: "Jarak Tidak Wajar",
      troubleDescription: `Jarak ${dist} m melebihi ${ONU_MAX_SAFE_DISTANCE_METERS} m.`,
      recommendation: "Verifikasi pemetaan ONU ke port PON dan panjang kabel",
      rowClassName: WARNING_ROW,
    };
  }
  return {
    severity: "normal",
    category: "healthy",
    isTroubled: false,
    badgeLabel: "Normal",
    troubleDescription: "Tidak ada masalah terdeteksi.",
    recommendation: "Tidak perlu tindakan",
  };
}

export function summarizeOnuTroubles(onus: readonly OnuTroubleInput[]): {
  total: number;
  troubled: number;
  criticalCount: number;
  warningCount: number;
  losCount: number;
  healthyCount: number;
} {
  const s = { total: onus.length, troubled: 0, criticalCount: 0, warningCount: 0, losCount: 0, healthyCount: 0 };
  for (const o of onus) {
    const e = classifyOnuTrouble(o);
    if (e.isTroubled) s.troubled++;
    else s.healthyCount++;
    if (e.severity === "critical") s.criticalCount++;
    if (e.severity === "warning") s.warningCount++;
    if (e.category === "optical_los") s.losCount++;
  }
  return s;
}
