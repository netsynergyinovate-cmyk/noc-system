import { ApiError, withApiSession } from "@/lib/api";
import { getOltLiveOnus } from "@/services/devices.service";
import { liveOnuFilterSchema } from "@/validators/devices";

export const runtime = "nodejs";

export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiSession(request, async () => {
    const { id } = await params;
    const parsed = liveOnuFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Parameter filter tidak valid.");
    const result = await getOltLiveOnus(id, parsed.data);
    if (!result) throw new ApiError(404, "NOT_FOUND", "OLT tidak ditemukan.");
    return Response.json({ success: true, data: result });
  });
}
