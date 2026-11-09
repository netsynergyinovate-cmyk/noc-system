import { withApiSession } from "@/lib/api";
import {
  listCpeDevices,
  type CpeStatusFilter,
} from "@/services/cpe-devices.service";

export const runtime = "nodejs";

const STATUSES: readonly string[] = ["all", "online", "offline"];

function intParam(value: string | null): number | undefined {
  return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
}

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "all";
    const result = await listCpeDevices({
      search: params.get("search") ?? undefined,
      status: (STATUSES.includes(status) ? status : "all") as CpeStatusFilter,
      page: intParam(params.get("page")),
      limit: intParam(params.get("limit")),
    });
    return Response.json(result);
  });
}
