import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./user.ts";

// Jejak siapa mengubah apa dan kapan. Baris tetap ada walau akunnya dihapus.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target").notNull(),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_created_idx").on(table.createdAt.desc()),
    index("audit_log_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  ],
);

// Alias untuk kompatibilitas skema log aktivitas operator
export const operatorActivityLogs = auditLog;
export type OperatorActivityLog = typeof auditLog.$inferSelect;
export type NewOperatorActivityLog = typeof auditLog.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
