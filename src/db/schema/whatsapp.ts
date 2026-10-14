import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const whatsappRecipients = pgTable("whatsapp_recipients", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // Nomor 628xxx atau ID grup.
  target: text("target").notNull().unique(),
  type: text("type")
    .$type<"individual" | "group">()
    .default("individual")
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const whatsappLogs = pgTable(
  "whatsapp_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id").references(() => whatsappRecipients.id, {
      onDelete: "set null",
    }),
    recipientTarget: text("recipient_target").notNull(),
    recipientName: text("recipient_name").notNull(),
    message: text("message").notNull(),
    // queue, cpu, port, optical, offline, test
    alertKind: text("alert_kind"),
    status: text("status")
      .$type<"pending" | "sent" | "failed">()
      .default("pending")
      .notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("wa_logs_created_idx").on(table.createdAt.desc()),
    index("wa_logs_status_idx").on(table.status, table.createdAt.desc()),
  ],
);
