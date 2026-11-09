import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };
process.env.ALLOW_SIGN_UP ??= "true";
import { register } from "tsx/esm/api";
register();

import test from "node:test";
import assert from "node:assert/strict";
const { auth } = await import("../src/lib/auth.ts");
const { roles, ADMIN_ROLES, DEFAULT_ROLE } =
  await import("../src/lib/permissions.ts");
const { isSuperAdmin, isAdmin, isStrictAdmin, isUser, roleLabel } =
  await import("../src/lib/roles.ts");
const { Pool } = await import("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

test(
  "E2E Role & Auth: Superadmin kontrol penuh, Admin ditolak ubah peran, User baru otomatis role user",
  {
    skip: !process.env.STARTER_TEST_RUN && !process.env.DATABASE_URL,
  },
  async () => {
    const timestamp = Date.now();
    const superadminEmail = `superadmin-${timestamp}@noc.local`;
    const adminEmail = `admin-${timestamp}@noc.local`;
    const userEmail = `user-${timestamp}@noc.local`;
    const password = "TestPassword-123!";

    // 1. Buat akun Superadmin awal dan set perannya di DB
    const saCreated = await auth.api.signUpEmail({
      body: { email: superadminEmail, password, name: "Super Admin Owner" },
    });
    await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [
      "superadmin",
      saCreated.user.id,
    ]);

    // Login Superadmin untuk mendapatkan sesi
    const saRes = await auth.api.signInEmail({
      body: { email: superadminEmail, password },
      asResponse: true,
    });
    const saCookie = saRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const saHeaders = new Headers({
      cookie: saCookie,
    });

    // 2. Superadmin membuat akun Admin melalui admin API (createUser)
    const adminCreated = await auth.api.createUser({
      headers: saHeaders,
      body: {
        name: "Admin Assistant NOC",
        email: adminEmail,
        password,
        role: "admin",
      },
    });

    assert.ok(adminCreated?.user?.id, "Admin berhasil dibuat oleh Superadmin");
    assert.equal(
      adminCreated.user.role,
      "admin",
      "Akun yang dibuat Superadmin harus tersimpan dengan role admin",
    );

    // Periksa langsung di database PostgreSQL
    const dbAdmin = await pool.query(
      'SELECT id, email, role FROM "user" WHERE id = $1',
      [adminCreated.user.id],
    );
    assert.equal(
      dbAdmin.rows[0].role,
      "admin",
      "Role admin tersimpan di PostgreSQL",
    );
    assert.equal(isAdmin("admin"), true);
    assert.equal(isStrictAdmin("admin"), true);
    assert.equal(isSuperAdmin("admin"), false);
    assert.equal(roleLabel("admin"), "Admin");

    // 3. Login sebagai Admin
    const adminRes = await auth.api.signInEmail({
      body: { email: adminEmail, password },
      asResponse: true,
    });
    const adminCookie = adminRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const adminHeaders = new Headers({
      cookie: adminCookie,
    });

    // 4. Pengujian Keamanan: Admin TIDAK BOLEH mengubah peran (set-role)
    // Admin mencoba menaikkan dirinya sendiri atau akun lain jadi superadmin/admin -> HARUS GAGAL
    let adminSetRoleFailed = false;
    try {
      const res = await auth.api.setRole({
        headers: adminHeaders,
        body: {
          userId: adminCreated.user.id,
          role: "superadmin",
        },
      });
      // Bila API mengembalikan error object atau melempar
      if (res?.error || res?.status === 403) {
        adminSetRoleFailed = true;
      }
    } catch (err) {
      adminSetRoleFailed = true;
    }
    assert.equal(
      adminSetRoleFailed,
      true,
      "Admin HARUS ditolak saat mencoba setRole (403 / unauthorized)",
    );

    // Pastikan role di database TIDAK berubah
    const dbAdminCheck = await pool.query(
      'SELECT role FROM "user" WHERE id = $1',
      [adminCreated.user.id],
    );
    assert.equal(
      dbAdminCheck.rows[0].role,
      "admin",
      "Role admin tetap tidak berubah",
    );

    // 5. Pendaftaran mandiri (buat akun publik) otomatis mendapat role 'user'
    const publicUser = await auth.api.signUpEmail({
      body: { email: userEmail, password, name: "Petugas Lapangan" },
    });
    assert.equal(
      publicUser.user.role,
      "user",
      "Akun baru dari buat akun harus mendapat role 'user'",
    );

    const dbUser = await pool.query('SELECT role FROM "user" WHERE id = $1', [
      publicUser.user.id,
    ]);
    assert.equal(dbUser.rows[0].role, "user");
    assert.equal(isUser("user"), true);
    assert.equal(isAdmin("user"), false);
    assert.equal(isSuperAdmin("user"), false);

    // 6. Superadmin berhasil mengubah peran user menjadi admin
    const roleUpdateResult = await auth.api.setRole({
      headers: saHeaders,
      body: {
        userId: publicUser.user.id,
        role: "admin",
      },
    });
    assert.ok(!roleUpdateResult?.error, "Superadmin sukses mengubah peran");

    const dbUserPromoted = await pool.query(
      'SELECT role FROM "user" WHERE id = $1',
      [publicUser.user.id],
    );
    assert.equal(
      dbUserPromoted.rows[0].role,
      "admin",
      "User berhasil dipromosikan ke admin oleh Superadmin",
    );

    // 7. Cleanup
    const ids = [saCreated.user.id, adminCreated.user.id, publicUser.user.id];
    for (const id of ids) {
      await pool.query('DELETE FROM "session" WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM "account" WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [id]);
    }
    await pool.end();
  },
);
