// captured_at = AWAL bucket 5 menit dan hanya bucket selesai yang di-flush tiap menit,
// jadi sampel terbaru collector sehat berumur ~5-11 menit; 15 menit memberi ruang flush terlambat.
export const NETFLOW_FRESH_MS = 15 * 60 * 1000;

export interface NetflowStatus {
  isDemo: boolean;
  totalSamples: number;
  lastCapturedAt: string | null;
  isActive: boolean;
  activeRoutersCount: number;
}

// Murni: mode demo selalu dianggap aktif; selain itu aktif bila sampel terakhir <= NETFLOW_FRESH_MS.
export function buildNetflowStatus(input: {
  isDemo: boolean;
  totalSamples: number;
  lastCapturedAt: Date | null;
  activeRoutersCount: number;
  nowMs: number;
}): NetflowStatus {
  const { isDemo, lastCapturedAt, nowMs } = input;
  const age = lastCapturedAt ? nowMs - lastCapturedAt.getTime() : Infinity;
  return {
    isDemo,
    totalSamples: input.totalSamples,
    lastCapturedAt: lastCapturedAt ? lastCapturedAt.toISOString() : null,
    isActive: isDemo || age <= NETFLOW_FRESH_MS,
    activeRoutersCount: input.activeRoutersCount,
  };
}
