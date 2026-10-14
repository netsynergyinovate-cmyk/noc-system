import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { DeviceStatus } from "./routers";

// OLT, sumber utama data sinyal fiber optik. `brand` dan `driver` sengaja
// berupa teks bebas: merek baru ditambahkan sebagai driver di backend tanpa
// mengubah skema.
export const olts = pgTable(
  "olts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    host: text("host").notNull().unique(),
    // Contoh: "hsgq".
    brand: text("brand").notNull(),
    // Nama driver di backend yang dipakai untuk OLT ini.
    driver: text("driver").notNull(),
    username: text("username").notNull(),
    // Hasil enkripsi AES-256-GCM, seperti routers.password_enc.
    passwordEnc: text("password_enc").notNull(),
    status: text("status").$type<DeviceStatus>().default("aktif").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("olts_status_check", sql`${table.status} in ('aktif', 'nonaktif')`),
  ],
);
