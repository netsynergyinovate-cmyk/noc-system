import { getRawPool } from "@/db";
import { withApiSession } from "@/lib/api";

export const runtime = "nodejs";

/**
 * GET /api/settings/users/overview
 * Menampilkan ringkasan daftar pengguna dan perannya di sistem.
 * Dapat diakses oleh semua pengguna yang login agar dapat melihat
 * siapa yang memegang peran superadmin, admin utama, dan user biasa.
 */
export function GET(request: Request) {
  return withApiSession(request, async () => {
    const pool = getRawPool();
    const res = await pool.query(
      'SELECT id, name, email, role, created_at FROM "user" ORDER BY CASE role WHEN \'superadmin\' THEN 1 WHEN \'admin\' THEN 2 ELSE 3 END, created_at ASC',
    );

    return Response.json({
      data: res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role ?? "user",
        createdAt: row.created_at,
      })),
    });
  });
}
