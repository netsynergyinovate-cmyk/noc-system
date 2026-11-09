import {
  check,
  doublePrecision,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const deviceStatuses = ["aktif", "nonaktif"] as const;
export type DeviceStatus = (typeof deviceStatuses)[number];

// Protokol koneksi router. "rest" = layanan www/www-ssl (80/443); "api" = API
// biner RouterOS (8728/8729) dengan soket TCP yang dipertahankan backend Go.
export const routerProtocols = ["rest", "api"] as const;
export type RouterProtocol = (typeof routerProtocols)[number];

// Router MikroTik yang dipantau. Login dashboard memakai tabel `user` milik
// Better Auth, bukan tabel terpisah.
export const routers = pgTable(
  "routers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    // Alamat tanpa skema, mis. "10.10.0.1" atau "10.10.0.1:8728". Unik.
    host: text("host").notNull().unique(),
    username: text("username").notNull(),
    // Hasil enkripsi AES-256-GCM (kunci dari environment). Jangan simpan
    // kata sandi asli di kolom ini.
    passwordEnc: text("password_enc").notNull(),
    // "rest" (bawaan, data lama) atau "api" (API biner). Backend Go memilih
    // transport berdasarkan kolom ini.
    protocol: text("protocol")
      .$type<RouterProtocol>()
      .default("rest")
      .notNull(),
    status: text("status").$type<DeviceStatus>().default("aktif").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "routers_status_check",
      sql`${table.status} in ('aktif', 'nonaktif')`,
    ),
    check("routers_protocol_check", sql`${table.protocol} in ('rest', 'api')`),
  ],
);
