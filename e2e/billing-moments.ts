import {
  billingStatusAtSlot,
  lastSuccessSlot,
  mockBillingSync,
  summarizeSync,
} from "../src/lib/dashboard/billing";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import type { BillingStatus } from "../src/lib/dashboard/types";

// Momen pada data tiruan yang dipakai beberapa spesifikasi untuk membuka halaman
// Billing pada keadaan sinkron tertentu. Bukan spesifikasi (tanpa .spec), jadi
// aman diimpor. Dicari dari datanya sendiri supaya test tidak bergantung pada
// jam sebenarnya.

export const BILLING_START = 1_791_400_000;
// Tiap 100 detik selama 7 hari. Kelipatan 100 mengenai tepat awal tiap sinkron.
export const BILLING_GRID = Array.from(
  { length: (7 * 86_400) / 100 },
  (_, index) => BILLING_START + index * 100,
);

export type BillingMomentKind =
  "ok" | "single" | "double" | "triple" | "running" | "runningAfterFail";

// Satu momen untuk tiap keadaan. Selain `running`, momennya jauh dari awal dan
// akhir sinkron (lebih dari 10 menit dari yang terakhir dan dari yang
// berikutnya), supaya lama dan hitung mundurnya tertulis dalam menit dan detik.
export function findBillingMoments() {
  const moments: Partial<Record<BillingMomentKind, number>> = {};
  for (const t of BILLING_GRID) {
    const sync = mockBillingSync(t);
    const summary = summarizeSync(sync.runs);
    let kind: BillingMomentKind;
    if (sync.running) {
      kind = summary.last?.status === "failed" ? "runningAfterFail" : "running";
    } else {
      const age = t - summary.last!.finishedAt;
      if (age < 600 || sync.nextRunAt - t < 600) continue;
      const failures = summary.consecutiveFailures;
      kind =
        failures >= 3
          ? "triple"
          : failures === 2
            ? "double"
            : failures === 1
              ? "single"
              : "ok";
    }
    moments[kind] ??= t;
  }
  return moments as Required<typeof moments>;
}

// Sinkron berikutnya setelah momen `from` yang selesainya cepat (paling lama 16
// detik), supaya seluruh pergantian (mulai, berjalan, selesai) terjadi sebelum
// penyegaran berkala berikutnya (tiap 30 detik) dan hanya bisa berasal dari
// jadwal sendiri.
export function pickQuickRun(from: number) {
  let start = mockBillingSync(from).nextRunAt;
  for (let i = 0; i < 200; i += 1, start += 3_600) {
    const run = mockBillingSync(start + 100).runs[0];
    if (run.startedAt === start && run.finishedAt - start <= 16) {
      return { start, finishedAt: run.finishedAt, run };
    }
  }
  throw new Error("tidak ada sinkron cepat pada data tiruan");
}

// Kalimat keadaan sinkron yang diharapkan setelah sinkron selesai, ditulis tangan
// (bukan dari kode aplikasi) supaya pengujian tidak mengulang dirinya sendiri.
export function headlineAfter(summary: ReturnType<typeof summarizeSync>) {
  if (summary.last!.status === "success") return "Sinkron terakhir berhasil";
  return summary.consecutiveFailures >= 2
    ? `Gagal ${summary.consecutiveFailures} kali berturut-turut`
    : "Sinkron terakhir gagal";
}

// Sinkron berikutnya setelah `from`, beserta kapan selesainya dan hasilnya,
// dibaca dari riwayat yang dibuat sesudahnya (bukan dari fungsi yang diuji).
export function nextSyncRun(from: number) {
  const start = mockBillingSync(from).nextRunAt;
  const run = mockBillingSync(start + 100).runs[0];
  return {
    start,
    finishedAt: run.finishedAt,
    slot: Number(run.id.replace("billing-sync-", "")),
    status: run.status,
  };
}

export interface ChangingRun {
  start: number;
  finishedAt: number;
  slot: number;
  // Pelanggan yang statusnya berganti karena sinkron ini.
  changes: { customerId: string; from: BillingStatus; to: BillingStatus }[];
}

// Sinkron berhasil, mulai dari `from`, yang mengubah status sedikitnya satu
// pelanggan; `accept` bisa menambah syarat.
export function changingRuns(
  count: number,
  accept: (run: ChangingRun) => boolean = () => true,
  from = BILLING_START,
) {
  const customers = createMockCustomers();
  const found: ChangingRun[] = [];
  let cursor = from;
  while (found.length < count) {
    const run = nextSyncRun(cursor);
    cursor = run.start;
    if (run.status !== "success") continue;
    const previous = lastSuccessSlot(run.finishedAt - 1);
    const changes = customers.flatMap((customer) => {
      const before = billingStatusAtSlot(customer.id, previous)!;
      const after = billingStatusAtSlot(customer.id, run.slot)!;
      return before === after
        ? []
        : [{ customerId: customer.id, from: before, to: after }];
    });
    const candidate = {
      start: run.start,
      finishedAt: run.finishedAt,
      slot: run.slot,
      changes,
    };
    if (changes.length > 0 && accept(candidate)) found.push(candidate);
  }
  return found;
}
