import {
  check,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { routers } from "./routers";

// Arsip histori traffic: satu baris per router per detik, supaya traffic pada
// jam insiden masih bisa ditelusuri setelah jendela 5 menit di memori lewat.
// Satuan Mbps, sama dengan di backend dan dashboard. Total semua router untuk
// satu detik adalah jumlah barisnya.
//
// Tabel ini biasa saja di PostgreSQL mana pun. Bila ekstensi TimescaleDB
// tersedia, migrasi 0004 menjadikannya hypertable (partisi harian) dengan
// retensi 30 hari; tanpa Timescale, baris lama perlu dibersihkan oleh backend.
//
// Perkiraan volume: 86.400 baris per router per hari, jadi 20 router sekitar
// 1,7 juta baris per hari.
export const trafficSamples = pgTable(
  "traffic_samples",
  {
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id, { onDelete: "cascade" }),
    // Kolom waktu harus ada di kunci utama agar bisa dijadikan hypertable.
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
    rxMbps: doublePrecision("rx_mbps").notNull(),
    txMbps: doublePrecision("tx_mbps").notNull(),
  },
  (table) => [
    // Satu sampel per router per detik; menulis ulang detik yang sama
    // menggantikan, bukan menambah baris.
    primaryKey({
      name: "traffic_samples_pkey",
      columns: [table.routerId, table.sampledAt],
    }),
    // Pembacaan lintas router (total traffic pada rentang waktu).
    index("traffic_samples_time_idx").on(table.sampledAt.desc()),
    check(
      "traffic_samples_nonnegative_check",
      sql`${table.rxMbps} >= 0 and ${table.txMbps} >= 0`,
    ),
  ],
);
