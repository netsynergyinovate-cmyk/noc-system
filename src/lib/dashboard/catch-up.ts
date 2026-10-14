export type CatchUpPlan =
  { kind: "none" } | { kind: "fill"; times: number[] } | { kind: "resync" };

// Browser menahan timer di tab yang tersembunyi atau tertutup (bisa jadi sekali
// per menit), jadi interval 1 detik bisa terlambat. Fungsi ini menentukan
// detik-detik yang terlewat supaya grafik tetap 1 sampel per detik tanpa
// lubang. Jika terlewat lebih dari `maxGap` detik (mis. komputer tidur),
// ambil snapshot baru saja.
export function planCatchUp(
  lastSec: number,
  nowSec: number,
  maxGap: number,
): CatchUpPlan {
  const gap = nowSec - lastSec;
  if (gap === 0) return { kind: "none" };
  // Jam sistem mundur membuat sumbu waktu tidak menaik; mulai dari snapshot baru.
  if (gap < 0 || gap > maxGap) return { kind: "resync" };
  return {
    kind: "fill",
    times: Array.from({ length: gap }, (_, index) => lastSec + index + 1),
  };
}
