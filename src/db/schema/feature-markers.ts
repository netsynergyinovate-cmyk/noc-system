import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./user";

export const featureMarkers = pgTable(
  "feature_markers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userEmail: varchar("user_email", { length: 255 }).notNull(),
    userRole: varchar("user_role", { length: 50 }).notNull(),
    pagePath: varchar("page_path", { length: 255 }).notNull(),
    pageTitle: varchar("page_title", { length: 255 }).default("").notNull(),
    elementSelector: varchar("element_selector", { length: 500 })
      .default("")
      .notNull(),
    elementText: text("element_text").default("").notNull(),
    featureName: varchar("feature_name", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 })
      .default("used_frequently")
      .notNull(),
    frequency: varchar("frequency", { length: 50 }).default("daily").notNull(),
    notes: text("notes").default("").notNull(),
    status: varchar("status", { length: 50 }).default("baru").notNull(),
    developerNotes: text("developer_notes").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("feature_markers_created_at_idx").on(table.createdAt.desc()),
    index("feature_markers_page_path_idx").on(table.pagePath),
    index("feature_markers_category_idx").on(table.category),
    index("feature_markers_status_idx").on(table.status),
  ],
);

export type FeatureMarker = typeof featureMarkers.$inferSelect;
export type NewFeatureMarker = typeof featureMarkers.$inferInsert;
