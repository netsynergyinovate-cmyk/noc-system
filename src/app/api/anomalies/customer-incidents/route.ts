import { withApiSession } from "@/lib/api";
import { listCustomerIncidentRows } from "@/services/customer-incidents.service";
import { customerIncidentsQuerySchema } from "@/validators/customer-incidents";

export const runtime = "nodejs";

// GET /api/anomalies/customer-incidents?range=24h|3d|7d|30d|90d
export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const { range } = customerIncidentsQuerySchema.parse({
      range: url.searchParams.get("range") ?? undefined,
    });
    const data = await listCustomerIncidentRows(range);
    return Response.json({ data });
  });
}
