// Penanda grafik trafik live (1 sampel/detik dari backend Go). Hanya menjelaskan apa yang ada di data:
// - titik 0/0: router benar-benar MENJAWAB 0 Mbps (kalau koneksi aplikasi ke MikroTik putus, titiknya
//   tidak ada sama sekali, bukan 0);
// - celah: backend tidak punya sampel dari router selama beberapa detik. Putusnya WebSocket browser
//   tidak menimbulkan celah, karena saat tersambung lagi backend mengirim ulang seluruh seri.

// Backend boleh melewati 1 detik saat counter router belum diperbarui; celah sependek itu bukan masalah.
export const TRAFFIC_GAP_SECONDS = 3;

export type TrafficMark =
  { kind: "zero"; time: number } | { kind: "gap"; from: number; to: number };

export function isZeroSample(rx: number, tx: number): boolean {
  return rx === 0 && tx === 0;
}

export function trafficMarks(
  times: readonly number[],
  rx: readonly number[],
  tx: readonly number[],
): TrafficMark[] {
  const marks: TrafficMark[] = [];
  for (let i = 0; i < times.length; i++) {
    if (i > 0 && times[i] - times[i - 1] >= TRAFFIC_GAP_SECONDS) {
      marks.push({ kind: "gap", from: times[i - 1], to: times[i] });
    }
    if (isZeroSample(rx[i], tx[i]))
      marks.push({ kind: "zero", time: times[i] });
  }
  return marks;
}

/** Penjelasan untuk titik ke-idx (tooltip dan chip "Titik"); null bila titiknya biasa. */
export function trafficPointNote(
  times: readonly number[],
  rx: readonly number[],
  tx: readonly number[],
  idx: number,
): string | null {
  const notes: string[] = [];
  const gap = idx > 0 ? times[idx] - times[idx - 1] : 0;
  if (gap >= TRAFFIC_GAP_SECONDS) {
    notes.push(
      `Sebelumnya tanpa data ${gap - 1} dtk: router tidak mengirim sampel ke backend (RTO/putus)`,
    );
  }
  if (isZeroSample(rx[idx], tx[idx])) {
    notes.push(
      "Router mengirim 0 Mbps: koneksi aplikasi ke MikroTik tetap ada, interface tidak mengalirkan trafik",
    );
  }
  return notes.length > 0 ? notes.join(". ") : null;
}
