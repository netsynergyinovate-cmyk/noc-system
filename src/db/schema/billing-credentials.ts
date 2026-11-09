import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type BillingSessionStatus =
  "active" | "expired" | "not_logged_in" | "locked";
export type BillingCsrfStatus = "acquired" | "missing" | "not_required";

// Kredensial + sesi login scraper billing. Kata sandi dan cookie disimpan
// terenkripsi AES-256-GCM ("iv:tag:ciphertext"); jangan simpan nilai asli.
export const billingCredentials = pgTable("billing_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url").notNull(),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  cookiesEnc: text("cookies_enc"),
  csrfToken: text("csrf_token"),
  status: text("status")
    .$type<BillingSessionStatus>()
    .default("not_logged_in")
    .notNull(),
  csrfStatus: text("csrf_status")
    .$type<BillingCsrfStatus>()
    .default("not_required")
    .notNull(),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  backoffUntil: timestamp("backoff_until", { withTimezone: true }),
  cookieCount: integer("cookie_count").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
