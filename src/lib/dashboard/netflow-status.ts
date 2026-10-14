export const NETFLOW_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export interface NetflowStatus {
  isDemo: boolean;
  totalSamples: number;
  lastCapturedAt: string | null;
  isActive: boolean;
  activeRoutersCount: number;
}

// Murni: mode demo selalu dianggap aktif; selain itu aktif bila sampel terakhir <= 5 menit.
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
    isActive: isDemo || age <= NETFLOW_ACTIVE_WINDOW_MS,
    activeRoutersCount: input.activeRoutersCount,
  };
}
