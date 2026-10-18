import { withApiSession } from "@/lib/api";
import { getCompleteRealMapData } from "@/services/real-map-data.service";
// Endpoint data peta terpadu operasional (mengintegrasikan getNetworkMapData dengan relasi kabel dan hierarki)

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const includeCables = url.searchParams.get("cables") !== "false";
    const includeHierarchy = url.searchParams.get("hierarchy") === "true";
    const search = url.searchParams.get("search") || undefined;
    const status = url.searchParams.get("status") as
      | "all"
      | "active"
      | "inactive"
      | "online"
      | "offline"
      | undefined;

    // Selalu ambil data nyata terpadu dari PostgreSQL operasional (zero-dummy compliance)
    // Menghilangkan seluruh fallback data tiruan / mock di endpoint peta
    const data = await getCompleteRealMapData({
      includeCables,
      includeHierarchy,
      searchQuery: search,
      statusFilter: status,
    });

    return Response.json({
      success: true,
      data,
    });
  });
}
