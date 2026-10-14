import {
  integer,
  numeric,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { olts } from "./olts";

// Kondisi optik terakhir tiap PON port. Satu baris per port (di-upsert), bukan
// riwayat. Daya dalam dBm, redaman dalam dB; kosong bila OLT tidak
// melaporkannya.
export const oltPonPorts = pgTable(
  "olt_pon_ports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    oltId: uuid("olt_id")
      .notNull()
      .references(() => olts.id, { onDelete: "cascade" }),
    ponIndex: integer("pon_index").notNull(),
    rxPower: numeric("rx_power", { precision: 6, scale: 2, mode: "number" }),
    txPower: numeric("tx_power", { precision: 6, scale: 2, mode: "number" }),
    attenuation: numeric("attenuation", {
      precision: 6,
      scale: 2,
      mode: "number",
    }),
    onuOnlineCount: integer("onu_online_count").default(0).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("olt_pon_ports_olt_pon_unique").on(table.oltId, table.ponIndex),
  ],
);
