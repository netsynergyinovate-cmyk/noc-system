import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { geometryBodySchema } from "../schema";

export const runtime = "nodejs";

// Pratinjau snapping + panjang; tidak menyimpan apa pun
export function POST(request: Request) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const { geometry } = geometryBodySchema.parse(await readJson(request));

    try {
      const preview = await MapDataAdapter.previewSegment(geometry);
      return Response.json({
        data: {
          geometry: preview.geometry,
          snapped: preview.snapped,
          snapProvider: preview.snapProvider,
          reason: preview.reason,
          lengthM: preview.lengthM,
        },
      });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
