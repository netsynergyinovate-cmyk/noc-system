import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./user";

export const apiKeyAccesses = ["read", "read-write"] as const;
export type ApiKeyAccess = (typeof apiKeyAccesses)[number];

// Kunci API untuk aplikasi luar yang menarik/mengubah data NOC. Kunci asli
// hanya ditampilkan sekali saat dibuat; di sini cuma hash SHA-256-nya. Permintaan
// berkunci bertindak atas nama `user_id` (pembuatnya), jadi peran pembuat tetap
// membatasi apa yang boleh diubah; `read` menolak semua metode selain GET.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    // Awal kunci (mis. "noc_AbCd1234") supaya bisa dikenali di daftar; bukan rahasia.
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    access: text("access").$type<ApiKeyAccess>().default("read").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("api_keys_user_idx").on(table.userId),
    check(
      "api_keys_access_check",
      sql`${table.access} in ('read', 'read-write')`,
    ),
    check(
      "api_keys_name_check",
      sql`char_length(btrim(${table.name})) between 1 and 80`,
    ),
  ],
);
