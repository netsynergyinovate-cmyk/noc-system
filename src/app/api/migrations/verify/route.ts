import { withApiPermission } from "@/lib/api";
import { verifyMigrationIdempotency } from "@/services/schema-migration-runner.service";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withApiPermission(request, { router: ["manage"] }, async () => {
    const result = await verifyMigrationIdempotency();
    return Response.json({ data: result });
  });
}
