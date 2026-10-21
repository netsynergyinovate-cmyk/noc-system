import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const mapLayers = pgTable("map_layers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  layerOrder: integer("layer_order").default(0).notNull(),
  opacity: doublePrecision("opacity").default(1.0).notNull(),
  visible: boolean("visible").default(true).notNull(),
  shapes: jsonb("shapes").$type<unknown[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
