import { ApiError, withApiSession } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const data = await MapDataAdapter.getMapData();
      return Response.json({ data }, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
