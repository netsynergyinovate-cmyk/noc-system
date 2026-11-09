import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Pengaturan "Pasang GenieACS lewat web ONT": satu baris saja (id = 'default').
// Dibaca backend Go setiap permintaan, jadi mengubahnya tidak butuh restart.
// Kata sandi disimpan terenkripsi AES-256-GCM dengan DEVICE_SECRET
// ("iv:tag:ciphertext", format yang sama dengan olts.password_enc); jangan simpan
// nilai asli dan jangan kembalikan nilai terenkripsinya ke klien.
export const ontWebSettings = pgTable(
  "ont_web_settings",
  {
    id: text("id").primaryKey().default("default"),
    // Alamat CWMP GenieACS yang dapat dijangkau MODEM, mis. http://172.16.0.1:7547.
    acsUrl: text("acs_url").notNull(),
    acsUsername: text("acs_username"),
    acsPasswordEnc: text("acs_password_enc"),
    informInterval: integer("inform_interval").default(300).notNull(),
    // Admin web modem bawaan untuk semua modem sejenis (boleh kosong).
    webUsername: text("web_username"),
    webPasswordEnc: text("web_password_enc"),
    // Admin web ZIMLINK ZL-2113X (dilaporkan OLT sebagai "HWTC H113"): akun berbeda dari FD511GW.
    zimlinkUsername: text("zimlink_username"),
    zimlinkPasswordEnc: text("zimlink_password_enc"),
    // Admin web GGCLink GM220-S XPON (dilaporkan OLT sebagai "ZICG GM22"): akun tersendiri.
    ggclinkUsername: text("ggclink_username"),
    ggclinkPasswordEnc: text("ggclink_password_enc"),
    // Admin web ZTE F609 versi MediaTek (dilaporkan OLT sebagai "MTKc F609"): akun tersendiri.
    f609Username: text("f609_username"),
    f609PasswordEnc: text("f609_password_enc"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("ont_web_settings_singleton", sql`${table.id} = 'default'`),
    check(
      "ont_web_settings_interval",
      sql`${table.informInterval} between 30 and 86400`,
    ),
  ],
);
