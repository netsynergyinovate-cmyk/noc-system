import { withApiSession } from "@/lib/api";
import { getVlanPonTraffic, type VlanTrafficRange } from "@/services/vlan-traffic.service";

export const runtime = "nodejs";

const VALID_RANGES = new Set<VlanTrafficRange>(["live", "1h", "6h", "24h", "7d"]);

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const { searchParams } = new URL(request.url);
    const rawRange = searchParams.get("range") ?? "live";
    const normalizedRange: VlanTrafficRange =
      rawRange === "5m" ? "live" : VALID_RANGES.has(rawRange as VlanTrafficRange) ? (rawRange as VlanTrafficRange) : "live";

    const data = await getVlanPonTraffic({ range: normalizedRange });
    return Response.json({ ok: true, data });
  });
}
