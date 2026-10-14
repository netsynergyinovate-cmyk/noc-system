import { withApiSession } from "@/lib/api";
import { getDevicesStatusOverview } from "@/services/devices.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({ data: await getDevicesStatusOverview() }),
  );
}
