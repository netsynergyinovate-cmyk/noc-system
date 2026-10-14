import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";
import { olts } from "./olts";

export const onuStatuses = ["online", "offline", "los"] as const;
export type OnuStatus = (typeof onuStatuses)[number];

// Kondisi optik terakhir tiap ONU. Satu baris per ONU (di-upsert). Satu
// pelanggan paling banyak punya satu ONU; ONU yang belum dipetakan ke pelanggan
// tetap disimpan dengan customer_id kosong.
export const oltOnus = pgTable(
  "olt_onus",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    oltId: uuid("olt_id")
      .notNull()
      .references(() => olts.id, { onDelete: "cascade" }),
    ponIndex: integer("pon_index").notNull(),
    onuIndex: integer("onu_index").notNull(),
    // Deskripsi/nama ONU di OLT dan SN/MAC; bahan pencocokan otomatis ke pelanggan.
    description: text("description"),
    serialNumber: text("serial_number"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    rxPower: numeric("rx_power", { precision: 6, scale: 2, mode: "number" }),
    txPower: numeric("tx_power", { precision: 6, scale: 2, mode: "number" }),
    attenuation: numeric("attenuation", {
      precision: 6,
      scale: 2,
      mode: "number",
    }),
    status: text("status").$type<OnuStatus>().default("offline").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("olt_onus_olt_pon_onu_unique").on(
      table.oltId,
      table.ponIndex,
      table.onuIndex,
    ),
    uniqueIndex("olt_onus_customer_unique").on(table.customerId),
    index("olt_onus_olt_pon_idx").on(table.oltId, table.ponIndex),
    check(
      "olt_onus_status_check",
      sql`${table.status} in ('online', 'offline', 'los')`,
    ),
  ],
);
