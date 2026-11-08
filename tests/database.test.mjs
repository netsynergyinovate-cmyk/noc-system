import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { root } from "../scripts/lib.mjs";

test("PostgreSQL migrations preserve rows on rerun and enforce auth constraints", async () => {
  const url = process.env.STARTER_TEST_DATABASE_URL;
  assert.ok(
    url && process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-"),
    "Run npm test to create an isolated database.",
  );
  const db = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
      "one",
      "One",
      "one@example.com",
    ]);
    await db.query(
      "INSERT INTO session (id, token, expires_at, user_id) VALUES ($1, $2, $3, $4)",
      ["session-one", "token-one", new Date(Date.now() + 60000), "one"],
    );
    await db.query("INSERT INTO notes (title, user_id) VALUES ($1, $2)", [
      "Migration persistence",
      "one",
    ]);
    const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM "user"')).rows[0]
        .count,
      1,
    );
    const row = (
      await db.query(
        'SELECT email_verified, created_at FROM "user" WHERE id = $1',
        ["one"],
      )
    ).rows[0];
    assert.equal(row.email_verified, false);
    assert.ok(row.created_at instanceof Date);
    await assert.rejects(
      db.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
        "two",
        "Two",
        "one@example.com",
      ]),
      { code: "23505" },
    );
    await assert.rejects(
      db.query(
        "INSERT INTO session (id, token, expires_at, user_id) VALUES ($1, $2, $3, $4)",
        ["invalid", "invalid-token", new Date(), "missing"],
      ),
      { code: "23503" },
    );
    const note = (
      await db.query(
        "SELECT id, content, created_at FROM notes WHERE user_id = $1",
        ["one"],
      )
    ).rows[0];
    assert.match(note.id, /^[0-9a-f-]{36}$/);
    assert.equal(note.content, "");
    assert.ok(note.created_at instanceof Date);
    await assert.rejects(
      db.query("INSERT INTO notes (title, user_id) VALUES ($1, $2)", [
        "Orphan",
        "missing",
      ]),
      { code: "23503" },
    );
    await db.query('DELETE FROM "user" WHERE id = $1', ["one"]);
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM notes")).rows[0]
        .count,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM session")).rows[0]
        .count,
      0,
    );
  } finally {
    await db.end();
  }
});

test("NOC core tables enforce keys, checks, and delete rules", async () => {
  const url = process.env.STARTER_TEST_DATABASE_URL;
  assert.ok(
    url && process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-"),
    "Run npm test to create an isolated database.",
  );
  const db = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const count = async (table, where = "true", params = []) =>
    (
      await one(
        `SELECT count(*)::int AS count FROM ${table} WHERE ${where}`,
        params,
      )
    ).count;
  const addRouter = (host) =>
    one(
      "INSERT INTO routers (name, host, username, password_enc) VALUES ('R', $1, 'api', 'enc') RETURNING id, status",
      [host],
    );
  const addCustomer = (pppoe, routerId, extra = "") =>
    one(
      `INSERT INTO customers (name, pppoe_username, router_id${extra ? ", " + extra.split("=")[0] : ""}) VALUES ('C', $1, $2${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id, billing_status, is_online`,
      [pppoe, routerId],
    );
  try {
    await db.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
      "noc-user",
      "NOC",
      "noc@example.com",
    ]);

    // Router: default aktif, host unik, status dibatasi.
    const router = await addRouter("10.0.0.1");
    assert.equal(router.status, "aktif");
    await assert.rejects(addRouter("10.0.0.1"), { code: "23505" });
    await assert.rejects(
      db.query("UPDATE routers SET status = 'mati' WHERE id = $1", [router.id]),
      { code: "23514" },
    );

    // Pelanggan: default, username unik, koordinat valid, router wajib ada.
    const customer = await addCustomer("budi.santoso001", router.id);
    assert.equal(customer.billing_status, "lunas");
    assert.equal(customer.is_online, false);
    await assert.rejects(addCustomer("budi.santoso001", router.id), {
      code: "23505",
    });
    await assert.rejects(addCustomer("lat", router.id, "latitude=91"), {
      code: "23514",
    });
    await assert.rejects(addCustomer("lng", router.id, "longitude=181"), {
      code: "23514",
    });
    await assert.rejects(
      addCustomer("orphan", "00000000-0000-4000-8000-000000000000"),
      { code: "23503" },
    );
    await assert.rejects(
      db.query("DELETE FROM routers WHERE id = $1", [router.id]),
      { code: "23503" },
    );
    const spare = await addCustomer("spare", router.id, "latitude=-6.9175");
    assert.ok(spare.id);

    // Nama ODP/lokasi: kosong secara bawaan, teks bebas 1-100 karakter.
    const setOdp = (value) =>
      db.query("UPDATE customers SET odp_name = $1 WHERE id = $2", [
        value,
        customer.id,
      ]);
    assert.equal(
      (await one("SELECT odp_name FROM customers WHERE id = $1", [customer.id]))
        .odp_name,
      null,
    );
    await setOdp("ODP-CHP-04");
    await setOdp("x".repeat(100));
    await setOdp(null);
    for (const bad of ["", "   ", "x".repeat(101)]) {
      await assert.rejects(setOdp(bad), { code: "23514" });
    }

    // OLT: satu baris per PON port dan per ONU; satu pelanggan satu ONU.
    const olt = await one(
      "INSERT INTO olts (name, host, brand, driver, username, password_enc) VALUES ('O', '10.0.1.1', 'hsgq', 'hsgq', 'admin', 'enc') RETURNING id",
    );
    await db.query(
      "INSERT INTO olt_pon_ports (olt_id, pon_index, rx_power) VALUES ($1, 1, -18.5)",
      [olt.id],
    );
    await assert.rejects(
      db.query("INSERT INTO olt_pon_ports (olt_id, pon_index) VALUES ($1, 1)", [
        olt.id,
      ]),
      { code: "23505" },
    );
    await db.query(
      "INSERT INTO olt_onus (olt_id, pon_index, onu_index, customer_id) VALUES ($1, 1, 1, $2)",
      [olt.id, customer.id],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO olt_onus (olt_id, pon_index, onu_index) VALUES ($1, 1, 1)",
        [olt.id],
      ),
      { code: "23505" },
    );
    await assert.rejects(
      db.query(
        "INSERT INTO olt_onus (olt_id, pon_index, onu_index, customer_id) VALUES ($1, 1, 2, $2)",
        [olt.id, customer.id],
      ),
      { code: "23505" },
    );
    // ONU tanpa pelanggan boleh banyak.
    await db.query(
      "INSERT INTO olt_onus (olt_id, pon_index, onu_index) VALUES ($1, 1, 3), ($1, 1, 4)",
      [olt.id],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO olt_onus (olt_id, pon_index, onu_index, status) VALUES ($1, 1, 5, 'rusak')",
        [olt.id],
      ),
      { code: "23514" },
    );

    // Billing satu baris per pelanggan.
    await db.query(
      "INSERT INTO billing_status (customer_id, status) VALUES ($1, 'isolir')",
      [customer.id],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO billing_status (customer_id, status) VALUES ($1, 'lunas')",
        [customer.id],
      ),
      { code: "23505" },
    );

    // Log jaringan: tipe valid, periode tidak terbalik, detail default {}.
    const log = await one(
      "INSERT INTO network_logs (router_id, customer_id, type, severity) VALUES ($1, $2, 'offline', 'warning') RETURNING id, ended_at, detail",
      [router.id, customer.id],
    );
    assert.equal(log.ended_at, null);
    assert.deepEqual(log.detail, {});
    await assert.rejects(
      db.query(
        "INSERT INTO network_logs (router_id, type, severity) VALUES ($1, 'ccq', 'warning')",
        [router.id],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      db.query(
        "UPDATE network_logs SET ended_at = started_at - interval '1 minute' WHERE id = $1",
        [log.id],
      ),
      { code: "23514" },
    );

    // Tugas CPE dan audit tetap ada saat akun pembuatnya dihapus.
    const task = await one(
      "INSERT INTO cpe_tasks (customer_id, action, created_by) VALUES ($1, 'change_ssid', 'noc-user') RETURNING id, status",
      [customer.id],
    );
    assert.equal(task.status, "pending");
    await assert.rejects(
      db.query(
        "INSERT INTO cpe_tasks (customer_id, action) VALUES ($1, 'reboot')",
        [customer.id],
      ),
      { code: "23514" },
    );
    await db.query(
      "INSERT INTO audit_log (user_id, action, target) VALUES ('noc-user', 'router.create', 'routers/1')",
    );
    await db.query('DELETE FROM "user" WHERE id = $1', ["noc-user"]);
    assert.equal(await count("cpe_tasks", "created_by IS NULL"), 1);
    assert.equal(await count("audit_log", "user_id IS NULL AND action = 'router.create' AND target = 'routers/1'"), 1);

    // Hapus pelanggan: data turunan ikut hilang, ONU dan log tetap tanpa pelanggan.
    await db.query("DELETE FROM customers WHERE id = $1", [customer.id]);
    assert.equal(await count("billing_status"), 0);
    assert.equal(await count("cpe_tasks"), 0);
    assert.equal(await count("olt_onus", "customer_id IS NULL"), 3);
    assert.equal(await count("network_logs", "customer_id IS NULL"), 1);

    // Hapus OLT: data optiknya ikut hilang.
    await db.query("DELETE FROM olts WHERE id = $1", [olt.id]);
    assert.equal(await count("olt_pon_ports"), 0);
    assert.equal(await count("olt_onus"), 0);
  } finally {
    await db.end();
  }
});

test("the traffic archive keeps one row per router per second and follows its router", async () => {
  const url = process.env.STARTER_TEST_DATABASE_URL;
  assert.ok(
    url && process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-"),
    "Run npm test to create an isolated database.",
  );
  const db = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const count = async (where = "true", params = []) =>
    (
      await db.query(
        `SELECT count(*)::int AS count FROM traffic_samples WHERE ${where}`,
        params,
      )
    ).rows[0].count;
  try {
    const router = (
      await db.query(
        "INSERT INTO routers (name, host, username, password_enc) VALUES ('Arsip', '10.7.7.1', 'api', 'enc') RETURNING id",
      )
    ).rows[0].id;
    const insert = (at, rx, tx) =>
      db.query(
        "INSERT INTO traffic_samples (router_id, sampled_at, rx_mbps, tx_mbps) VALUES ($1, $2, $3, $4)",
        [router, at, rx, tx],
      );

    await insert("2026-10-07T10:00:00Z", 120.5, 20.25);
    await insert("2026-10-07T10:00:01Z", 121, 21);

    // Satu baris per router per detik.
    await assert.rejects(insert("2026-10-07T10:00:00Z", 1, 1), {
      code: "23505",
    });
    // Penulis menulis ulang detik yang sama dengan upsert: nilai terbaru menang.
    await db.query(
      `INSERT INTO traffic_samples (router_id, sampled_at, rx_mbps, tx_mbps)
       VALUES ($1, '2026-10-07T10:00:00Z', 130, 30)
       ON CONFLICT (router_id, sampled_at)
       DO UPDATE SET rx_mbps = EXCLUDED.rx_mbps, tx_mbps = EXCLUDED.tx_mbps`,
      [router],
    );
    assert.equal(await count("router_id = $1", [router]), 2);
    const row = (
      await db.query(
        "SELECT rx_mbps, tx_mbps FROM traffic_samples WHERE router_id = $1 AND sampled_at = '2026-10-07T10:00:00Z'",
        [router],
      )
    ).rows[0];
    assert.deepEqual(row, { rx_mbps: 130, tx_mbps: 30 });

    // Router lain boleh memakai detik yang sama.
    const other = (
      await db.query(
        "INSERT INTO routers (name, host, username, password_enc) VALUES ('Lain', '10.7.7.2', 'api', 'enc') RETURNING id",
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO traffic_samples (router_id, sampled_at, rx_mbps, tx_mbps) VALUES ($1, '2026-10-07T10:00:00Z', 5, 1)",
      [other],
    );
    // Total semua router pada satu detik adalah jumlah barisnya.
    const total = (
      await db.query(
        "SELECT sum(rx_mbps) AS rx FROM traffic_samples WHERE sampled_at = '2026-10-07T10:00:00Z'",
      )
    ).rows[0];
    assert.equal(total.rx, 135);

    // Tanpa router, nilai negatif, dan nilai kosong ditolak.
    await assert.rejects(
      db.query(
        "INSERT INTO traffic_samples VALUES ('00000000-0000-4000-8000-000000000000', now(), 1, 1)",
      ),
      { code: "23503" },
    );
    await assert.rejects(insert("2026-10-07T10:00:02Z", -1, 1), {
      code: "23514",
    });
    await assert.rejects(insert("2026-10-07T10:00:02Z", 1, -0.5), {
      code: "23514",
    });
    await assert.rejects(insert("2026-10-07T10:00:02Z", null, 1), {
      code: "23502",
    });
    // Nol adalah nilai yang sah (tidak ada traffic).
    await insert("2026-10-07T10:00:03Z", 0, 0);

    // Arsip mengikuti routernya.
    await db.query("DELETE FROM routers WHERE id = $1", [router]);
    assert.equal(await count("router_id = $1", [router]), 0);
    assert.equal(await count("router_id = $1", [other]), 1);
    await db.query("DELETE FROM routers WHERE id = $1", [other]);

    // Hypertable hanya ada bila TimescaleDB terpasang. Image uji memakai
    // PostgreSQL biasa, sehingga tabelnya biasa; bila Timescale ada, migrasi
    // harus sudah menjadikannya hypertable dengan retensi.
    const timescale = (
      await db.query("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'")
    ).rowCount;
    if (timescale) {
      const hypertable = await db.query(
        "SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'traffic_samples'",
      );
      assert.equal(hypertable.rowCount, 1);
      const retention = await db.query(
        "SELECT 1 FROM timescaledb_information.jobs WHERE hypertable_name = 'traffic_samples' AND proc_name = 'policy_retention'",
      );
      assert.equal(retention.rowCount, 1);
    } else {
      const kind = (
        await db.query(
          "SELECT relkind FROM pg_class WHERE relname = 'traffic_samples'",
        )
      ).rows[0].relkind;
      assert.equal(kind, "r");
    }
  } finally {
    await db.end();
  }
});
