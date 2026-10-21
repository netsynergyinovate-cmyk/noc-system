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

// Perangkat (server/ODC/ODP/tiang) yang dibuat langsung di peta, terpisah dari `network_infrastructure`.
export const mapDevices = pgTable(
  "map_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(), // 'server' | 'odc' | 'odp' | 'pole'
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    capacity: integer("capacity").default(0).notNull(),
    status: varchar("status", { length: 32 }).default("normal").notNull(), // 'normal' | 'warning' | 'critical' | 'offline'
    // Teks tanpa FK: bisa menunjuk entitas lokal (UUID) atau pusat (mis. "odp-...")
    parentDeviceId: text("parent_device_id"),
    notes: text("notes"),
    // Rasio splitter ODC/ODP (1:N, simpan N) = jumlah port output; null = belum diisi
    splitterRatio: integer("splitter_ratio"),
    // Splitter rasio (coupler tak seimbang): persen port tap, mis. 10 = 10:90; null = tidak ada
    splitterTap: integer("splitter_tap"),
    // Port ODC tempat ODP ini dipasang (1..rasio ODC); null = belum dicatat
    odcPort: integer("odc_port"),
    // OLT operasional di aplikasi pusat yang diwakili titik OLT ini; null = belum ditautkan
    centralOltId: text("central_olt_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("map_devices_parent_idx").on(table.parentDeviceId),
    index("map_devices_type_idx").on(table.type),
    index("map_devices_coords_idx").on(table.latitude, table.longitude),
  ],
);
