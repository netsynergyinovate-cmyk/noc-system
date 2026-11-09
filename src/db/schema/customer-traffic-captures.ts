import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { routers } from "./routers";

export interface CustomerCaptureFlowItem {
  platform: string;
  domain?: string;
  category?: string;
  confidence?: number | null;
  peerIp: string;
  port: number;
  protocol: string;
  bytes: number;
  packets: number;
  throughputBps: number;
}

// customer_traffic_captures: Menyimpan riwayat rekaman inspeksi langsung (15s, 30s, 60s) per pelanggan
export const customerTrafficCaptures = pgTable(
  "customer_traffic_captures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    routerId: uuid("router_id").references(() => routers.id, {
      onDelete: "set null",
    }),
    customerIp: text("customer_ip").notNull(),
    durationSeconds: integer("duration_seconds").notNull(), // 15, 30, 60
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).default(0).notNull(),
    totalPackets: integer("total_packets").default(0).notNull(),
    flowCount: integer("flow_count").default(0).notNull(),
    recordedBy: text("recorded_by").default("Operator").notNull(),
    topApp: text("top_app"),
    flows: jsonb("flows")
      .$type<CustomerCaptureFlowItem[]>()
      .default([])
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("traffic_captures_customer_idx").on(
      table.customerId,
      table.startedAt.desc(),
    ),
    index("traffic_captures_time_idx").on(table.startedAt.desc()),
  ],
);
