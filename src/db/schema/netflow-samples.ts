import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { routers } from "./routers";

// Sampel flow NetFlow: satu baris per flow yang diterima dari router.
export const netflowSamples = pgTable(
  "netflow_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routerId: uuid("router_id").references(() => routers.id, {
      onDelete: "set null",
    }),
    srcIp: text("src_ip").notNull(),
    dstIp: text("dst_ip").notNull(),
    srcPort: integer("src_port").notNull(),
    dstPort: integer("dst_port").notNull(),
    protocol: text("protocol").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    packets: integer("packets").default(1).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("netflow_captured_idx").on(table.capturedAt.desc()),
    index("netflow_src_ip_idx").on(table.srcIp, table.capturedAt.desc()),
    index("netflow_dst_port_idx").on(table.dstPort, table.capturedAt.desc()),
  ],
);
