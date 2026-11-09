import { withApiSession } from "@/lib/api";
import { listOnus } from "@/services/devices.service";
import { parseListOnusParams } from "@/validators/devices";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({
      data: await listOnus(
        parseListOnusParams(new URL(request.url).searchParams),
      ),
    }),
  );
}
