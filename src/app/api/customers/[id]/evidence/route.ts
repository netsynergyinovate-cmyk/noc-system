import { withApiSession } from "@/lib/api";
import { customerExists } from "@/services/customer-traffic.service";
import { getCustomerEvidence } from "@/services/customer-evidence.service";
import { customerEvidenceQuerySchema } from "@/validators/customer-evidence";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// GET /api/customers/{id}/evidence?range=24h|3d|7d|30d|90d
export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const { id, range } = customerEvidenceQuerySchema.parse({
      id: (await context.params).id,
      range: new URL(request.url).searchParams.get("range") ?? undefined,
    });
    const customer = await customerExists(id);
    if (!customer) {
      return Response.json(
        { error: "Pelanggan tidak ditemukan." },
        { status: 404 },
      );
    }
    const data = await getCustomerEvidence(id, range);
    return Response.json({ data });
  });
}
