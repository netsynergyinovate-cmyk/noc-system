import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID pelanggan wajib diisi");

const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90, "Latitude harus di antara -90 dan 90"),
  longitude: z
    .number()
    .min(-180)
    .max(180, "Longitude harus di antara -180 dan 180"),
  odpId: z.string().min(1).optional(),
});

export function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const id = idSchema.parse(params.id);
    const body = await readJson(request);
    const parsed = updateLocationSchema.parse(body);

    try {
      const undoId = await MapDataAdapter.updateCustomerLocation(
        id,
        parsed.latitude,
        parsed.longitude,
        parsed.odpId,
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
