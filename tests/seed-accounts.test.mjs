import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { verifyPassword } from "better-auth/crypto";
import { root } from "../scripts/lib.mjs";
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  DEFAULT_VIEWER_EMAIL,
  DEFAULT_VIEWER_NAME,
  GENERATED_PASSWORD_LENGTH,
  PASSWORD_ALPHABET,
  SeedError,
  buildAccountSpecs,
  decideRole,
  formatSummary,
  generatePassword,
  normalizeEmail,
  parseArgs,
  seedAccounts,
  validateAccountSpecs,
} from "../scripts/seed-accounts-lib.mjs";

// Skrip seed dites di database SENDIRI di dalam server uji sekali pakai:
// tests/database.test.mjs menghitung seluruh baris tabel user dan session di
// database utama, sedangkan berkas uji dijalankan paralel. Database ini dibuat
// di awal dan dibuang di akhir.
const serverUrl = process.env.STARTER_TEST_DATABASE_URL;
assert.ok(
  serverUrl && process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-"),
  "Run npm test to create an isolated database.",
);
const dbName = `seed_accounts_${randomBytes(6).toString("hex")}`;
const dbUrl = (() => {
  const url = new URL(serverUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
})();

const NOW = new Date("2026-10-09T03:00:00.000Z");
const CONFUSING = /[0OolI1]/;

let server;
let pool;

before(async () => {
  server = new Pool({
    connectionString: serverUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  await server.query(`CREATE DATABASE ${dbName}`);
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: dbUrl, MIGRATION_DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  pool = new Pool({
    connectionString: dbUrl,
    max: 4,
    connectionTimeoutMillis: 5000,
  });
});

after(async () => {
  await pool?.end();
  await server?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await server?.end();
});

// --- pembantu -----------------------------------------------------------

const token = () => randomBytes(5).toString("hex");

function specsFor(id = token(), extra = {}) {
  return [
    {
      kind: "admin",
      email: `admin-${id}@example.com`,
      name: "Admin Uji",
      ...extra.admin,
    },
    {
      kind: "viewer",
      email: `viewer-${id}@example.com`,
      name: "Viewer Uji",
      ...extra.viewer,
    },
  ];
}

const seed = (accounts, options = {}) =>
  seedAccounts({ pool, accounts, now: NOW, production: false, ...options });

async function userOf(email) {
  return (await pool.query('SELECT * FROM "user" WHERE email = $1', [email]))
    .rows[0];
}
async function accountsOf(userId) {
  return (
    await pool.query("SELECT * FROM account WHERE user_id = $1 ORDER BY id", [
      userId,
    ])
  ).rows;
}
async function hashOf(email) {
  const user = await userOf(email);
  const [account] = await accountsOf(user.id);
  return account.password;
}
async function countUsers(emails) {
  return (
    await pool.query(
      'SELECT count(*)::int AS n FROM "user" WHERE lower(email) = ANY($1)',
      [emails.map((email) => email.toLowerCase())],
    )
  ).rows[0].n;
}
async function addSession(userId) {
  await pool.query(
    "INSERT INTO session (id, token, expires_at, user_id) VALUES ($1, $2, $3, $4)",
    [randomUUID(), randomUUID(), new Date(Date.now() + 3_600_000), userId],
  );
}
async function sessionCount(userId) {
  return (
    await pool.query(
      "SELECT count(*)::int AS n FROM session WHERE user_id = $1",
      [userId],
    )
  ).rows[0].n;
}
const setRole = (email, role) =>
  pool.query('UPDATE "user" SET role = $2 WHERE email = $1', [email, role]);

async function rejectsWith(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof SeedError, `galat bukan SeedError: ${error}`);
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`diharapkan galat ${code}`);
}

// Seluruh isi tabel yang bisa memuat kata sandi, sebagai teks.
async function dumpAuthTables() {
  const parts = [];
  for (const table of ['"user"', "account", "session", "verification"]) {
    const { rows } = await pool.query(
      `SELECT row_to_json(t)::text AS row FROM ${table} t`,
    );
    parts.push(...rows.map((row) => row.row));
  }
  return parts.join("\n");
}

// --- pembuatan akun -----------------------------------------------------

test("creates an admin and a read-only account that Better Auth can verify", async () => {
  const accounts = specsFor();
  const results = await seed(accounts);

  assert.deepEqual(
    results.map((result) => [result.kind, result.status, result.role]),
    [
      ["admin", "created", "admin"],
      ["viewer", "created", "user"],
    ],
  );
  const [admin, viewer] = results;
  for (const [result, spec] of [
    [admin, accounts[0]],
    [viewer, accounts[1]],
  ]) {
    const user = await userOf(spec.email);
    assert.equal(user.name, spec.name);
    assert.equal(user.email_verified, true);
    assert.equal(user.banned, false);
    assert.equal(user.role, result.role);
    assert.ok(user.id.length >= 16);
    assert.equal(user.created_at.getTime(), NOW.getTime());
    assert.equal(user.updated_at.getTime(), NOW.getTime());

    const rows = await accountsOf(user.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider_id, "credential");
    assert.equal(rows[0].account_id, user.id);
    assert.match(rows[0].password, /^[0-9a-f]{32}:[0-9a-f]{128}$/);

    // O hash dibuat dengan fungsi Better Auth: sandi yang dicetak cocok,
    // sandi lain tidak.
    assert.equal(result.generatedPassword.length, GENERATED_PASSWORD_LENGTH);
    assert.equal(
      await verifyPassword({
        hash: rows[0].password,
        password: result.generatedPassword,
      }),
      true,
    );
    assert.equal(
      await verifyPassword({
        hash: rows[0].password,
        password: `${result.generatedPassword}x`,
      }),
      false,
    );
  }
  assert.notEqual(admin.generatedPassword, viewer.generatedPassword);

  // Sandi tidak ada di baris mana pun, dan hash tidak ikut dalam hasil.
  const dump = await dumpAuthTables();
  const adminHash = await hashOf(accounts[0].email);
  for (const result of results) {
    assert.ok(!dump.includes(result.generatedPassword));
    assert.ok(!JSON.stringify(results).includes(adminHash));
  }
});

test("normalizes email and name, and uses an operator password without returning it", async () => {
  const id = token();
  const password = "Sandi-Pilihan-Operator-123";
  const results = await seed([
    {
      kind: "admin",
      email: `  Admin-${id}@Example.COM `,
      name: "  Admin Besar  ",
      password,
    },
    { kind: "viewer", email: `viewer-${id}@example.com`, name: "V" },
  ]);
  assert.equal(results[0].email, `admin-${id}@example.com`);
  assert.equal(results[0].generatedPassword, undefined);
  assert.equal(results[1].generatedPassword?.length, GENERATED_PASSWORD_LENGTH);
  const user = await userOf(`admin-${id}@example.com`);
  assert.equal(user.name, "Admin Besar");
  assert.equal(
    await verifyPassword({
      hash: await hashOf(user.email),
      password,
    }),
    true,
  );
  assert.ok(!(await dumpAuthTables()).includes(password));
  assert.ok(!JSON.stringify(results).includes(password));
  assert.ok(!formatSummary(results).join("\n").includes(password));
});

// --- idempoten ----------------------------------------------------------

test("a second run is idempotent: no duplicate rows, no password overwritten", async () => {
  const id = token();
  const accounts = specsFor(id);
  const first = await seed(accounts);
  const before = {
    admin: await hashOf(accounts[0].email),
    viewer: await hashOf(accounts[1].email),
  };
  const userIds = [
    (await userOf(accounts[0].email)).id,
    (await userOf(accounts[1].email)).id,
  ];

  // Sandi lain lewat spesifikasi (SEED_*_PASSWORD) juga tidak boleh menimpa.
  const second = await seed(
    specsFor(id, {
      admin: {
        email: accounts[0].email.toUpperCase(),
        password: "Sandi-Lain-9999",
      },
      viewer: { password: "Sandi-Lain-8888" },
    }),
  );
  assert.deepEqual(
    second.map((result) => [result.status, result.roleChanged]),
    [
      ["exists", false],
      ["exists", false],
    ],
  );
  for (const result of second) {
    assert.equal(result.generatedPassword, undefined);
    assert.equal(result.credentialAdded, false);
  }
  assert.equal(await countUsers(accounts.map((spec) => spec.email)), 2);
  assert.equal(await hashOf(accounts[0].email), before.admin);
  assert.equal(await hashOf(accounts[1].email), before.viewer);
  assert.deepEqual(
    [
      (await userOf(accounts[0].email)).id,
      (await userOf(accounts[1].email)).id,
    ],
    userIds,
  );
  for (const userId of userIds)
    assert.equal((await accountsOf(userId)).length, 1);
  assert.equal(
    await verifyPassword({
      hash: before.admin,
      password: first[0].generatedPassword,
    }),
    true,
  );
  assert.equal(
    await verifyPassword({ hash: before.admin, password: "Sandi-Lain-9999" }),
    false,
  );
  // Hasil run kedua tidak memuat rahasia apa pun.
  const summary = formatSummary(second).join("\n");
  assert.ok(summary.includes("sudah ada"));
  assert.ok(!summary.includes("Kata sandi baru"));
  assert.ok(!summary.includes(first[0].generatedPassword));
});

test("two runs at the same moment create one account and report the other as existing", async () => {
  const accounts = specsFor();
  const [one, two] = await Promise.all([seed(accounts), seed(accounts)]);
  assert.deepEqual([one[0].status, two[0].status].sort(), [
    "created",
    "exists",
  ]);
  assert.deepEqual([one[1].status, two[1].status].sort(), [
    "created",
    "exists",
  ]);
  assert.equal(await countUsers(accounts.map((spec) => spec.email)), 2);
  for (const spec of accounts)
    assert.equal((await accountsOf((await userOf(spec.email)).id)).length, 1);
});

// --- peran --------------------------------------------------------------

test("the role of an existing account is repaired without touching its password", async () => {
  const accounts = specsFor();
  await seed(accounts);
  const hashes = [
    await hashOf(accounts[0].email),
    await hashOf(accounts[1].email),
  ];

  await setRole(accounts[0].email, "user");
  let again = await seed(accounts);
  assert.equal(again[0].status, "exists");
  assert.equal(again[0].roleChanged, true);
  assert.equal(again[0].role, "admin");
  assert.equal((await userOf(accounts[0].email)).role, "admin");

  await setRole(accounts[0].email, null);
  await setRole(accounts[1].email, null);
  again = await seed(accounts);
  assert.equal((await userOf(accounts[0].email)).role, "admin");
  assert.equal((await userOf(accounts[1].email)).role, "user");

  // Daftar peran yang sudah memuat admin dibiarkan.
  await setRole(accounts[0].email, "support, admin");
  again = await seed(accounts);
  assert.equal(again[0].roleChanged, false);
  assert.equal((await userOf(accounts[0].email)).role, "support, admin");

  assert.equal(await hashOf(accounts[0].email), hashes[0]);
  assert.equal(await hashOf(accounts[1].email), hashes[1]);
});

test("a read-only email that is already an admin stops the run before anything is written", async () => {
  for (const role of ["admin", "user,admin", "admin,support"]) {
    const accounts = specsFor();
    await seed([accounts[1]]);
    await setRole(accounts[1].email, role);

    const error = await rejectsWith(seed(accounts), "VIEWER_IS_ADMIN");
    assert.match(error.message, /admin/);
    assert.deepEqual(error.completed, []);
    // Peran tidak diturunkan diam-diam, dan akun admin barunya tidak dibuat.
    assert.equal((await userOf(accounts[1].email)).role, role);
    assert.equal(await userOf(accounts[0].email), undefined);
  }
});

test("a read-only email with any other role is refused instead of rewritten", async () => {
  const accounts = specsFor();
  await seed([accounts[1]]);
  await setRole(accounts[1].email, "support");
  await rejectsWith(seed(accounts), "VIEWER_ROLE_NOT_READ_ONLY");
  assert.equal((await userOf(accounts[1].email)).role, "support");
  assert.equal(await userOf(accounts[0].email), undefined);
});

test("decideRole covers every case", () => {
  assert.deepEqual(decideRole("admin", "admin"), {
    role: "admin",
    changed: false,
  });
  assert.deepEqual(decideRole("admin", null), { role: "admin", changed: true });
  assert.deepEqual(decideRole("admin", "user"), {
    role: "admin",
    changed: true,
  });
  assert.deepEqual(decideRole("admin", "Admin"), {
    role: "admin",
    changed: true,
  });
  assert.deepEqual(decideRole("viewer", "user"), {
    role: "user",
    changed: false,
  });
  assert.deepEqual(decideRole("viewer", null), { role: "user", changed: true });
  assert.deepEqual(decideRole("viewer", ""), { role: "user", changed: true });
  assert.deepEqual(decideRole("viewer", "user, user"), {
    role: "user",
    changed: true,
  });
  assert.throws(() => decideRole("viewer", "admin"), {
    code: "VIEWER_IS_ADMIN",
  });
  assert.throws(() => decideRole("viewer", "user,admin"), {
    code: "VIEWER_IS_ADMIN",
  });
  assert.throws(() => decideRole("viewer", "Admin"), {
    code: "VIEWER_ROLE_NOT_READ_ONLY",
  });
  assert.throws(() => decideRole("viewer", "editor"), {
    code: "VIEWER_ROLE_NOT_READ_ONLY",
  });
});

// --- akun lama dan keadaan tak lazim ------------------------------------

test("an existing account without a password login gets one; a blocked account stays blocked", async () => {
  const id = token();
  const bare = `bare-${id}@example.com`;
  const nullPassword = `nullpw-${id}@example.com`;
  const banned = `banned-${id}@example.com`;
  for (const [userId, email, isBanned] of [
    [`u-bare-${id}`, bare, false],
    [`u-null-${id}`, nullPassword, false],
    [`u-ban-${id}`, banned, true],
  ])
    await pool.query(
      'INSERT INTO "user" (id, name, email, role, banned) VALUES ($1, $2, $3, $4, $5)',
      [userId, "Lama", email, "admin", isBanned],
    );
  await pool.query(
    "INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES ($1, $2, 'credential', $2, NULL)",
    [`a-null-${id}`, `u-null-${id}`],
  );
  await pool.query(
    "INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES ($1, $2, 'credential', $2, $3)",
    [`a-ban-${id}`, `u-ban-${id}`, "salt:kunci-lama"],
  );
  const viewerEmail = `viewer-${id}@example.com`;

  const run = async (adminEmail) =>
    seed([
      { kind: "admin", email: adminEmail, name: "Lama" },
      { kind: "viewer", email: viewerEmail, name: "V" },
    ]);

  const [added] = await run(bare);
  assert.equal(added.status, "exists");
  assert.equal(added.credentialAdded, true);
  const rows = await accountsOf(`u-bare-${id}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider_id, "credential");
  assert.equal(
    await verifyPassword({
      hash: rows[0].password,
      password: added.generatedPassword,
    }),
    true,
  );

  const [filled] = await run(nullPassword);
  assert.equal(filled.credentialAdded, true);
  const filledRows = await accountsOf(`u-null-${id}`);
  assert.equal(filledRows.length, 1);
  assert.equal(
    await verifyPassword({
      hash: filledRows[0].password,
      password: filled.generatedPassword,
    }),
    true,
  );

  const [blocked] = await run(banned);
  assert.equal(blocked.status, "exists");
  assert.equal(blocked.generatedPassword, undefined);
  assert.equal(blocked.warnings.length, 1);
  assert.equal((await userOf(banned)).banned, true);
  assert.equal(await hashOf(banned), "salt:kunci-lama");
  assert.match(formatSummary([blocked]).join("\n"), /diblokir/);
});

// --- --reset-password ---------------------------------------------------

test("reset replaces the hash, prints the new password and revokes only that account's sessions", async () => {
  const accounts = specsFor();
  const first = await seed(accounts);
  const admin = await userOf(accounts[0].email);
  const viewer = await userOf(accounts[1].email);
  await addSession(admin.id);
  await addSession(admin.id);
  await addSession(viewer.id);
  const oldHash = await hashOf(accounts[0].email);
  const viewerHash = await hashOf(accounts[1].email);

  const results = await seed([
    { ...accounts[0], resetPassword: true },
    accounts[1],
  ]);
  assert.equal(results[0].status, "reset");
  assert.equal(results[1].status, "exists");
  const newPassword = results[0].generatedPassword;
  assert.equal(newPassword.length, GENERATED_PASSWORD_LENGTH);
  assert.notEqual(newPassword, first[0].generatedPassword);

  const newHash = await hashOf(accounts[0].email);
  assert.notEqual(newHash, oldHash);
  assert.equal(
    await verifyPassword({ hash: newHash, password: newPassword }),
    true,
  );
  assert.equal(
    await verifyPassword({
      hash: newHash,
      password: first[0].generatedPassword,
    }),
    false,
  );
  assert.equal((await accountsOf(admin.id)).length, 1);
  assert.equal(await sessionCount(admin.id), 0);
  assert.equal(await sessionCount(viewer.id), 1);
  assert.equal(await hashOf(accounts[1].email), viewerHash);
  assert.equal((await userOf(accounts[0].email)).id, admin.id);

  const summary = formatSummary(results).join("\n");
  assert.ok(summary.includes(newPassword));
  assert.ok(summary.includes("sesi lamanya dicabut"));
  assert.ok(!(await dumpAuthTables()).includes(newPassword));
});

test("reset can use an operator password, and resetting both accounts works", async () => {
  const accounts = specsFor();
  await seed(accounts);
  const chosen = "Pilihan-Operator-Baru-77";
  const results = await seed([
    { ...accounts[0], resetPassword: true, password: chosen },
    { ...accounts[1], resetPassword: true },
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["reset", "reset"],
  );
  assert.equal(results[0].generatedPassword, undefined);
  assert.equal(
    await verifyPassword({
      hash: await hashOf(accounts[0].email),
      password: chosen,
    }),
    true,
  );
  assert.equal(
    await verifyPassword({
      hash: await hashOf(accounts[1].email),
      password: results[1].generatedPassword,
    }),
    true,
  );
  assert.ok(!formatSummary(results).join("\n").includes(chosen));
});

test("reset on an account that does not exist yet just creates it", async () => {
  const accounts = specsFor().map((spec) => ({ ...spec, resetPassword: true }));
  const results = await seed(accounts);
  assert.deepEqual(
    results.map((result) => result.status),
    ["created", "created"],
  );
});

// --- kegagalan ----------------------------------------------------------

test("a failing account rolls back and reports the accounts already saved", async () => {
  const accounts = specsFor();
  // Gagal pada INSERT account kedua, yaitu akun hanya-lihat (admin sudah
  // tersimpan lebih dulu).
  const failing = { query: (...args) => pool.query(...args) };
  let inserts = 0;
  failing.connect = async () => {
    const client = await pool.connect();
    const query = client.query.bind(client);
    client.query = (sql, ...rest) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO account")) {
        inserts += 1;
        if (inserts === 2) return Promise.reject(new Error("gagal sengaja"));
      }
      return query(sql, ...rest);
    };
    return client;
  };

  const error = await seedAccounts({
    pool: failing,
    accounts,
    now: NOW,
    production: false,
  }).then(
    () => assert.fail("diharapkan galat"),
    (caught) => caught,
  );
  assert.equal(error.message, "gagal sengaja");
  assert.equal(error.completed.length, 1);
  assert.equal(error.completed[0].kind, "admin");
  assert.equal(
    await verifyPassword({
      hash: await hashOf(accounts[0].email),
      password: error.completed[0].generatedPassword,
    }),
    true,
  );
  // Akun yang gagal tidak meninggalkan baris setengah jadi.
  assert.equal(await userOf(accounts[1].email), undefined);
  // Pool tidak macet: run ulang melengkapi akun yang tersisa.
  const retry = await seed(accounts);
  assert.deepEqual(
    retry.map((result) => result.status),
    ["exists", "created"],
  );
});

// --- validasi -----------------------------------------------------------

test("invalid email, name, password, kind and duplicate emails are rejected before the database", async () => {
  const id = token();
  const good = specsFor(id);
  const attempt = (patch, index = 0) => {
    const accounts = specsFor(id);
    accounts[index] = { ...accounts[index], ...patch };
    return seed(accounts);
  };
  for (const email of [
    "",
    "   ",
    "tanpa-at",
    "a@localhost",
    "a b@example.com",
    `${"x".repeat(250)}@example.com`,
    undefined,
    42,
  ])
    await rejectsWith(attempt({ email }), "INVALID_EMAIL");
  for (const name of ["", "   ", "x".repeat(101), "Nama\nBaris", undefined])
    await rejectsWith(attempt({ name }), "INVALID_NAME");
  for (const password of ["1234567", "x".repeat(129), "", 12345678]) {
    const error = await rejectsWith(attempt({ password }), "INVALID_PASSWORD");
    if (password) assert.ok(!error.message.includes(String(password)));
  }
  await seed([
    { ...good[0], password: "x".repeat(8) },
    { ...good[1], password: "y".repeat(128) },
  ]);
  const second = specsFor(token());
  await rejectsWith(attempt({ kind: "operator" }), "INVALID_KIND");
  await rejectsWith(
    seed([second[0], { ...second[1], kind: "admin" }]),
    "DUPLICATE_KIND",
  );
  await rejectsWith(seed([]), "NO_ACCOUNTS");
  await rejectsWith(
    seed([
      second[0],
      { ...second[1], email: ` ${second[0].email.toUpperCase()}` },
    ]),
    "SAME_EMAIL",
  );
  assert.equal(await countUsers(second.map((spec) => spec.email)), 0);
  assert.throws(() => normalizeEmail("bukan email"), { code: "INVALID_EMAIL" });
  await assert.rejects(
    seedAccounts({ pool, accounts: second, now: "kemarin", production: false }),
    TypeError,
  );
});

// --- kata sandi acak ----------------------------------------------------

test("generated passwords are long, random, from a wide unambiguous alphabet", () => {
  const seen = new Set();
  const used = new Set();
  const total = 400;
  for (let index = 0; index < total; index += 1) {
    const password = generatePassword();
    assert.equal(password.length, GENERATED_PASSWORD_LENGTH);
    assert.ok(password.length >= 24);
    assert.match(password, /^[A-Za-z0-9]+$/);
    assert.ok(!CONFUSING.test(password), password);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /\d/);
    seen.add(password);
    for (const char of password) used.add(char);
  }
  assert.equal(seen.size, total);
  // Seluruh alfabet (huruf besar, kecil, angka tanpa yang membingungkan)
  // benar-benar terpakai: bukan alfabet pendek.
  assert.ok(used.size >= 54, `hanya ${used.size} karakter berbeda terpakai`);
  assert.equal(new Set(PASSWORD_ALPHABET).size, PASSWORD_ALPHABET.length);
  assert.ok(PASSWORD_ALPHABET.length >= 54);
  assert.ok(!CONFUSING.test(PASSWORD_ALPHABET));

  assert.equal(generatePassword(40).length, 40);
  assert.throws(() => generatePassword(23), RangeError);
  assert.throws(() => generatePassword(129), RangeError);
  assert.throws(() => generatePassword(24.5), RangeError);
});

// --- konfigurasi --------------------------------------------------------

test("buildAccountSpecs takes arguments over environment over defaults", () => {
  const defaults = buildAccountSpecs({ env: {}, args: {}, production: false });
  assert.deepEqual(defaults, [
    {
      kind: "admin",
      email: DEFAULT_ADMIN_EMAIL,
      name: DEFAULT_ADMIN_NAME,
      resetPassword: false,
    },
    {
      kind: "viewer",
      email: DEFAULT_VIEWER_EMAIL,
      name: DEFAULT_VIEWER_NAME,
      resetPassword: false,
    },
  ]);
  assert.equal(DEFAULT_ADMIN_EMAIL, "admin@noc.local");
  assert.equal(DEFAULT_VIEWER_EMAIL, "viewer@noc.local");
  assert.equal(DEFAULT_ADMIN_NAME, "Admin NOC");
  assert.equal(DEFAULT_VIEWER_NAME, "Petugas Hanya Lihat");

  const env = {
    SEED_ADMIN_EMAIL: "Env-Admin@Example.com",
    SEED_VIEWER_EMAIL: "env-viewer@example.com",
    SEED_ADMIN_NAME: "Admin Env",
    SEED_VIEWER_NAME: "",
    SEED_ADMIN_PASSWORD: "sandi-env-admin",
    SEED_VIEWER_PASSWORD: "",
  };
  const fromEnv = buildAccountSpecs({ env, args: {}, production: false });
  assert.equal(fromEnv[0].email, "env-admin@example.com");
  assert.equal(fromEnv[0].name, "Admin Env");
  assert.equal(fromEnv[0].password, "sandi-env-admin");
  assert.equal(fromEnv[1].name, DEFAULT_VIEWER_NAME); // kosong = tidak diisi
  assert.equal(fromEnv[1].password, undefined);

  const fromArgs = buildAccountSpecs({
    env,
    args: {
      adminEmail: "arg-admin@example.com",
      viewerName: "Viewer Arg",
      reset: new Set(["viewer"]),
    },
    production: false,
  });
  assert.equal(fromArgs[0].email, "arg-admin@example.com");
  assert.equal(fromArgs[0].name, "Admin Env");
  assert.equal(fromArgs[1].email, "env-viewer@example.com");
  assert.equal(fromArgs[1].name, "Viewer Arg");
  assert.deepEqual(
    fromArgs.map((spec) => spec.resetPassword),
    [false, true],
  );
});

test("buildAccountSpecs refuses bad passwords without echoing them, and the same email twice", () => {
  const bad = "pendek";
  for (const key of ["SEED_ADMIN_PASSWORD", "SEED_VIEWER_PASSWORD"]) {
    assert.throws(
      () => buildAccountSpecs({ env: { [key]: bad }, production: false }),
      (error) =>
        error.code === "INVALID_PASSWORD" &&
        !error.message.includes(bad) &&
        error.message.includes("8-128"),
    );
  }
  assert.throws(
    () =>
      buildAccountSpecs({
        env: {},
        args: {
          adminEmail: "sama@example.com",
          viewerEmail: "SAMA@example.com",
        },
        production: false,
      }),
    { code: "SAME_EMAIL" },
  );
  assert.throws(
    () =>
      buildAccountSpecs({
        env: {},
        args: { adminEmail: "rusak" },
        production: false,
      }),
    { code: "INVALID_EMAIL" },
  );
});

test("production refuses the default emails and demands explicit ones", async () => {
  // Tanpa email eksplisit.
  assert.throws(
    () => buildAccountSpecs({ env: {}, args: {}, production: true }),
    {
      code: "EXPLICIT_EMAIL_REQUIRED",
    },
  );
  assert.throws(
    () =>
      buildAccountSpecs({
        env: {},
        args: { adminEmail: "admin@isp.example" },
        production: true,
      }),
    { code: "EXPLICIT_EMAIL_REQUIRED" },
  );
  // NODE_ENV=production lewat env juga dikenali.
  assert.throws(() => buildAccountSpecs({ env: { NODE_ENV: "production" } }), {
    code: "EXPLICIT_EMAIL_REQUIRED",
  });
  // Eksplisit tetapi masih @noc.local.
  for (const [adminEmail, viewerEmail] of [
    [DEFAULT_ADMIN_EMAIL, "viewer@isp.example"],
    ["admin@isp.example", "Lihat@NOC.local"],
  ])
    assert.throws(
      () =>
        buildAccountSpecs({
          env: {},
          args: { adminEmail, viewerEmail },
          production: true,
        }),
      { code: "RESERVED_EMAIL_IN_PRODUCTION" },
    );
  const ok = buildAccountSpecs({
    env: {},
    args: { adminEmail: "admin@isp.example", viewerEmail: "lihat@isp.example" },
    production: true,
  });
  assert.deepEqual(
    ok.map((spec) => spec.email),
    ["admin@isp.example", "lihat@isp.example"],
  );

  // seedAccounts memeriksa lagi sendiri, dan tidak menyentuh database.
  const defaults = buildAccountSpecs({ env: {}, args: {}, production: false });
  await rejectsWith(
    seedAccounts({ pool, accounts: defaults, now: NOW, production: true }),
    "RESERVED_EMAIL_IN_PRODUCTION",
  );
  assert.throws(() => validateAccountSpecs(defaults, { production: true }), {
    code: "RESERVED_EMAIL_IN_PRODUCTION",
  });
  assert.equal(
    await countUsers([DEFAULT_ADMIN_EMAIL, DEFAULT_VIEWER_EMAIL]),
    0,
  );

  // Bawaannya mengikuti NODE_ENV.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await rejectsWith(
      seedAccounts({ pool, accounts: defaults, now: NOW }),
      "RESERVED_EMAIL_IN_PRODUCTION",
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  // Di luar produksi email bawaan sah.
  assert.doesNotThrow(() =>
    validateAccountSpecs(defaults, { production: false }),
  );
});

test("parseArgs understands both option forms and refuses passwords and strangers", () => {
  const parsed = parseArgs([
    "--admin-email=a@example.com",
    "--viewer-email",
    "v@example.com",
    "--admin-name",
    "Admin Satu",
    "--viewer-name=Viewer Dua",
    "--reset-password",
    "admin",
    "--reset-password=viewer",
  ]);
  assert.equal(parsed.adminEmail, "a@example.com");
  assert.equal(parsed.viewerEmail, "v@example.com");
  assert.equal(parsed.adminName, "Admin Satu");
  assert.equal(parsed.viewerName, "Viewer Dua");
  assert.deepEqual([...parsed.reset].sort(), ["admin", "viewer"]);
  assert.deepEqual([...parseArgs(["--reset-password", "both"]).reset].sort(), [
    "admin",
    "viewer",
  ]);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.deepEqual(parseArgs([]).reset.size, 0);

  const secret = "RahasiaSekali-12345";
  for (const argv of [
    ["--admin-password", secret],
    [`--viewer-password=${secret}`],
    [`--password=${secret}`],
    [secret],
    ["--tidak-ada", secret],
    ["--admin-email"],
    ["--admin-email", "--viewer-email"],
    ["--reset-password", "semua"],
  ])
    assert.throws(
      () => parseArgs(argv),
      (error) => error.code === "USAGE" && !error.message.includes(secret),
      JSON.stringify(argv),
    );
});

// --- CLI ----------------------------------------------------------------

function cli(args, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["scripts/seed-accounts.mjs", ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        MIGRATION_DATABASE_URL: dbUrl,
        NODE_ENV: "test",
        SEED_ADMIN_EMAIL: "",
        SEED_VIEWER_EMAIL: "",
        SEED_ADMIN_NAME: "",
        SEED_VIEWER_NAME: "",
        SEED_ADMIN_PASSWORD: "",
        SEED_VIEWER_PASSWORD: "",
        ...env,
      },
      encoding: "utf8",
    },
  );
  return { ...result, all: `${result.stdout}${result.stderr}` };
}

function printedPassword(output, email) {
  const match = new RegExp(
    `^\\s+${email.replace(/[.@]/g, "\\$&")}\\s+([A-Za-z0-9]{24})$`,
    "m",
  ).exec(output);
  return match?.[1];
}

test("the CLI seeds, prints each new password once, and a rerun prints none", async () => {
  const id = token();
  const adminEmail = `cli-admin-${id}@example.com`;
  const viewerEmail = `cli-viewer-${id}@example.com`;
  const flags = [
    "--admin-email",
    adminEmail,
    "--viewer-email",
    viewerEmail,
    "--admin-name",
    "Admin CLI",
  ];

  const first = cli(flags);
  assert.equal(first.status, 0, first.all);
  assert.equal(first.stderr, "");
  const adminPassword = printedPassword(first.stdout, adminEmail);
  const viewerPassword = printedPassword(first.stdout, viewerEmail);
  assert.ok(adminPassword && viewerPassword, first.stdout);
  assert.equal(first.stdout.split(adminPassword).length - 1, 1);
  assert.equal(first.stdout.split(viewerPassword).length - 1, 1);
  assert.match(first.stdout, /dibuat/);
  assert.match(first.stdout, /ganti/i);
  assert.equal((await userOf(adminEmail)).name, "Admin CLI");
  assert.equal((await userOf(adminEmail)).role, "admin");
  assert.equal((await userOf(viewerEmail)).role, "user");
  assert.equal((await userOf(viewerEmail)).name, DEFAULT_VIEWER_NAME);
  const adminHash = await hashOf(adminEmail);
  assert.equal(
    await verifyPassword({ hash: adminHash, password: adminPassword }),
    true,
  );
  // Hash tidak pernah dicetak.
  for (const hash of [adminHash, await hashOf(viewerEmail)])
    for (const piece of hash.split(":")) assert.ok(!first.all.includes(piece));

  const second = cli(flags);
  assert.equal(second.status, 0, second.all);
  assert.match(second.stdout, /sudah ada/);
  assert.ok(!second.all.includes(adminPassword));
  assert.ok(!second.all.includes(viewerPassword));
  assert.ok(!/Kata sandi baru/.test(second.all));
  assert.equal(await hashOf(adminEmail), adminHash);

  // Reset hanya akun hanya-lihat: sandi baru dicetak, sesi lamanya dicabut.
  await addSession((await userOf(viewerEmail)).id);
  await addSession((await userOf(adminEmail)).id);
  const reset = cli([...flags, "--reset-password", "viewer"]);
  assert.equal(reset.status, 0, reset.all);
  const newViewer = printedPassword(reset.stdout, viewerEmail);
  assert.ok(newViewer && newViewer !== viewerPassword);
  assert.equal(printedPassword(reset.stdout, adminEmail), undefined);
  assert.equal(
    await verifyPassword({
      hash: await hashOf(viewerEmail),
      password: newViewer,
    }),
    true,
  );
  assert.equal(await sessionCount((await userOf(viewerEmail)).id), 0);
  assert.equal(await sessionCount((await userOf(adminEmail)).id), 1);
  assert.equal(await hashOf(adminEmail), adminHash);
});

test("the CLI never echoes a password taken from the environment", async () => {
  const id = token();
  const adminPassword = `Env-Admin-${id}-Sandi`;
  const viewerPassword = `Env-Viewer-${id}-Sandi`;
  const result = cli([], {
    SEED_ADMIN_EMAIL: `env-admin-${id}@example.com`,
    SEED_VIEWER_EMAIL: `env-viewer-${id}@example.com`,
    SEED_ADMIN_NAME: "Admin Env",
    SEED_VIEWER_NAME: "Viewer Env",
    SEED_ADMIN_PASSWORD: adminPassword,
    SEED_VIEWER_PASSWORD: viewerPassword,
  });
  assert.equal(result.status, 0, result.all);
  assert.ok(!result.all.includes(adminPassword));
  assert.ok(!result.all.includes(viewerPassword));
  assert.ok(!/Kata sandi baru/.test(result.all));
  assert.equal(
    await verifyPassword({
      hash: await hashOf(`env-admin-${id}@example.com`),
      password: adminPassword,
    }),
    true,
  );
  assert.equal(
    (await userOf(`env-viewer-${id}@example.com`)).name,
    "Viewer Env",
  );

  // Kata sandi pendek: galat tanpa nilainya, tanpa menyentuh database.
  const shortPassword = "pendek1";
  const bad = cli([], {
    SEED_ADMIN_EMAIL: `bad-admin-${id}@example.com`,
    SEED_VIEWER_EMAIL: `bad-viewer-${id}@example.com`,
    SEED_ADMIN_PASSWORD: shortPassword,
  });
  assert.notEqual(bad.status, 0);
  assert.ok(!bad.all.includes(shortPassword));
  assert.equal(await userOf(`bad-admin-${id}@example.com`), undefined);
});

test("the CLI exits non-zero without touching the database when input is refused", async () => {
  const before = (await pool.query('SELECT count(*)::int AS n FROM "user"'))
    .rows[0].n;
  const id = token();
  const cases = [
    // Produksi dengan email bawaan, dan dengan email bawaan yang eksplisit.
    cli([], { NODE_ENV: "production" }),
    cli(
      [
        "--admin-email",
        DEFAULT_ADMIN_EMAIL,
        "--viewer-email",
        `v-${id}@isp.example`,
      ],
      {
        NODE_ENV: "production",
      },
    ),
    // Email sama untuk keduanya.
    cli([
      "--admin-email",
      `sama-${id}@example.com`,
      "--viewer-email",
      `SAMA-${id}@example.com`,
    ]),
    cli(["--admin-email", "bukan-email"]),
    cli(["--admin-name", " "]),
    cli(["--admin-password", "RahasiaSekali-12345"]),
    cli(["--tidak-dikenal"]),
  ];
  for (const result of cases) {
    assert.notEqual(result.status, 0, result.all);
    assert.notEqual(result.stderr, "");
    assert.ok(!/Kata sandi baru/.test(result.all));
    assert.ok(!result.all.includes("RahasiaSekali-12345"));
  }
  assert.match(cases[0].stderr, /produksi/);
  assert.match(cases[1].stderr, /noc\.local/);
  assert.match(cases[2].stderr, /email yang sama/);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n,
    before,
  );
  const help = cli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /seed:accounts/);
});

test("the CLI stops with a clear error when the read-only email is an admin", async () => {
  const id = token();
  const accounts = specsFor(id);
  await seed([accounts[1]]);
  await setRole(accounts[1].email, "admin");
  const result = cli([
    "--admin-email",
    accounts[0].email,
    "--viewer-email",
    accounts[1].email,
  ]);
  assert.equal(result.status, 1, result.all);
  assert.match(result.stderr, /sudah berperan admin/);
  assert.ok(!/Kata sandi baru/.test(result.all));
  assert.equal((await userOf(accounts[1].email)).role, "admin");
  assert.equal(await userOf(accounts[0].email), undefined);
});

test("the CLI with an unreachable database fails with a message that hides the connection string", () => {
  const result = cli(
    ["--admin-email", "a@example.com", "--viewer-email", "v@example.com"],
    {
      DATABASE_URL:
        "postgresql://rahasia-user:rahasia-sandi@127.0.0.1:1/tidakada",
    },
  );
  assert.equal(result.status, 1);
  assert.ok(!result.all.includes("rahasia-sandi"));
  assert.ok(!result.all.includes("rahasia-user"));
  assert.ok(!/Kata sandi baru/.test(result.all));
});
