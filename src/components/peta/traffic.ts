// Logika murni grafik trafik live pelanggan (diuji di tests/traffic.test.mjs).

export type TrafficPoint = { t: number; down: number; up: number };

type Sample = {
  downloadBps: number;
  uploadBps: number;
  downloadBytes: number;
  uploadBytes: number;
  sampledAt: number;
};

// Rate bit/detik dari selisih byte antar dua bacaan. Bacaan pertama atau penghitung yang
// turun (sesi PPPoE tersambung ulang) memakai field rate MikroTik apa adanya.
export function toPoint(prev: Sample | null, cur: Sample): TrafficPoint {
  const dt = prev ? cur.sampledAt - prev.sampledAt : 0;
  const dDown = prev ? cur.downloadBytes - prev.downloadBytes : -1;
  const dUp = prev ? cur.uploadBytes - prev.uploadBytes : -1;
  if (dt <= 0 || dDown < 0 || dUp < 0) {
    return { t: cur.sampledAt, down: cur.downloadBps, up: cur.uploadBps };
  }
  return { t: cur.sampledAt, down: (dDown * 8000) / dt, up: (dUp * 8000) / dt };
}

/** Volume data (byte) dari deret Mbps: luas di bawah kurva antar titik berurutan (trapesium) */
export function seriesUsageBytes(series: { t: number; down: number; up: number }[]) {
  let down = 0;
  let up = 0;
  for (let i = 1; i < series.length; i++) {
    const sec = (series[i].t - series[i - 1].t) / 1000;
    if (sec <= 0) continue;
    down += (((series[i].down + series[i - 1].down) / 2) * 1e6 * sec) / 8;
    up += (((series[i].up + series[i - 1].up) / 2) * 1e6 * sec) / 8;
  }
  return { down, up };
}

// Langkah garis bantu "bulat" (1/2/2.5/5 x 10^n) agar 4 garis menutup puncak data
export function niceStep(peak: number): number {
  const raw = Math.max(peak, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
}
