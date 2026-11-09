import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { routers } from "./routers";
import { user } from "./user";

// PRD §6: Entitas Bukti Akses Pelanggan (Halaman NetFlow & Detail)

// netflow_exporters: Exporter NetFlow per router beserta pengali sampling rate dan kesehatan
export const netflowExporters = pgTable(
  "netflow_exporters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    routerId: uuid("router_id").references(() => routers.id, {
      onDelete: "cascade",
    }),
    host: text("host").notNull(),
    version: text("version").notNull(), // v5, v9, IPFIX
    samplingRate: integer("sampling_rate").default(1).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    status: text("status").default("active").notNull(),
  },
  (table) => [index("netflow_exporters_router_idx").on(table.routerId)],
);

// dns_queries: Catatan mentah query DNS; disimpan 1 hari untuk investigasi pada hari yang sama
export const dnsQueries = pgTable(
  "dns_queries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    clientIp: text("client_ip").notNull(),
    domain: text("domain").notNull(),
    queriedAt: timestamp("queried_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("dns_queries_time_idx").on(table.queriedAt.desc()),
    index("dns_queries_customer_idx").on(
      table.customerId,
      table.queriedAt.desc(),
    ),
    index("dns_queries_domain_idx").on(table.domain),
  ],
);

// tls_sni_events: Catatan mentah nama tujuan dari SNI TLS; disimpan 1 hari
export const tlsSniEvents = pgTable(
  "tls_sni_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    clientIp: text("client_ip").notNull(),
    sniHost: text("sni_host").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tls_sni_time_idx").on(table.observedAt.desc()),
    index("tls_sni_customer_idx").on(table.customerId, table.observedAt.desc()),
    index("tls_sni_host_idx").on(table.sniHost),
  ],
);

// domain_catalog: Pemetaan domain ke kategori beserta tingkat keyakinan (TrustPositif / katalog)
export const domainCatalog = pgTable(
  "domain_catalog",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domain: text("domain").notNull().unique(),
    category: text("category").notNull(),
    confidence: doublePrecision("confidence").default(1.0).notNull(),
    source: text("source").default("internal").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("domain_catalog_domain_idx").on(table.domain),
    index("domain_catalog_category_idx").on(table.category),
  ],
);

// domain_category_overrides: Penimpaan kategori manual oleh peran berwenang
export const domainCategoryOverrides = pgTable(
  "domain_category_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domain: text("domain").notNull().unique(),
    category: text("category").notNull(),
    setBy: text("set_by").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("domain_overrides_domain_idx").on(table.domain)],
);

// browsing_daily_rollups: Lapisan bukti utama: satu baris per pelanggan–domain–tanggal (disimpan 30 hari)
export const browsingDailyRollups = pgTable(
  "browsing_daily_rollups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    date: date("date").notNull(),
    hitCount: integer("hit_count").default(1).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    category: text("category").default("Umum").notNull(),
    confidence: doublePrecision("confidence").default(0.8).notNull(),
  },
  (table) => [
    uniqueIndex("browsing_rollups_unique").on(
      table.customerId,
      table.domain,
      table.date,
    ),
    index("browsing_rollups_customer_date_idx").on(
      table.customerId,
      table.date.desc(),
    ),
    index("browsing_rollups_domain_idx").on(table.domain),
  ],
);

// browsing_access_audit: Jejak setiap pembukaan riwayat akses pelanggan
export const browsingAccessAudit = pgTable(
  "browsing_access_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(), // ref user.id
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("browsing_audit_customer_idx").on(
      table.customerId,
      table.openedAt.desc(),
    ),
    index("browsing_audit_user_idx").on(table.userId, table.openedAt.desc()),
  ],
);

// browsing_retention_runs: Riwayat pembersihan retensi data akses
export const browsingRetentionRuns = pgTable(
  "browsing_retention_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(), // success, failed
    deletedRows: integer("deleted_rows").default(0).notNull(),
    errorMessage: text("error_message"),
  },
  (table) => [index("browsing_retention_time_idx").on(table.startedAt.desc())],
);
