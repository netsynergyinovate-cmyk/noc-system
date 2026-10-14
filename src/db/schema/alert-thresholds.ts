import {
  check,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./user";

export const alertThresholdKinds = [
  "queue",
  "cpu",
  "port",
  "optical",
  "offline",
] as const;
export type AlertThresholdKind = (typeof alertThresholdKinds)[number];

// Satu baris per aturan alert. `threshold` kosong untuk aturan tanpa angka (offline).
export const alertThresholds = pgTable(
  "alert_thresholds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleKind: text("rule_kind").$type<AlertThresholdKind>().notNull().unique(),
    threshold: doublePrecision("threshold"),
    forSeconds: integer("for_seconds").notNull(),
    updatedBy: text("updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "alert_thresholds_rule_kind_check",
      sql`${table.ruleKind} in ('queue', 'cpu', 'port', 'optical', 'offline')`,
    ),
    check("alert_thresholds_for_seconds_check", sql`${table.forSeconds} >= 0`),
  ],
);
