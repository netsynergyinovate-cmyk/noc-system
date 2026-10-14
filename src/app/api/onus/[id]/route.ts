import { ApiError, withApiSession } from "@/lib/api";
import { getOnu } from "@/services/devices.service";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const id = oltIdSchema.parse((await context.params).id);
    const data = await getOnu(id);
    if (!data) throw new ApiError(404, "NOT_FOUND", "ONU tidak ditemukan.");
    return Response.json({ data });
  });
}
