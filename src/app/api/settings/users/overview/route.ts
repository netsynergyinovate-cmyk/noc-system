import { getRawPool } from "@/db";
import { withApiSession } from "@/lib/api";

export const runtime = "nodejs";

/**
 * GET /api/settings/users/overview
 * Menampilkan daftar pengguna, peran, tanggal terdaftar, dan metode login (provider).
 * Dapat diakses oleh semua pengguna yang login untuk melihat hierarki peran.
 */
export function GET(request: Request) {
  return withApiSession(request, async () => {
    const pool = getRawPool();
    const res = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              coalesce(string_agg(DISTINCT a.provider_id, ','), 'credential') as providers
       FROM "user" u
       LEFT JOIN "account" a ON u.id = a.user_id
       GROUP BY u.id, u.name, u.email, u.role, u.created_at
       ORDER BY CASE u.role WHEN 'superadmin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, u.created_at ASC`,
    );

    return Response.json({
      data: res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role ?? "user",
        providers: row.providers,
        createdAt: row.created_at,
      })),
    });
  });
}
