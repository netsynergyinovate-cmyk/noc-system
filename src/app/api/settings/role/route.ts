import { getRawPool } from "@/db";
import { withApiSession } from "@/lib/api";
import { roleNames } from "@/lib/roles";

export const runtime = "nodejs";

/**
 * GET /api/settings/role
 * Memeriksa peran asli (real role) akun pengguna saat ini dari database PostgreSQL.
 */
export function GET(request: Request) {
  return withApiSession(request, async (session) => {
    const pool = getRawPool();
    const res = await pool.query(
      'SELECT id, name, email, role FROM "user" WHERE id = $1',
      [session.user.id],
    );

    const row = res.rows[0];
    const realRole = row?.role ?? "user";
    const isAdmin = roleNames(realRole).includes("admin");

    return Response.json({
      data: {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: realRole,
        isAdmin,
      },
    });
  });
}

/**
 * POST /api/settings/role
 * Mengubah peran akun pengguna di database PostgreSQL.
 * Mengatasi masalah peran terkunci atau pengguna yang ingin hak akses Admin penuh.
 */
export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    let body: { role?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Default ke admin jika tanpa body
    }

    const targetRole = body.role === "user" ? "user" : "admin";
    const pool = getRawPool();
    const res = await pool.query(
      'UPDATE "user" SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, email, role',
      [targetRole, session.user.id],
    );

    const updated = res.rows[0];

    return Response.json({
      data: {
        userId: updated?.id ?? session.user.id,
        email: updated?.email ?? session.user.email,
        role: updated?.role ?? targetRole,
        isAdmin: targetRole === "admin",
      },
      message:
        targetRole === "admin"
          ? "Akun Anda berhasil dipromosikan menjadi Administrator di database. Silakan muat ulang halaman untuk memperbarui sesi."
          : "Peran akun diubah menjadi Petugas (User).",
    });
  });
}
