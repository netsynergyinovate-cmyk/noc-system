import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID perangkat wajib diisi");

const updateParentSchema = z.object({
  parentDeviceId: z.string().min(1).nullable(),
});

export function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const id = idSchema.parse(params.id);
    const body = await readJson(request);
    const parsed = updateParentSchema.parse(body);

    try {
      const undoId = await MapDataAdapter.updateDeviceParent(
        id,
        parsed.parentDeviceId,
      );

      return Response.json({ success: true, undoId }, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
