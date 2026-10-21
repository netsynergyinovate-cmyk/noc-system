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

export const cableRoutes = pgTable(
  "cable_routes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    cableType: varchar("cable_type", { length: 64 }).notNull(),
    fiberCapacity: integer("fiber_capacity").notNull(),
    // Teks tanpa FK: bisa menunjuk entitas lokal (UUID) atau pusat (mis. "odp-...")
    fromDeviceId: text("from_device_id").notNull(),
    toDeviceId: text("to_device_id"),
    samplingIntervalM: integer("sampling_interval_m").default(50).notNull(),
    totalLengthM: doublePrecision("total_length_m").default(0).notNull(),
    // Warna pilihan jalur (#rrggbb, tanpa kuning/merah/hijau); null = warna kapasitas
    color: varchar("color", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("cable_routes_code_idx").on(table.code),
    index("cable_routes_from_idx").on(table.fromDeviceId),
  ],
);
