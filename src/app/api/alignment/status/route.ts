import { withApiSession } from "@/lib/api";
import { getAlignmentStatusAndHistory } from "@/services/data-alignment.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const status = await getAlignmentStatusAndHistory();
    return Response.json({ data: status });
  });
}
