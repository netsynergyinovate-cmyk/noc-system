import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";
import { routers } from "./routers";

export const networkLogTypes = [
  "queue",
  "cpu",
  "optical",
  "offline",
  "port",
] as const;
export type NetworkLogType = (typeof networkLogTypes)[number];

export const networkLogSeverities = ["info", "warning", "critical"] as const;
export type NetworkLogSeverity = (typeof networkLogSeverities)[number];

// Catatan anomali saja, bukan semua kejadian. `ended_at` kosong berarti
// gangguan masih berjalan (alert aktif).
export const networkLogs = pgTable(
  "network_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<NetworkLogType>().notNull(),
    severity: text("severity").$type<NetworkLogSeverity>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
  },
  (table) => [
    index("network_logs_started_idx").on(table.startedAt.desc()),
    index("network_logs_router_started_idx").on(
      table.routerId,
      table.startedAt.desc(),
    ),
    // Daftar alert aktif hanya membaca baris yang belum selesai.
    index("network_logs_active_idx")
      .on(table.type, table.startedAt.desc())
      .where(sql`${table.endedAt} is null`),
    check(
      "network_logs_type_check",
      sql`${table.type} in ('queue', 'cpu', 'optical', 'offline', 'port')`,
    ),
    check(
      "network_logs_severity_check",
      sql`${table.severity} in ('info', 'warning', 'critical')`,
    ),
    check(
      "network_logs_period_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

// Alias tabel anomali untuk domain penanganan deteksi anomali.
export const anomalies = networkLogs;
export type NetworkLog = typeof networkLogs.$inferSelect;
export type NewNetworkLog = typeof networkLogs.$inferInsert;
export type AnomalyRecord = NetworkLog;
export type NewAnomalyRecord = NewNetworkLog;
