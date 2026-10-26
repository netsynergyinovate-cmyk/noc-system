import { getRawPool } from "@/db";
import { withApiSession } from "@/lib/api";
import { roleNames } from "@/lib/roles";

export const runtime = "nodejs";

/**
 * GET /api/settings/role
 * Memeriksa peran asli (real role) akun pengguna saat ini dari database PostgreSQL.
 * Tidak ada POST: peran hanya diubah lewat `npm run role:set` di server, supaya
 * akun biasa tidak bisa mempromosikan dirinya sendiri.
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
    const names = roleNames(realRole);
    const isSuperAdmin = names.includes("superadmin");
    const isAdmin = isSuperAdmin || names.includes("admin");
    const isUser = !isSuperAdmin && !names.includes("admin");

    return Response.json({
      data: {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: realRole,
        isSuperAdmin,
        isAdmin,
        isUser,
      },
    });
  });
}
