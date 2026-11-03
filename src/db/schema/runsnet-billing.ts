import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Data Pelanggan yang disinkronkan langsung dari RunsNet (app.runsnet.id)
export const runsnetCustomers = pgTable(
  "runsnet_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    custId: text("cust_id").notNull().unique(),
    name: text("name").notNull(),
    serviceProfile: text("service_profile"),
    type: text("type"), // Prepaid / Postpaid
    spkDate: text("spk_date"),
    activeDate: text("active_date"),
    expiredDate: text("expired_date"),
    connectivity: text("connectivity"), // Terhubung / Tidak Terhubung
    status: text("status").notNull(), // Active, Pending, Isolir, Terminate
    rawJson: text("raw_json"),
    // Sesi PPPoE terakhir dari halaman detail RunsNet (diisi saat sinkron; pelanggan offline memakai sesi terakhirnya).
    ipAddress: text("ip_address"),
    macAddress: text("mac_address"),
    ipSyncedAt: timestamp("ip_synced_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("runsnet_customers_cust_id_idx").on(table.custId),
    index("runsnet_customers_status_idx").on(table.status),
  ],
);

// Data Tagihan / Invoice dari RunsNet
export const runsnetInvoices = pgTable(
  "runsnet_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceCode: text("invoice_code").notNull().unique(),
    custId: text("cust_id").notNull(),
    custName: text("cust_name").notNull(),
    periode: text("periode"),
    dueDate: text("due_date"),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    remainingAmount: numeric("remaining_amount", {
      precision: 12,
      scale: 2,
      mode: "number",
    })
      .default(0)
      .notNull(),
    agent: text("agent"),
    status: text("status").notNull(), // "unpaid" | "paid" | "partial"
    fileUrl: text("file_url"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("runsnet_invoices_cust_id_idx").on(table.custId),
    index("runsnet_invoices_status_idx").on(table.status),
    index("runsnet_invoices_periode_idx").on(table.periode),
  ],
);

// Data Riwayat Pembayaran / Payment dari RunsNet
export const runsnetPayments = pgTable(
  "runsnet_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentCode: text("payment_code").notNull().unique(),
    invoiceCode: text("invoice_code"),
    custId: text("cust_id").notNull(),
    custName: text("cust_name").notNull(),
    periode: text("periode"),
    payDate: text("pay_date"),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    method: text("method"), // Pembayaran Tunai, Transfer, dll.
    agent: text("agent"),
    operator: text("operator"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("runsnet_payments_cust_id_idx").on(table.custId),
    index("runsnet_payments_invoice_code_idx").on(table.invoiceCode),
    index("runsnet_payments_pay_date_idx").on(table.payDate),
  ],
);

// Log Eksekusi Sinkronisasi RunsNet
export const runsnetSyncLogs = pgTable(
  "runsnet_sync_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: text("status").notNull(), // "running" | "success" | "error"
    customersCount: integer("customers_count").default(0).notNull(),
    invoicesCount: integer("invoices_count").default(0).notNull(),
    paymentsCount: integer("payments_count").default(0).notNull(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("runsnet_sync_logs_started_at_idx").on(table.startedAt),
  ],
);

