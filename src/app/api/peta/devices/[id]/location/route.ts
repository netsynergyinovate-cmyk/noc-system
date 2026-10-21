import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID perangkat wajib diisi");

const updateDeviceLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const id = idSchema.parse(params.id);
    const body = await readJson(request);
    const parsed = updateDeviceLocationSchema.parse(body);

    try {
      const undoId = await MapDataAdapter.updateDeviceLocation(
        id,
        parsed.latitude,
        parsed.longitude,
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
