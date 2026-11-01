// Periode yang bisa dipilih di halaman Deteksi Anomali. Mengatur seberapa jauh
// riwayat dimuat dari database; yang masih aktif selalu ikut.
export type AnomalyRange = "today" | "7d" | "30d" | "all";

export interface AnomalyRangeInfo {
  value: AnomalyRange;
  // Teks tombol.
  tab: string;
  // Judul kartu ringkasan.
  label: string;
  // Dipakai di kalimat: "N anomali <phrase>".
  phrase: string;
  // Teks pendek untuk kartu per jenis.
  short: string;
}

export const anomalyRanges: readonly AnomalyRangeInfo[] = [
  { value: "today", tab: "Hari ini", label: "Hari ini", phrase: "hari ini", short: "Hari ini" },
  { value: "7d", tab: "7 hari", label: "7 hari terakhir", phrase: "dalam 7 hari terakhir", short: "7 hari" },
  { value: "30d", tab: "1 bulan", label: "30 hari terakhir", phrase: "dalam 30 hari terakhir", short: "30 hari" },
  { value: "all", tab: "Semua", label: "Seluruh riwayat", phrase: "di seluruh riwayat", short: "Semua" },
];

export const defaultAnomalyRange: AnomalyRange = "7d";

export function anomalyRangeInfo(range: AnomalyRange): AnomalyRangeInfo {
  return anomalyRanges.find((item) => item.value === range) ?? anomalyRanges[1];
}

// Detik epoch awal periode, atau null untuk "semua". "Hari ini" dimulai tengah
// malam menurut zona waktu peramban, supaya cocok dengan jam yang dilihat petugas.
export function anomalyRangeStart(range: AnomalyRange, nowSec: number): number | null {
  switch (range) {
    case "today": {
      const midnight = new Date(nowSec * 1000);
      midnight.setHours(0, 0, 0, 0);
      return Math.floor(midnight.getTime() / 1000);
    }
    case "7d":
      return nowSec - 7 * 86_400;
    case "30d":
      return nowSec - 30 * 86_400;
    case "all":
      return null;
  }
}

// Periode yang terbuka saat halaman dimuat: kejadian hari ini. Pemuat data (dan
// tes) tetap memakai defaultAnomalyRange (7 hari) bila periode tidak disebut.
export const initialAnomalyRange: AnomalyRange = "today";
