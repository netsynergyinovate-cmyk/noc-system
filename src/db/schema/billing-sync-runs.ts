import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const billingSyncRunStatuses = ["running", "success", "failed"] as const;
export type BillingSyncRunStatus = (typeof billingSyncRunStatuses)[number];

// Siapa yang memulai sinkron. PRD hanya menyebut jadwal tiap jam; "manual"
// disediakan agar tombol sinkron yang nanti ditambahkan tidak perlu migrasi.
export const billingSyncTriggers = ["schedule", "manual"] as const;
export type BillingSyncTrigger = (typeof billingSyncTriggers)[number];

// Batas panjang pesan galat. Pesan itu satu kalimat untuk petugas (login
// ditolak, token CSRF tidak ditemukan, ...), jadi 500 karakter sudah longgar;
// penulis (backend Go) memotongnya sebelum menyimpan. Angka yang sama dipakai
// check `billing_sync_runs_error_check` di bawah.
export const BILLING_SYNC_ERROR_MAX_LENGTH = 500;

// Log sinkron billing: satu baris per percobaan sinkron (jadwal tiap jam),
// dibaca halaman Billing lewat BillingSyncState di
// `src/lib/dashboard/billing.ts`:
//
// - baris `running` menjadi `sync.running` ({ startedAt });
// - baris yang sudah selesai, `finished_at` menurun, 24 teratas, menjadi
//   `sync.runs` (indeks `billing_sync_runs_finished_idx`);
// - `success` membawa hitungan menjadi `result`: `invoices` = `invoices_total`,
//   `matched` = `matched_exact` + `matched_normalized`, `unmatched` =
//   `unmatched_unknown` + `unmatched_duplicate` + `unmatched_ambiguous`,
//   `withoutInvoice` = `customers_without_invoice`;
// - `failed` membawa `error_message` menjadi `error`.
//
// `nextRunAt` tidak disimpan; ia turunan dari jadwal penjalan. Waktu di API
// berupa detik epoch bulat, jadi lapisan API yang membulatkannya.
//
// Aturan yang dijaga database (lihat check di bawah): `finished_at` kosong
// tepat saat `running`; `error_message` terisi tepat saat `failed`; hitungan
// terisi tepat saat `success`, tidak negatif, dan `invoices_total` selalu
// jumlah matched dan unmatched (kontrak: "result.invoices selalu matched +
// unmatched"). Paling banyak SATU baris `running` pada satu waktu, supaya dua
// sinkron tidak berjalan bersamaan.
//
// Yang menjadi tugas penulis, bukan database:
// - isi sebuah sinkron tidak diubah lagi setelah selesai;
// - sinkron yang gagal tidak menyentuh `billing_status` dan
//   `customers.billing_status`;
// - proses yang mati di tengah sinkron meninggalkan baris `running`, yang akan
//   menghalangi sinkron berikutnya lewat indeks unik; saat start, tandai baris
//   itu `failed` lebih dulu;
// - tidak ada yang menghapus baris lama di sini. Bila dipangkas, sisakan
//   sinkron `success` terbaru karena `rows` dan `unmatched` di API membaca
//   hasilnya. Menghapus sebuah sinkron ikut menghapus ketidakcocokannya dan
//   mengosongkan `billing_status.run_id`.
export const billingSyncRuns = pgTable(
  "billing_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Kosong selama sinkron berjalan.
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").$type<BillingSyncRunStatus>().notNull(),
    trigger: text("trigger")
      .$type<BillingSyncTrigger>()
      .default("schedule")
      .notNull(),
    // Terisi tepat bila `failed`. Tanpa kata sandi, cookie, token, atau alamat
    // internal sistem billing.
    errorMessage: text("error_message"),
    // Hitungan, terisi tepat bila `success`. Tagihan yang terbaca dari billing
    // dipecah menurut aturan pencocokan (`matchBilling`): cocok persis, cocok
    // setelah dirapikan, atau tidak cocok dengan alasan unknown, duplicate,
    // atau ambiguous.
    invoicesTotal: integer("invoices_total"),
    matchedExact: integer("matched_exact"),
    matchedNormalized: integer("matched_normalized"),
    unmatchedUnknown: integer("unmatched_unknown"),
    unmatchedDuplicate: integer("unmatched_duplicate"),
    unmatchedAmbiguous: integer("unmatched_ambiguous"),
    // Pelanggan yang tidak mendapat tagihan pada sinkron ini (match "none").
    customersWithoutInvoice: integer("customers_without_invoice"),
    // Pelanggan yang statusnya berubah oleh sinkron ini; hanya pelanggan yang
    // cocok bisa berubah, jadi tidak pernah melebihi jumlah yang cocok.
    statusesChanged: integer("statuses_changed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Riwayat: WHERE finished_at IS NOT NULL ORDER BY finished_at DESC
    // NULLS LAST LIMIT 24. Sinkron yang berjalan tidak ada di indeks ini.
    index("billing_sync_runs_finished_idx")
      .on(table.finishedAt.desc())
      .where(sql`${table.finishedAt} is not null`),
    // Paling banyak satu baris `running`: semua baris di indeks ini bernilai
    // status yang sama, jadi unik berarti tidak boleh ada dua.
    uniqueIndex("billing_sync_runs_running_unique")
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
    check(
      "billing_sync_runs_status_check",
      sql`${table.status} in ('running', 'success', 'failed')`,
    ),
    check(
      "billing_sync_runs_trigger_check",
      sql`${table.trigger} in ('schedule', 'manual')`,
    ),
    // `finished_at` kosong jika dan hanya jika masih berjalan.
    check(
      "billing_sync_runs_finished_check",
      sql`(${table.status} = 'running') = (${table.finishedAt} is null)`,
    ),
    check(
      "billing_sync_runs_period_check",
      sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    // Ditulis dengan cabang eksplisit: perbandingan dengan NULL bernilai
    // "tidak diketahui", yang akan lolos dari check bila dipakai apa adanya.
    // "Tidak kosong" berarti ada minimal satu karakter bukan spasi putih
    // (btrim saja hanya membuang spasi, bukan baris baru atau tab).
    check(
      "billing_sync_runs_error_check",
      sql`(${table.status} = 'failed' and ${table.errorMessage} is not null and ${table.errorMessage} ~ '[^[:space:]]' and char_length(${table.errorMessage}) <= ${sql.raw(String(BILLING_SYNC_ERROR_MAX_LENGTH))}) or (${table.status} <> 'failed' and ${table.errorMessage} is null)`,
    ),
    // Delapan hitungan: semuanya terisi saat `success`, semuanya kosong selain itu.
    check(
      "billing_sync_runs_counts_check",
      sql`(${table.status} = 'success' and ${table.invoicesTotal} is not null and ${table.matchedExact} is not null and ${table.matchedNormalized} is not null and ${table.unmatchedUnknown} is not null and ${table.unmatchedDuplicate} is not null and ${table.unmatchedAmbiguous} is not null and ${table.customersWithoutInvoice} is not null and ${table.statusesChanged} is not null) or (${table.status} <> 'success' and ${table.invoicesTotal} is null and ${table.matchedExact} is null and ${table.matchedNormalized} is null and ${table.unmatchedUnknown} is null and ${table.unmatchedDuplicate} is null and ${table.unmatchedAmbiguous} is null and ${table.customersWithoutInvoice} is null and ${table.statusesChanged} is null)`,
    ),
    check(
      "billing_sync_runs_counts_nonnegative_check",
      sql`${table.invoicesTotal} >= 0 and ${table.matchedExact} >= 0 and ${table.matchedNormalized} >= 0 and ${table.unmatchedUnknown} >= 0 and ${table.unmatchedDuplicate} >= 0 and ${table.unmatchedAmbiguous} >= 0 and ${table.customersWithoutInvoice} >= 0 and ${table.statusesChanged} >= 0`,
    ),
    // Tiap tagihan yang terbaca tepat satu kali: cocok atau tidak cocok.
    check(
      "billing_sync_runs_total_check",
      sql`${table.invoicesTotal} = ${table.matchedExact} + ${table.matchedNormalized} + ${table.unmatchedUnknown} + ${table.unmatchedDuplicate} + ${table.unmatchedAmbiguous}`,
    ),
    check(
      "billing_sync_runs_changed_check",
      sql`${table.statusesChanged} <= ${table.matchedExact} + ${table.matchedNormalized}`,
    ),
  ],
);
