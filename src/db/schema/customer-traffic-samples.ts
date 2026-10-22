import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";

// Trafik per pelanggan, satu baris per pelanggan per 5 menit (seperti grafik
// "Daily, 5 minute average" di MikroTik). Diisi backend Go dari laju simple
// queue dinamis "<pppoe-USERNAME>" yang dipoll tiap detik. Download = ke
// pelanggan, upload = dari pelanggan, dalam Mbps. Byte adalah perkiraan dari
// laju (jumlah laju per detik / 8), bukan counter router: counter queue
// kembali ke nol tiap sesi PPPoE tersambung ulang.
//
// Volume: 288 baris per pelanggan per hari; backend menghapus baris > 400 hari.
export const customerTrafficSamples = pgTable(
  "customer_traffic_samples",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    // Jumlah sampel per detik di bucket ini; bobot saat menggabungkan rata-rata.
    samples: integer("samples").notNull(),
    downloadMbpsAvg: doublePrecision("download_mbps_avg").notNull(),
    uploadMbpsAvg: doublePrecision("upload_mbps_avg").notNull(),
    downloadMbpsMax: doublePrecision("download_mbps_max").notNull(),
    uploadMbpsMax: doublePrecision("upload_mbps_max").notNull(),
    downloadBytes: bigint("download_bytes", { mode: "number" }).notNull(),
    uploadBytes: bigint("upload_bytes", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "customer_traffic_samples_pkey",
      columns: [table.customerId, table.bucketStart],
    }),
    index("customer_traffic_samples_time_idx").on(table.bucketStart.desc()),
    check(
      "customer_traffic_samples_nonnegative_check",
      sql`${table.samples} > 0 and ${table.downloadBytes} >= 0 and ${table.uploadBytes} >= 0`,
    ),
  ],
);
