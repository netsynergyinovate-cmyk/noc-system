// Membuat dua akun siap pakai: npm run seed:accounts -- [pilihan]
// Satu admin (boleh mengubah data) dan satu hanya-lihat. Bantuan lengkap:
// npm run seed:accounts -- --help. Logikanya ada di seed-accounts-lib.mjs.
//
// Kata sandi tidak pernah ditulis ke berkas atau log. Kata sandi yang dibuat
// acak oleh run ini dicetak SEKALI di akhir; hash tidak pernah dicetak.
import { Pool } from "pg";
import { loadEnvironment } from "./lib.mjs";
import { databaseUrl, databaseError } from "./postgres.mjs";
import {
  SeedError,
  USAGE,
  buildAccountSpecs,
  formatSummary,
  parseArgs,
  seedAccounts,
} from "./seed-accounts-lib.mjs";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

let pool;
try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
  } else {
    await loadEnvironment();
    // Semua pemeriksaan masukan (termasuk larangan produksi) selesai sebelum
    // menyentuh database.
    const accounts = buildAccountSpecs({ args });
    pool = new Pool({
      connectionString: databaseUrl(),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", () => {});
    const results = await seedAccounts({ pool, accounts });
    for (const line of formatSummary(results)) console.log(line);
  }
} catch (error) {
  // Akun yang sudah tersimpan sebelum galat tetap dilaporkan, supaya kata
  // sandi acaknya tidak hilang begitu saja.
  if (error?.completed?.length > 0) {
    for (const line of formatSummary(error.completed)) console.log(line);
    console.log("");
  }
  if (error instanceof SeedError || error instanceof RangeError) {
    fail(
      error instanceof SeedError && error.code === "USAGE"
        ? `${error.message}\n\n${USAGE}`
        : error.message,
    );
  } else {
    fail(databaseError(error));
  }
} finally {
  await pool?.end();
}
