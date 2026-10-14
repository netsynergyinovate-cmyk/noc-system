export interface RouterTrafficStats {
  hasData: boolean;
  rxBps: number;
  txBps: number;
  rxTotalBytes: number;
  txTotalBytes: number;
  peakRxBps: number;
  peakTxBps: number;
  avgRxBps: number;
  avgTxBps: number;
  updatedAt: number;
  reason?: string;
}

// Hash string -> 0..1, deterministik supaya data tiruan stabil antar render.
function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function getMockRouterTraffic(routerId: string, active = true): RouterTrafficStats {
  if (!active) {
    return {
      hasData: false,
      rxBps: 0,
      txBps: 0,
      rxTotalBytes: 0,
      txTotalBytes: 0,
      peakRxBps: 0,
      peakTxBps: 0,
      avgRxBps: 0,
      avgTxBps: 0,
      updatedAt: Date.now(),
      reason: "Router offline atau REST terputus",
    };
  }
  // ponytail: data tiruan; ganti dengan sampel /interface/monitor-traffic saat backend siap.
  const rxBps = Math.round((20 + unit(`${routerId}:rx`) * 480) * 1_000_000);
  const txBps = Math.round(rxBps * (0.15 + unit(`${routerId}:tx`) * 0.45));
  const peakRxBps = Math.round(rxBps * (1.2 + unit(`${routerId}:prx`) * 0.5));
  const peakTxBps = Math.round(txBps * (1.2 + unit(`${routerId}:ptx`) * 0.5));
  const avgRxBps = Math.round(rxBps * (0.6 + unit(`${routerId}:arx`) * 0.3));
  const avgTxBps = Math.round(txBps * (0.6 + unit(`${routerId}:atx`) * 0.3));
  // total = rata-rata * 24 jam (bit -> byte)
  const rxTotalBytes = Math.round((avgRxBps * 86_400) / 8);
  const txTotalBytes = Math.round((avgTxBps * 86_400) / 8);
  return {
    hasData: true,
    rxBps,
    txBps,
    rxTotalBytes,
    txTotalBytes,
    peakRxBps,
    peakTxBps,
    avgRxBps,
    avgTxBps,
    updatedAt: Date.now(),
  };
}

export function isTrafficEmpty(stats: RouterTrafficStats): boolean {
  return !stats.hasData || (stats.rxBps === 0 && stats.txBps === 0 && stats.peakRxBps === 0);
}
