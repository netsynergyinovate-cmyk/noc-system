import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";
import { geometryBodySchema } from "../../../schema";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID wajib diisi");

// Rapikan titik belokan segmen yang sudah ada
export function PUT(
  request: Request,
  props: { params: Promise<{ id: string; segmentId: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const routeId = idSchema.parse(params.id);
    const segmentId = idSchema.parse(params.segmentId);
    const { geometry } = geometryBodySchema.parse(await readJson(request));

    try {
      const result = await MapDataAdapter.updateCableSegment(
        routeId,
        segmentId,
        geometry,
      );
      return Response.json({ data: result });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
