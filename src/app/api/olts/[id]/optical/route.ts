import { ApiError, withApiSession } from "@/lib/api";
import { getOltOpticalData } from "@/services/devices.service";
import { opticalFilterSchema } from "@/validators/devices";

export const runtime = "nodejs";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiSession(request, async () => {
    const { id } = await params;
    const parsed = opticalFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Parameter filter tidak valid.");
    const result = await getOltOpticalData(id, parsed.data.ponIndex);
    if (!result) throw new ApiError(404, "NOT_FOUND", "OLT tidak ditemukan.");
    return Response.json({ success: true, data: result });
  });
}
