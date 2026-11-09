import { withApiSession } from "@/lib/api";
import { filterSchemaMigrations } from "@/lib/dashboard/schema-migrations";
import { getRealSchemaMigrationsData } from "@/services/schema-migration-runner.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const statusParam = (url.searchParams.get("status") || "all") as
      "all" | "applied" | "pending" | "failed";
    const queryParam =
      url.searchParams.get("q") || url.searchParams.get("query") || "";

    const { overview, items } = await getRealSchemaMigrationsData();

    const filteredItems = filterSchemaMigrations(items, {
      status: statusParam,
      query: queryParam,
    });

    return Response.json({
      data: {
        overview,
        items: filteredItems,
        totalItems: items.length,
        filteredCount: filteredItems.length,
      },
    });
  });
}
