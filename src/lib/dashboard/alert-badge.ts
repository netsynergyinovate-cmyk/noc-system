import type { AlertTone, SeveritySummary } from "./alerts";
import { formatInteger } from "./format";

// LENCANA JUMLAH ALERT AKTIF di menu "Alert". Petugas NOC tidak selalu membuka
// halaman Alert, jadi jumlahnya harus terlihat dari halaman mana pun, dan berubah
// sendiri begitu hub mengirim alert baru atau yang selesai (tanpa memuat ulang).
// Bagian ini murni (tanpa browser) supaya tulisan dan batasnya bisa diuji; angkanya
// berasal dari summarizeAlertSeverity, fungsi yang sama dengan kartu daftar aktif
// dan lencana di dasbor, jadi ketiganya selalu menyebut angka dan tingkat yang sama.

// Lencana sekecil menu, jadi angkanya dibatasi: lebih dari ini ditulis "99+".
// Jumlah yang sebenarnya tetap ada di tulisan untuk pembaca layar dan di tooltip.
export const ALERT_BADGE_MAX = 99;

export interface AlertBadgeModel {
  tone: AlertTone;
  total: number;
  critical: number;
  // Tulisan di lencana: angka (dibatasi), atau kosong bila tidak ada alert (lencana
  // hanya memuat ikon tanda normal).
  text: string;
  // Kalimat lengkap, juga untuk pembaca layar dan tooltip.
  description: string;
  // Data terakhir yang diterima, karena sambungan data terputus.
  stale: boolean;
}

// null bila daftar alert belum diterima: lencana tidak mengarang angka nol.
export function alertBadge(
  summary: SeveritySummary | null,
  stale: boolean,
): AlertBadgeModel | null {
  if (summary === null) return null;
  const { total, critical, tone } = summary;
  const base =
    total === 0
      ? "Tidak ada alert aktif"
      : critical > 0
        ? `${formatInteger(total)} alert aktif, ${formatInteger(critical)} kritis`
        : `${formatInteger(total)} alert aktif`;
  return {
    tone,
    total,
    critical,
    text:
      total === 0
        ? ""
        : total > ALERT_BADGE_MAX
          ? `${ALERT_BADGE_MAX}+`
          : formatInteger(total),
    description: stale ? `${base} (koneksi terputus, data terakhir)` : base,
    stale,
  };
}
