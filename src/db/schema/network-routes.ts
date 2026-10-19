import {
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const networkRouteStatuses = ["active", "inactive"] as const;
export type NetworkRouteStatus = (typeof networkRouteStatuses)[number];

export const networkRoutes = pgTable(
  "network_routes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    oltId: text("olt_id"),
    odcId: text("odc_id"),
    ponPort: text("pon_port"),
    status: text("status").$type<NetworkRouteStatus>().default("active").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("network_routes_olt_idx").on(table.oltId),
    index("network_routes_odc_idx").on(table.odcId),
  ],
);

export type NetworkRoute = typeof networkRoutes.$inferSelect;
export type NewNetworkRoute = typeof networkRoutes.$inferInsert;
