import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const vlanTrafficSamples = pgTable(
  "vlan_traffic_samples",
  {
    vlanName: text("vlan_name").notNull(),
    vlanId: integer("vlan_id").notNull(),
    ponIndex: integer("pon_index").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
    downloadMbps: doublePrecision("download_mbps").notNull(),
    uploadMbps: doublePrecision("upload_mbps").notNull(),
    rxBytes: bigint("rx_bytes", { mode: "number" }).notNull(),
    txBytes: bigint("tx_bytes", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "vlan_traffic_samples_pkey",
      columns: [table.vlanName, table.sampledAt],
    }),
    index("vlan_traffic_samples_vlan_time_idx").on(
      table.vlanName,
      table.sampledAt.desc(),
    ),
    index("vlan_traffic_samples_time_idx").on(table.sampledAt.desc()),
    check(
      "vlan_traffic_samples_nonnegative_check",
      sql`${table.downloadMbps} >= 0 and ${table.uploadMbps} >= 0`,
    ),
  ],
);
