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
import { user } from "./user";

export const cpeActions = [
  "change_ssid",
  "change_password",
  "list_hosts",
  "ping_test",
  "traceroute",
  "reboot_device",
  "factory_reset",
  "check_optical",
  "speed_test",
] as const;
export type CpeAction = (typeof cpeActions)[number];

export const cpeTaskStatuses = [
  "pending",
  "running",
  "success",
  "failed",
] as const;
export type CpeTaskStatus = (typeof cpeTaskStatuses)[number];

// Antrean perubahan perangkat pelanggan lewat GenieACS. `payload` bisa memuat
// kata sandi WiFi baru sampai tugas diproses; jangan tampilkan di log.
export const cpeTasks = pgTable(
  "cpe_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    action: text("action").$type<CpeAction>().notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: text("status").$type<CpeTaskStatus>().default("pending").notNull(),
    // Tetap tersimpan walau akun pembuatnya dihapus.
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("cpe_tasks_customer_created_idx").on(
      table.customerId,
      table.createdAt.desc(),
    ),
    index("cpe_tasks_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      "cpe_tasks_action_check",
      sql`${table.action} in ('change_ssid', 'change_password', 'list_hosts', 'ping_test', 'traceroute', 'reboot_device', 'factory_reset', 'check_optical', 'speed_test')`,
    ),
    check(
      "cpe_tasks_status_check",
      sql`${table.status} in ('pending', 'running', 'success', 'failed')`,
    ),
  ],
);
