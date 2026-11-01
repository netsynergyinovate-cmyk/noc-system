import {
  bigserial,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";

export const connectionEventKinds = ["up", "down"] as const;
export type ConnectionEventKind = (typeof connectionEventKinds)[number];

// "live" = ditulis backend Go saat status online pelanggan berubah;
// "alert" = disusun dari alert "offline" lama saat migrasi 0038 (waktu hanya
// seteliti deteksi alert, bukan saat sesi PPPoE benar-benar putus).
export const connectionEventSources = ["live", "alert"] as const;
export type ConnectionEventSource = (typeof connectionEventSources)[number];

// Riwayat naik/turun koneksi per pelanggan: bukti kapan pelanggan down dan up.
// customers.is_online hanya menyimpan keadaan terakhir; tabel ini menyimpan
// tiap perpindahan. Backend Go menulis hanya bila jenisnya berbeda dari
// kejadian terakhir pelanggan itu (restart backend tidak menggandakan
// "up"). Backend yang mati tidak melihat perpindahan, jadi riwayat bisa
// berlubang selama backend berhenti. Baris > 400 hari dihapus backend.
export const customerConnectionEvents = pgTable(
  "customer_connection_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ConnectionEventKind>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: text("source")
      .$type<ConnectionEventSource>()
      .default("live")
      .notNull(),
  },
  (table) => [
    index("customer_connection_events_customer_time_idx").on(
      table.customerId,
      table.occurredAt.desc(),
    ),
    index("customer_connection_events_time_idx").on(table.occurredAt),
    check(
      "customer_connection_events_kind_check",
      sql`${table.kind} in ('up', 'down')`,
    ),
    check(
      "customer_connection_events_source_check",
      sql`${table.source} in ('live', 'alert')`,
    ),
  ],
);
