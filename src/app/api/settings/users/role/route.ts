import { getRawPool } from "@/db";
import { ApiError, readJson, withApiSession } from "@/lib/api";
import { isPreviewableRole, isSuperAdmin, previewableRoles, roleLabel, type AppRole } from "@/lib/roles";

export const runtime = "nodejs";

interface SetRoleBody {
  userId: string;
  role: AppRole;
}

/**
 * POST /api/settings/users/role
 * Memperbarui peran akun pengguna di database.
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
        "Hanya akun Super Admin yang berwenang mengubah peran pengguna.",
      );
    }

    // 2. Baca dan validasi payload
    const raw = await readJson(request);
    const body = raw as Partial<SetRoleBody>;

    if (!body?.userId || typeof body.userId !== "string") {
      throw new ApiError(400, "BAD_REQUEST", "userId wajib diisi.");
    }

    const targetRole = body.role;
    if (!targetRole || !isPreviewableRole(targetRole)) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `Role harus salah satu dari: ${previewableRoles.join(", ")}.`,
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

    // 4. Perlindungan Super Admin Terakhir
    if (isSuperAdmin(currentTargetRole) && targetRole !== "superadmin") {
      const saCountRes = await pool.query(
        "SELECT count(*)::int FROM \"user\" WHERE 'superadmin' = ANY(string_to_array(coalesce(role, ''), ','))",
      );
      const saCount = saCountRes.rows[0]?.count ?? 0;
      if (saCount <= 1) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "Tidak dapat menurunkan peran Super Admin terakhir di sistem.",
        );
      }
    }

    // 5. Perbarui peran di PostgreSQL
    const updateRes = await pool.query(
      'UPDATE "user" SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role',
      [targetRole, body.userId],
    );

    const updated = updateRes.rows[0];

    return Response.json({
      success: true,
      data: updated,
      message: `Peran untuk ${updated.email} berhasil diubah menjadi ${roleLabel(targetRole)}.`,
    });
  });
}
