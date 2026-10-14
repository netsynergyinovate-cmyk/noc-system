import { withApiSession } from "@/lib/api";
import { getSchemaMigrationStatus } from "@/services/schema-migration-runner.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const status = await getSchemaMigrationStatus();
    return Response.json({ data: status });
  });
}
