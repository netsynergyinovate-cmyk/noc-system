// Membuat (atau menaikkan ke) akun superadmin di database: dipanggil `noc-system admin create`
// dan oleh `noc-system install`.
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { databaseUrl, databaseError } from "./postgres.mjs";

const DEFAULT_ADMIN_EMAIL = "admin@noc.local";
const DEFAULT_ADMIN_NAME = "Admin NOC";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(length = 24) {
  const bytes = randomBytes(length);
  let pass = "";
  for (let i = 0; i < length; i++) pass += ALPHABET[bytes[i] % ALPHABET.length];
  return pass;
}

const filled = (v) =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

let pool;
try {
  pool = new Pool({
    connectionString: databaseUrl(),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => {});
  const email = (filled(process.env.NOC_ADMIN_EMAIL) ?? DEFAULT_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
  const name = filled(process.env.NOC_ADMIN_NAME) ?? DEFAULT_ADMIN_NAME;
  const supplied = filled(process.env.NOC_ADMIN_PASSWORD);
  const password = supplied ?? generatePassword();
  const resetPassword = process.argv.includes("--reset-password");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const now = new Date();
    const { rows } = await client.query(
      'SELECT id, role FROM "user" WHERE lower(email) = $1 FOR UPDATE',
      [email],
    );
    if (rows.length === 0) {
      const id = randomUUID();
      const hash = await hashPassword(password);
      await client.query(
        `INSERT INTO "user" (id, name, email, email_verified, role, banned, created_at, updated_at)
         VALUES ($1, $2, $3, true, 'superadmin', false, $4, $4)`,
        [id, name, email, now],
      );
      await client.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
        [randomUUID(), id, hash, now],
      );
      await client.query("COMMIT");
      console.log(`Akun superadmin berhasil dibuat: ${email}`);
      if (!supplied) console.log(`Kata sandi: ${password}`);
    } else {
      const existing = rows[0];
      await client.query(
        'UPDATE "user" SET role = $1, updated_at = $2 WHERE id = $3',
        ["superadmin", now, existing.id],
      );
      if (resetPassword || supplied) {
        const hash = await hashPassword(password);
        await client.query(
          `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
           VALUES ($1, $2, 'credential', $2, $3, $4, $4)
           ON CONFLICT (account_id, provider_id) DO UPDATE SET password = $3, updated_at = $4`,
          [randomUUID(), existing.id, hash, now],
        );
        await client.query("DELETE FROM session WHERE user_id = $1", [
          existing.id,
        ]);
        console.log(`Akun superadmin diperbarui & password direset: ${email}`);
        if (!supplied) console.log(`Kata sandi baru: ${password}`);
      } else {
        console.log(`Akun ${email} sudah ada, peran dinaikkan ke superadmin.`);
      }
      await client.query("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
} catch (error) {
  process.exitCode = 1;
  console.error(databaseError(error));
} finally {
  await pool?.end();
}
