import {
  mockActiveAlerts,
  summarizeAlertSeverity,
  type SeveritySummary,
} from "../src/lib/dashboard/alerts";

// Momen pada data tiruan yang dipakai beberapa spesifikasi untuk membuka halaman
// pada keadaan alert tertentu. Bukan spesifikasi (tanpa .spec), jadi aman diimpor.

export const START = 1_791_400_000;
export const GRID = Array.from(
  { length: (7 * 86_400) / 300 },
  (_, index) => START + index * 300,
);

export interface Moment {
  t: number;
  summary: SeveritySummary;
}

// Satu momen untuk tiap keadaan yang harus tampil berbeda.
export function findMoments() {
  const moments: { mixed?: Moment; warningOnly?: Moment; empty?: Moment } = {};
  for (const t of GRID) {
    const summary = summarizeAlertSeverity(mockActiveAlerts(t));
    if (!moments.mixed && summary.critical > 0 && summary.warning > 0)
      moments.mixed = { t, summary };
    if (!moments.warningOnly && summary.total > 0 && summary.critical === 0)
      moments.warningOnly = { t, summary };
    if (!moments.empty && summary.total === 0) moments.empty = { t, summary };
  }
  return moments as Required<typeof moments>;
}
