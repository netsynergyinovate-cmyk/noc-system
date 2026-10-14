import { withApiSession } from "@/lib/api";
import { evaluateSetupGate } from "@/lib/dashboard/setup-gate";
import { env } from "@/lib/env";
import { countConnectedDevices } from "@/services/devices.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const connected = await countConnectedDevices();
    const isDemo = env.DASHBOARD_DATA === "demo";
    const gate = evaluateSetupGate({ isDemo, connected });
    return Response.json({ data: { isDemo, connected, ...gate } });
  });
}
