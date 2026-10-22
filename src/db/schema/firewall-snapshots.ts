import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customers";
import { diagnosticRuns } from "./diagnostics";
import { routers } from "./routers";

// Potret firewall router untuk satu pelanggan pada satu diagnosa (Fase 4).
// Hanya-baca: diambil lewat GET /ip/firewall/{filter,raw,nat,mangle} dan
// /ip/firewall/connection; tidak ada rule yang ditambah atau diubah.
export const firewallSnapshots = pgTable(
  "firewall_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => diagnosticRuns.id, { onDelete: "cascade" }),
    routerId: uuid("router_id").references(() => routers.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    customerIp: text("customer_ip").notNull(),
    // Terpisah karena fasttrack membatalkan simple queue.
    fasttrackActive: boolean("fasttrack_active").notNull(),
    // Koneksi milik pelanggan (keluar + masuk) dan isi tabel router.
    conntrackCount: integer("conntrack_count").notNull(),
    conntrackTotal: integer("conntrack_total"),
    conntrackMax: integer("conntrack_max"),
    rawDropMatched: boolean("raw_drop_matched").notNull(),
    addressListMatched: text("address_list_matched")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
  },
  (table) => [index("firewall_snapshots_run_idx").on(table.runId)],
);

// Rule firewall/NAT yang mengenai trafik pelanggan, dengan posisi dan hit-count.
export const firewallRuleHits = pgTable(
  "firewall_rule_hits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => firewallSnapshots.id, { onDelete: "cascade" }),
    table: text("table").notNull(),
    chain: text("chain").notNull(),
    // Urutan rule di tabelnya: urutan menentukan rule mana yang berlaku.
    ruleIndex: integer("rule_index").notNull(),
    ruleId: text("rule_id").notNull(),
    action: text("action").notNull(),
    // khusus | umum | mungkin (lihat ruleScope di src/lib/diagnostics.ts).
    scope: text("scope").notNull(),
    summary: text("summary").notNull(),
    comment: text("comment").notNull(),
    disabled: boolean("disabled").notNull(),
    matchedPackets: bigint("matched_packets", { mode: "number" }).notNull(),
    matchedBytes: bigint("matched_bytes", { mode: "number" }).notNull(),
    // Aktif, khusus pelanggan, hit-count nol.
    isStale: boolean("is_stale").notNull(),
  },
  (table) => [
    index("firewall_rule_hits_snapshot_idx").on(table.snapshotId),
    check("firewall_rule_hits_table_check", sql`${table.table} in ('filter', 'raw', 'nat', 'mangle')`),
    check("firewall_rule_hits_scope_check", sql`${table.scope} in ('khusus', 'umum', 'mungkin')`),
  ],
);
