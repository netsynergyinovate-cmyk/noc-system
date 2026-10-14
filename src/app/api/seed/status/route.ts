import { withApiSession } from "@/lib/api";
import { getSeedDataStatus } from "@/services/seed-data.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const status = await getSeedDataStatus();
    return Response.json({ data: status });
  });
}
