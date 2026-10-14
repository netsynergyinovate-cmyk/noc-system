import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";
import { routers } from "./routers";

export const alertKinds = [
  "queue",
  "cpu",
  "port",
  "optical",
  "offline",
] as const;
export type AlertKind = (typeof alertKinds)[number];

export const alertSeverities = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof alertSeverities)[number];

export const alertStatuses = [
  "active",
  "resolved",
  "handled",
  "acknowledged",
] as const;
export type AlertStatus = (typeof alertStatuses)[number];

export const alertTicketStatuses = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
] as const;
export type AlertTicketStatus = (typeof alertTicketStatuses)[number];

export const alertTicketPriorities = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type AlertTicketPriority = (typeof alertTicketPriorities)[number];

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routerId: uuid("router_id").references(() => routers.id, {
      onDelete: "restrict",
    }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<AlertKind>().notNull(),
    severity: text("severity").$type<AlertSeverity>().notNull(),
    status: text("status").$type<AlertStatus>().default("active").notNull(),
    title: text("title"),
    message: text("message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    timeSource: text("time_source")
      .$type<"event" | "poll">()
      .default("poll")
      .notNull(),
    timeUncertaintySeconds: integer("time_uncertainty_seconds")
      .default(0)
      .notNull(),
    endTimeSource: text("end_time_source").$type<
      "event" | "poll" | "operator"
    >(),
    endTimeUncertaintySeconds: integer("end_time_uncertainty_seconds").default(
      0,
    ),
    handledBy: text("handled_by"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    locationName: text("location_name"),
    locationAddress: text("location_address"),
    locationOdp: text("location_odp"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ticketStatus: text("ticket_status")
      .$type<AlertTicketStatus>()
      .default("open")
      .notNull(),
    ticketPriority: text("ticket_priority")
      .$type<AlertTicketPriority>()
      .default("medium")
      .notNull(),
    ticketNotes: text("ticket_notes"),
    actionTaken: text("action_taken"),
    dispatchTechnician: boolean("dispatch_technician").default(false),
    technicianName: text("technician_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("alerts_status_idx").on(table.status, table.startedAt.desc()),
    index("alerts_started_idx").on(table.startedAt.desc()),
    index("alerts_router_started_idx").on(
      table.routerId,
      table.startedAt.desc(),
    ),
    index("alerts_customer_idx").on(table.customerId, table.startedAt.desc()),
    index("alerts_active_idx")
      .on(table.type, table.startedAt.desc())
      .where(sql`${table.status} = 'active'`),
    check(
      "alerts_type_check",
      sql`${table.type} in ('queue', 'cpu', 'port', 'optical', 'offline')`,
    ),
    check(
      "alerts_severity_check",
      sql`${table.severity} in ('info', 'warning', 'critical')`,
    ),
    check(
      "alerts_status_check",
      sql`${table.status} in ('active', 'resolved', 'handled', 'acknowledged')`,
    ),
    check(
      "alerts_ticket_status_check",
      sql`${table.ticketStatus} in ('open', 'in_progress', 'resolved', 'escalated')`,
    ),
    check(
      "alerts_ticket_priority_check",
      sql`${table.ticketPriority} in ('low', 'medium', 'high', 'critical')`,
    ),
    check(
      "alerts_period_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);
