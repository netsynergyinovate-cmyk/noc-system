import { withApiSession } from "@/lib/api";
import {
  getMigrationHistoryRecords,
  getRealSchemaMigrationsData,
} from "@/services/schema-migration-runner.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    if (url.searchParams.get("raw") === "true") {
      const raw = await getMigrationHistoryRecords();
      return Response.json({ data: raw });
    }
    const { items } = await getRealSchemaMigrationsData();
    return Response.json({ data: items });
  });
}
