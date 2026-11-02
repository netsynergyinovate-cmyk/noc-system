// Membuat (atau menaikkan ke) akun superadmin di database: dipanggil `noc-system admin create`
// dan oleh `noc-system install`. Memakai logika seed-accounts-lib (hash Better Auth, peran,
// kata sandi acak yang dicetak SEKALI). Kata sandi pilihan lewat env NOC_ADMIN_PASSWORD,
// bukan argumen, supaya tidak terlihat di daftar proses.
import { Pool } from "pg";
import { databaseUrl, databaseError } from "./postgres.mjs";
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  SeedError,
  formatSummary,
  seedAccounts,
} from "./seed-accounts-lib.mjs";

const filled = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

let pool;
try {
  pool = new Pool({ connectionString: databaseUrl(), max: 1, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {});
  const results = await seedAccounts({
    pool,
    // Email bawaan @noc.local ditolak hanya di NODE_ENV=production; CLI ini sengaja
    // memperbolehkannya karena pemasang belum tentu punya email, tetapi sarankan email asli.
    production: false,
    accounts: [
      {
        kind: "admin",
        role: "superadmin",
        email: filled(process.env.NOC_ADMIN_EMAIL) ?? DEFAULT_ADMIN_EMAIL,
        name: filled(process.env.NOC_ADMIN_NAME) ?? DEFAULT_ADMIN_NAME,
        password: filled(process.env.NOC_ADMIN_PASSWORD),
        resetPassword: process.argv.includes("--reset-password"),
      },
    ],
  });
  for (const line of formatSummary(results)) console.log(line);
} catch (error) {
  process.exitCode = 1;
  console.error(
    error instanceof SeedError || error instanceof RangeError ? error.message : databaseError(error),
  );
} finally {
  await pool?.end();
}
