import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import {
  MAP_DATA_SOURCE_REGISTRY,
  getMapDataSourcesSummary,
  DATA_SOURCE_REGISTRY,
} from "@/lib/data-source-registry";
import { checkMapDatabaseHealth } from "@/services/real-map-data.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const health = await checkMapDatabaseHealth();
      const summary = getMapDataSourcesSummary();

      return NextResponse.json({
        success: true,
        registry: MAP_DATA_SOURCE_REGISTRY,
        dataSourceRegistry: DATA_SOURCE_REGISTRY,
        summary,
        databaseHealth: health,
      });
    } catch (error) {
      console.error("[MAP_DATA_SOURCE_REGISTRY_ERROR]", error);
      return NextResponse.json(
        {
          success: false,
          error: "Gagal memuat status registri sumber data peta.",
          message: error instanceof Error ? error.message : "Internal Server Error",
        },
        { status: 500 },
      );
    }
  });
}
