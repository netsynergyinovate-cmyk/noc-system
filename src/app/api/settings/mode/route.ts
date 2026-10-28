import { withApiSession } from "@/lib/api";
import { getRuntimeModeStatus } from "@/services/runtime-mode.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const hostHeader = request.headers.get("host");
    const status = await getRuntimeModeStatus(hostHeader);

    return Response.json({
      data: status,
    });
  });
}
