import { withApiSession } from "@/lib/api";
import {
  getMapMarkersData,
  type MapMarkersFilterOptions,
} from "@/services/map-markers.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const typeParam = url.searchParams.get("type");
    const statusParam = url.searchParams.get("status");
    const search = url.searchParams.get("search") || undefined;

    const filterOptions: MapMarkersFilterOptions = {
      type: (typeParam as MapMarkersFilterOptions["type"]) || "all",
      status: (statusParam as MapMarkersFilterOptions["status"]) || "all",
      search,
    };

    const data = await getMapMarkersData(filterOptions);
    return Response.json({
      success: true,
      data,
    });
  });
}
