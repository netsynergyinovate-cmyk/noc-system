import { index, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// Satu aksi tulis peta yang bisa dibatalkan: keadaan baris sebelum aksi (before null = baris baru)
export const mapUndoEntries = pgTable(
  "map_undo_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    label: varchar("label", { length: 160 }).notNull(),
    changes: jsonb("changes").$type<unknown[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("map_undo_entries_created_idx").on(table.createdAt)],
);
