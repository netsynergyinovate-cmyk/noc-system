import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./user";

/**
 * Tabel definisi langkah onboarding terstruktur dari nol ke go-live.
 */
export const onboardingSteps = pgTable(
  "onboarding_steps",
  {
    id: text("id").primaryKey(), // mis. "step-mikrotik-core", "step-ambang-alert"
    stepNumber: integer("step_number").notNull(),
    type: text("type").notNull(), // "wajib" | "opsional"
    title: text("title").notNull(),
    description: text("description").notNull(),
    targetUrl: text("target_url").notNull(),
    targetLabel: text("target_label").notNull(),
    prerequisiteStepIds: text("prerequisite_step_ids")
      .array()
      .notNull()
      .default([]),
    estimatedMinutes: integer("estimated_minutes").notNull().default(5),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("onboarding_steps_number_idx").on(table.stepNumber),
    index("onboarding_steps_type_idx").on(table.type),
  ],
);

export type OnboardingStepRow = typeof onboardingSteps.$inferSelect;
export type OnboardingStepInsert = typeof onboardingSteps.$inferInsert;

/**
 * Tabel pelacakan progres pengerjaan langkah tutorial operator.
 */
export const onboardingProgress = pgTable(
  "onboarding_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stepId: text("step_id")
      .notNull()
      .references(() => onboardingSteps.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("tertunda"), // "tertunda" | "selesai" | "terkunci"
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("onboarding_progress_user_step_idx").on(
      table.userId,
      table.stepId,
    ),
    index("onboarding_progress_status_idx").on(table.status),
    index("onboarding_progress_step_idx").on(table.stepId),
  ],
);

export type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;
export type OnboardingProgressInsert = typeof onboardingProgress.$inferInsert;
