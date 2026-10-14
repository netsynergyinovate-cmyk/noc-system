import { withApiSession } from "@/lib/api";
import { getCustomerOnu } from "@/services/devices.service";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const customerId = oltIdSchema.parse((await context.params).id);
    const data = await getCustomerOnu(customerId);
    return Response.json({ data });
  });
}
