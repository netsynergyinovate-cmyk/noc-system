import { withApiSession } from "@/lib/api";
import { getCompleteRealMapData } from "@/services/real-map-data.service";

export const runtime = "nodejs";

/**
 * GET /api/map/unified
 * Endpoint Data Peta Terpadu Operasional NOC
 * Mengembalikan kumpulan data spasial terpadu: Pelanggan, Infrastruktur, Jalur Kabel, Hierarki,
 * serta Metrik Telemetri dan Status Sumber Data PostgreSQL Live.
 */
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

    // Selalu ambil data nyata terpadu dari PostgreSQL operasional NOC (zero-dummy compliance)
    // Menghilangkan seluruh fallback data tiruan / mock di endpoint peta terpadu
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
