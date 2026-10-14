import { ApiError, withApiPermission } from "@/lib/api";
import { autoMatchOnus, getOlt } from "@/services/devices.service";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Audit `onu-auto-matched` ditulis oleh service (satu transaksi dengan update).
export async function POST(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  return withApiPermission(request, { router: ["manage"] }, async (session) => {
    const id = oltIdSchema.parse(rawId);
    if (!(await getOlt(id))) throw new ApiError(404, "NOT_FOUND", "OLT tidak ditemukan.");
    return Response.json({ data: await autoMatchOnus(id, session.user.id) });
  });
}
