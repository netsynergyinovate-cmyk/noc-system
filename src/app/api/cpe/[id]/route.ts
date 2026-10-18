import { withApiSession } from "@/lib/api";
import { getCpeDevice } from "@/services/cpe-devices.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const { id } = await context.params;
    const data = await getCpeDevice(id);
    if (!data) return Response.json({ error: "Perangkat CPE tidak ditemukan" }, { status: 404 });
    return Response.json({ data });
  });
}
