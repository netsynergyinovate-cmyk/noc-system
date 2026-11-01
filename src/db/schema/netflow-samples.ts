import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";
import { routers } from "./routers";

// Aliran NetFlow. Backend Go (netflow/aggregate.go) menulis agregat per
// pelanggan per 5 menit: satu baris per arah per lawan (IP + port layanan +
// protokol), hanya 10 lawan terbesar per pelanggan per arah per bucket plus
// satu baris "lainnya" (IP lawan 0.0.0.0). `captured_at` = awal bucket.
//
// `dst_port` adalah port layanan lawan untuk KEDUA arah (unduh juga), supaya
// pengelompokan per layanan (443 = HTTPS) berlaku sama; `src_port` = 0.
// `src_ip`/`dst_ip` tetap arah sebenarnya.
export const netflowSamples = pgTable(
  "netflow_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routerId: uuid("router_id").references(() => routers.id, {
      onDelete: "set null",
    }),
    // Pelanggan pemilik IP sesi saat aliran diterima; kosong = bukan pelanggan.
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    // up = dari pelanggan (unggah), down = ke pelanggan (unduh).
    direction: text("direction").$type<"up" | "down">(),
    srcIp: text("src_ip").notNull(),
    dstIp: text("dst_ip").notNull(),
    srcPort: integer("src_port").notNull(),
    dstPort: integer("dst_port").notNull(),
    protocol: text("protocol").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    packets: integer("packets").default(1).notNull(),
    // Jumlah flow yang digabung ke baris ini.
    flows: integer("flows").default(1).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("netflow_captured_idx").on(table.capturedAt.desc()),
    index("netflow_src_ip_idx").on(table.srcIp, table.capturedAt.desc()),
    index("netflow_dst_port_idx").on(table.dstPort, table.capturedAt.desc()),
    index("netflow_customer_idx").on(table.customerId, table.capturedAt.desc()),
    check(
      "netflow_direction_check",
      sql`${table.direction} is null or ${table.direction} in ('up', 'down')`,
    ),
  ],
);
