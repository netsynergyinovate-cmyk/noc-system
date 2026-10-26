import { getRawPool } from "@/db";
import { ApiError, readJson, withApiSession } from "@/lib/api";
import { isSuperAdmin } from "@/lib/roles";

export const runtime = "nodejs";

interface DeleteUserBody {
  userId: string;
}

/**
 * POST /api/settings/users/delete
 * Menghapus akun pengguna dari database secara permanen.
 * Khusus akun Super Admin.
 */
export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    const pool = getRawPool();

    // 1. Periksa peran asli pemanggil dari database
    const callerRes = await pool.query(
      'SELECT role FROM "user" WHERE id = $1',
      [session.user.id],
    );
    const callerRole = callerRes.rows[0]?.role ?? "user";

    if (!isSuperAdmin(callerRole)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya akun Super Admin yang berwenang menghapus akun pengguna.",
      );
    }

    // 2. Baca dan validasi payload
    const raw = await readJson(request);
    const body = raw as Partial<DeleteUserBody>;

    if (!body?.userId || typeof body.userId !== "string") {
      throw new ApiError(400, "BAD_REQUEST", "userId wajib diisi.");
    }

    // Tidak boleh menghapus diri sendiri yang sedang login
    if (body.userId === session.user.id) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Tidak dapat menghapus akun Anda sendiri yang sedang aktif digunakan.",
      );
    }

    // 3. Periksa akun target
    const targetRes = await pool.query(
      'SELECT id, email, role FROM "user" WHERE id = $1',
      [body.userId],
    );

    if (targetRes.rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Pengguna tidak ditemukan.");
    }

    const currentTargetRole = targetRes.rows[0].role;
    const targetEmail = targetRes.rows[0].email;

    // 4. Perlindungan Super Admin Terakhir
    if (isSuperAdmin(currentTargetRole)) {
      const saCountRes = await pool.query(
        "SELECT count(*)::int FROM \"user\" WHERE 'superadmin' = ANY(string_to_array(coalesce(role, ''), ','))",
      );
      const saCount = saCountRes.rows[0]?.count ?? 0;
      if (saCount <= 1) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "Tidak dapat menghapus Super Admin terakhir di sistem.",
        );
      }
    }

    // 5. Hapus akun pengguna (cascade ke session & account)
    await pool.query('DELETE FROM "user" WHERE id = $1', [body.userId]);

    return Response.json({
      success: true,
      message: `Akun ${targetEmail} berhasil dihapus dari sistem.`,
    });
  });
}
