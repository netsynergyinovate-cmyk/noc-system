import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { deployTargets } from "./deploy-targets";

export const deployRunTypes = ["deploy", "rollback", "uji"] as const;
export type DeployRunType = (typeof deployRunTypes)[number];

export const deployRunStatuses = ["berjalan", "berhasil", "gagal"] as const;
export type DeployRunStatus = (typeof deployRunStatuses)[number];

export const deployStepStatuses = [
  "menunggu",
  "berjalan",
  "berhasil",
  "gagal",
  "dilewati",
] as const;
export type DeployStepStatus = (typeof deployStepStatuses)[number];

export const deployRuns = pgTable(
  "deploy_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetId: uuid("target_id").references(() => deployTargets.id, {
      onDelete: "set null",
    }),
    versi: text("versi").notNull(),
    jenis: text("jenis").$type<DeployRunType>().notNull(),
    status: text("status")
      .$type<DeployRunStatus>()
      .notNull()
      .default("berjalan"),
    titikBalikVersi: text("titik_balik_versi"),
    otomatis: boolean("otomatis").notNull().default(false),
    dijalankanOleh: text("dijalankan_oleh").notNull().default("Operator"),
    mulai: timestamp("mulai", { withTimezone: true }).defaultNow().notNull(),
    selesai: timestamp("selesai", { withTimezone: true }),
  },
  (table) => [
    check(
      "deploy_runs_jenis_check",
      sql`${table.jenis} in ('deploy', 'rollback', 'uji')`,
    ),
    check(
      "deploy_runs_status_check",
      sql`${table.status} in ('berjalan', 'berhasil', 'gagal')`,
    ),
  ],
);

export const deploySteps = pgTable(
  "deploy_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => deployRuns.id, { onDelete: "cascade" }),
    urutan: integer("urutan").notNull(),
    nama: text("nama").notNull(),
    status: text("status")
      .$type<DeployStepStatus>()
      .notNull()
      .default("menunggu"),
    keluaran: text("keluaran"),
    mulai: timestamp("mulai", { withTimezone: true }),
    selesai: timestamp("selesai", { withTimezone: true }),
  },
  (table) => [
    check(
      "deploy_steps_status_check",
      sql`${table.status} in ('menunggu', 'berjalan', 'berhasil', 'gagal', 'dilewati')`,
    ),
  ],
);

export const deployReleases = pgTable("deploy_releases", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetId: uuid("target_id")
    .notNull()
    .references(() => deployTargets.id, { onDelete: "cascade" }),
  versi: text("versi").notNull(),
  path: text("path").notNull(),
  dipasangPada: timestamp("dipasang_pada", { withTimezone: true })
    .defaultNow()
    .notNull(),
  aktif: boolean("aktif").notNull().default(false),
});

export const deployConfigSyncs = pgTable("deploy_config_syncs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => deployRuns.id, { onDelete: "cascade" }),
  tabel: text("tabel").notNull(),
  disisipkan: integer("disisipkan").notNull().default(0),
  diperbarui: integer("diperbarui").notNull().default(0),
  dilewati: integer("dilewati").notNull().default(0),
  status: text("status")
    .$type<"berhasil" | "gagal" | "dilewati">()
    .notNull()
    .default("berhasil"),
  disinkronkanPada: timestamp("disinkronkan_pada", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const deployWriteGuardLogs = pgTable("deploy_write_guard_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  reason: text("reason").notNull(),
  payloadPreview: text("payload_preview"),
  blockedAt: timestamp("blocked_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type DeployRun = typeof deployRuns.$inferSelect;
export type DeployStep = typeof deploySteps.$inferSelect;
export type DeployRelease = typeof deployReleases.$inferSelect;
export type DeployConfigSync = typeof deployConfigSyncs.$inferSelect;
export type DeployWriteGuardLog = typeof deployWriteGuardLogs.$inferSelect;
