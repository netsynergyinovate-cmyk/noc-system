// Inti skrip `npm run seed:accounts`: membuat dua akun siap pakai (satu admin,
// satu hanya-lihat) langsung di database. Dipisah dari CLI supaya bisa dites
// (tests/seed-accounts.test.mjs, e2e/seed-accounts.spec.ts). Satu-satunya efek
// samping modul ini adalah menulis ke `pool` yang diberikan; ia tidak membaca
// berkas, tidak mencetak apa pun, dan tidak pernah menyimpan kata sandi.
//
// Peran (src/lib/permissions.ts):
//   - admin   -> peran `admin`: boleh mengubah data (router, alert, CPE).
//   - viewer  -> peran bawaan `user`: tanpa satu pun izin mengubah.
//
// Kata sandi di-hash dengan fungsi milik Better Auth sendiri (scrypt, format
// `salt:key`), jadi POST /api/auth/sign-in/email menerimanya tanpa jalan lain.
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";

/**
 * @typedef {"admin" | "viewer"} AccountKind
 *
 * @typedef {object} AccountSpec
 * @property {AccountKind} kind
 * @property {string} email
 * @property {string} name
 * @property {string} [password] Kata sandi pilihan operator. Bila kosong, dibuat acak.
 * @property {boolean} [resetPassword] Ganti kata sandi akun yang sudah ada.
 *
 * @typedef {object} SeedResult
 * @property {AccountKind} kind
 * @property {string} email
 * @property {string} name
 * @property {string | null} role Peran akhir di database.
 * @property {"created" | "exists" | "reset"} status
 * @property {boolean} roleChanged
 * @property {boolean} credentialAdded Akun lama belum punya kata sandi masuk, lalu dibuatkan.
 * @property {string} [generatedPassword] Hanya ada bila kata sandi DIBUAT ACAK oleh run ini.
 * @property {string[]} warnings
 */

export const DEFAULT_ADMIN_EMAIL = "admin@noc.local";
export const DEFAULT_VIEWER_EMAIL = "viewer@noc.local";
export const DEFAULT_ADMIN_NAME = "Admin NOC";
export const DEFAULT_VIEWER_NAME = "Petugas Hanya Lihat";
// Domain cadangan untuk email bawaan. Tidak boleh dipakai di produksi.
export const RESERVED_EMAIL_DOMAIN = "noc.local";

// Sama dengan emailAndPassword di src/lib/auth.ts.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const GENERATED_PASSWORD_LENGTH = 24;
// Tanpa karakter yang mudah tertukar: 0 O o, 1 l I.
export const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

// Peran tiap jenis akun. Hanya-lihat memakai peran bawaan `user`, yang
// sengaja kosong di permissions.ts.
export const ROLE_BY_KIND = Object.freeze({ admin: "admin", viewer: "user" });
const KINDS = Object.keys(ROLE_BY_KIND);

export class SeedError extends Error {
  /**
   * @param {string} code
   * @param {string} message Tidak boleh memuat kata sandi.
   */
  constructor(code, message) {
    super(message);
    this.name = "SeedError";
    this.code = code;
    /** @type {SeedResult[]} Akun yang sudah tersimpan sebelum galat ini. */
    this.completed = [];
  }
}

// --- Kata sandi ---------------------------------------------------------

/**
 * Kata sandi acak dari crypto.randomBytes: tiap karakter dipilih seragam
 * (nilai byte yang membuat condong ke karakter awal dibuang), dan harus memuat
 * huruf besar, huruf kecil, dan angka.
 */
export function generatePassword(length = GENERATED_PASSWORD_LENGTH) {
  if (
    !Number.isInteger(length) ||
    length < GENERATED_PASSWORD_LENGTH ||
    length > MAX_PASSWORD_LENGTH
  )
    throw new RangeError(
      `Panjang kata sandi acak harus ${GENERATED_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH}.`,
    );
  const size = PASSWORD_ALPHABET.length;
  const limit = Math.floor(256 / size) * size;
  for (;;) {
    let password = "";
    while (password.length < length) {
      for (const byte of randomBytes(length * 2)) {
        if (byte >= limit) continue;
        password += PASSWORD_ALPHABET[byte % size];
        if (password.length === length) break;
      }
    }
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password))
      return password;
  }
}

/** Kata sandi pilihan operator: hanya panjangnya yang diperiksa (seperti auth.ts). */
export function validatePassword(value, label = "Kata sandi") {
  if (
    typeof value !== "string" ||
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > MAX_PASSWORD_LENGTH
  )
    throw new SeedError(
      "INVALID_PASSWORD",
      `${label} harus ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} karakter.`,
    );
  return value;
}

// --- Email dan nama -----------------------------------------------------

export function normalizeEmail(value, label = "Email") {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  // Aturan yang sama dengan yang dipakai Better Auth saat masuk: email yang
  // lolos di sini pasti bisa dipakai untuk login.
  if (!email || email.length > 254 || !z.email().safeParse(email).success)
    throw new SeedError(
      "INVALID_EMAIL",
      `${label} bukan alamat email yang sah.`,
    );
  return email;
}

export function normalizeName(value, label = "Nama") {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 100 || /\p{Cc}/u.test(name))
    throw new SeedError(
      "INVALID_NAME",
      `${label} harus 1-100 karakter tanpa karakter kendali.`,
    );
  return name;
}

function isReservedEmail(email) {
  return email.endsWith(`@${RESERVED_EMAIL_DOMAIN}`);
}

// --- Spesifikasi akun ---------------------------------------------------

/**
 * Memeriksa dan merapikan daftar akun. Dipanggil lagi oleh seedAccounts, jadi
 * larangan produksi dan email kembar tidak bisa dilewati oleh pemanggil.
 *
 * @param {AccountSpec[]} accounts
 * @param {{ production?: boolean }} [options]
 * @returns {AccountSpec[]}
 */
export function validateAccountSpecs(
  accounts,
  { production = process.env.NODE_ENV === "production" } = {},
) {
  if (!Array.isArray(accounts) || accounts.length === 0)
    throw new SeedError("NO_ACCOUNTS", "Tidak ada akun yang harus dibuat.");
  const seen = new Set();
  return accounts.map((account) => {
    if (!KINDS.includes(account?.kind))
      throw new SeedError(
        "INVALID_KIND",
        `Jenis akun harus salah satu dari: ${KINDS.join(", ")}.`,
      );
    if (seen.has(account.kind))
      throw new SeedError(
        "DUPLICATE_KIND",
        `Jenis akun ${account.kind} disebut dua kali.`,
      );
    seen.add(account.kind);
    const label = account.kind === "admin" ? "admin" : "hanya-lihat";
    const email = normalizeEmail(account.email, `Email ${label}`);
    const spec = {
      kind: account.kind,
      email,
      name: normalizeName(account.name, `Nama ${label}`),
      resetPassword: account.resetPassword === true,
    };
    if (production && isReservedEmail(email))
      throw new SeedError(
        "RESERVED_EMAIL_IN_PRODUCTION",
        `Email @${RESERVED_EMAIL_DOMAIN} (email bawaan) tidak boleh dipakai di produksi. Isi email ${label} yang sebenarnya.`,
      );
    if (account.password !== undefined)
      spec.password = validatePassword(account.password, `Kata sandi ${label}`);
    return spec;
  });
}

// Email dibandingkan sesudah dirapikan, jadi Admin@x.id dan admin@x.id sama.
function assertDistinctEmails(specs) {
  const emails = new Set(specs.map((spec) => spec.email));
  if (emails.size !== specs.length)
    throw new SeedError(
      "SAME_EMAIL",
      "Akun admin dan hanya-lihat tidak boleh memakai email yang sama.",
    );
}

const FLAGS = {
  "admin-email": "adminEmail",
  "viewer-email": "viewerEmail",
  "admin-name": "adminName",
  "viewer-name": "viewerName",
  "reset-password": "reset",
};

export const USAGE = `Pemakaian: npm run seed:accounts -- [pilihan]

Membuat dua akun siap pakai: admin (boleh mengubah data) dan hanya-lihat.
Akun yang sudah ada tidak diubah kata sandinya.

Pilihan (atau variabel lingkungan di kurung):
  --admin-email <email>    (SEED_ADMIN_EMAIL)    bawaan ${DEFAULT_ADMIN_EMAIL}
  --viewer-email <email>   (SEED_VIEWER_EMAIL)   bawaan ${DEFAULT_VIEWER_EMAIL}
  --admin-name <nama>      (SEED_ADMIN_NAME)     bawaan "${DEFAULT_ADMIN_NAME}"
  --viewer-name <nama>     (SEED_VIEWER_NAME)    bawaan "${DEFAULT_VIEWER_NAME}"
  --reset-password <admin|viewer|both>
                           buat kata sandi BARU untuk akun yang sudah ada dan
                           cabut semua sesi lamanya
  --help                   tampilkan bantuan ini

Kata sandi: isi SEED_ADMIN_PASSWORD / SEED_VIEWER_PASSWORD (8-128 karakter)
atau biarkan kosong agar dibuat acak dan dicetak SEKALI di akhir. Kata sandi
sengaja tidak diterima lewat argumen karena terlihat di daftar proses.

NODE_ENV=production: email bawaan (@${RESERVED_EMAIL_DOMAIN}) ditolak, email
admin dan hanya-lihat harus diisi eksplisit.`;

/**
 * @param {string[]} argv Argumen tanpa node dan nama skrip.
 * @returns {{ help?: boolean, adminEmail?: string, viewerEmail?: string, adminName?: string, viewerName?: string, reset: Set<AccountKind> }}
 */
export function parseArgs(argv) {
  const parsed = { reset: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { ...parsed, help: true };
    const match = /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(arg);
    // Nilai yang tidak dikenal tidak ditampilkan: bisa saja itu kata sandi.
    if (!match)
      throw new SeedError(
        "USAGE",
        "Argumen tidak dikenal (nilainya tidak ditampilkan). Lihat --help.",
      );
    const [, flag, inline] = match;
    if (/password/.test(flag) && flag !== "reset-password")
      throw new SeedError(
        "USAGE",
        "Kata sandi tidak diterima lewat argumen karena terlihat di daftar proses dan riwayat shell. Isi SEED_ADMIN_PASSWORD atau SEED_VIEWER_PASSWORD, atau biarkan kosong agar dibuat acak.",
      );
    const key = FLAGS[flag];
    if (!key)
      throw new SeedError(
        "USAGE",
        `Pilihan --${flag} tidak dikenal. Lihat --help.`,
      );
    let value = inline;
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new SeedError("USAGE", `Pilihan --${flag} butuh nilai.`);
      index += 1;
    }
    if (key === "reset") {
      if (!["admin", "viewer", "both"].includes(value))
        throw new SeedError(
          "USAGE",
          "--reset-password harus berisi admin, viewer, atau both.",
        );
      for (const kind of value === "both" ? KINDS : [value])
        parsed.reset.add(kind);
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

const filled = (value) =>
  value === undefined || value === "" ? undefined : value;

/**
 * Menggabungkan argumen, variabel lingkungan, dan bawaan (urutan itu) menjadi
 * dua spesifikasi akun yang sudah diperiksa.
 *
 * @param {{ env?: NodeJS.ProcessEnv | Record<string, string | undefined>, args?: Partial<ReturnType<typeof parseArgs>>, production?: boolean }} [options]
 * @returns {AccountSpec[]}
 */
export function buildAccountSpecs({
  env = process.env,
  args = {},
  production = env.NODE_ENV === "production",
} = {}) {
  const adminEmail = filled(args.adminEmail) ?? filled(env.SEED_ADMIN_EMAIL);
  const viewerEmail = filled(args.viewerEmail) ?? filled(env.SEED_VIEWER_EMAIL);
  if (production && (adminEmail === undefined || viewerEmail === undefined))
    throw new SeedError(
      "EXPLICIT_EMAIL_REQUIRED",
      "Di produksi email admin dan hanya-lihat harus diisi eksplisit (--admin-email dan --viewer-email, atau SEED_ADMIN_EMAIL dan SEED_VIEWER_EMAIL).",
    );
  const reset = args.reset ?? new Set();
  const specs = validateAccountSpecs(
    [
      {
        kind: "admin",
        email: adminEmail ?? DEFAULT_ADMIN_EMAIL,
        name:
          filled(args.adminName) ??
          filled(env.SEED_ADMIN_NAME) ??
          DEFAULT_ADMIN_NAME,
        password: filled(env.SEED_ADMIN_PASSWORD),
        resetPassword: reset.has("admin"),
      },
      {
        kind: "viewer",
        email: viewerEmail ?? DEFAULT_VIEWER_EMAIL,
        name:
          filled(args.viewerName) ??
          filled(env.SEED_VIEWER_NAME) ??
          DEFAULT_VIEWER_NAME,
        password: filled(env.SEED_VIEWER_PASSWORD),
        resetPassword: reset.has("viewer"),
      },
    ],
    { production },
  );
  assertDistinctEmails(specs);
  return specs;
}

// --- Peran --------------------------------------------------------------

const rolesOf = (role) =>
  (role ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * Peran yang harus dimiliki akun yang SUDAH ada.
 *   - admin: tetap admin bila sudah memuat `admin`; selain itu dinaikkan.
 *   - viewer: tidak boleh memuat `admin` (dihentikan, tidak diturunkan diam-
 *     diam), dan tidak boleh berperan selain `user`; kosong menjadi `user`.
 *
 * @param {AccountKind} kind
 * @param {string | null | undefined} current
 * @returns {{ role: string, changed: boolean }}
 */
export function decideRole(kind, current) {
  const roles = rolesOf(current);
  if (kind === "admin") {
    if (roles.includes("admin")) return { role: current, changed: false };
    return { role: "admin", changed: true };
  }
  if (roles.includes("admin"))
    throw new SeedError(
      "VIEWER_IS_ADMIN",
      "Email hanya-lihat ini sudah berperan admin. Seed tidak menurunkan peran diam-diam: pakai email lain untuk akun hanya-lihat, atau turunkan dulu dengan `npm run role:set -- <email> user` bila memang disengaja.",
    );
  if (roles.some((name) => name !== "user"))
    throw new SeedError(
      "VIEWER_ROLE_NOT_READ_ONLY",
      `Email hanya-lihat ini berperan "${current}", bukan hanya-lihat. Pakai email lain, atau setel dengan \`npm run role:set -- <email> user\` bila memang disengaja.`,
    );
  if (current === "user") return { role: "user", changed: false };
  return { role: "user", changed: true };
}

// --- Database -----------------------------------------------------------

const RETRY = Symbol("retry");

async function seedInTransaction(client, spec, now) {
  const { rows } = await client.query(
    'SELECT id, role, banned FROM "user" WHERE lower(email) = $1 FOR UPDATE',
    [spec.email],
  );
  if (rows.length > 1)
    throw new SeedError(
      "AMBIGUOUS_EMAIL",
      `Ada lebih dari satu akun dengan email ${spec.email} (beda huruf besar-kecil). Rapikan dulu secara manual.`,
    );
  const supplied = spec.password !== undefined;
  const role = ROLE_BY_KIND[spec.kind];

  if (rows.length === 0) {
    const password = supplied ? spec.password : generatePassword();
    const hash = await hashPassword(password);
    const id = randomUUID();
    const inserted = await client.query(
      `INSERT INTO "user" (id, name, email, email_verified, role, banned, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, false, $5, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [id, spec.name, spec.email, role, now],
    );
    // Run lain menyisipkan email yang sama lebih dulu: ulangi sebagai "sudah ada".
    if (inserted.rowCount === 0) return RETRY;
    await client.query(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
      [randomUUID(), id, hash, now],
    );
    return {
      kind: spec.kind,
      email: spec.email,
      name: spec.name,
      role,
      status: "created",
      roleChanged: false,
      credentialAdded: false,
      ...(supplied ? {} : { generatedPassword: password }),
      warnings: [],
    };
  }

  const existing = rows[0];
  const warnings = [];
  const decision = decideRole(spec.kind, existing.role);
  if (decision.changed)
    await client.query(
      'UPDATE "user" SET role = $2, updated_at = $3 WHERE id = $1',
      [existing.id, decision.role, now],
    );
  if (existing.banned)
    warnings.push(
      "Akun ini diblokir (banned) sehingga tidak bisa masuk. Seed tidak mengubah status blokir.",
    );

  const credentials = await client.query(
    "SELECT id, password FROM account WHERE user_id = $1 AND provider_id = 'credential' FOR UPDATE",
    [existing.id],
  );
  const hasPassword = credentials.rows.some((row) => row.password);
  const reset = spec.resetPassword === true;
  let generatedPassword;
  if (reset || !hasPassword) {
    // Kata sandi lama hanya ditimpa atas permintaan eksplisit (--reset-password).
    const password = supplied ? spec.password : generatePassword();
    const hash = await hashPassword(password);
    if (!supplied) generatedPassword = password;
    if (credentials.rows.length > 0)
      await client.query(
        "UPDATE account SET password = $1, updated_at = $2 WHERE user_id = $3 AND provider_id = 'credential'",
        [hash, now, existing.id],
      );
    else
      await client.query(
        `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
        [randomUUID(), existing.id, hash, now],
      );
  }
  // Kata sandi baru berarti sesi lama tidak boleh hidup lagi.
  if (reset)
    await client.query("DELETE FROM session WHERE user_id = $1", [existing.id]);

  return {
    kind: spec.kind,
    email: spec.email,
    name: spec.name,
    role: decision.role,
    status: reset ? "reset" : "exists",
    roleChanged: decision.changed,
    credentialAdded: !hasPassword,
    ...(generatedPassword === undefined ? {} : { generatedPassword }),
    warnings,
  };
}

async function seedOne(pool, spec, now) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const outcome = await seedInTransaction(client, spec, now);
      if (outcome === RETRY) {
        await client.query("ROLLBACK");
        continue;
      }
      await client.query("COMMIT");
      return outcome;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      throw error;
    } finally {
      client.release(broken);
    }
  }
  throw new SeedError(
    "CONFLICT",
    `Akun ${spec.email} berubah terus selagi dibuat. Jalankan lagi.`,
  );
}

/**
 * Membuat (atau memeriksa) akun-akun di database. Satu transaksi per akun.
 * Akun yang sudah ada tidak ditimpa kata sandinya; lihat decideRole untuk
 * aturan peran. Bila sebuah akun gagal, akun sebelumnya tetap tersimpan dan
 * dilaporkan lewat `error.completed` supaya kata sandi acaknya tidak hilang.
 *
 * @param {object} options
 * @param {import("pg").Pool} options.pool
 * @param {AccountSpec[]} options.accounts
 * @param {Date} [options.now] Waktu untuk created_at/updated_at.
 * @param {boolean} [options.production] Bawaan: NODE_ENV === "production".
 * @returns {Promise<SeedResult[]>}
 */
export async function seedAccounts({
  pool,
  accounts,
  now = new Date(),
  production = process.env.NODE_ENV === "production",
}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime()))
    throw new TypeError("`now` harus berupa Date yang sah.");
  const specs = validateAccountSpecs(accounts, { production });
  assertDistinctEmails(specs);

  // Periksa dulu semua aturan peran sebelum menulis apa pun, supaya akun
  // hanya-lihat yang ternyata admin tidak menyisakan admin baru tanpa kata
  // sandi yang tercetak.
  for (const spec of specs) {
    const { rows } = await pool.query(
      'SELECT role FROM "user" WHERE lower(email) = $1',
      [spec.email],
    );
    if (rows.length === 1) decideRole(spec.kind, rows[0].role);
  }

  /** @type {SeedResult[]} */
  const results = [];
  try {
    for (const spec of specs) results.push(await seedOne(pool, spec, now));
  } catch (error) {
    if (error && typeof error === "object") error.completed = results;
    throw error;
  }
  return results;
}

// --- Ringkasan ----------------------------------------------------------

/**
 * Teks ringkasan untuk dicetak. Satu-satunya rahasia yang boleh ada di
 * dalamnya adalah kata sandi yang DIBUAT run ini; hash tidak pernah dicetak.
 *
 * @param {SeedResult[]} results
 * @returns {string[]}
 */
export function formatSummary(results) {
  const lines = ["Akun NOC:"];
  for (const result of results) {
    const notes = [];
    if (result.status === "created") notes.push("dibuat");
    else {
      notes.push("sudah ada");
      if (result.status === "reset")
        notes.push("kata sandi diganti, semua sesi lamanya dicabut");
      else notes.push("kata sandi tidak diubah");
      if (result.credentialAdded && result.status !== "reset")
        notes.push("belum punya kata sandi masuk, sudah dibuatkan");
      if (result.roleChanged) notes.push(`peran disetel ke ${result.role}`);
    }
    lines.push(
      `  ${result.kind.padEnd(6)} ${result.email}  peran ${result.role ?? "(bawaan)"}  ${notes.join("; ")}`,
    );
    for (const warning of result.warnings)
      lines.push(`         Peringatan: ${warning}`);
  }
  const fresh = results.filter((result) => result.generatedPassword);
  if (fresh.length > 0) {
    lines.push(
      "",
      "Kata sandi baru (hanya tampil sekarang; tidak disimpan di berkas, log, atau database selain hash):",
    );
    for (const result of fresh)
      lines.push(`  ${result.email}  ${result.generatedPassword}`);
    lines.push(
      "Simpan di pengelola kata sandi dan ganti setelah masuk pertama kali.",
    );
  }
  return lines;
}
