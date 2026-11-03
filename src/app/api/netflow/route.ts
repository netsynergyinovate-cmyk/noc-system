import { withApiSession } from "@/lib/api";
import { getTopFlows } from "@/services/netflow.service";
import { parseNetflowQuery } from "@/validators/netflow";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const parsed = parseNetflowQuery(new URL(request.url).searchParams);
    return Response.json({ data: await getTopFlows(parsed) });
  });
}
