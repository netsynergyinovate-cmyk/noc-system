import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Tabel pelacakan eksekusi sinkronisasi data (seed, transfer, periodik, penyelarasan).
export const dataSyncRuns = pgTable(
  "data_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    module: text("module").notNull(),
    syncType: text("sync_type").notNull(), // seed, transfer, periodic_sync, alignment
    direction: text("direction").notNull(), // local_to_server, server_to_local, bidirectional, seed
    status: text("status").notNull(), // pending, in_progress, completed, failed
    recordsProcessed: integer("records_processed").default(0).notNull(),
    recordsInserted: integer("records_inserted").default(0).notNull(),
    recordsUpdated: integer("records_updated").default(0).notNull(),
    recordsSkipped: integer("records_skipped").default(0).notNull(),
    checksum: text("checksum"),
    durationMs: integer("duration_ms").default(0),
    actor: text("actor").default("system"),
    summaryMessage: text("summary_message"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: text("metadata"),
  },
  (table) => [
    index("data_sync_runs_module_idx").on(table.module),
    index("data_sync_runs_status_idx").on(table.status),
    index("data_sync_runs_started_at_idx").on(table.startedAt),
  ],
);

export type DataSyncRunRow = typeof dataSyncRuns.$inferSelect;
export type DataSyncRunInsert = typeof dataSyncRuns.$inferInsert;

// Tabel pelacakan penyemaian data awal (idempoten) per kategori & checksum.
export const seedTracking = pgTable(
  "seed_tracking",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seedKey: text("seed_key").notNull().unique(),
    category: text("category").notNull(), // accounts, thresholds, devices, whatsapp, billing
    targetTable: text("target_table").notNull(),
    recordsCount: integer("records_count").default(0).notNull(),
    checksum: text("checksum").notNull(),
    isIdempotent: boolean("is_idempotent").default(true).notNull(),
    status: text("status").default("seeded").notNull(), // seeded, verified, failed
    seededAt: timestamp("seeded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    details: text("details"),
  },
  (table) => [
    index("seed_tracking_category_idx").on(table.category),
    index("seed_tracking_status_idx").on(table.status),
  ],
);

export type SeedTrackingRow = typeof seedTracking.$inferSelect;
export type SeedTrackingInsert = typeof seedTracking.$inferInsert;
