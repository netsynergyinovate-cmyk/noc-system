import { ApiError, withApiPermission } from "@/lib/api";
import { applyUndo } from "@/services/map/undo";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().uuid("ID undo tidak valid");

// Batalkan satu aksi tulis peta: baris dipulihkan ke keadaan sebelum aksi itu
export function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const id = idSchema.parse((await props.params).id);
    try {
      const label = await applyUndo(id);
      return Response.json({ data: { label } });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
