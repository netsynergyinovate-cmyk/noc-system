import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Pelanggan yang dibuat langsung di peta, terpisah dari tabel inti `customers`.
export const mapCustomers = pgTable(
  "map_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    customerNumber: varchar("customer_number", { length: 64 })
      .notNull()
      .unique(),
    address: text("address").default("").notNull(),
    region: varchar("region", { length: 64 }).default("").notNull(),
    status: varchar("status", { length: 32 }).default("terhubung").notNull(), // 'terhubung' | 'isolir' | 'loss' | 'offline'
    billingStatus: varchar("billing_status", { length: 32 })
      .default("aktif")
      .notNull(), // 'lunas' | 'menunggak' | 'isolir' | 'aktif'
    packagePlan: varchar("package_plan", { length: 64 }).default("Standard"),
    monthlyFee: integer("monthly_fee").default(250000),
    opticalPower: doublePrecision("optical_power").default(-19.5),
    onuSerial: varchar("onu_serial", { length: 64 }),
    cpeSsid: varchar("cpe_ssid", { length: 64 }),
    cpeIp: varchar("cpe_ip", { length: 64 }),
    cpeHosts: integer("cpe_hosts").default(0),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    // Teks tanpa FK: bisa menunjuk entitas lokal (UUID) atau pusat (mis. "odp-...")
    odpId: text("odp_id"),
    // Nomor port ODP tempat pelanggan dipasang (1..kapasitas); null = belum dicatat
    odpPort: integer("odp_port"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("map_customers_number_idx").on(table.customerNumber),
    index("map_customers_coords_idx").on(table.latitude, table.longitude),
    index("map_customers_status_idx").on(table.status),
    index("map_customers_odp_idx").on(table.odpId),
  ],
);
