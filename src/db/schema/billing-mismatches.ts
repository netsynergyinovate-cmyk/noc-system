import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { BillingStatus } from "./customers.ts";
import { billingSyncRuns } from "./billing-sync-runs.ts";

export const billingMismatchReasons = [
  "unknown",
  "duplicate",
  "ambiguous",
] as const;
export type BillingMismatchReason = (typeof billingMismatchReasons)[number];

// Tagihan yang tidak bisa dipasangkan dengan pelanggan pada satu sinkron
// (BillingUnmatched di `src/lib/dashboard/billing.ts`). `billing_status`
// mewajibkan `customer_id`, jadi tagihan seperti ini tidak punya tempat di
// sana. Alasannya mengikuti aturan 3 di `matchBilling`:
//
// - `unknown`: tidak ada pelanggan bernama itu; `customer_ids` kosong.
// - `duplicate`: pelanggannya sudah dipasangkan dengan tagihan lain pada
//   sinkron yang sama; `customer_ids` berisi pelanggan itu, satu saja.
// - `ambiguous`: setelah dirapikan cocok dengan lebih dari satu pelanggan,
//   jadi tidak ditebak; `customer_ids` berisi semua kandidat (dua atau lebih).
//
// Satu baris per tagihan per sinkron, jadi `rows` dan `unmatched` di API
// membaca baris sinkron `success` terbaru (`run_id`). Menghapus sinkronnya
// menghapus baris ini juga.
//
// Kandidat disimpan sebagai `uuid[]`, bukan tabel anak: ia potret keputusan
// sinkron itu, hubungannya dengan alasan bisa dijaga satu check (jumlah
// elemen menurut alasan), dan satu tagihan ditulis dalam satu baris. Harganya:
// array tidak bisa punya foreign key, jadi pelanggan yang dihapus sesudahnya
// tetap tertulis di sini. Pembaca mencari nama lewat `customers` dan
// melewatkan id yang sudah tidak ada. Penulis tidak boleh mengisi id ganda.
export const billingMismatches = pgTable(
  "billing_mismatches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => billingSyncRuns.id, { onDelete: "cascade" }),
    // Nama koneksi PPPoE persis seperti tertulis di billing (belum dirapikan).
    // Boleh teks kosong: tagihan tanpa nama koneksi juga "tidak ada pelanggan".
    invoiceName: text("invoice_name").notNull(),
    // Kode tagihan di billing. Boleh kosong; lapisan API yang memutuskan
    // tulisannya, karena kontrak frontend memakai string.
    invoiceRef: text("invoice_ref"),
    // Status pada tagihan itu (kontrak: BillingUnmatched.status).
    invoiceStatus: text("invoice_status").$type<BillingStatus>().notNull(),
    reason: text("reason").$type<BillingMismatchReason>().notNull(),
    customerIds: uuid("customer_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Semua ketidakcocokan satu sinkron.
    index("billing_mismatches_run_idx").on(table.runId),
    check(
      "billing_mismatches_status_check",
      sql`${table.invoiceStatus} in ('lunas', 'isolir')`,
    ),
    check(
      "billing_mismatches_reason_check",
      sql`${table.reason} in ('unknown', 'duplicate', 'ambiguous')`,
    ),
    // Jumlah kandidat menurut alasan. Tiap syarat hanya berlaku untuk alasannya
    // sendiri, supaya alasan di luar daftar ditolak oleh check alasan saja.
    check(
      "billing_mismatches_candidates_check",
      sql`(${table.reason} <> 'unknown' or cardinality(${table.customerIds}) = 0) and (${table.reason} <> 'duplicate' or cardinality(${table.customerIds}) = 1) and (${table.reason} <> 'ambiguous' or cardinality(${table.customerIds}) >= 2)`,
    ),
    check(
      "billing_mismatches_candidates_null_check",
      sql`array_position(${table.customerIds}, null) is null`,
    ),
  ],
);
