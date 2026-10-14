import { ApiError, withApiSession } from "@/lib/api";
import { getOltPonPort } from "@/services/devices.service";
import { oltIdSchema, ponIndexSchema } from "@/validators/devices";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; ponIndex: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const params = await context.params;
    const id = oltIdSchema.parse(params.id);
    const ponIndex = ponIndexSchema.parse(params.ponIndex);
    const result = await getOltPonPort(id, ponIndex);
    if (!result) throw new ApiError(404, "NOT_FOUND", "Port PON tidak ditemukan.");
    return Response.json({ data: result });
  });
}
