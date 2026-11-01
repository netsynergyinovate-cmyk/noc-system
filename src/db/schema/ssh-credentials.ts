import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { deployTargets } from "./deploy-targets";

export const sshCredentials = pgTable("ssh_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  targetId: uuid("target_id")
    .notNull()
    .references(() => deployTargets.id, { onDelete: "cascade" }),
  // Kunci privat atau kata sandi tersimpan terenkripsi AES-256-GCM
  privateKeyEnc: text("private_key_enc"),
  passphraseEnc: text("passphrase_enc"),
  passwordEnc: text("password_enc"),
  // Fingerprint publik (SHA256:...) atau penanda tipe kredensial
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

export type SshCredential = typeof sshCredentials.$inferSelect;
export type NewSshCredential = typeof sshCredentials.$inferInsert;
