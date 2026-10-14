import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const deviceTypes = ["mikrotik", "olt", "genieacs", "billing"] as const;
export type DeviceType = (typeof deviceTypes)[number];

export const deviceTestStatuses = [
  "connected",
  "disconnected",
  "error",
  "timeout",
  "untested",
] as const;
export type DeviceTestStatus = (typeof deviceTestStatuses)[number];

export const deviceTestCodes = [
  "OK",
  "TIMEOUT",
  "AUTH_FAILED",
  "CONNECTION_REFUSED",
  "INVALID_PORT",
  "INVALID_HOST",
  "HTTP_ERROR",
  "DNS_ERROR",
] as const;
export type DeviceTestCode = (typeof deviceTestCodes)[number];

// Riwayat hasil uji koneksi. Tidak pernah menyimpan password/token (details sudah disaring).
export const deviceTestResults = pgTable(
  "device_test_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceType: text("device_type").$type<DeviceType>().notNull(),
    deviceId: uuid("device_id"),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username"),
    endpointTested: text("endpoint_tested").notNull(),
    mode: text("mode").default("real").notNull(),
    status: text("status").$type<DeviceTestStatus>().notNull(),
    code: text("code").$type<DeviceTestCode>().notNull(),
    statusCode: integer("status_code"),
    message: text("message").notNull(),
    latencyMs: integer("latency_ms"),
    ok: boolean("ok").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    testedBy: text("tested_by"),
    testedAt: timestamp("tested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("device_test_results_type_idx").on(
      table.deviceType,
      table.testedAt.desc(),
    ),
    index("device_test_results_host_idx").on(table.host, table.testedAt.desc()),
    index("device_test_results_device_id_idx").on(
      table.deviceId,
      table.testedAt.desc(),
    ),
    index("device_test_results_tested_at_idx").on(table.testedAt.desc()),
    check(
      "device_test_results_type_check",
      sql`${table.deviceType} in ('mikrotik', 'olt', 'genieacs', 'billing')`,
    ),
    check(
      "device_test_results_status_check",
      sql`${table.status} in ('connected', 'disconnected', 'error', 'timeout', 'untested')`,
    ),
    check(
      "device_test_results_code_check",
      sql`${table.code} in ('OK', 'TIMEOUT', 'AUTH_FAILED', 'CONNECTION_REFUSED', 'INVALID_PORT', 'INVALID_HOST', 'HTTP_ERROR', 'DNS_ERROR')`,
    ),
  ],
);

export type DeviceTestResultRow = typeof deviceTestResults.$inferSelect;
export type NewDeviceTestResultRow = typeof deviceTestResults.$inferInsert;
