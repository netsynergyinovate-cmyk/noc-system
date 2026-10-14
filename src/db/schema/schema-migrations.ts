import { bigint, integer, pgSchema, serial, text } from "drizzle-orm/pg-core";

export const drizzleSchema = pgSchema("drizzle");

export const drizzleMigrationsTable = drizzleSchema.table(
  "__drizzle_migrations",
  {
    id: serial("id").primaryKey(),
    hash: text("hash").notNull(),
    createdAt: bigint("created_at", { mode: "number" }),
    tag: text("tag"),
    durationMs: integer("duration_ms"),
    appliedBy: text("applied_by"),
    statementsCount: integer("statements_count"),
  },
);

export type DrizzleMigrationRow = typeof drizzleMigrationsTable.$inferSelect;
export type DrizzleMigrationInsert = typeof drizzleMigrationsTable.$inferInsert;
