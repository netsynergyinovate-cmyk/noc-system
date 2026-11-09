// Klasifikasi sinyal optik PON. Satu sumber untuk badge dan filter di UI.
export type OpticalLevel =
  "ideal" | "warning" | "critical" | "overload" | "los";

export interface OpticalStatus {
  level: OpticalLevel;
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  isOutOfThreshold: boolean;
  description: string;
}

/** Status RX ONU/ONT (dBm). null/undefined dianggap tidak ada sinyal (LOS). */
export function getOpticalSignalStatus(
  rxDbm: number | null | undefined,
): OpticalStatus {
  if (rxDbm == null || Number.isNaN(rxDbm) || rxDbm <= -35) {
    return {
      level: "los",
      label: "LOS (Putus)",
      tone: "danger",
      isOutOfThreshold: true,
      description: "Tidak ada sinyal optik (LOS).",
    };
  }
  if (rxDbm <= -30) {
    return {
      level: "critical",
      label: "Kritis (<= -30 dBm)",
      tone: "danger",
      isOutOfThreshold: true,
      description:
        "Redaman loss tinggi di atas -30 dBm; periksa konektor, splitter, atau kabel.",
    };
  }
  if (rxDbm <= -26) {
    return {
      level: "warning",
      label: "Peringatan (<= -26 dBm)",
      tone: "warning",
      isOutOfThreshold: true,
      description: "Redaman mencapai batas -26 dBm; pantau.",
    };
  }
  if (rxDbm > -8) {
    return {
      level: "overload",
      label: "Overload (> -8 dBm)",
      tone: "warning",
      isOutOfThreshold: true,
      description: "Daya terlalu kuat; risiko ONU jenuh, pasang attenuator.",
    };
  }
  return {
    level: "ideal",
    label: "Normal",
    tone: "success",
    isOutOfThreshold: false,
    description: "Sinyal optik dalam batas normal.",
  };
}

/** Redaman optik (dB) = TX - RX, positif. null bila TX kosong atau RX kosong/LOS (<= -35). */
export function calculateOpticalLoss(
  txDbm: number | null | undefined,
  rxDbm: number | null | undefined,
): number | null {
  if (txDbm == null || Number.isNaN(txDbm)) return null;
  if (rxDbm == null || Number.isNaN(rxDbm) || rxDbm <= -35) return null;
  return Math.round((txDbm - rxDbm) * 10) / 10;
}

/** TX ONU Class B+ normal: 1.0 s/d 3.5 dBm (inklusif). */
export function getOnuTxStatus(txDbm: number | null | undefined): {
  ok: boolean;
  label: string;
} {
  if (txDbm == null || Number.isNaN(txDbm))
    return { ok: false, label: "Tidak ada data TX" };
  if (txDbm < 1.0) return { ok: false, label: "TX terlalu rendah (< 1.0 dBm)" };
  if (txDbm > 3.5) return { ok: false, label: "TX terlalu tinggi (> 3.5 dBm)" };
  return { ok: true, label: "TX normal (1.0 s/d 3.5 dBm)" };
}

/** Pendek untuk badge sempit. */
export const OPTICAL_SHORT_LABEL: Record<OpticalLevel, string> = {
  ideal: "Normal",
  warning: "Peringatan",
  critical: "Kritis",
  overload: "Overload",
  los: "LOS",
};

export const OPTICAL_TONE_CLASS: Record<OpticalStatus["tone"], string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

export const OPTICAL_TEXT_CLASS: Record<OpticalStatus["tone"], string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Batas port PON: Tx +1.5..+5.0 dBm, Rx -28.0..-8.0 dBm (inklusif). */
export function getPonPortOpticalStatus(
  rxDbm: number | null,
  txDbm: number | null,
): { isTxNormal: boolean; isRxNormal: boolean; isOutOfThreshold: boolean } {
  // Tidak ada data (null) = tidak dinilai, bukan pelanggaran ambang.
  const isTxNormal = txDbm == null || (txDbm >= 1.5 && txDbm <= 5.0);
  const isRxNormal = rxDbm == null || (rxDbm >= -28.0 && rxDbm <= -8.0);
  return {
    isTxNormal,
    isRxNormal,
    isOutOfThreshold: !isTxNormal || !isRxNormal,
  };
}
