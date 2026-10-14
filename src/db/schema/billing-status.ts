import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { billingSyncRuns } from "./billing-sync-runs.ts";
import type { BillingStatus } from "./customers.ts";
import { customers } from "./customers.ts";

// Cara sebuah tagihan dipasangkan dengan pelanggannya (aturan 1 dan 2 di
// `matchBilling`). Pelanggan tanpa tagihan ("none" di API) tidak punya nilai
// di sini; ia tidak dicocokkan dengan apa pun.
export const billingMatchKinds = ["exact", "normalized"] as const;
export type BillingMatchKind = (typeof billingMatchKinds)[number];

// Hasil sinkron billing terbaru: satu baris per pelanggan (di-upsert tiap jam).
//
// `match_kind`, `billing_name`, dan `run_id` ditambahkan oleh migrasi 0006
// untuk kontrak BillingRow: `match` dan `billingName` (nama PPPoE persis
// seperti di billing, yang beda dari `customers.pppoe_username` pada cocok
// "normalized") tidak bisa diturunkan dari tabel lain, dan `run_id` menelusuri
// baris ke sinkron yang menuliskannya.
//
// Ketiganya boleh kosong supaya baris dari sebelum 0006 tetap sah. Baris lama
// itu tidak punya `match_kind`; pembaca menganggapnya "none" sampai sinkron
// berikutnya menulis ulang. Sinkron yang berhasil menulis baris untuk pelanggan
// yang cocok dan membuang baris pelanggan yang tidak mendapat tagihan, dalam
// transaksi yang sama dengan penutupan sinkronnya, sehingga tabel ini
// mencerminkan sinkron `success` terbaru. Sinkron gagal tidak menyentuhnya.
export const billingStatus = pgTable(
  "billing_status",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .unique()
      .references(() => customers.id, { onDelete: "cascade" }),
    status: text("status").$type<BillingStatus>().notNull(),
    invoiceRef: text("invoice_ref"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Kosong tepat bila `billing_name` kosong (check di bawah).
    matchKind: text("match_kind").$type<BillingMatchKind>(),
    // Nama koneksi PPPoE persis seperti tertulis di billing.
    billingName: text("billing_name"),
    // Sinkron yang menulis baris ini. Menjadi kosong bila log sinkronnya
    // dihapus; barisnya tetap.
    runId: uuid("run_id").references(() => billingSyncRuns.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    // Mencari baris yang ditulis satu sinkron; juga menjaga penghapusan log
    // sinkron (yang mengosongkan `run_id`) tidak memindai seluruh tabel.
    index("billing_status_run_idx").on(table.runId),
    check(
      "billing_status_status_check",
      sql`${table.status} in ('lunas', 'isolir')`,
    ),
    check(
      "billing_status_match_kind_check",
      sql`${table.matchKind} is null or ${table.matchKind} in ('exact', 'normalized')`,
    ),
    // Kontrak: billingName kosong tepat bila match "none". Yang ada hanya
    // `match_kind` kosong atau terisi bersama nama billing yang tidak kosong.
    check(
      "billing_status_billing_name_check",
      sql`(${table.matchKind} is null and ${table.billingName} is null) or (${table.matchKind} is not null and ${table.billingName} is not null and char_length(${table.billingName}) > 0)`,
    ),
  ],
);
