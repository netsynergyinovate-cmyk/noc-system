import { withApiSession } from "@/lib/api";
import { getNetflowStatus } from "@/services/netflow.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    return Response.json({ data: await getNetflowStatus() });
  });
}
