import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { routers } from "./routers";

export const billingStatuses = ["lunas", "isolir"] as const;
export type BillingStatus = (typeof billingStatuses)[number];

// Pelanggan PPPoE. `pppoe_username` adalah kunci pencocokan dengan data
// router, billing, dan OLT.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    pppoeUsername: text("pppoe_username").notNull().unique(),
    // Router tidak bisa dihapus selagi masih punya pelanggan; nonaktifkan saja.
    routerId: uuid("router_id")
      .notNull()
      .references(() => routers.id, { onDelete: "restrict" }),
    // Alamat dan koordinat boleh kosong: pelanggan yang ditemukan dari data
    // PPPoE belum tentu sudah dilengkapi.
    address: text("address"),
    latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
    longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
    // Nama ODP (kotak distribusi fiber) atau lokasi tempat pelanggan tersambung,
    // ditulis bebas sesuai penamaan ISP. Kosong bila belum diketahui; tidak
    // boleh berupa teks kosong atau lebih dari 100 karakter.
    odpName: text("odp_name"),
    // Salinan dari hasil sinkron billing terbaru (lihat tabel billing_status).
    billingStatus: text("billing_status")
      .$type<BillingStatus>()
      .default("lunas")
      .notNull(),
    // Rx power ONU dalam dBm, diambil dari OLT.
    opticalPower: numeric("optical_power", {
      precision: 6,
      scale: 2,
      mode: "number",
    }),
    isOnline: boolean("is_online").default(false).notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("customers_router_idx").on(table.routerId),
    check(
      "customers_billing_status_check",
      sql`${table.billingStatus} in ('lunas', 'isolir')`,
    ),
    check(
      "customers_latitude_check",
      sql`${table.latitude} between -90 and 90`,
    ),
    check(
      "customers_longitude_check",
      sql`${table.longitude} between -180 and 180`,
    ),
    check(
      "customers_odp_name_check",
      sql`${table.odpName} is null or char_length(btrim(${table.odpName})) between 1 and 100`,
    ),
  ],
);
