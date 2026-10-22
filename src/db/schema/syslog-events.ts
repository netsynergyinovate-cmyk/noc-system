import {
  bigserial,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { routers } from "./routers";

// Log RouterOS yang dikirim router lewat syslog UDP dan disimpan backend Go
// (backend/internal/collector/syslog_store.go). Diagnosa membaca tabel ini,
// bukan meminta router: buffer memori router hanya menyimpan 1000 baris
// (belasan menit pada router yang ramai). Retensi dihapus backend
// (SYSLOG_RETENTION_DAYS, bawaan 14 hari).
//
// Penyaringan derau dilakukan saat dibaca (classifyLogLine di
// src/lib/diagnostics.ts), jadi baris rutin tetap tersimpan dan aturan
// penyaringan bisa ditinjau ulang tanpa kehilangan data.
export const syslogEvents = pgTable(
  "syslog_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id, { onDelete: "cascade" }),
    // Waktu diterima backend; jam router tidak dipakai karena bisa melenceng.
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    // Dari PRI syslog; kosong bila paket tidak memuat PRI.
    facility: smallint("facility"),
    severity: smallint("severity"),
    // Topik RouterOS, mis. "pppoe,ppp,info,account"; kosong bila tidak terbaca.
    topics: text("topics").default("").notNull(),
    message: text("message").notNull(),
  },
  (table) => [
    index("syslog_events_router_time_idx").on(
      table.routerId,
      table.receivedAt.desc(),
    ),
  ],
);
