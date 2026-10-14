import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { root } from "../scripts/lib.mjs";

// Skema sinkron billing (migrasi 0006): log sinkron `billing_sync_runs`, tagihan
// yang tidak cocok `billing_mismatches`, dan kolom tambahan `billing_status`.
// Tiap tes membuat database sendiri di server uji sekali pakai, lalu
// menerapkan migrasi dari awal, sehingga tidak bergantung pada tes lain yang
// memakai database yang sama (Go dan database.test.mjs).

const MIGRATION = "0006_billing_sync";
const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";
const TABLES = ["billing_sync_runs", "billing_mismatches", "billing_status"];

const serverUrl = () => {
  const url = process.env.STARTER_TEST_DATABASE_URL;
  assert.ok(
    url && process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-"),
    "Run npm test to create an isolated database.",
  );
  return url;
};

const migrationsFolder = resolve(root, "drizzle");
const readJson = (...parts) =>
  JSON.parse(readFileSync(resolve(root, ...parts), "utf8"));

async function applyMigrations(db, folder = migrationsFolder) {
  await migrate(drizzle(db), { migrationsFolder: folder });
}

// Database kosong yang baru dibuat; dibuang lagi sesudah tes.
async function withDatabase(body, { migrated = true } = {}) {
  const admin = new Pool({ connectionString: serverUrl(), max: 1 });
  const name = `billing_schema_${randomBytes(6).toString("hex")}`;
  let db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(serverUrl());
    url.pathname = `/${name}`;
    db = new Pool({
      connectionString: url.toString(),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    if (migrated) await applyMigrations(db);
    await body(db, url.toString());
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

// Folder migrasi yang berhenti sebelum `tag`: keadaan database sebelum migrasi
// itu ada.
function migrationsBefore(tag) {
  const journal = readJson("drizzle", "meta", "_journal.json");
  const cut = journal.entries.findIndex((entry) => entry.tag === tag);
  assert.ok(cut > 0, `${tag} is not in the journal`);
  const kept = journal.entries.slice(0, cut);
  const dir = mkdtempSync(join(tmpdir(), "billing-schema-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: kept }),
  );
  for (const entry of kept) {
    cpSync(
      resolve(migrationsFolder, `${entry.tag}.sql`),
      join(dir, `${entry.tag}.sql`),
    );
  }
  return dir;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const count = async (db, table, where = "true", params = []) =>
  (
    await one(
      db,
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
      params,
    )
  ).n;

async function insert(db, table, row) {
  const columns = Object.keys(row);
  const text = columns.length
    ? `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`
    : `INSERT INTO ${table} DEFAULT VALUES RETURNING *`;
  return one(
    db,
    text,
    columns.map((c) => row[c]),
  );
}

// Ditolak dengan kode galat dan, bila disebut, oleh constraint atau indeks
// bernama itu. Menyebut namanya memastikan baris uji melanggar aturan yang
// dimaksud saja.
const rejected = (promise, code, constraint) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (constraint) assert.equal(error.constraint, constraint, error.message);
    return true;
  });
const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const NOT_NULL = "23502";

const T0 = Date.parse("2026-10-09T08:05:00Z");
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

// --- Pabrik baris ----------------------------------------------------------

const SUMMED = [
  "matched_exact",
  "matched_normalized",
  "unmatched_unknown",
  "unmatched_duplicate",
  "unmatched_ambiguous",
];
const COUNTS = [
  "invoices_total",
  ...SUMMED,
  "customers_without_invoice",
  "statuses_changed",
];
const baseCounts = {
  matched_exact: 90,
  matched_normalized: 4,
  unmatched_unknown: 6,
  unmatched_duplicate: 3,
  unmatched_ambiguous: 1,
  customers_without_invoice: 6,
  statuses_changed: 5,
};

// Sinkron berhasil yang sah; `invoices_total` dihitung dari bagiannya kecuali
// disebut.
function successRun(overrides = {}) {
  const counts = { ...baseCounts, ...overrides };
  const total = SUMMED.reduce((sum, key) => sum + counts[key], 0);
  return {
    started_at: at(0),
    finished_at: at(10),
    status: "success",
    invoices_total: total,
    ...counts,
    ...overrides,
  };
}
const failedRun = (overrides = {}) => ({
  started_at: at(0),
  finished_at: at(10),
  status: "failed",
  error_message: "Token CSRF tidak ditemukan di halaman login billing.",
  ...overrides,
});
const runningRun = (overrides = {}) => ({
  started_at: at(0),
  status: "running",
  ...overrides,
});

async function addRouter(db, host = "10.9.0.1") {
  return one(
    db,
    "INSERT INTO routers (name, host, username, password_enc) VALUES ('R', $1, 'api', 'enc') RETURNING id",
    [host],
  );
}
async function addCustomer(db, routerId, pppoe, billing = "lunas") {
  return one(
    db,
    "INSERT INTO customers (name, pppoe_username, router_id, billing_status) VALUES ($1, $2, $3, $4) RETURNING id",
    [`Pelanggan ${pppoe}`, pppoe, routerId, billing],
  );
}

// --- Jurnal dan snapshot ---------------------------------------------------

test("the journal lists the billing sync migration and the snapshots form one chain", () => {
  const journal = readJson("drizzle", "meta", "_journal.json");
  const entries = journal.entries;
  entries.forEach((entry, index) => {
    assert.equal(entry.idx, index, "journal indexes are consecutive");
    assert.equal(
      entry.tag.slice(0, 4),
      String(index).padStart(4, "0"),
      `${entry.tag} carries its own index`,
    );
    assert.ok(
      existsSync(resolve(migrationsFolder, `${entry.tag}.sql`)),
      `${entry.tag}.sql exists`,
    );
    assert.ok(
      existsSync(
        resolve(
          migrationsFolder,
          "meta",
          `${entry.tag.slice(0, 4)}_snapshot.json`,
        ),
      ),
      `${entry.tag} has a snapshot`,
    );
    if (index > 0) {
      assert.ok(
        entry.when > entries[index - 1].when,
        `${entry.tag} is newer than the migration before it`,
      );
    }
  });
  const entry = entries.find((e) => e.tag === MIGRATION);
  assert.ok(entry, `${MIGRATION} is in the journal`);
  assert.equal(entry.idx, 6);
  assert.equal(entry.breakpoints, true);

  // Tiap snapshot menunjuk snapshot sebelumnya, tanpa cabang.
  const snapshots = entries.map((e) =>
    readJson("drizzle", "meta", `${e.tag.slice(0, 4)}_snapshot.json`),
  );
  snapshots.forEach((snapshot, index) => {
    if (index > 0) assert.equal(snapshot.prevId, snapshots[index - 1].id);
  });
  assert.equal(new Set(snapshots.map((s) => s.id)).size, snapshots.length);

  // Snapshot migrasi ini memuat ketiga tabel.
  const snapshot = snapshots[entry.idx];
  for (const table of TABLES) {
    assert.ok(snapshot.tables[`public.${table}`], `${table} in the snapshot`);
  }
});

test("drizzle-kit check finds no conflicting migrations", () => {
  const bin = resolve(root, "node_modules/drizzle-kit/bin.cjs");
  assert.ok(existsSync(bin), "drizzle-kit is installed");
  const result = spawnSync(process.execPath, [bin, "check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Everything's fine/);
});

// --- Struktur --------------------------------------------------------------

test("migrating an empty database builds exactly what the latest snapshot describes", async () => {
  const journal = readJson("drizzle", "meta", "_journal.json").entries;
  const latest = journal[journal.length - 1];
  const snapshot = readJson(
    "drizzle",
    "meta",
    `${latest.tag.slice(0, 4)}_snapshot.json`,
  );
  await withDatabase(async (db) => {
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
        )
      ).n,
      journal.length,
      "every journal entry was applied once",
    );
    for (const table of TABLES) {
      const expected = snapshot.tables[`public.${table}`];

      const columns = (
        await db.query(
          `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped`,
          [table],
        )
      ).rows;
      assert.deepEqual(
        columns.sort(byName),
        Object.values(expected.columns)
          .map((c) => ({ name: c.name, type: c.type, not_null: c.notNull }))
          .sort(byName),
        `${table} columns`,
      );

      const constraintNames = async (kind) =>
        (
          await db.query(
            `SELECT c.conname FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'public' AND t.relname = $1 AND c.contype = $2`,
            [table, kind],
          )
        ).rows
          .map((r) => r.conname)
          .sort();
      assert.deepEqual(
        await constraintNames("c"),
        Object.keys(expected.checkConstraints).sort(),
        `${table} check constraints`,
      );
      assert.deepEqual(
        await constraintNames("f"),
        Object.keys(expected.foreignKeys).sort(),
        `${table} foreign keys`,
      );
      assert.deepEqual(
        await constraintNames("u"),
        Object.keys(expected.uniqueConstraints).sort(),
        `${table} unique constraints`,
      );

      const indexes = (
        await db.query(
          `SELECT i.indexname FROM pg_indexes i
           WHERE i.schemaname = 'public' AND i.tablename = $1
             AND NOT EXISTS (
               SELECT 1 FROM pg_constraint c
               WHERE c.conname = i.indexname AND c.contype IN ('p', 'u')
             )`,
          [table],
        )
      ).rows
        .map((r) => r.indexname)
        .sort();
      assert.deepEqual(
        indexes,
        Object.keys(expected.indexes).sort(),
        `${table} indexes`,
      );
    }
  });
});

test("the sync log, mismatch list, and billing_status have the columns, defaults, keys, and indexes the contract needs", async () => {
  await withDatabase(async (db) => {
    const defaults = Object.fromEntries(
      (
        await db.query(
          `SELECT table_name || '.' || column_name AS key, column_default, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = ANY($1)`,
          [TABLES],
        )
      ).rows.map((r) => [r.key, r]),
    );
    const column = (key) => {
      assert.ok(defaults[key], `${key} exists`);
      return defaults[key];
    };

    // Log sinkron: kosong secara bawaan hanya untuk yang boleh kosong.
    assert.match(
      column("billing_sync_runs.id").column_default,
      /gen_random_uuid/,
    );
    assert.match(
      column("billing_sync_runs.started_at").column_default,
      /now\(\)/,
    );
    assert.match(
      column("billing_sync_runs.created_at").column_default,
      /now\(\)/,
    );
    assert.match(
      column("billing_sync_runs.trigger").column_default,
      /'schedule'/,
    );
    assert.equal(column("billing_sync_runs.status").column_default, null);
    assert.equal(column("billing_sync_runs.status").is_nullable, "NO");
    for (const name of ["finished_at", "error_message", ...COUNTS]) {
      assert.equal(
        column(`billing_sync_runs.${name}`).is_nullable,
        "YES",
        `billing_sync_runs.${name} is empty until the run ends`,
      );
    }

    // Ketidakcocokan: kandidat kosong secara bawaan, kode tagihan boleh kosong.
    assert.match(
      column("billing_mismatches.customer_ids").column_default,
      /'\{\}'::uuid\[\]/,
    );
    for (const name of [
      "id",
      "run_id",
      "invoice_name",
      "invoice_status",
      "reason",
      "customer_ids",
      "created_at",
    ]) {
      assert.equal(
        column(`billing_mismatches.${name}`).is_nullable,
        "NO",
        name,
      );
    }
    assert.equal(column("billing_mismatches.invoice_ref").is_nullable, "YES");

    // billing_status: kolom baru boleh kosong supaya baris lama tetap sah.
    for (const name of ["match_kind", "billing_name", "run_id"]) {
      assert.equal(column(`billing_status.${name}`).is_nullable, "YES", name);
    }

    // Hapus log: ketidakcocokan ikut hilang, billing_status kehilangan rujukan saja.
    const keys = Object.fromEntries(
      (
        await db.query(
          `SELECT c.conname, c.confdeltype, t.relname AS "from", c.confrelid::regclass::text AS "to"
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
           WHERE c.contype = 'f' AND t.relname = ANY($1)`,
          [TABLES],
        )
      ).rows.map((r) => [r.conname, r]),
    );
    assert.equal(
      keys.billing_mismatches_run_id_billing_sync_runs_id_fk?.confdeltype,
      "c",
      "deleting a run deletes its mismatches",
    );
    assert.equal(
      keys.billing_mismatches_run_id_billing_sync_runs_id_fk?.to,
      "billing_sync_runs",
    );
    assert.equal(
      keys.billing_status_run_id_billing_sync_runs_id_fk?.confdeltype,
      "n",
      "deleting a run only clears billing_status.run_id",
    );
    assert.equal(
      keys.billing_status_run_id_billing_sync_runs_id_fk?.to,
      "billing_sync_runs",
    );
    assert.equal(
      keys.billing_status_customer_id_customers_id_fk?.confdeltype,
      "c",
      "the existing customer rule is untouched",
    );

    const indexDef = async (name) =>
      (
        await one(
          db,
          "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
          [name],
        )
      )?.indexdef;
    const running = await indexDef("billing_sync_runs_running_unique");
    assert.match(running, /^CREATE UNIQUE INDEX/);
    assert.match(running, /\(status\) WHERE \(status = 'running'::text\)$/);
    const finished = await indexDef("billing_sync_runs_finished_idx");
    assert.match(finished, /^CREATE INDEX/);
    assert.match(
      finished,
      /\(finished_at DESC NULLS LAST\) WHERE \(finished_at IS NOT NULL\)$/,
    );
    assert.match(await indexDef("billing_mismatches_run_idx"), /\(run_id\)$/);
    assert.match(await indexDef("billing_status_run_idx"), /\(run_id\)$/);
  });
});

// --- Log sinkron -----------------------------------------------------------

test("a sync run must be complete and consistent for its status", async () => {
  await withDatabase(async (db) => {
    const runs = (row) => insert(db, "billing_sync_runs", row);

    // Sinkron berjalan: waktu mulai dan jenis pemicu terisi sendiri.
    const running = await runs({ status: "running" });
    assert.match(running.id, /^[0-9a-f-]{36}$/);
    assert.ok(running.started_at instanceof Date);
    assert.equal(running.finished_at, null);
    assert.equal(running.trigger, "schedule");
    for (const name of ["error_message", ...COUNTS]) {
      assert.equal(running[name], null, name);
    }
    // Selesai: sinkron berikutnya boleh mulai (indeks unik parsial dilepas).
    await db.query(
      "UPDATE billing_sync_runs SET status = 'failed', finished_at = started_at + interval '9 seconds', error_message = 'Billing tidak menjawab.' WHERE id = $1",
      [running.id],
    );
    await runs(runningRun({ trigger: "manual" }));
    await db.query("DELETE FROM billing_sync_runs");

    // Baris yang sah.
    await runs(successRun());
    await runs(
      successRun({
        matched_exact: 0,
        matched_normalized: 0,
        unmatched_unknown: 0,
        unmatched_duplicate: 0,
        unmatched_ambiguous: 0,
        customers_without_invoice: 0,
        statuses_changed: 0,
      }),
    );
    await runs(failedRun());
    await runs(failedRun({ error_message: "x".repeat(500) }));
    await runs(successRun({ finished_at: at(0) })); // selesai di detik yang sama
    assert.equal(await count(db, "billing_sync_runs"), 5);

    // Status dan pemicu hanya dari daftar.
    for (const status of ["queued", "done", "Success", ""]) {
      await rejected(
        runs({ started_at: at(0), finished_at: at(10), status }),
        CHECK,
        "billing_sync_runs_status_check",
      );
    }
    for (const trigger of ["cron", "", "Schedule"]) {
      await rejected(
        runs(successRun({ trigger })),
        CHECK,
        "billing_sync_runs_trigger_check",
      );
    }
    await rejected(runs({ status: null }), NOT_NULL);
    await rejected(runs(successRun({ trigger: null })), NOT_NULL);

    // `finished_at` kosong jika dan hanya jika masih berjalan.
    await rejected(
      runs(runningRun({ finished_at: at(5) })),
      CHECK,
      "billing_sync_runs_finished_check",
    );
    await rejected(
      runs(successRun({ finished_at: null })),
      CHECK,
      "billing_sync_runs_finished_check",
    );
    await rejected(
      runs(failedRun({ finished_at: null })),
      CHECK,
      "billing_sync_runs_finished_check",
    );
    await rejected(
      db.query(
        "UPDATE billing_sync_runs SET finished_at = NULL WHERE status = 'failed'",
      ),
      CHECK,
      "billing_sync_runs_finished_check",
    );

    // Selesai tidak boleh lebih awal dari mulai.
    await rejected(
      runs(successRun({ started_at: at(10), finished_at: at(9) })),
      CHECK,
      "billing_sync_runs_period_check",
    );
    await rejected(
      runs(failedRun({ started_at: at(10), finished_at: at(0) })),
      CHECK,
      "billing_sync_runs_period_check",
    );

    // Pesan galat terisi tepat bila gagal, tidak kosong, paling panjang 500.
    await rejected(
      runs(failedRun({ error_message: null })),
      CHECK,
      "billing_sync_runs_error_check",
    );
    for (const message of ["", "   ", "\n\t "]) {
      await rejected(
        runs(failedRun({ error_message: message })),
        CHECK,
        "billing_sync_runs_error_check",
      );
    }
    await rejected(
      runs(failedRun({ error_message: "x".repeat(501) })),
      CHECK,
      "billing_sync_runs_error_check",
    );
    await rejected(
      runs(successRun({ error_message: "Seharusnya kosong." })),
      CHECK,
      "billing_sync_runs_error_check",
    );
    await rejected(
      runs(runningRun({ error_message: "Belum ada galat." })),
      CHECK,
      "billing_sync_runs_error_check",
    );
    await rejected(
      runs(successRun({ error_message: "" })),
      CHECK,
      "billing_sync_runs_error_check",
    );

    assert.equal(await count(db, "billing_sync_runs"), 5);
  });
});

test("sync counts are filled only for a successful run, never negative, and add up", async () => {
  await withDatabase(async (db) => {
    const runs = (row) => insert(db, "billing_sync_runs", row);
    const zeros = Object.fromEntries(COUNTS.map((name) => [name, 0]));

    // Hitungan hanya untuk sinkron berhasil, dan harus lengkap.
    await rejected(
      runs(failedRun(zeros)),
      CHECK,
      "billing_sync_runs_counts_check",
    );
    await rejected(
      runs(runningRun(zeros)),
      CHECK,
      "billing_sync_runs_counts_check",
    );
    await rejected(
      runs(failedRun({ invoices_total: 0 })),
      CHECK,
      "billing_sync_runs_counts_check",
    );
    await rejected(
      runs(runningRun({ statuses_changed: 0 })),
      CHECK,
      "billing_sync_runs_counts_check",
    );
    for (const name of COUNTS) {
      await rejected(
        runs(successRun({ [name]: null })),
        CHECK,
        "billing_sync_runs_counts_check",
      );
    }

    // Tidak ada hitungan yang negatif. Bagian yang dijumlahkan menyesuaikan
    // `invoices_total` dan `statuses_changed` agar hanya aturan ini yang
    // dilanggar.
    for (const name of COUNTS) {
      if (name === "invoices_total") continue;
      await rejected(
        runs(
          successRun({
            [name]: -1,
            statuses_changed: name === "statuses_changed" ? -1 : 0,
          }),
        ),
        CHECK,
        "billing_sync_runs_counts_nonnegative_check",
      );
    }

    // Tiap tagihan dihitung sekali: total = cocok + tidak cocok.
    const total = SUMMED.reduce((sum, key) => sum + baseCounts[key], 0);
    for (const wrong of [total + 1, total - 1, 0]) {
      await rejected(
        runs(successRun({ invoices_total: wrong })),
        CHECK,
        "billing_sync_runs_total_check",
      );
    }
    // Hanya pelanggan yang cocok yang bisa berubah statusnya.
    await rejected(
      runs(successRun({ statuses_changed: 95 })),
      CHECK,
      "billing_sync_runs_changed_check",
    );
    await runs(successRun({ statuses_changed: 94 }));

    assert.equal(await count(db, "billing_sync_runs"), 1);
  });
});

test("only one sync can be running, while any number of finished runs may exist", async () => {
  await withDatabase(async (db, url) => {
    const runs = (row) => insert(db, "billing_sync_runs", row);

    // Dua sambungan memulai sinkron pada saat yang sama: tepat satu yang menang.
    const other = new Pool({ connectionString: url, max: 1 });
    try {
      const outcomes = await Promise.allSettled([
        db.query("INSERT INTO billing_sync_runs (status) VALUES ('running')"),
        other.query(
          "INSERT INTO billing_sync_runs (status) VALUES ('running')",
        ),
      ]);
      assert.deepEqual(outcomes.map((o) => o.status).sort(), [
        "fulfilled",
        "rejected",
      ]);
      const loser = outcomes.find((o) => o.status === "rejected");
      assert.equal(loser.reason.code, UNIQUE);
      assert.equal(loser.reason.constraint, "billing_sync_runs_running_unique");
    } finally {
      await other.end();
    }
    const first = await one(
      db,
      "SELECT id FROM billing_sync_runs WHERE status = 'running'",
    );
    await rejected(
      runs(runningRun({ started_at: at(60), trigger: "manual" })),
      UNIQUE,
      "billing_sync_runs_running_unique",
    );
    assert.equal(await count(db, "billing_sync_runs", "status = 'running'"), 1);

    // Banyak sinkron selesai, berhasil maupun gagal, berdampingan dengan yang berjalan.
    for (let i = 0; i < 6; i += 1) {
      await runs(
        successRun({
          started_at: at(-4000 * (i + 1)),
          finished_at: at(-4000 * (i + 1) + 8),
        }),
      );
      await runs(
        failedRun({
          started_at: at(-4000 * (i + 1) - 1800),
          finished_at: at(-4000 * (i + 1) - 1790),
        }),
      );
    }
    assert.equal(
      await count(db, "billing_sync_runs", "status <> 'running'"),
      12,
    );
    assert.equal(await count(db, "billing_sync_runs", "status = 'running'"), 1);

    // Yang berjalan tidak boleh diubah menjadi dua; yang selesai tidak bisa
    // "berjalan" lagi sementara ada yang berjalan.
    const finished = await one(
      db,
      "SELECT id FROM billing_sync_runs WHERE status = 'failed' LIMIT 1",
    );
    await rejected(
      db.query(
        "UPDATE billing_sync_runs SET status = 'running', finished_at = NULL, error_message = NULL WHERE id = $1",
        [finished.id],
      ),
      UNIQUE,
      "billing_sync_runs_running_unique",
    );

    // Setelah yang berjalan selesai, yang berikutnya boleh mulai.
    await db.query(
      `UPDATE billing_sync_runs
       SET status = 'success', finished_at = started_at + interval '12 seconds',
           invoices_total = 10, matched_exact = 9, matched_normalized = 0,
           unmatched_unknown = 1, unmatched_duplicate = 0, unmatched_ambiguous = 0,
           customers_without_invoice = 2, statuses_changed = 1
       WHERE id = $1`,
      [first.id],
    );
    assert.equal(await count(db, "billing_sync_runs", "status = 'running'"), 0);
    await runs(runningRun({ started_at: at(3600) }));
    assert.equal(await count(db, "billing_sync_runs", "status = 'running'"), 1);
  });
});

test("the history query reads the 24 newest finished runs from the partial index", async () => {
  await withDatabase(async (db) => {
    const runs = (row) => insert(db, "billing_sync_runs", row);
    const ids = [];
    for (let i = 0; i < 30; i += 1) {
      const started = at(-3600 * (30 - i));
      const row =
        i % 5 === 0
          ? failedRun({
              started_at: started,
              finished_at: at(-3600 * (30 - i) + 7),
            })
          : successRun({
              started_at: started,
              finished_at: at(-3600 * (30 - i) + 7),
            });
      ids.push((await runs(row)).id);
    }
    const running = await runs(runningRun({ started_at: at(-30) }));

    const history = `SELECT id FROM billing_sync_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC NULLS LAST LIMIT 24`;
    const rows = (await db.query(history)).rows.map((r) => r.id);
    assert.equal(rows.length, 24);
    assert.deepEqual(
      rows,
      ids.slice(-24).reverse(),
      "newest first, running excluded",
    );
    assert.ok(!rows.includes(running.id));

    // Dengan pemindaian berurutan dimatikan, pembacaan ini memakai indeks.
    await db.query("SET enable_seqscan = off");
    const plan = JSON.stringify(
      (await db.query(`EXPLAIN (FORMAT JSON) ${history}`)).rows[0][
        "QUERY PLAN"
      ],
    );
    assert.match(plan, /billing_sync_runs_finished_idx/);
    await db.query("RESET enable_seqscan");
  });
});

// --- Ketidakcocokan --------------------------------------------------------

test("a mismatch needs a run, a known reason, and candidates that fit the reason", async () => {
  await withDatabase(async (db) => {
    const router = await addRouter(db);
    const [a, b, c] = await Promise.all(
      ["budi01", "Budi01", "dewi02"].map((name) =>
        addCustomer(db, router.id, name),
      ),
    );
    const run = await insert(db, "billing_sync_runs", successRun());
    const other = await insert(
      db,
      "billing_sync_runs",
      successRun({ started_at: at(3600), finished_at: at(3610) }),
    );
    const mismatch = (row) =>
      insert(db, "billing_mismatches", {
        run_id: run.id,
        invoice_name: "x",
        invoice_status: "lunas",
        ...row,
      });

    // unknown: tanpa kandidat, kode tagihan dan nama boleh kosong.
    const unknown = await mismatch({
      reason: "unknown",
      invoice_name: "tidak.ada.99",
      invoice_ref: "INV-10090",
    });
    assert.deepEqual(unknown.customer_ids, []);
    assert.ok(unknown.created_at instanceof Date);
    await mismatch({ reason: "unknown", invoice_name: "", invoice_ref: null });
    await mismatch({
      reason: "unknown",
      invoice_ref: "INV-1",
      customer_ids: [],
    });
    // duplicate: tepat satu pelanggan, yang sudah terpasang.
    await mismatch({
      reason: "duplicate",
      invoice_name: "dewi02",
      invoice_ref: "INV-10034-B",
      invoice_status: "isolir",
      customer_ids: [c.id],
    });
    // ambiguous: dua atau lebih kandidat.
    await mismatch({
      reason: "ambiguous",
      invoice_name: "BUDI01 ",
      customer_ids: [a.id, b.id],
    });
    await mismatch({ reason: "ambiguous", customer_ids: [a.id, b.id, c.id] });
    assert.equal(await count(db, "billing_mismatches"), 6);

    // Alasan hanya dari daftar; id kandidat tidak ikut menentukan.
    for (const reason of ["other", "", "Unknown", "UNKNOWN"]) {
      await rejected(
        mismatch({ reason }),
        CHECK,
        "billing_mismatches_reason_check",
      );
    }
    await rejected(mismatch({ reason: null }), NOT_NULL);
    // Status tagihan hanya lunas atau isolir.
    for (const invoice_status of ["tunggakan", "", "Lunas"]) {
      await rejected(
        mismatch({ reason: "unknown", invoice_status }),
        CHECK,
        "billing_mismatches_status_check",
      );
    }
    await rejected(
      mismatch({ reason: "unknown", invoice_status: null }),
      NOT_NULL,
    );

    // Jumlah kandidat menurut alasan.
    await rejected(
      mismatch({ reason: "unknown", customer_ids: [a.id] }),
      CHECK,
      "billing_mismatches_candidates_check",
    );
    await rejected(
      mismatch({ reason: "duplicate" }),
      CHECK,
      "billing_mismatches_candidates_check",
    );
    await rejected(
      mismatch({ reason: "duplicate", customer_ids: [a.id, b.id] }),
      CHECK,
      "billing_mismatches_candidates_check",
    );
    await rejected(
      mismatch({ reason: "ambiguous" }),
      CHECK,
      "billing_mismatches_candidates_check",
    );
    await rejected(
      mismatch({ reason: "ambiguous", customer_ids: [a.id] }),
      CHECK,
      "billing_mismatches_candidates_check",
    );
    // Elemen kosong di daftar kandidat tidak berarti apa-apa.
    await rejected(
      db.query(
        "INSERT INTO billing_mismatches (run_id, invoice_name, invoice_status, reason, customer_ids) VALUES ($1, 'x', 'lunas', 'ambiguous', ARRAY[$2::uuid, NULL])",
        [run.id, a.id],
      ),
      CHECK,
      "billing_mismatches_candidates_null_check",
    );
    await rejected(
      db.query(
        "INSERT INTO billing_mismatches (run_id, invoice_name, invoice_status, reason, customer_ids) VALUES ($1, 'x', 'lunas', 'duplicate', ARRAY[NULL]::uuid[])",
        [run.id],
      ),
      CHECK,
      "billing_mismatches_candidates_null_check",
    );
    await rejected(
      mismatch({ reason: "unknown", customer_ids: null }),
      NOT_NULL,
    );

    // Wajib punya sinkron yang ada.
    await rejected(
      insert(db, "billing_mismatches", {
        invoice_name: "x",
        invoice_status: "lunas",
        reason: "unknown",
      }),
      NOT_NULL,
    );
    await rejected(
      mismatch({ run_id: NO_SUCH_ID, reason: "unknown" }),
      FOREIGN_KEY,
    );
    await rejected(
      mismatch({ invoice_name: null, reason: "unknown" }),
      NOT_NULL,
    );

    // Kandidat dipotret saat sinkron; pelanggan yang dihapus sesudahnya tidak
    // mengubah catatan itu (array tidak punya foreign key).
    await db.query("DELETE FROM customers WHERE id = $1", [c.id]);
    const kept = await one(
      db,
      "SELECT customer_ids FROM billing_mismatches WHERE invoice_ref = 'INV-10034-B'",
    );
    assert.deepEqual(kept.customer_ids, [c.id]);

    // Menghapus sinkron menghapus ketidakcocokannya saja.
    await mismatch({
      run_id: other.id,
      reason: "unknown",
      invoice_ref: "INV-OTHER",
    });
    assert.equal(
      await count(db, "billing_mismatches", "run_id = $1", [run.id]),
      6,
    );
    await db.query("DELETE FROM billing_sync_runs WHERE id = $1", [run.id]);
    assert.equal(
      await count(db, "billing_mismatches", "run_id = $1", [run.id]),
      0,
    );
    assert.equal(
      await count(db, "billing_mismatches", "run_id = $1", [other.id]),
      1,
    );
    await db.query("DELETE FROM billing_sync_runs WHERE id = $1", [other.id]);
    assert.equal(await count(db, "billing_mismatches"), 0);
  });
});

// --- billing_status --------------------------------------------------------

test("billing_status records how a customer was matched and which run wrote it", async () => {
  await withDatabase(async (db) => {
    const router = await addRouter(db);
    const [a, b, c, d] = await Promise.all(
      ["budi01", "dewi02", "agus03", "sari04"].map((name) =>
        addCustomer(db, router.id, name),
      ),
    );
    const run = await insert(db, "billing_sync_runs", successRun());
    const status = (row) =>
      insert(db, "billing_status", { status: "lunas", ...row });

    // Bentuk lama (tanpa kolom baru) masih sah dan memberi kolom baru kosong.
    const legacy = await status({
      customer_id: a.id,
      status: "isolir",
      invoice_ref: "INV-1",
    });
    assert.equal(legacy.match_kind, null);
    assert.equal(legacy.billing_name, null);
    assert.equal(legacy.run_id, null);

    // Cocok persis dan cocok setelah dirapikan (nama billing beda dari nama pelanggan).
    const exact = await status({
      customer_id: b.id,
      invoice_ref: "INV-2",
      match_kind: "exact",
      billing_name: "dewi02",
      run_id: run.id,
    });
    assert.equal(exact.match_kind, "exact");
    const normalized = await status({
      customer_id: c.id,
      invoice_ref: "INV-3",
      match_kind: "normalized",
      billing_name: "  AGUS03 ",
      run_id: run.id,
    });
    assert.equal(normalized.billing_name, "  AGUS03 ");
    assert.equal(await count(db, "billing_status", "run_id = $1", [run.id]), 2);

    // Satu baris per pelanggan tetap berlaku.
    await rejected(
      status({
        customer_id: b.id,
        match_kind: "exact",
        billing_name: "dewi02",
      }),
      UNIQUE,
    );
    // Cara menimpa tiap jam: upsert per pelanggan, satu baris tetap satu.
    const next = await insert(
      db,
      "billing_sync_runs",
      successRun({ started_at: at(3600), finished_at: at(3609) }),
    );
    await db.query(
      `INSERT INTO billing_status (customer_id, status, invoice_ref, match_kind, billing_name, run_id, synced_at)
       VALUES ($1, 'isolir', 'INV-2B', 'normalized', 'DEWI02', $2, now())
       ON CONFLICT (customer_id) DO UPDATE SET status = EXCLUDED.status,
         invoice_ref = EXCLUDED.invoice_ref, match_kind = EXCLUDED.match_kind,
         billing_name = EXCLUDED.billing_name, run_id = EXCLUDED.run_id, synced_at = EXCLUDED.synced_at`,
      [b.id, next.id],
    );
    const upserted = await one(
      db,
      "SELECT * FROM billing_status WHERE customer_id = $1",
      [b.id],
    );
    assert.equal(upserted.match_kind, "normalized");
    assert.equal(upserted.billing_name, "DEWI02");
    assert.equal(upserted.run_id, next.id);
    assert.equal(
      await count(db, "billing_status", "customer_id = $1", [b.id]),
      1,
    );

    // Cara pencocokan hanya exact atau normalized (pelanggan "none" tidak punya nilai).
    for (const match_kind of ["fuzzy", "none", "Exact", ""]) {
      await rejected(
        status({ customer_id: d.id, match_kind, billing_name: "sari04" }),
        CHECK,
        "billing_status_match_kind_check",
      );
    }
    // Cara pencocokan dan nama billing terisi bersama, nama tidak kosong.
    await rejected(
      status({ customer_id: d.id, match_kind: "exact" }),
      CHECK,
      "billing_status_billing_name_check",
    );
    await rejected(
      status({ customer_id: d.id, billing_name: "sari04" }),
      CHECK,
      "billing_status_billing_name_check",
    );
    await rejected(
      status({ customer_id: d.id, match_kind: "normalized", billing_name: "" }),
      CHECK,
      "billing_status_billing_name_check",
    );
    await rejected(
      db.query(
        "UPDATE billing_status SET match_kind = NULL WHERE customer_id = $1",
        [c.id],
      ),
      CHECK,
      "billing_status_billing_name_check",
    );
    // Status tagihan tetap hanya lunas atau isolir.
    await rejected(
      status({ customer_id: d.id, status: "tunggakan" }),
      CHECK,
      "billing_status_status_check",
    );
    // Rujukan sinkron harus ada.
    await rejected(
      status({
        customer_id: d.id,
        match_kind: "exact",
        billing_name: "sari04",
        run_id: NO_SUCH_ID,
      }),
      FOREIGN_KEY,
    );

    // Menghapus log sinkron mengosongkan rujukan; status pelanggan tidak hilang.
    const before = await one(
      db,
      "SELECT status, invoice_ref, match_kind, billing_name FROM billing_status WHERE customer_id = $1",
      [c.id],
    );
    await db.query("DELETE FROM billing_sync_runs WHERE id = $1", [run.id]);
    assert.equal(await count(db, "billing_status"), 3);
    assert.equal(await count(db, "billing_status", "run_id = $1", [run.id]), 0);
    assert.deepEqual(
      await one(
        db,
        "SELECT status, invoice_ref, match_kind, billing_name FROM billing_status WHERE customer_id = $1",
        [c.id],
      ),
      before,
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT run_id FROM billing_status WHERE customer_id = $1",
          [c.id],
        )
      ).run_id,
      null,
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT run_id FROM billing_status WHERE customer_id = $1",
          [b.id],
        )
      ).run_id,
      next.id,
    );

    // Menghapus pelanggan masih menghapus barisnya.
    await db.query("DELETE FROM customers WHERE id = $1", [b.id]);
    assert.equal(
      await count(db, "billing_status", "customer_id = $1", [b.id]),
      0,
    );
  });
});

// --- Database yang sudah berisi --------------------------------------------

test("migration 0006 keeps existing customers and billing_status rows intact", async () => {
  const before = migrationsBefore(MIGRATION);
  try {
    await withDatabase(
      async (db) => {
        await applyMigrations(db, before);
        assert.equal(
          (await one(db, "SELECT to_regclass('public.billing_sync_runs') AS t"))
            .t,
          null,
          "the sync log does not exist before the migration",
        );

        const router = await addRouter(db, "10.9.9.1");
        const budi = await addCustomer(db, router.id, "budi.santoso001");
        const dewi = await addCustomer(
          db,
          router.id,
          "dewi.lestari002",
          "isolir",
        );
        const agus = await addCustomer(db, router.id, "agus.firmansyah003");
        await db.query(
          "INSERT INTO billing_status (customer_id, status, invoice_ref, synced_at) VALUES ($1, 'lunas', 'INV-10001', '2026-10-08T07:05:09Z'), ($2, 'isolir', NULL, '2026-10-08T07:05:09Z')",
          [budi.id, dewi.id],
        );
        const customersBefore = (
          await db.query("SELECT * FROM customers ORDER BY pppoe_username")
        ).rows;
        const billingBefore = (
          await db.query("SELECT * FROM billing_status ORDER BY customer_id")
        ).rows;
        assert.equal(billingBefore.length, 2);

        await applyMigrations(db);

        assert.deepEqual(
          (await db.query("SELECT * FROM customers ORDER BY pppoe_username"))
            .rows,
          customersBefore,
        );
        const billingAfter = (
          await db.query("SELECT * FROM billing_status ORDER BY customer_id")
        ).rows;
        assert.deepEqual(
          billingAfter.map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(
                ([name]) =>
                  !["match_kind", "billing_name", "run_id"].includes(name),
              ),
            ),
          ),
          billingBefore,
          "the old columns are unchanged",
        );
        for (const row of billingAfter) {
          assert.equal(row.match_kind, null);
          assert.equal(row.billing_name, null);
          assert.equal(row.run_id, null);
        }
        assert.equal(await count(db, "billing_sync_runs"), 0);
        assert.equal(await count(db, "billing_mismatches"), 0);
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
            )
          ).n,
          readJson("drizzle", "meta", "_journal.json").entries.length,
        );

        // Sinkron pertama sesudah migrasi: menimpa baris lama dan menambah yang baru.
        const run = await insert(db, "billing_sync_runs", runningRun());
        await db.query(
          `INSERT INTO billing_status (customer_id, status, invoice_ref, match_kind, billing_name, run_id)
           VALUES ($1, 'lunas', 'INV-10001', 'exact', 'budi.santoso001', $4),
                  ($2, 'lunas', 'INV-10002', 'normalized', 'Dewi.Lestari002 ', $4),
                  ($3, 'isolir', 'INV-10003', 'exact', 'agus.firmansyah003', $4)
           ON CONFLICT (customer_id) DO UPDATE SET status = EXCLUDED.status,
             invoice_ref = EXCLUDED.invoice_ref, match_kind = EXCLUDED.match_kind,
             billing_name = EXCLUDED.billing_name, run_id = EXCLUDED.run_id`,
          [budi.id, dewi.id, agus.id, run.id],
        );
        assert.equal(await count(db, "billing_status"), 3);
        assert.equal(
          await count(db, "billing_status", "run_id = $1", [run.id]),
          3,
        );
        await db.query(
          `UPDATE billing_sync_runs SET status = 'success', finished_at = now() + interval '1 second',
             invoices_total = 3, matched_exact = 2, matched_normalized = 1, unmatched_unknown = 0,
             unmatched_duplicate = 0, unmatched_ambiguous = 0, customers_without_invoice = 0,
             statuses_changed = 2
           WHERE id = $1`,
          [run.id],
        );
      },
      { migrated: false },
    );
  } finally {
    rmSync(before, { recursive: true, force: true });
  }
});
