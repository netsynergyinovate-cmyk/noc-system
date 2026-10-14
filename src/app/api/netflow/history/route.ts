import { withApiSession } from "@/lib/api";
import { getFlowHistory } from "@/services/netflow.service";
import { parseNetflowQuery } from "@/validators/netflow";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const { range, routerId, protocol } = parseNetflowQuery(
      new URL(request.url).searchParams,
    );
    return Response.json({
      data: await getFlowHistory({ range, routerId, protocol }),
    });
  });
}
