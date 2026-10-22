import { withApiSession } from "@/lib/api";
import {
  customerExists,
  getCustomerLiveTraffic,
  getCustomerTrafficHistory,
} from "@/services/customer-traffic.service";
import { customerTrafficQuerySchema } from "@/validators/customer-traffic";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// GET /api/customers/{id}/traffic?range=live|24h|7d|30d
export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const { id, range } = customerTrafficQuerySchema.parse({
      id: (await context.params).id,
      range: new URL(request.url).searchParams.get("range") ?? undefined,
    });
    const customer = await customerExists(id);
    if (!customer) {
      return Response.json({ error: "Pelanggan tidak ditemukan." }, { status: 404 });
    }
    if (range !== "live") {
      return Response.json({ data: await getCustomerTrafficHistory(id, range) });
    }
    try {
      return Response.json({ data: await getCustomerLiveTraffic(customer) });
    } catch (err) {
      console.error("[CUSTOMER LIVE TRAFFIC]", err);
      return Response.json(
        { error: "Router pelanggan tidak bisa dibaca saat ini." },
        { status: 502 },
      );
    }
  });
}
