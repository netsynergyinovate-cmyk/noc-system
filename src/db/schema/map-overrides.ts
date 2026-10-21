import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// Koreksi lokal atas pelanggan/perangkat milik aplikasi pusat. Data pusat tidak pernah diubah;
// kolom null berarti "pakai nilai pusat".
export const mapOverrides = pgTable(
  "map_overrides",
  {
    entityType: varchar("entity_type", { length: 16 }).notNull(), // 'customer' | 'device'
    entityId: text("entity_id").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    parentDeviceId: text("parent_device_id"),
    // true = induk dikosongkan secara sengaja (beda dengan null = ikut pusat)
    parentCleared: boolean("parent_cleared").default(false).notNull(),
    notes: text("notes"),
    // Nomor port ODP tempat pelanggan dipasang (1..kapasitas); null = belum dicatat
    odpPort: integer("odp_port"),
    // Koreksi perangkat: rasio splitter (1:N) dan port ODC tempat ODP dipasang
    splitterRatio: integer("splitter_ratio"),
    splitterTap: integer("splitter_tap"),
    odcPort: integer("odc_port"),
    // Koreksi jenis perangkat pusat ('odp' | 'odc'); null = ikut jenis dari pusat
    deviceType: varchar("device_type", { length: 16 }),
    // Koreksi nama perangkat pusat (mis. awalan ODP -> ODC saat jenis diubah); null = ikut pusat
    name: varchar("name", { length: 160 }),
    // Tautan titik OLT pusat ke OLT operasional bila host-nya tidak tercatat
    centralOltId: text("central_olt_id"),
    hidden: boolean("hidden").default(false).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityType, table.entityId] })],
);
