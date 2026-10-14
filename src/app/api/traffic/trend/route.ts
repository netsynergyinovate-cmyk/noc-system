import { withApiSession } from "@/lib/api";
import { getTrafficTrendData } from "@/services/traffic.service";
import { parseTrafficTrendQuery } from "@/validators/traffic";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const query = parseTrafficTrendQuery(new URL(request.url).searchParams);
    const data = await getTrafficTrendData(query);
    return Response.json({ data });
  });
}
