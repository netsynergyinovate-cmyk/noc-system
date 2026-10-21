import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { cableRoutes } from "./cable-routes";

export const cableSegments = pgTable(
  "cable_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => cableRoutes.id, { onDelete: "cascade" }),
    // Teks tanpa FK: bisa menunjuk entitas lokal (UUID) atau pusat (mis. "odp-...")
    fromDeviceId: text("from_device_id").notNull(),
    toDeviceId: text("to_device_id"),
    customerId: text("customer_id"),
    sequence: integer("sequence").notNull(),
    geometry: jsonb("geometry").$type<[number, number][]>().notNull(),
    lengthM: doublePrecision("length_m").default(0).notNull(),
    snapped: boolean("snapped").default(false).notNull(),
    snapProvider: varchar("snap_provider", { length: 64 })
      .default("central-api")
      .notNull(),
    snapToleranceM: integer("snap_tolerance_m").default(30).notNull(),
    snappedAt: timestamp("snapped_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("cable_segments_route_seq_idx").on(
      table.routeId,
      table.sequence,
    ),
    index("cable_segments_route_idx").on(table.routeId),
    index("cable_segments_customer_idx").on(table.customerId),
  ],
);
