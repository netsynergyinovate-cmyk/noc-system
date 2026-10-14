// Rentang waktu pada grafik traffic. "live" adalah jendela 5 menit yang bergerak
// tiap detik dari memori; sisanya adalah arsip histori (traffic_samples) yang
// diringkas ke resolusi yang cukup agar tiap rentang berisi paling banyak
// sekitar 400 titik.
export type TrafficRangeId = "live" | "1h" | "6h" | "24h" | "7d";

export interface TrafficRange {
  id: TrafficRangeId;
  label: string;
  // Panjang rentang dalam detik.
  seconds: number;
  // Jarak antar titik pada data histori; kosong untuk "live" (1 detik).
  stepSeconds?: number;
}

export const TRAFFIC_RANGES: readonly TrafficRange[] = [
  { id: "live", label: "5 menit", seconds: 300 },
  { id: "1h", label: "1 jam", seconds: 3600, stepSeconds: 10 },
  { id: "6h", label: "6 jam", seconds: 6 * 3600, stepSeconds: 60 },
  { id: "24h", label: "24 jam", seconds: 24 * 3600, stepSeconds: 300 },
  { id: "7d", label: "7 hari", seconds: 7 * 24 * 3600, stepSeconds: 1800 },
];

export const DEFAULT_RANGE: TrafficRangeId = "live";

export function getRange(id: TrafficRangeId): TrafficRange {
  return TRAFFIC_RANGES.find((range) => range.id === id) ?? TRAFFIC_RANGES[0];
}
