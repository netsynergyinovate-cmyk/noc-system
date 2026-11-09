import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";
import { routers } from "./routers";
import type { VerdictSecondary } from "../../lib/diagnostics";

// Diagnosa pelanggan berlapis (/app/anomali). Manual dan otomatis memakai mesin
// yang sama dan tabel yang sama; yang beda hanya `trigger_mode` dan alasannya.
// Diagnosa hanya membaca: tidak ada yang ditulis ke router, OLT, atau ONT.
export const diagnosticRuns = pgTable(
  "diagnostic_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Kosong untuk catatan gangguan bersama (bukan milik satu pelanggan).
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    // Router pelanggan saat diagnosa diminta; dasar batas antrean per router.
    routerId: uuid("router_id").references(() => routers.id, {
      onDelete: "set null",
    }),
    triggerMode: text("trigger_mode").$type<"manual" | "auto">().notNull(),
    // Nama operator yang menekan tombol (manual saja).
    triggeredBy: text("triggered_by"),
    triggeredByUserId: text("triggered_by_user_id"),
    triggerReason: text("trigger_reason").notNull(),
    // Id alert/tiket yang memicu diagnosa otomatis.
    triggerSourceRef: text("trigger_source_ref"),
    // Kunci penggabungan diagnosa otomatis per pelanggan per jendela waktu.
    dedupeKey: text("dedupe_key"),
    // Kejadian pemicu lain yang digabung ke run ini, bukan run baru.
    mergedCount: integer("merged_count").default(0).notNull(),
    lastMergedAt: timestamp("last_merged_at", { withTimezone: true }),
    // Angka kecil didahulukan: manual 0, otomatis 10.
    priority: smallint("priority").notNull(),
    status: text("status")
      .$type<"queued" | "running" | "done" | "failed">()
      .default("queued")
      .notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Waktu keluhan/kejadian pemicu; acuan garis waktu. Kosong = waktu diminta.
    complaintAt: timestamp("complaint_at", { withTimezone: true }),
    // Kejadian log & alert di sekitar keluhan, potret saat diagnosa berjalan.
    timeline: jsonb("timeline")
      .$type<
        {
          at: string;
          kind: string;
          label: string;
          detail: string;
          source: string;
        }[]
      >()
      .default([])
      .notNull(),
    verdictLayer: text("verdict_layer"),
    verdictDetail: text("verdict_detail"),
    isSharedFault: boolean("is_shared_fault").default(false).notNull(),
    verdictScope: text("verdict_scope").$type<"own" | "shared" | "unknown">(),
    verdictRoot: jsonb("verdict_root").$type<{
      kind: "customer" | "odp" | "router" | "uplink";
      name: string;
      affected: number;
      served: number;
    }>(),
    verdictSecondary: jsonb("verdict_secondary")
      .$type<VerdictSecondary[]>()
      .default([])
      .notNull(),
    verdictHeld: boolean("verdict_held").default(false).notNull(),
  },
  (table) => [
    index("diagnostic_runs_customer_idx").on(
      table.customerId,
      table.createdAt.desc(),
    ),
    index("diagnostic_runs_created_idx").on(table.createdAt.desc()),
    uniqueIndex("diagnostic_runs_dedupe_unique").on(table.dedupeKey),
    // Tekan tombol dua kali = diarahkan ke run manual yang masih berjalan.
    uniqueIndex("diagnostic_runs_manual_active_unique")
      .on(table.customerId)
      .where(
        sql`${table.triggerMode} = 'manual' and ${table.status} in ('queued', 'running')`,
      ),
    check(
      "diagnostic_runs_trigger_mode_check",
      sql`${table.triggerMode} in ('manual', 'auto')`,
    ),
    check(
      "diagnostic_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'done', 'failed')`,
    ),
  ],
);

// Satu temuan = satu angka pada satu lapisan, lengkap dengan ambang dan sumber.
// `unchecked` mencatat lapisan yang tidak dapat diperiksa beserta alasannya,
// supaya tidak pernah menyamar sebagai `ok`.
export const diagnosticFindings = pgTable(
  "diagnostic_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => diagnosticRuns.id, { onDelete: "cascade" }),
    layer: text("layer").notNull(),
    metric: text("metric").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    threshold: text("threshold"),
    comparator: text("comparator"),
    status: text("status")
      .$type<"ok" | "warn" | "fail" | "unchecked">()
      .notNull(),
    // Penjelasan untuk operator; untuk `unchecked` berisi alasannya.
    detail: text("detail").notNull(),
    // Router/OLT/tabel asal data dan waktu sampelnya.
    sourceRef: text("source_ref"),
    sampledAt: timestamp("sampled_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("diagnostic_findings_run_idx").on(table.runId),
    check(
      "diagnostic_findings_status_check",
      sql`${table.status} in ('ok', 'warn', 'fail', 'unchecked')`,
    ),
  ],
);

// Kebijakan pemicu otomatis. Satu baris (id = 1).
export const diagnosticPolicy = pgTable(
  "diagnostic_policy",
  {
    id: smallint("id").primaryKey().default(1),
    triggerAlert: boolean("trigger_alert").default(true).notNull(),
    triggerTicket: boolean("trigger_ticket").default(true).notNull(),
    triggerBilling: boolean("trigger_billing").default(true).notNull(),
    dedupeMinutes: integer("dedupe_minutes").default(15).notNull(),
    massThreshold: integer("mass_threshold").default(10).notNull(),
    massWindowMinutes: integer("mass_window_minutes").default(5).notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("diagnostic_policy_single_row_check", sql`${table.id} = 1`),
    check(
      "diagnostic_policy_ranges_check",
      sql`${table.dedupeMinutes} between 1 and 1440 and ${table.massThreshold} between 2 and 1000 and ${table.massWindowMinutes} between 1 and 60`,
    ),
  ],
);
