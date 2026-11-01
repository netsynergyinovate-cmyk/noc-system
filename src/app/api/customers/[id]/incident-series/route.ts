import { withApiSession } from "@/lib/api";
import { customerExists } from "@/services/customer-traffic.service";
import { getIncidentSeries } from "@/services/customer-incidents.service";
import { incidentSeriesQuerySchema } from "@/validators/customer-incidents";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// GET /api/customers/{id}/incident-series?from=<sec>&to=<sec|open>
export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const { id, from, to } = incidentSeriesQuerySchema.parse({
      id: (await context.params).id,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    const customer = await customerExists(id);
    if (!customer) {
      return Response.json(
        { error: "Pelanggan tidak ditemukan." },
        { status: 404 },
      );
    }
    const data = await getIncidentSeries(id, from, to);
    return Response.json({ data });
  });
}
