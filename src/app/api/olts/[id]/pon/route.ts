import { ApiError, withApiSession } from "@/lib/api";
import { getOltPonPorts } from "@/services/devices.service";

export const runtime = "nodejs";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    const { id } = await params;
    const ports = await getOltPonPorts(id);
    if (!ports) throw new ApiError(404, "NOT_FOUND", "OLT tidak ditemukan.");
    return Response.json({ success: true, data: ports });
  });
}
