import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const deployModes = ["lan", "tailscale", "tunnel"] as const;
export type DeployMode = (typeof deployModes)[number];

export const deviceAccessLevels = ["simulator", "baca-saja", "penuh"] as const;
export type DeviceAccessLevel = (typeof deviceAccessLevels)[number];

export const deployTargets = pgTable(
  "deploy_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nama: text("nama").notNull().default("SERVER NATIVE"),
    host: text("host").notNull(),
    port: integer("port").notNull().default(22),
    sshUser: text("ssh_user").notNull(),
    mode: text("mode").$type<DeployMode>().notNull().default("lan"),
    tailscaleHost: text("tailscale_host"),
    connectionReason: text("connection_reason"),
    hostKeyFingerprint: text("host_key_fingerprint"),
    deviceAccessLevel: text("device_access_level")
      .$type<DeviceAccessLevel>()
      .notNull()
      .default("simulator"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "deploy_targets_mode_check",
      sql`${table.mode} in ('lan', 'tailscale', 'tunnel')`,
    ),
    check(
      "deploy_targets_access_level_check",
      sql`${table.deviceAccessLevel} in ('simulator', 'baca-saja', 'penuh')`,
    ),
  ],
);

export type DeployTarget = typeof deployTargets.$inferSelect;
export type NewDeployTarget = typeof deployTargets.$inferInsert;
