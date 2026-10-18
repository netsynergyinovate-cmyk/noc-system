import { withApiSession } from "@/lib/api";
import { getMapLayersData } from "@/services/map-layers.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const layer = url.searchParams.get("layer");

    const data = await getMapLayersData({ layer });
    return Response.json({
      success: true,
      data,
    });
  });
}
